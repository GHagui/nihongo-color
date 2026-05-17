# Contributing to NihongoColor

First off, thank you for considering contributing to **NihongoColor**! It's people like you that make open-source tools great.

### How Can I Contribute?

#### 1. Adding New Languages
NihongoColor is entirely data-driven! You can add a new language without changing a single line of JavaScript.
- Create a new JSON file in the `languages/` folder (e.g., `languages/thai.json`).
- Define the `categories`, `particles`, `regexRules`, and `legend`.
- Register the new file in `languages/registry.json`.
- Restart the extension and test it.

#### 2. Improving Existing Language Packs
Did you spot a missing particle or a wrong color mapping? 
- Open `languages/japanese.json` (or `korean.json`, etc.).
- Update the rules, arrays, or tooltips.
- Submit a Pull Request!

#### 3. Code Contributions (JavaScript/CSS)
If you want to improve the `content.js` engine (e.g., tweaking the `CSS Custom Highlight API` implementation or the `MutationObserver` performance):
1. Fork the repo and create your branch from `main`.
2. Make sure you test your changes on heavy websites (like YouTube with subtitles or long Wikipedia articles).
3. Ensure no DOM elements are unnecessarily injected to prevent SPA breaks.
4. Issue that pull request!

### Development Setup
1. Clone the repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extension folder.
5. You can inspect the popup or background scripts using Chrome DevTools.