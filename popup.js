/**
 * popup.js — V4 com suporte multi-idioma e LangDB.
 *
 * Funcionalidades:
 *  - Toggle ativação/desativação
 *  - Seleção de línguas via chips
 *  - Troca de locale para tooltips
 *  - Legenda dinâmica por língua
 *  - Estado de carregamento do Kuromoji
 */

const toggleBtn = document.getElementById('toggleBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const langSelector = document.getElementById('langSelector');
const localeSelect = document.getElementById('localeSelect');
const legendTabs = document.getElementById('legendTabs');
const legendGrid = document.getElementById('legendGrid');

let allLanguages = [];
let selectedLangs = new Set();
let activeLegendTab = null;

// ── UI helpers ────────────────────────────────────────────────────

function setUI(state) {
  statusDot.className = 'status-dot';
  statusText.className = 'status-text';
  toggleBtn.classList.remove('active');
  toggleBtn.disabled = false;

  switch (state) {
    case 'on':
      toggleBtn.textContent = '🔴 Desativar Cores na Página';
      toggleBtn.classList.add('active');
      statusDot.classList.add('active');
      statusText.classList.add('active');
      statusText.textContent = 'Ativado';
      break;
    case 'loading':
      toggleBtn.textContent = '⏳ Carregando…';
      toggleBtn.disabled = true;
      statusDot.classList.add('loading');
      statusText.classList.add('loading');
      statusText.textContent = 'Carregando dicionários…';
      break;
    default:
      toggleBtn.textContent = '⚡ Ativar Cores na Página';
      statusText.textContent = 'Desativado';
  }
}

// ── Language Chips ────────────────────────────────────────────────

function renderLangChips() {
  langSelector.innerHTML = '';
  for (const lang of allLanguages) {
    const chip = document.createElement('div');
    chip.className = 'lang-chip' + (selectedLangs.has(lang.id) ? ' selected' : '');
    chip.innerHTML = `<span class="lang-icon">${lang.icon}</span><span class="lang-name">${lang.native}</span>`;
    chip.addEventListener('click', () => {
      if (selectedLangs.has(lang.id)) {
        selectedLangs.delete(lang.id);
      } else {
        selectedLangs.add(lang.id);
      }
      chrome.storage.local.set({ jpEnabledLangs: [...selectedLangs] });
      renderLangChips();
      renderLegendTabs();
      notifyContentScript('setEnabledLangs', { langIds: [...selectedLangs] });
    });
    langSelector.appendChild(chip);
  }
}

// ── Legend ─────────────────────────────────────────────────────────

function renderLegendTabs() {
  legendTabs.innerHTML = '';
  const enabledLangs = allLanguages.filter(l => selectedLangs.has(l.id));

  if (enabledLangs.length === 0) {
    legendGrid.innerHTML = '<div class="legend-empty">Selecione uma língua</div>';
    activeLegendTab = null;
    return;
  }

  // Se a tab ativa não está mais selecionada, pegar a primeira
  if (!activeLegendTab || !selectedLangs.has(activeLegendTab)) {
    activeLegendTab = enabledLangs[0].id;
  }

  // Tabs (só mostra se mais de 1 língua)
  if (enabledLangs.length > 1) {
    for (const lang of enabledLangs) {
      const tab = document.createElement('div');
      tab.className = 'legend-tab' + (activeLegendTab === lang.id ? ' active' : '');
      tab.textContent = lang.icon + ' ' + lang.native;
      tab.addEventListener('click', () => {
        activeLegendTab = lang.id;
        renderLegendTabs();
      });
      legendTabs.appendChild(tab);
    }
  }

  // Carregar legenda via content script
  loadLegend(activeLegendTab);
}

async function loadLegend(langId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      renderFallbackLegend(langId);
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getLegend',
      langId: langId,
    });

    if (response?.legend?.length > 0) {
      renderLegendGrid(response.legend, langId);
    } else {
      renderFallbackLegend(langId);
    }
  } catch {
    renderFallbackLegend(langId);
  }
}

function rgbaToHex(color) {
  if (!color) return '#ffffff';
  if (color.startsWith('#')) return color.slice(0, 7);
  if (color.startsWith('rgba') || color.startsWith('rgb')) {
    const parts = color.substring(color.indexOf('(') + 1).split(',').map(p => parseInt(p.trim()));
    return '#' + parts.slice(0, 3).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  return '#ffffff';
}

function renderLegendGrid(legend, langId) {
  legendGrid.innerHTML = '';
  for (const item of legend) {
    const el = document.createElement('div');
    el.className = 'legend-item';
    if (item.enabled === false) el.style.opacity = '0.4';

    const sampleText = item.sample ? item.sample + ' ' : '';
    const baseColor = item.style === 'sov' ? item.borderColor : item.color;
    const hexColor = rgbaToHex(baseColor);

    const controlsHtml = item.categoryId ? `
      <div class="legend-controls">
        <input type="checkbox" class="legend-toggle" data-cat="${item.categoryId}" ${item.enabled !== false ? 'checked' : ''} title="Ativar/Desativar">
        <input type="color" class="legend-color-picker" data-cat="${item.categoryId}" data-style="${item.style}" value="${hexColor}" title="Mudar cor">
      </div>
    ` : `
      <div class="legend-controls">
        <span class="legend-swatch" style="background:${item.color}; ${item.style === 'sov' ? `border: 2px solid ${item.borderColor || item.color}` : ''}"></span>
      </div>
    `;

    el.innerHTML = `${controlsHtml}<span class="legend-label">${sampleText}${item.label}</span>`;

    legendGrid.appendChild(el);
  }

  const toggles = legendGrid.querySelectorAll('.legend-toggle');
  toggles.forEach(t => t.addEventListener('change', (e) => updateCategory(langId, e.target.dataset.cat, 'enabled', e.target.checked)));

  const pickers = legendGrid.querySelectorAll('.legend-color-picker');
  pickers.forEach(p => p.addEventListener('change', (e) => updateCategoryColor(langId, e.target.dataset.cat, e.target.dataset.style, e.target.value)));
}

async function updateCategory(langId, catId, key, value) {
  const stored = await chrome.storage.local.get(['jpCustomStyles']);
  const styles = stored.jpCustomStyles || {};
  if (!styles[langId]) styles[langId] = {};
  if (!styles[langId][catId]) styles[langId][catId] = {};

  styles[langId][catId][key] = value;
  await chrome.storage.local.set({ jpCustomStyles: styles });
  notifyContentScript(styles);
  loadLegend(langId);
}

async function updateCategoryColor(langId, catId, styleType, hexValue) {
  const stored = await chrome.storage.local.get(['jpCustomStyles']);
  const styles = stored.jpCustomStyles || {};
  if (!styles[langId]) styles[langId] = {};
  if (!styles[langId][catId]) styles[langId][catId] = {};

  if (styleType === 'sov') {
    const r = parseInt(hexValue.slice(1, 3), 16);
    const g = parseInt(hexValue.slice(3, 5), 16);
    const b = parseInt(hexValue.slice(5, 7), 16);
    styles[langId][catId].borderColor = hexValue;
    styles[langId][catId].color = 'rgba(' + r + ', ' + g + ', ' + b + ', 0.18)';
  } else {
    styles[langId][catId].color = hexValue;
  }

  await chrome.storage.local.set({ jpCustomStyles: styles });
  notifyContentScript(styles);
  loadLegend(langId);
}

async function notifyContentScript(styles) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'updateCustomStyles', styles });
  }
}

function renderFallbackLegend(langId) {
  // Fallback: legenda genérica baseada no langId
  const fallbackData = {
    japanese: [
      { color: 'rgba(52,152,219,0.18)', borderColor: '#3498DB', label: 'Sujeito', sample: '[S]', style: 'sov' },
      { color: 'rgba(155,89,182,0.18)', borderColor: '#9B59B6', label: 'Objeto', sample: '[O]', style: 'sov' },
      { color: 'rgba(231,76,60,0.18)', borderColor: '#E74C3C', label: 'Verbo', sample: '[V]', style: 'sov' },
      { color: '#C0392B', label: 'は Tópico' },
      { color: '#D35400', label: 'が Sujeito' },
      { color: '#27AE60', label: 'に Alvo' },
      { color: '#2980B9', label: 'で Meio' },
      { color: '#8E44AD', label: 'を Objeto' },
      { color: '#16A085', label: 'と E/Com' },
      { color: '#F39C12', label: 'も Também' },
      { color: '#1ABC9C', label: 'の Posse' },
      { color: '#2C3E50', label: 'Auxiliares' },
      { color: '#E67E22', label: 'Final de frase' },
      { color: '#8E44AD', label: 'ば Condicionais' },
      { color: '#9B59B6', label: 'って Citação' },
      { color: '#E74C3C', label: 'て Conector' },
      { color: '#B7472A', label: 'た Passado' },
      { color: '#95A5A6', label: 'ない Negativo' },
      { color: '#3498DB', label: 'よう Volitivo' },
      { color: '#E74C3C', label: 'ろ/え Imperativo' },
      { color: '#2ECC71', label: 'ます Polido' },
      { color: '#E67E22', label: 'い Adjetivo' },
      { color: '#F39C12', label: 'な Adjetivo' },
    ],
    korean: [
      { color: '#C0392B', label: '은/는 Topic' },
      { color: '#D35400', label: '이/가 Subject' },
      { color: '#8E44AD', label: '을/를 Object' },
      { color: '#27AE60', label: '에 Place' },
      { color: '#2980B9', label: '에서 Action' },
      { color: '#1ABC9C', label: '의 Possessive' },
    ],
    chinese: [
      { color: '#C0392B', label: '的/地 Structural' },
      { color: '#D35400', label: '了/过/着 Aspect' },
      { color: '#E67E22', label: '吗/吧 Modal' },
      { color: '#27AE60', label: '在/把/被 Prep.' },
      { color: '#16A085', label: '和/但是 Conj.' },
      { color: '#8E44AD', label: '不/没 Adverb' },
    ],
  };

  const items = fallbackData[langId] || [];
  if (items.length > 0) {
    renderLegendGrid(items);
  } else {
    legendGrid.innerHTML = '<div class="legend-empty">Legenda indisponível</div>';
  }
}

// ── Communication with content script ─────────────────────────────

async function notifyContentScript(action, data = {}) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    return await chrome.tabs.sendMessage(tab.id, { action, ...data });
  } catch {
    return null;
  }
}

// ── Init ──────────────────────────────────────────────────────────

async function initPopup() {
  // Carregar estado salvo
  const stored = await chrome.storage.local.get([
    'jpHighlighterActive',
    'jpEnabledLangs',
    'jpLocale',
  ]);

  setUI(stored.jpHighlighterActive ? 'on' : 'off');
  selectedLangs = new Set(stored.jpEnabledLangs || ['japanese']);
  localeSelect.value = stored.jpLocale || 'pt-BR';

  // Carregar lista de línguas do content script
  try {
    const response = await notifyContentScript('getLanguages');
    if (response?.languages?.length > 0) {
      allLanguages = response.languages;
    }
  } catch { }

  // Fallback se o content script não respondeu
  if (allLanguages.length === 0) {
    allLanguages = [
      { id: 'japanese', name: 'Japonês', native: '日本語', icon: '🇯🇵', engine: 'kuromoji' },
      { id: 'korean', name: 'Coreano', native: '한국어', icon: '🇰🇷', engine: 'regex' },
      { id: 'chinese', name: 'Chinês', native: '中文', icon: '🇨🇳', engine: 'regex' },
    ];
  }

  renderLangChips();
  renderLegendTabs();
}

initPopup();

// ── Toggle ────────────────────────────────────────────────────────

toggleBtn.addEventListener('click', async () => {
  const { jpHighlighterActive } = await chrome.storage.local.get(['jpHighlighterActive']);
  const newState = !jpHighlighterActive;

  await chrome.storage.local.set({ jpHighlighterActive: newState });

  if (newState) {
    setUI('loading');
  } else {
    setUI('off');
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: newState ? 'activate' : 'deactivate'
    });

    if (response?.status === 'activated') {
      setUI('on');
      // Re-render legend agora que o content script está ativo
      renderLegendTabs();
    } else if (response?.status === 'loading') {
      setUI('loading');
      const poll = setInterval(async () => {
        try {
          const r = await chrome.tabs.sendMessage(tab.id, { action: 'status' });
          if (r?.status === 'ready' || r?.status === 'activated') {
            setUI('on');
            clearInterval(poll);
            renderLegendTabs();
          }
        } catch { clearInterval(poll); }
      }, 500);
    }
  } catch {
    await chrome.storage.local.set({ jpHighlighterActive: !newState });
    setUI(!newState ? 'on' : 'off');
  }
});

// ── Locale change ─────────────────────────────────────────────────

localeSelect.addEventListener('change', async () => {
  const newLocale = localeSelect.value;
  await chrome.storage.local.set({ jpLocale: newLocale });
  await notifyContentScript('setLocale', { locale: newLocale });
  // Re-render legend with new locale
  renderLegendTabs();
});
