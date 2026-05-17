/**
 * content.js — V4 com LangDB + Kuromoji + CSS Custom Highlight API
 *
 * Diferenças da V3:
 *  - V3: Partículas, cores e tooltips hardcoded em português.
 *  - V4: Tudo vem do banco de dados (languages/*.json).
 *        Suporta múltiplas línguas (japonês, coreano, chinês, etc.)
 *        Tooltips traduzidos para qualquer locale.
 *        Engine plugável: Kuromoji (morfológico) OU Regex (pattern-based).
 *
 * POS tags relevantes do Kuromoji (IPAdic):
 *  - 助詞 (joshi): partículas
 *    - 格助詞: caso (が, を, に, で, と, へ, から, まで)
 *    - 係助詞: tópico/binding (は, も)
 *    - 接続助詞: conjuntiva (て, ば, と, ので, のに, けど)
 *    - 終助詞: final de frase (ね, よ, ぞ, ぜ, わ, かな, かしら)
 *    - 副助詞: adverbial (って, でも, まで)
 *  - 助動詞 (jodōshi): auxiliares verbais
 *  - 動詞-非自立: verbos não-independentes (いる, ある, おく, しまう após て)
 */

// ═══════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
  'CODE', 'PRE', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO',
  'IFRAME', 'OBJECT', 'EMBED',
]);

let isActive   = false;
let tokenizer  = null;
let isLoading  = false;
let pendingActivation = false;

// Línguas ativas e dados compilados
let activeLangs    = [];      // [{ id, detectRegex, compiled, engine }]
let currentLocale  = 'pt-BR';

// Observador de mutações e navegação SPA
let observer       = null;
let debounceTimer  = null;
let lastUrl        = location.href;
const DEBOUNCE_MS  = 300;

// Estado do Highlight API (Sem modificar o DOM)
const nodeRanges     = new WeakMap();     // TextNode -> Range[]
const highlightMap   = new Map();         // Color -> Highlight object
const rangeData      = new WeakMap();     // Range -> { color, title }
const processedNodes = new WeakSet();     // TextNodes já processados

let tooltipEl = null;
let currentHoverRange = null;

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO DO LANGDB + KUROMOJI
// ═══════════════════════════════════════════════════════════════════

async function initLanguages() {
  // Carregar locale salvo ou padrão
  const stored = await chrome.storage.local.get(['jpLocale', 'jpEnabledLangs']);
  currentLocale = stored.jpLocale || 'pt-BR';
  const enabledLangIds = stored.jpEnabledLangs || ['japanese'];

  // Inicializar LangDB
  await LangDB.init(currentLocale);

  // Preparar línguas ativas
  activeLangs = [];
  for (const langId of enabledLangIds) {
    const compiled = LangDB.getCompiled(langId);
    const detectRegex = LangDB.getDetectRegex(langId);
    const entry = LangDB.getRegistryEntry(langId);
    if (compiled && detectRegex && entry) {
      activeLangs.push({
        id: langId,
        detectRegex,
        compiled,
        engine: entry.engine,
      });
    }
  }

  console.log(`[日本語カラー] LangDB pronto — ${activeLangs.length} língua(s) ativa(s): ${activeLangs.map(l => l.id).join(', ')}`);
}

function initTokenizer() {
  return new Promise((resolve, reject) => {
    if (tokenizer) { resolve(tokenizer); return; }
    if (isLoading) {
      const check = setInterval(() => {
        if (tokenizer) { clearInterval(check); resolve(tokenizer); }
      }, 200);
      return;
    }

    isLoading = true;
    const dicPath = chrome.runtime.getURL('dict/');

    if (typeof kuromoji === 'undefined') {
      reject(new Error('kuromoji.js não foi carregado'));
      return;
    }

    kuromoji.builder({ dicPath }).build((err, _tokenizer) => {
      isLoading = false;
      if (err) {
        console.error('[日本語カラー] Erro ao carregar Kuromoji:', err);
        reject(err);
      } else {
        tokenizer = _tokenizer;
        console.log('[日本語カラー] Kuromoji inicializado com sucesso ✓');
        resolve(tokenizer);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// DETECÇÃO DE LÍNGUA POR TEXTO
// ═══════════════════════════════════════════════════════════════════

function detectLanguagesInText(text) {
  const matches = [];
  for (const lang of activeLangs) {
    if (lang.detectRegex.test(text)) {
      matches.push(lang);
    }
  }
  return matches;
}

// ═══════════════════════════════════════════════════════════════════
// CSS HIGHLIGHTS E TOOLTIPS (SEM ALTERAR O DOM)
// ═══════════════════════════════════════════════════════════════════

function addHighlightCSS(color) {
  let styleEl = document.getElementById('jp-hl-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'jp-hl-styles';
    styleEl.textContent = `
      ::highlight(jp-hover) {
        background-color: rgba(0, 0, 0, 0.08) !important;
      }
    `;
    document.head.appendChild(styleEl);
  }
  const className = 'jp-color-' + color.replace('#', '');
  if (!styleEl.textContent.includes(className)) {
    styleEl.textContent += `
      ::highlight(${className}) {
        color: ${color} !important;
        text-decoration: underline dotted ${color} !important;
        text-underline-offset: 3px;
      }
    `;
  }
}

function removeRangesForNode(node) {
  const ranges = nodeRanges.get(node);
  if (ranges) {
    for (const r of ranges) {
      const data = rangeData.get(r);
      if (data) {
        const hl = highlightMap.get(data.color);
        if (hl) hl.delete(r);
      }
    }
    nodeRanges.delete(node);
  }
}

function createTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.id = 'jp-hl-tooltip';
  tooltipEl.style.cssText = `
    position: fixed;
    z-index: 999999;
    background: #2C3E50;
    color: #ECF0F1;
    padding: 6px 10px;
    border-radius: 4px;
    font-family: 'Segoe UI', sans-serif;
    font-size: 13px;
    pointer-events: none;
    box-shadow: 0 4px 6px rgba(0,0,0,0.2);
    display: none;
    white-space: nowrap;
    transition: opacity 0.1s;
  `;
  document.body.appendChild(tooltipEl);

  const hoverHl = new Highlight();
  CSS.highlights.set('jp-hover', hoverHl);
}

// Detecta o mouse passando por cima de um texto com Range destacado
document.addEventListener('mousemove', (e) => {
  if (!isActive) {
    if (tooltipEl) tooltipEl.style.display = 'none';
    return;
  }
  
  let range;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  }

  let foundRange = null;
  if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
    const node = range.startContainer;
    const offset = range.startOffset;
    
    const ranges = nodeRanges.get(node);
    if (ranges) {
      for (const r of ranges) {
        if (offset >= r.startOffset && offset < r.endOffset) {
          foundRange = r;
          break;
        }
      }
    }
  }

  if (foundRange) {
    const data = rangeData.get(foundRange);
    if (!tooltipEl) createTooltip();
    tooltipEl.textContent = data.title;
    tooltipEl.style.left = (e.clientX + 15) + 'px';
    tooltipEl.style.top = (e.clientY + 15) + 'px';
    tooltipEl.style.display = 'block';
    
    if (currentHoverRange !== foundRange) {
      currentHoverRange = foundRange;
      const hoverHl = CSS.highlights.get('jp-hover');
      if (hoverHl) {
        hoverHl.clear();
        hoverHl.add(foundRange);
      }
    }
  } else {
    if (tooltipEl) tooltipEl.style.display = 'none';
    if (currentHoverRange) {
      currentHoverRange = null;
      const hoverHl = CSS.highlights.get('jp-hover');
      if (hoverHl) hoverHl.clear();
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
// ANÁLISE MORFOLÓGICA (KUROMOJI ENGINE)
// ═══════════════════════════════════════════════════════════════════

function processTextNodeKuromoji(node, compiled) {
  if (!tokenizer) return;
  const text = node.nodeValue;
  if (!text) return;

  const tokens = tokenizer.tokenize(text);
  let currentIndex = 0;
  let i = 0;
  
  const ranges = nodeRanges.get(node) || [];

  while (i < tokens.length) {
    const tok = tokens[i];
    const style = resolveTokenStyle(tokens, i, compiled);

    if (style) {
      try {
        const range = new Range();
        range.setStart(node, currentIndex);
        range.setEnd(node, currentIndex + style.text.length);
        
        let hl = highlightMap.get(style.color);
        if (!hl) {
          hl = new Highlight();
          highlightMap.set(style.color, hl);
          CSS.highlights.set('jp-color-' + style.color.replace('#', ''), hl);
          addHighlightCSS(style.color);
        }
        
        hl.add(range);
        rangeData.set(range, { color: style.color, title: style.title });
        ranges.push(range);
      } catch (e) {
        // Range errors ocorrem se o texto mudou no exato milissegundo, ignora pacificamente
      }
      currentIndex += style.text.length;
      i += style.skip;
    } else {
      currentIndex += tok.surface_form.length;
      i++;
    }
  }

  if (ranges.length > 0) {
    nodeRanges.set(node, ranges);
  }
}

function resolveTokenStyle(tokens, idx, compiled) {
  const tok = tokens[idx];
  const pos = tok.pos;
  const pos1 = tok.pos_detail_1;
  const surface = tok.surface_form;

  const {
    particleStyle,
    finalParticleStyle,
    finalParticleMulti,
    conditionalStyle,
    quoteStyle,
    auxCompoundColor,
    auxCompoundMap,
    auxTeFormConfig,
    colloquialStyle,
    auxVerbalStyle,
    verbFormRules,
    verbConjugationRules,
    teFormStyle,
    adjectiveRules,
  } = compiled;

  // 1) Auxiliares compostos: て + verbo não-independente
  if (auxTeFormConfig && pos === auxTeFormConfig.triggerPOS && pos1 === auxTeFormConfig.triggerPOSDetail && auxTeFormConfig.triggers.has(surface)) {
    const next = tokens[idx + 1];
    if (next && next.pos === auxTeFormConfig.nextPOS && next.pos_detail_1 === auxTeFormConfig.nextPOSDetail) {
      const baseForm = next.basic_form || next.surface_form;
      const auxTitle = auxCompoundMap[baseForm] || auxCompoundMap[next.surface_form];
      if (auxTitle) {
        return { text: surface + next.surface_form, color: auxCompoundColor, title: auxTitle, skip: 2 };
      }
    }
  }

  // 2) Auxiliares coloquiais
  if (colloquialStyle[surface]) {
    const style = colloquialStyle[surface];
    return { text: surface, color: style.color, title: style.title, skip: 1 };
  }

  // 3) Partículas
  if (pos === '助詞') {
    if (quoteStyle[surface]) return { text: surface, color: quoteStyle[surface].color, title: quoteStyle[surface].title, skip: 1 };
    if (conditionalStyle[surface]) return { text: surface, color: conditionalStyle[surface].color, title: conditionalStyle[surface].title, skip: 1 };
    if (finalParticleMulti[surface]) return { text: surface, color: finalParticleMulti[surface].color, title: finalParticleMulti[surface].title, skip: 1 };
    
    if (pos1 === '終助詞' && finalParticleStyle) {
      return { text: surface, color: finalParticleStyle.color, title: finalParticleStyle.title + ' (' + surface + ')', skip: 1 };
    }

    // 5) Forma て standalone (quando NÃO seguida de auxiliar composto)
    if (teFormStyle && teFormStyle.surfaces.has(surface) && pos1 === teFormStyle.posDetail) {
      // Já tratado pelo check 1) se seguido de auxiliar, então aqui só chega o て "solto"
      const next = tokens[idx + 1];
      const isAuxNext = next && next.pos === '動詞' && next.pos_detail_1 === '非自立';
      if (!teFormStyle.skipIfNextIsAuxiliary || !isAuxNext) {
        return { text: surface, color: teFormStyle.color, title: teFormStyle.title, skip: 1 };
      }
    }

    if (particleStyle[surface]) {
      const s = particleStyle[surface];
      return { text: surface, color: s.color, title: s.title, skip: 1 };
    }
  }

  // 4) Auxiliares verbais (たら / なら como 助動詞) — alta prioridade
  if (pos === '助動詞') {
    for (const [auxSurface, auxData] of Object.entries(auxVerbalStyle)) {
      if (surface === auxSurface || (auxData.altMatchField && tok[auxData.altMatchField] === auxSurface)) {
        return { text: surface, color: auxData.color, title: auxData.title, skip: 1 };
      }
    }
  }

  // 6) Formas verbais (た, ない, ます, う, よう, です, etc.)
  if (pos === '助動詞' && verbFormRules && verbFormRules.length > 0) {
    for (const rule of verbFormRules) {
      if (tok.pos !== rule.pos) continue;
      const fieldValue = tok[rule.matchField];
      if (fieldValue === rule.matchValue) {
        // Verificar exclusões de surface (ex: だ como auxiliar mas não な/なら)
        if (rule.surfaceExclude.length > 0 && rule.surfaceExclude.includes(surface)) continue;
        return { text: surface, color: rule.color, title: rule.title, skip: 1 };
      }
    }
  }

  // 7) Conjugações verbais (imperativo: 命令形)
  if (pos === '動詞' && verbConjugationRules && verbConjugationRules.length > 0) {
    for (const rule of verbConjugationRules) {
      if (tok.pos !== rule.pos) continue;
      // Kuromoji usa conjugated_form (ex: "命令ｅ", "命令ｉ", "命令ro")
      const conjForm = tok.conjugated_form || '';
      if (conjForm.includes(rule.conjugatedFormMatch)) {
        return { text: surface, color: rule.color, title: rule.title, skip: 1 };
      }
    }
  }

  // 8) Adjetivos (い-adj: 形容詞-自立, な-adj: 名詞-形容動詞語幹)
  if (adjectiveRules && adjectiveRules.length > 0) {
    for (const rule of adjectiveRules) {
      if (tok.pos === rule.pos && tok.pos_detail_1 === rule.posDetail) {
        return { text: surface, color: rule.color, title: rule.title, skip: 1 };
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// ANÁLISE POR REGEX (REGEX ENGINE — PARA COREANO, CHINÊS, ETC.)
// ═══════════════════════════════════════════════════════════════════

function processTextNodeRegex(node, compiled) {
  const text = node.nodeValue;
  if (!text) return;

  const ranges = nodeRanges.get(node) || [];

  for (const rule of compiled.regexRules) {
    // Reset regex lastIndex para cada nó
    rule.regex.lastIndex = 0;
    let match;

    while ((match = rule.regex.exec(text)) !== null) {
      try {
        const startIdx = match.index;
        const endIdx = startIdx + match[0].length;

        const range = new Range();
        range.setStart(node, startIdx);
        range.setEnd(node, endIdx);

        let hl = highlightMap.get(rule.color);
        if (!hl) {
          hl = new Highlight();
          highlightMap.set(rule.color, hl);
          CSS.highlights.set('jp-color-' + rule.color.replace('#', ''), hl);
          addHighlightCSS(rule.color);
        }

        hl.add(range);
        rangeData.set(range, { color: rule.color, title: rule.title });
        ranges.push(range);
      } catch (e) {
        // Ignora erros de Range
      }
    }
  }

  if (ranges.length > 0) {
    nodeRanges.set(node, ranges);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TREE WALKER — PROCESSA TODOS OS TEXT NODES
// ═══════════════════════════════════════════════════════════════════

function processSubtree(root) {
  if (!root) return 0;
  if (activeLangs.length === 0) return 0;

  // Verifica se pelo menos o Kuromoji está pronto (se necessário)
  const needsKuromoji = activeLangs.some(l => l.engine === 'kuromoji');
  if (needsKuromoji && !tokenizer) return 0;

  // Construir regex combinado de todas as línguas ativas
  const combinedPattern = activeLangs.map(l => l.detectRegex.source).join('|');
  const combinedRegex = new RegExp(combinedPattern);

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (!combinedRegex.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let count = 0;
  let current;
  while ((current = walker.nextNode())) {
    if (processedNodes.has(current)) continue;
    processedNodes.add(current);

    // Detectar quais línguas estão presentes no nó
    const matchedLangs = detectLanguagesInText(current.nodeValue);
    for (const lang of matchedLangs) {
      if (lang.engine === 'kuromoji' && tokenizer) {
        processTextNodeKuromoji(current, lang.compiled);
      } else if (lang.engine === 'regex') {
        processTextNodeRegex(current, lang.compiled);
      }
    }

    count++;
  }

  return count;
}

function processPage() {
  const count = processSubtree(document.body);
  if (count > 0) {
    console.log(`[日本語カラー] Processados ${count} nós de texto.`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// MUTATION OBSERVER — CONTEÚDO DINÂMICO
// ═══════════════════════════════════════════════════════════════════

let pendingNodes = [];

function scheduleDebouncedProcess() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (!isActive) return;

    const nodes = pendingNodes.splice(0);
    const unique = deduplicateNodes(nodes);
    let total = 0;
    for (const node of unique) {
      if (node.isConnected) {
        total += processSubtree(node);
      }
    }
    if (total > 0) {
      console.log(`[日本語カラー] Dinâmico: ${total} nós processados.`);
    }
  }, DEBOUNCE_MS);
}

function deduplicateNodes(nodes) {
  if (nodes.length <= 1) return nodes;
  const set = new Set(nodes);
  return nodes.filter(node => {
    let parent = node.parentElement;
    while (parent && parent !== document.body) {
      if (set.has(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

function containsAnyLanguage(text) {
  return activeLangs.some(l => l.detectRegex.test(text));
}

function startObserver() {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    if (!isActive) return;

    let hasWork = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const added of mutation.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE) {
            pendingNodes.push(added);
            hasWork = true;
          } else if (added.nodeType === Node.TEXT_NODE && containsAnyLanguage(added.nodeValue)) {
            pendingNodes.push(added.parentElement);
            hasWork = true;
          }
        }
      }

      if (mutation.type === 'characterData') {
        const target = mutation.target;
        removeRangesForNode(target);
        processedNodes.delete(target);
        
        if (containsAnyLanguage(target.nodeValue)) {
          pendingNodes.push(target.parentElement);
          hasWork = true;
        }
      }
    }

    if (hasWork) {
      scheduleDebouncedProcess();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log('[日本語カラー] MutationObserver ativado ✓');
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  clearTimeout(debounceTimer);
  pendingNodes = [];
}

// ═══════════════════════════════════════════════════════════════════
// DETECÇÃO DE NAVEGAÇÃO SPA (pushState / replaceState / popstate)
// ═══════════════════════════════════════════════════════════════════

let historyPatched = false;

function onSpaNavigation() {
  const newUrl = location.href;
  if (newUrl === lastUrl) return;
  lastUrl = newUrl;

  if (!isActive) return;

  console.log(`[日本語カラー] Navegação SPA detectada → ${newUrl}`);

  setTimeout(() => {
    if (isActive) processPage();
  }, 800);
}

function patchHistory() {
  if (historyPatched) return;
  historyPatched = true;

  const origPush = history.pushState;
  history.pushState = function (...args) {
    origPush.apply(this, args);
    onSpaNavigation();
  };

  const origReplace = history.replaceState;
  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    onSpaNavigation();
  };

  window.addEventListener('popstate', onSpaNavigation);

  console.log('[日本語カラー] Detecção SPA ativada ✓');
}

// ═══════════════════════════════════════════════════════════════════
// LIMPAR HIGHLIGHTS
// ═══════════════════════════════════════════════════════════════════

function clearHighlights() {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    for (const key of highlightMap.keys()) {
      CSS.highlights.delete('jp-color-' + key.replace('#', ''));
    }
    CSS.highlights.delete('jp-hover');
  }
  highlightMap.clear();
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════
// ATIVAÇÃO / DESATIVAÇÃO
// ═══════════════════════════════════════════════════════════════════

async function activate() {
  try {
    // 1) Carregar banco de dados de línguas
    await initLanguages();

    // 2) Inicializar Kuromoji se alguma língua precisa
    const needsKuromoji = activeLangs.some(l => l.engine === 'kuromoji');
    if (needsKuromoji) {
      await initTokenizer();
    }

    // 3) Processar página
    processPage();
    isActive = true;
    startObserver();
    patchHistory();
    return 'activated';
  } catch (err) {
    console.error('[日本語カラー] Falha ao ativar:', err);
    return 'error';
  }
}

function deactivate() {
  isActive = false;
  stopObserver();
  clearHighlights();
  return 'deactivated';
}

// ═══════════════════════════════════════════════════════════════════
// MENSAGENS DO POPUP
// ═══════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'activate') {
    if (isLoading) {
      pendingActivation = true;
      sendResponse({ status: 'loading' });
      return true;
    }
    activate().then((status) => {
      sendResponse({ status });
    });
    return true; 
  }

  if (message.action === 'deactivate') {
    sendResponse({ status: deactivate() });
    return true;
  }

  if (message.action === 'status') {
    if (isLoading) {
      sendResponse({ status: 'loading' });
    } else if (isActive) {
      sendResponse({ status: 'ready' });
    } else {
      sendResponse({ status: 'off' });
    }
    return true;
  }

  // Novos comandos para o popup multi-idioma
  if (message.action === 'getLanguages') {
    (async () => {
      if (!LangDB.isReady()) await LangDB.init(currentLocale);
      sendResponse({ languages: LangDB.getLanguages() });
    })();
    return true;
  }

  if (message.action === 'getLegend') {
    const langId = message.langId || 'japanese';
    if (!LangDB.isReady()) {
      sendResponse({ legend: [] });
    } else {
      sendResponse({ legend: LangDB.getLegend(langId) });
    }
    return true;
  }

  if (message.action === 'setLocale') {
    currentLocale = message.locale || 'pt-BR';
    chrome.storage.local.set({ jpLocale: currentLocale });
    if (LangDB.isReady()) {
      LangDB.setLocale(currentLocale);
      // Recompilar línguas ativas
      for (const lang of activeLangs) {
        lang.compiled = LangDB.getCompiled(lang.id);
      }
    }
    sendResponse({ status: 'ok', locale: currentLocale });
    return true;
  }

  if (message.action === 'setEnabledLangs') {
    const langIds = message.langIds || ['japanese'];
    chrome.storage.local.set({ jpEnabledLangs: langIds });
    // Se ativo, recarregar
    if (isActive) {
      deactivate();
      activate().then(() => {
        sendResponse({ status: 'reloaded' });
      });
      return true;
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  return false;
});

chrome.storage.local.get(['jpHighlighterActive'], (result) => {
  if (result.jpHighlighterActive) {
    requestAnimationFrame(() => activate());
  }
});
