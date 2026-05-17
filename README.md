<p align="center">
  <img src="icons/icon128.png" alt="NihongoColor Logo" width="96" height="96">
</p>

<h1 align="center">日本語カラー — NihongoColor</h1>

<p align="center">
  <strong>Multi-language grammar highlighter for the browser</strong><br>
  Real-time morphological analysis that color-codes particles, verb forms, adjectives, and grammar structures — right on any webpage.
</p>

<p align="center">
  <a href="#features"><img src="https://img.shields.io/badge/languages-Japanese%20%7C%20Korean%20%7C%20Chinese-blue?style=flat-square" alt="Languages"></a>
  <a href="#"><img src="https://img.shields.io/badge/manifest-v3-green?style=flat-square&logo=googlechrome" alt="Manifest V3"></a>
  <a href="#"><img src="https://img.shields.io/badge/engine-Kuromoji%20NLP-orange?style=flat-square" alt="Kuromoji"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-purple?style=flat-square" alt="MIT License"></a>
</p>

---

## ✨ What is this?

**NihongoColor** is a Chrome Extension (Manifest V3) that performs **real-time grammar highlighting** on any webpage. Instead of modifying the DOM, it uses the native [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API) for **zero-impact** rendering — fully compatible with SPAs, Google Translate, and dynamic content.

For **Japanese**, it uses [Kuromoji.js](https://github.com/takuyaa/kuromoji.js) for morphological analysis (tokenization + POS tagging). For **Korean** and **Chinese**, it uses pattern-based regex matching. New languages can be added by simply dropping a JSON file — no code changes needed.

> **Hover over any highlighted word** to see a tooltip explaining its grammatical function in your preferred language (Portuguese, English, Japanese, Korean, or Chinese).

---

## 🔥 New Features

- **🎨 Full UI Customization:** Open the extension popup to instantly **toggle grammar categories** on/off or **change their colors** using the built-in color picker. Your preferences are saved automatically!
- **🧠 Subject-Object-Verb (SOV) Engine:** A revolutionary dual-layer parser! While grammatical particles have their text colored, their corresponding Subject, Object, and Verb clauses receive an elegant **background highlight + colored border** for deeper syntactical understanding.
- **🎬 Instant Subtitle Sync (Netflix & YouTube):** The engine detects when you are watching a video (YouTube, Netflix, Crunchyroll, Prime Video, etc.) and drops the internal analysis latency to **50ms**. Grammars are highlighted instantly the moment a subtitle appears on screen!

---

## 🎯 Features

### 🇯🇵 Japanese (Kuromoji NLP Engine)

| Category | Color | Examples |
|----------|-------|----------|
| **は** Topic marker | 🔴 Red | 私**は**学生です |
| **が** Subject | 🟠 Orange | 猫**が**います |
| **に** Target / Place / Time | 🟢 Green | 学校**に**行く |
| **で** Location / Means | 🔵 Blue | 図書館**で**読む |
| **を** Direct Object | 🟣 Purple | パン**を**食べる |
| **と** And / With / Quote | 🩵 Teal | 友達**と**映画 |
| **も** Also | 🟡 Yellow | 私**も**行く |
| **の** Possessive | 💚 Mint | 私**の**本 |
| **って** Informal Quote | 💜 Amethyst | 好きだ**って**言った |
| **ね/よ/ぞ/ぜ** Sentence-final | 🟠 Orange | 面白い**ね** |
| **ば/たら/なら** Conditionals | 🟣 Purple | 安けれ**ば**買う |
| **ている/てある/ておく** Auxiliaries | ⚫ Dark | 読ん**でいる** |
| **た** Past tense | 🟤 Brown | 食べ**た** |
| **ない** Negative | ⚪ Gray | 行か**ない** |
| **ます/です** Polite | 🟢 Green | 食べ**ます** |
| **よう/おう** Volitional | 🔵 Blue | 食べ**よう** |
| **命令形** Imperative | 🔴 Red | 行**け**！ |
| **い-adjectives** | 🟠 Orange | **面白い**本 |
| **な-adjectives** | 🟡 Yellow | **きれいな**花 |

### 🇰🇷 Korean (Regex Engine)

Particles: 은/는, 이/가, 을/를, 에, 에서, 의, 와/과, 도, 부터, 까지, 한테, 에게

### 🇨🇳 Chinese (Regex Engine)

Structural particles (的/地/得), aspect markers (了/过/着), modal particles (吗/吧/呢), prepositions (在/把/被), conjunctions, grammar adverbs

---

## 🏗️ Architecture

```
nihongo-color/
├── languages/                 # 🗄️ Scalable language database
│   ├── registry.json          # Central index of all languages
│   ├── japanese.json          # Full pack: particles, verbs, adjectives
│   ├── korean.json            # Korean particles + regex rules
│   └── chinese.json           # Chinese grammar patterns
├── lang-loader.js             # Loads registry + packs → compiled tables
├── content.js                 # Dual-engine highlighter (Kuromoji + Regex)
├── popup.html / popup.js      # Multi-language popup UI
├── manifest.json              # Chrome Extension Manifest V3
├── lib/kuromoji.js             # Kuromoji tokenizer (bundled)
└── dict/                      # IPAdic dictionary files (~16MB)
```

### Data-Driven Design

All grammar rules, colors, and tooltips live in **JSON files** — not in code. The extension reads `registry.json` to discover languages, loads each pack, and compiles fast lookup tables at runtime.

```
registry.json → lang-loader.js → compiled tables → content.js
                                                        ↓
                                              CSS Highlight API
                                              (zero DOM changes)
```

---

## 🌍 Adding a New Language

**Zero code changes required.** Just two steps:

### 1. Create `languages/thai.json`

```json
{
  "id": "thai",
  "version": "1.0.0",
  "engine": "regex",
  "categories": {
    "classifier": {
      "label": { "pt-BR": "Classificador", "en-US": "Classifier" },
      "color": "#E74C3C"
    }
  },
  "particles": { ... },
  "regexRules": [ ... ],
  "legend": [ ... ]
}
```

### 2. Register in `registry.json`

```json
{
  "id": "thai",
  "name": { "native": "ไทย", "en-US": "Thai", "pt-BR": "Tailandês" },
  "icon": "🇹🇭",
  "engine": "regex",
  "detectRegex": "[\\u0E00-\\u0E7F]",
  "packFile": "thai.json",
  "enabled": true
}
```

Done! 🎉

---

## 🚀 Installation

### From source (Developer mode)

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/nihongo-color.git
   ```

2. Open Chrome → `chrome://extensions/`

3. Enable **Developer mode** (top-right toggle)

4. Click **Load unpacked** → select the cloned folder

5. Navigate to any page with Japanese/Korean/Chinese text and click the extension icon

### Dependencies

The extension is self-contained. Kuromoji.js and its dictionary files are bundled. No build step is required.

If you want to update Kuromoji:
```bash
npm install
```

---

## 🎨 How It Works

1. **Detection** — Unicode regex identifies which languages are present in each text node
2. **Tokenization** — Kuromoji (for Japanese) performs morphological analysis; regex rules handle other languages
3. **Classification** — Each token is matched against the language pack's rules (particles, verb forms, adjectives, etc.)
4. **Highlighting** — The CSS Custom Highlight API applies colors without modifying the DOM (Dual-layer: text color for grammar, background+border for SOV structures)
5. **Tooltip** — `mousemove` listener finds highlighted ranges and shows localized tooltips
6. **Dynamic content** — `MutationObserver` + SPA navigation detection ensures new content is processed automatically (with custom 50ms ultra-low latency specifically mapped for video streaming platforms)

---

## 🌐 Localization

Tooltips are available in multiple languages. Select your preferred tooltip language from the popup:

- 🇧🇷 Português (BR)
- 🇺🇸 English (US)
- 🇯🇵 日本語
- 🇰🇷 한국어
- 🇨🇳 中文

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [Kuromoji.js](https://github.com/takuyaa/kuromoji.js) | Japanese morphological analysis (IPAdic) |
| [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API) | Zero-DOM text highlighting |
| Chrome Extension Manifest V3 | Extension platform |
| MutationObserver | Dynamic content detection |
| JSON Language Packs | Data-driven grammar rules |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  <strong>頑張ってください！ — Happy studying! 💜</strong>
</p>
