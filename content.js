/**
 * content.js — V4 with LangDB + Kuromoji + CSS Custom Highlight API
 *
 * Differences from V3:
 *  - V3: Particles, colors, and tooltips hardcoded in Portuguese.
 *  - V4: Everything comes from the database (languages/*.json).
 *        Supports multiple languages (Japanese, Korean, Chinese, etc.)
 *        Tooltips translated to any locale.
 *        Pluggable engine: Kuromoji (morphological) OR Regex (pattern-based).
 *
 * Relevant Kuromoji POS tags (IPAdic):
 *  - 助詞 (joshi): particles
 *    - 格助詞: case (が, を, に, で, と, へ, から, まで)
 *    - 係助詞: topic/binding (は, も)
 *    - 接続助詞: conjunctive (て, ば, と, ので, のに, けど)
 *    - 終助詞: sentence final (ね, よ, ぞ, ぜ, わ, かな, かしら)
 *    - 副助詞: adverbial (って, でも, まで)
 *  - 助動詞 (jodōshi): verbal auxiliaries
 *  - 動詞-非自立: non-independent verbs (いる, ある, おく, しまう after て)
 */

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
  'CODE', 'PRE', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO',
  'IFRAME', 'OBJECT', 'EMBED',
]);

let isActive = false;
let tokenizer = null;
let isLoading = false;
let pendingActivation = false;

// Active languages and compiled data
let activeLangs = [];      // [{ id, detectRegex, compiled, engine }]
let currentLocale = 'pt-BR';

// Mutation observer and SPA navigation
let observer = null;
let debounceTimer = null;
let lastUrl = location.href;
let DEBOUNCE_MS = 300;

// Optimization for video/subtitle sites
if (/(youtube\.com|netflix\.com|crunchyroll\.com|viki\.com|primevideo\.com|hulu\.com|animelon\.com)/i.test(location.hostname)) {
  DEBOUNCE_MS = 10;
  console.log('[NihongoColor] Video site detected. Debounce rate reduced to match subtitles.');
}
// Highlight API State (Without modifying the DOM)
const nodeRanges = new WeakMap();     // TextNode -> Range[]
const highlightMap = new Map();         // Color -> Highlight object
const rangeData = new WeakMap();     // Range -> { color, title }
const processedNodes = new WeakSet();     // TextNodes already processed

let tooltipEl = null;
let currentHoverRange = null;

// ═══════════════════════════════════════════════════════════════════
// LANGDB + KUROMOJI INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

async function initLanguages() {
  // Load saved or default locale
  const stored = await chrome.storage.local.get(['jpLocale', 'jpEnabledLangs']);
  currentLocale = stored.jpLocale || 'pt-BR';
  const enabledLangIds = stored.jpEnabledLangs || ['japanese'];

  // Initialize LangDB
  await LangDB.init(currentLocale);

  // Prepare active languages
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

  console.log(`[NihongoColor] LangDB ready — ${activeLangs.length} active language(s): ${activeLangs.map(l => l.id).join(', ')}`);
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
        console.error('[NihongoColor] Error loading Kuromoji:', err);
        reject(err);
      } else {
        tokenizer = _tokenizer;
        console.log('[NihongoColor] Kuromoji successfully initialized ✓');
        resolve(tokenizer);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// LANGUAGE DETECTION BY TEXT
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
// CSS HIGHLIGHTS AND TOOLTIPS (WITHOUT MODIFYING DOM)
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
        text-underline-offset: 3px;
      }
    `;
  }
}

// CSS for SOV roles (uses background-color, coexists with grammar colors)
const sovHighlightMap = new Map();  // sovKey -> Highlight

function addSovHighlightCSS(bgColor, borderColor, sovKey) {
  let styleEl = document.getElementById('jp-hl-styles');
  if (!styleEl) return;
  if (!styleEl.textContent.includes(sovKey)) {
    styleEl.textContent += `
      ::highlight(${sovKey}) {
        background-color: ${bgColor} !important;
        text-decoration: underline solid ${borderColor} !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 2px;
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

// Detects mouse hovering over text with highlighted Range
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

    // Show above cursor to not overlap Rikaikun (which appears below)
    tooltipEl.style.display = 'block';
    const tipH = tooltipEl.offsetHeight || 30;
    const tipW = tooltipEl.offsetWidth || 200;
    const OFFSET = 12;

    let top = e.clientY - tipH - OFFSET;
    let left = e.clientX + OFFSET;

    // Fallback: if it goes off top of screen, show below
    if (top < 4) top = e.clientY + OFFSET + 16;
    // Horizontal clamp: do not go off right edge
    if (left + tipW > window.innerWidth - 4) left = window.innerWidth - tipW - 8;
    // Left clamp
    if (left < 4) left = 4;

    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';

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
// MORPHOLOGICAL ANALYSIS (KUROMOJI ENGINE)
// ═══════════════════════════════════════════════════════════════════

function processTextNodeKuromoji(node, compiled) {
  if (!tokenizer) return;
  const text = node.nodeValue;
  if (!text) return;

  const tokens = tokenizer.tokenize(text);
  let currentIndex = 0;
  let i = 0;

  const ranges = nodeRanges.get(node) || [];

  // Pre-compute positions of each token for SOV pass
  const tokenPositions = [];
  let posAccum = 0;
  for (const tok of tokens) {
    tokenPositions.push({ start: posAccum, end: posAccum + tok.surface_form.length });
    posAccum += tok.surface_form.length;
  }

  // Pass 1: Grammar highlighting (particles, verb forms, adjectives)
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
        // Range errors occur if text changed at the exact millisecond, ignore peacefully
      }
      currentIndex += style.text.length;
      i += style.skip;
    } else {
      currentIndex += tok.surface_form.length;
      i++;
    }
  }

  // Pass 2: SOV role highlighting (background-color layer)
  if (compiled.sovRoles) {
    processSovPass(node, tokens, tokenPositions, compiled.sovRoles, ranges);
  }

  if (ranges.length > 0) {
    nodeRanges.set(node, ranges);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SOV PASS — SUBJECT / OBJECT / VERB (BACKGROUND LAYER)
// ═══════════════════════════════════════════════════════════════════

function isNounLike(token, sovRole) {
  const pos = token.pos;
  const pos1 = token.pos_detail_1;
  // Noun + not excluded subtypes (非自立, 接尾)
  if (sovRole.nounPOS.has(pos) && !sovRole.nounPOSExclude.has(pos1)) return true;
  // Also include prefix/prenominal (接頭詞, 連体詞)
  if (sovRole.alsoIncludePOS.has(pos)) return true;
  return false;
}

function addSovRange(node, start, end, sovRole, ranges) {
  try {
    const range = new Range();
    range.setStart(node, start);
    range.setEnd(node, end);

    const sovKey = 'jp-sov-' + sovRole.borderColor.replace('#', '');
    let hl = sovHighlightMap.get(sovKey);
    if (!hl) {
      hl = new Highlight();
      sovHighlightMap.set(sovKey, hl);
      CSS.highlights.set(sovKey, hl);
      addSovHighlightCSS(sovRole.color, sovRole.borderColor, sovKey);
    }

    hl.add(range);
    rangeData.set(range, { color: sovRole.borderColor, title: sovRole.title });
    ranges.push(range);
  } catch (e) {
    // Ignore Range errors
  }
}

function processSovPass(node, tokens, tokenPositions, sovRoles, ranges) {
  // 1) Subject & Object: find trigger particles and look back
  for (const role of ['subject', 'object']) {
    const config = sovRoles[role];
    if (!config) continue;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.pos !== config.triggerPOS) continue;
      if (!config.triggerParticles.has(tok.surface_form)) continue;

      // Lookback: find consecutive nouns before the particle
      let spanStart = null;
      let spanEnd = null;

      for (let j = i - 1; j >= 0; j--) {
        if (isNounLike(tokens[j], config)) {
          spanStart = tokenPositions[j].start;
          if (spanEnd === null) spanEnd = tokenPositions[j].end;
        } else {
          break; // Stop at first non-noun token
        }
      }

      if (spanStart !== null && spanEnd !== null) {
        addSovRange(node, spanStart, spanEnd, config, ranges);
      }
    }
  }

  // 2) Verb: independent verbs (動詞 + 自立)
  if (sovRoles.verb) {
    const config = sovRoles.verb;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.pos === config.pos && tok.pos_detail_1 === config.posDetail) {
        addSovRange(node, tokenPositions[i].start, tokenPositions[i].end, config, ranges);
      }
    }
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
    specificWordsStyle,
  } = compiled;

  // 0) Specific words (Demonstratives, etc) - Highest priority
  if (specificWordsStyle && specificWordsStyle[surface]) {
    const style = specificWordsStyle[surface];
    return { text: surface, color: style.color, title: style.title, skip: 1 };
  }

  // 1) Compound auxiliaries: て + non-independent verb
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

  // 2) Colloquial auxiliaries
  if (colloquialStyle[surface]) {
    const style = colloquialStyle[surface];
    return { text: surface, color: style.color, title: style.title, skip: 1 };
  }

  // 3) Particles
  if (pos === '助詞') {
    if (quoteStyle[surface]) return { text: surface, color: quoteStyle[surface].color, title: quoteStyle[surface].title, skip: 1 };
    if (conditionalStyle[surface]) return { text: surface, color: conditionalStyle[surface].color, title: conditionalStyle[surface].title, skip: 1 };
    if (finalParticleMulti[surface]) return { text: surface, color: finalParticleMulti[surface].color, title: finalParticleMulti[surface].title, skip: 1 };

    if (pos1 === '終助詞' && finalParticleStyle) {
      return { text: surface, color: finalParticleStyle.color, title: finalParticleStyle.title + ' (' + surface + ')', skip: 1 };
    }

    // 5) Standalone て form (when NOT followed by compound auxiliary)
    if (teFormStyle && teFormStyle.surfaces.has(surface) && pos1 === teFormStyle.posDetail) {
      // Already handled by check 1) if followed by auxiliary, so only "loose" て arrives here
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

  // 4) Verbal auxiliaries (たら / なら as 助動詞) — high priority
  if (pos === '助動詞') {
    for (const [auxSurface, auxData] of Object.entries(auxVerbalStyle)) {
      if (surface === auxSurface || (auxData.altMatchField && tok[auxData.altMatchField] === auxSurface)) {
        return { text: surface, color: auxData.color, title: auxData.title, skip: 1 };
      }
    }
  }

  // 6) Verb forms (た, ない, ます, う, よう, です, etc.)
  if (pos === '助動詞' && verbFormRules && verbFormRules.length > 0) {
    for (const rule of verbFormRules) {
      if (tok.pos !== rule.pos) continue;
      const fieldValue = tok[rule.matchField];
      if (fieldValue === rule.matchValue) {
        // Check surface exclusions (e.g. だ as auxiliary but not な/なら)
        if (rule.surfaceExclude.length > 0 && rule.surfaceExclude.includes(surface)) continue;
        return { text: surface, color: rule.color, title: rule.title, skip: 1 };
      }
    }
  }

  // 7) Verb conjugations (imperative: 命令形)
  if (pos === '動詞' && verbConjugationRules && verbConjugationRules.length > 0) {
    for (const rule of verbConjugationRules) {
      if (tok.pos !== rule.pos) continue;
      // Kuromoji uses conjugated_form (e.g. "命令ｅ", "命令ｉ", "命令ro")
      const conjForm = tok.conjugated_form || '';
      if (conjForm.includes(rule.conjugatedFormMatch)) {
        return { text: surface, color: rule.color, title: rule.title, skip: 1 };
      }
    }
  }

  // 8) Adjectives (い-adj: 形容詞-自立, な-adj: 名詞-形容動詞語幹)
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
// REGEX ANALYSIS (REGEX ENGINE — FOR KOREAN, CHINESE, ETC.)
// ═══════════════════════════════════════════════════════════════════

function processTextNodeRegex(node, compiled) {
  const text = node.nodeValue;
  if (!text) return;

  const ranges = nodeRanges.get(node) || [];

  for (const rule of compiled.regexRules) {
    // Reset regex lastIndex for each node
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
        // Ignore Range errors
      }
    }
  }

  if (ranges.length > 0) {
    nodeRanges.set(node, ranges);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TREE WALKER — PROCESS ALL TEXT NODES
// ═══════════════════════════════════════════════════════════════════

function processSubtree(root) {
  if (!root) return 0;
  if (activeLangs.length === 0) return 0;

  // Check if at least Kuromoji is ready (if necessary)
  const needsKuromoji = activeLangs.some(l => l.engine === 'kuromoji');
  if (needsKuromoji && !tokenizer) return 0;

  // Build combined regex from all active languages
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

    // Detect which languages are present in the node
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
    console.log(`[NihongoColor] Processed ${count} text nodes.`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// MUTATION OBSERVER — DYNAMIC CONTENT
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
      console.log(`[NihongoColor] Dynamic: ${total} nodes processed.`);
    }
  }, DEBOUNCE_MS);
}

function deduplicateNodes(nodes) {
  if (nodes.length <= 1) return nodes;
  const set = new Set(nodes);
  return nodes.filter(node => {
    if (!node) return false;
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
            if (added.parentElement) {
              pendingNodes.push(added.parentElement);
              hasWork = true;
            }
          }
        }
      }

      if (mutation.type === 'characterData') {
        const target = mutation.target;
        removeRangesForNode(target);
        processedNodes.delete(target);

        if (containsAnyLanguage(target.nodeValue)) {
          if (target.parentElement) {
            pendingNodes.push(target.parentElement);
            hasWork = true;
          }
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

  console.log('[NihongoColor] MutationObserver activated ✓');
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
// SPA NAVIGATION DETECTION (pushState / replaceState / popstate)
// ═══════════════════════════════════════════════════════════════════

let historyPatched = false;

function onSpaNavigation() {
  const newUrl = location.href;
  if (newUrl === lastUrl) return;
  lastUrl = newUrl;

  if (!isActive) return;

  console.log(`[NihongoColor] SPA navigation detected → ${newUrl}`);

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

  console.log('[NihongoColor] SPA detection activated ✓');
}

// ═══════════════════════════════════════════════════════════════════
// CLEAR HIGHLIGHTS
// ═══════════════════════════════════════════════════════════════════

function clearHighlights() {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    for (const key of highlightMap.keys()) {
      CSS.highlights.delete('jp-color-' + key.replace('#', ''));
    }
    for (const key of sovHighlightMap.keys()) {
      CSS.highlights.delete(key);
    }
    CSS.highlights.delete('jp-hover');
  }
  highlightMap.clear();
  sovHighlightMap.clear();
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVATION / DEACTIVATION
// ═══════════════════════════════════════════════════════════════════

async function activate() {
  try {
    // 1) Load languages database
    await initLanguages();

    // 2) Initialize Kuromoji if any language needs it
    const needsKuromoji = activeLangs.some(l => l.engine === 'kuromoji');
    if (needsKuromoji) {
      await initTokenizer();
    }

    // 3) Process page
    processPage();
    isActive = true;
    startObserver();
    patchHistory();
    return 'activated';
  } catch (err) {
    console.error('[NihongoColor] Failed to activate:', err);
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
// POPUP MESSAGES
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

  // New commands for multi-language popup
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
      // Recompile active languages
      for (const lang of activeLangs) {
        lang.compiled = LangDB.getCompiled(lang.id);
      }
    }
    sendResponse({ status: 'ok', locale: currentLocale });
    return true;
  }

  if (message.action === 'updateCustomStyles') {
    if (LangDB.isReady()) {
      LangDB.updateCustomStyles(message.styles);
      for (const lang of activeLangs) {
        lang.compiled = LangDB.getCompiled(lang.id);
      }
      clearHighlights();
      nodeRanges.clear();
      rangeData.clear();
      if (isActive) processPage();
    }
    sendResponse({ status: 'ok' });
    return true;
  }

  if (message.action === 'setEnabledLangs') {
    const langIds = message.langIds || ['japanese'];
    chrome.storage.local.set({ jpEnabledLangs: langIds });
    // If active, reload
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
