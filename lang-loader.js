/**
 * lang-loader.js — Motor de carregamento de language packs
 *
 * Carrega o registry.json e os packs individuais (japanese.json, korean.json, etc.)
 * e expõe uma API limpa para o content.js consumir sem conhecer a estrutura interna.
 *
 * Arquitetura:
 *  registry.json  →  lista de línguas disponíveis + metadados
 *  {lang}.json    →  pack completo com partículas, categorias, tooltips localizados
 *  lang-loader.js →  lê tudo, resolve locale, e entrega objetos prontos para uso
 */

// ═══════════════════════════════════════════════════════════════════
// ESTADO DO LOADER
// ═══════════════════════════════════════════════════════════════════

const LangDB = {
  _registry: null,
  _packs: new Map(),       // langId -> parsed JSON
  _compiled: new Map(),    // langId -> compiled lookup tables
  _locale: 'pt-BR',
  _enabledLangs: new Set(),
  _ready: false,

  // ═══════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════

  async init(locale) {
    if (this._ready) return;
    this._locale = locale || 'pt-BR';

    // 1) Carregar registry e custom styles
    const registryUrl = chrome.runtime.getURL('languages/registry.json');
    const res = await fetch(registryUrl);
    this._registry = await res.json();
    
    const stored = await chrome.storage.local.get(['jpCustomStyles']);
    this._customStyles = stored.jpCustomStyles || {};

    // 2) Carregar cada pack habilitado
    const loadPromises = this._registry.languages
      .filter(lang => lang.enabled)
      .map(async (lang) => {
        try {
          const packUrl = chrome.runtime.getURL('languages/' + lang.packFile);
          const packRes = await fetch(packUrl);
          const pack = await packRes.json();
          this._packs.set(lang.id, pack);
          this._enabledLangs.add(lang.id);
          this._compiled.set(lang.id, this._compilePack(pack));
          console.log(`[LangDB] Pack carregado: ${lang.id} (${lang.name.native})`);
        } catch (err) {
          console.warn(`[LangDB] Erro ao carregar pack '${lang.id}':`, err);
        }
      });

    await Promise.all(loadPromises);
    this._ready = true;
    console.log(`[LangDB] Pronto — ${this._packs.size} línguas carregadas, locale: ${this._locale}`);
  },

  // ═══════════════════════════════════════════════════════════════
  // COMPILAÇÃO DE PACK → LOOKUP TABLES
  // ═══════════════════════════════════════════════════════════════

  _compilePack(pack) {
    const locale = this._locale;
    const cats = pack.categories || {};
    const langId = pack.id;
    const customStyles = this._customStyles[langId] || {};

    const catEnabled = (catId) => customStyles[catId]?.enabled !== false;

    // Resolve a cor e tooltip de uma categoria
    const catColor = (catId) => customStyles[catId]?.color || cats[catId]?.color || '#888';
    const catBorderColor = (catId) => customStyles[catId]?.borderColor || cats[catId]?.borderColor || catColor(catId);
    
    const catLabel = (catId) => {
      const cat = cats[catId];
      if (!cat) return catId;
      return cat.label[locale] || cat.label['en-US'] || cat.label[Object.keys(cat.label)[0]] || catId;
    };

    const resolveTooltip = (tooltipObj) => {
      if (!tooltipObj) return '';
      return tooltipObj[locale] || tooltipObj['en-US'] || tooltipObj[Object.keys(tooltipObj)[0]] || '';
    };

    // ── Partículas (caso/tópico/etc) ──
    const particleStyle = {};
    if (pack.particles) {
      for (const [surface, data] of Object.entries(pack.particles)) {
        if (catEnabled(data.category)) {
          particleStyle[surface] = {
            color: catColor(data.category),
            title: resolveTooltip(data.tooltip),
          };
        }
      }
    }

    // ── Final particles ──
    let finalParticleStyle = null;
    let finalParticleMulti = {};
    if (pack.finalParticles) {
      const fp = pack.finalParticles;
      if (catEnabled(fp.category)) {
        finalParticleStyle = {
          color: catColor(fp.category),
          title: catLabel(fp.category),
          surfaces: new Set(fp.surfaces || []),
        };
        if (fp.multiWord) {
          for (const [surface, data] of Object.entries(fp.multiWord)) {
            finalParticleMulti[surface] = {
              color: catColor(fp.category),
              title: resolveTooltip(data.tooltip),
            };
          }
        }
      }
    }

    // ── Condicionais ──
    const conditionalStyle = {};
    if (pack.conditionals) {
      for (const [surface, data] of Object.entries(pack.conditionals)) {
        if (catEnabled(data.category)) {
          conditionalStyle[surface] = {
            color: catColor(data.category),
            title: resolveTooltip(data.tooltip),
          };
        }
      }
    }

    // ── Citação ──
    const quoteStyle = {};
    if (pack.quotes) {
      for (const [surface, data] of Object.entries(pack.quotes)) {
        if (catEnabled(data.category)) {
          quoteStyle[surface] = {
            color: catColor(data.category),
            title: resolveTooltip(data.tooltip),
          };
        }
      }
    }

    // ── Auxiliares compostos (て + verbo) ──
    let auxCompoundColor = null;
    let auxCompoundMap = {};
    let auxTeFormConfig = null;
    if (pack.auxiliaryCompounds?.teForm) {
      const tf = pack.auxiliaryCompounds.teForm;
      if (catEnabled(tf.category)) {
        auxCompoundColor = catColor(tf.category);
        auxTeFormConfig = {
          triggers: new Set(tf.triggers || []),
          triggerPOS: tf.triggerPOS,
          triggerPOSDetail: tf.triggerPOSDetail,
          nextPOS: tf.nextPOS,
          nextPOSDetail: tf.nextPOSDetail,
        };
        for (const [verb, data] of Object.entries(tf.verbs || {})) {
          auxCompoundMap[verb] = resolveTooltip(data.tooltip);
        }
      }
    }

    // ── Coloquiais ──
    const colloquialStyle = {};
    if (pack.colloquials) {
      for (const [surface, data] of Object.entries(pack.colloquials)) {
        if (catEnabled(data.category)) {
          colloquialStyle[surface] = {
            color: catColor(data.category),
            title: resolveTooltip(data.tooltip),
          };
        }
      }
    }

    // ── Auxiliares verbais (たら, なら como 助動詞) ──
    const auxVerbalStyle = {};
    if (pack.auxiliaryVerbal) {
      for (const [surface, data] of Object.entries(pack.auxiliaryVerbal)) {
        if (catEnabled(data.category)) {
          auxVerbalStyle[surface] = {
            color: catColor(data.category),
            title: resolveTooltip(data.tooltip),
            matchField: data.matchField || 'surface_form',
            altMatchField: data.altMatchField || null,
          };
        }
      }
    }

    // ── Formas verbais (た, ない, ます, う, よう, etc.) ──
    const verbFormRules = [];
    if (pack.verbForms) {
      for (const [key, data] of Object.entries(pack.verbForms)) {
        if (catEnabled(data.category)) {
          verbFormRules.push({
            id: key,
            pos: data.pos,
            matchField: data.matchField,
            matchValue: data.matchValue,
            surfaceExclude: data.surfaceExclude || [],
            color: catColor(data.category),
            title: resolveTooltip(data.tooltip),
          });
        }
      }
    }

    // ── Conjugações verbais (imperativo, etc.) ──
    const verbConjugationRules = [];
    if (pack.verbConjugations) {
      for (const [key, data] of Object.entries(pack.verbConjugations)) {
        if (catEnabled(data.category)) {
          verbConjugationRules.push({
            id: key,
            pos: data.pos,
            conjugatedFormMatch: data.conjugatedFormMatch,
            color: catColor(data.category),
            title: resolveTooltip(data.tooltip),
          });
        }
      }
    }

    // ── Forma て standalone (quando não seguida de auxiliar) ──
    let teFormStyle = null;
    if (pack.teFormParticle) {
      const tf = pack.teFormParticle;
      if (catEnabled(tf.category)) {
        teFormStyle = {
          surfaces: new Set(tf.surfaces || []),
          pos: tf.pos,
          posDetail: tf.posDetail,
          skipIfNextIsAuxiliary: tf.skipIfNextIsAuxiliary || false,
          color: catColor(tf.category),
          title: resolveTooltip(tf.tooltip),
        };
      }
    }

    // ── Adjetivos (い-adj, な-adj) ──
    const adjectiveRules = [];
    if (pack.adjectives) {
      for (const [key, data] of Object.entries(pack.adjectives)) {
        if (catEnabled(data.category)) {
          adjectiveRules.push({
            id: key,
            pos: data.pos,
            posDetail: data.posDetail,
            color: catColor(data.category),
            title: resolveTooltip(data.tooltip),
          });
        }
      }
    }

    // ── SOV Roles (Sujeito-Objeto-Verbo) ──
    let sovRoles = null;
    if (pack.sovRoles) {
      const sr = pack.sovRoles;
      sovRoles = {};

      // Subject/Object: trigger particles + noun lookback
      for (const role of ['subject', 'object']) {
        if (sr[role]) {
          const r = sr[role];
          if (catEnabled(r.category)) {
            const cat = cats[r.category] || {};
            sovRoles[role] = {
              triggerParticles: new Set(r.triggerParticles || []),
              triggerPOS: r.triggerPOS,
              nounPOS: new Set(r.nounPOS || []),
              nounPOSExclude: new Set(r.nounPOSExclude || []),
              alsoIncludePOS: new Set(r.alsoIncludePOS || []),
              color: catColor(r.category),
              borderColor: catBorderColor(r.category),
              title: resolveTooltip(r.tooltip),
            };
          }
        }
      }

      // Verb: POS matching
      if (sr.verb) {
        const v = sr.verb;
        if (catEnabled(v.category)) {
          const cat = cats[v.category] || {};
          sovRoles.verb = {
            pos: v.pos,
            posDetail: v.posDetail,
            color: catColor(v.category),
            borderColor: catBorderColor(v.category),
            title: resolveTooltip(v.tooltip),
          };
        }
      }
    }

    // ── Regex rules (para engines regex-based) ──
    const regexRules = [];
    if (pack.regexRules) {
      for (const rule of pack.regexRules) {
        if (catEnabled(rule.category)) {
          const particleData = pack.particles?.[rule.tooltipKey];
          regexRules.push({
            id: rule.id,
            regex: new RegExp(rule.pattern, 'g'),
            color: catColor(rule.category),
            title: particleData ? resolveTooltip(particleData.tooltip) : catLabel(rule.category),
          });
        }
      }
    }

    // ── Legenda para o popup ──
    const legend = (pack.legend || []).map(item => ({
      categoryId: item.category,
      enabled: catEnabled(item.category),
      color: catColor(item.category),
      borderColor: catBorderColor(item.category),
      label: catLabel(item.category),
      sample: item.sample,
      style: item.style || 'grammar',
    }));

    return {
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
      sovRoles,
      regexRules,
      legend,
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════

  /** Lista de línguas disponíveis */
  getLanguages() {
    if (!this._registry) return [];
    return this._registry.languages
      .filter(l => l.enabled)
      .map(l => ({
        id: l.id,
        name: l.name[this._locale] || l.name['en-US'] || l.name.native,
        native: l.name.native,
        icon: l.icon,
        engine: l.engine,
      }));
  },

  /** Regex de detecção para uma língua */
  getDetectRegex(langId) {
    const lang = this._registry?.languages.find(l => l.id === langId);
    if (!lang) return null;
    return new RegExp(lang.detectRegex);
  },

  /** Tabelas compiladas para uma língua */
  getCompiled(langId) {
    return this._compiled.get(langId) || null;
  },

  /** Dados do registry para uma língua */
  getRegistryEntry(langId) {
    return this._registry?.languages.find(l => l.id === langId) || null;
  },

  /** Verifica se uma língua usa engine kuromoji */
  usesKuromoji(langId) {
    const entry = this.getRegistryEntry(langId);
    return entry?.engine === 'kuromoji';
  },

  /** Legenda formatada para o popup */
  getLegend(langId) {
    const compiled = this._compiled.get(langId);
    return compiled?.legend || [];
  },

  /** Locale atual */
  getLocale() {
    return this._locale;
  },

  /** Muda locale e recompila todos os packs */
  setLocale(newLocale) {
    this._locale = newLocale;
    for (const [langId, pack] of this._packs) {
      this._compiled.set(langId, this._compilePack(pack));
    }
    console.log(`[LangDB] Locale atualizado: ${newLocale}`);
  },

  /** Verifica se o loader está pronto */
  isReady() {
    return this._ready;
  },

  /** Atualiza estilos customizados (chamado pelo content.js) */
  updateCustomStyles(styles) {
    this._customStyles = styles;
    for (const langId of this._enabledLangs) {
      const pack = this._packs.get(langId);
      if (pack) {
        this._compiled.set(langId, this._compilePack(pack));
      }
    }
  }
};
