# 📌 ScrollStamp v1

> Bookmark scroll positions in AI chat conversations

ScrollStamp is a lightweight Chrome extension that saves and restores scroll positions on popular AI chat platforms, allowing you to quickly return to specific points in long conversations.

---

## 🎯 Overview

ScrollStamp v1 uses scroll percentage-based bookmarking to help you navigate lengthy AI conversations. Simply click to save your current position and return to it anytime.

---

## 🚀 Supported Platforms

Supports on every website except message based LLm's like chat gpt grok for those you could use 
  V2

---

## ✨ Features

- **  Scroll Position Bookmarking** — Save your exact scroll position as a percentage
- **💾 Persistent Storage** — Bookmarks are saved locally and persist across browser sessions
- **🔄 Instant Restoration** — Click any bookmark to scroll back to that exact position
- **🌐 Multi-Platform Support** — Works seamlessly across all major AI chat platforms
- **⚡ Lightweight** — Minimal footprint with no impact on page performance
- **🎨 Clean UI** — Simple, intuitive floating button interface

---

## 📁 Project Structure

```
scrollstamp-v1/
├── manifest.json      # Chrome extension configuration
├── content.js         # Core bookmarking logic
├── content.css        # Floating button styles
├── popup.html         # Extension popup structure
├── popup.css          # Popup styling
├── popup.js           # Popup interaction handling
└── README.md          # This file
```

---

## 🛠️ Installation

### From Source (Developer Mode)

1. **Download** — Clone or download this repository
   ```bash
   git clone https://github.com/yourusername/scrollstamp.git
   ```

2. **Open Chrome Extensions** — Navigate to `chrome://extensions/`

3. **Enable Developer Mode** — Toggle the switch in the top-right corner

4. **Load Extension** — Click "Load unpacked" and select the `scrollstamp-v1` folder

5. **Pin Extension** — Click the puzzle icon in Chrome toolbar and pin ScrollStamp

---

## 🎮 Usage Guide

### Creating a Bookmark

1. Navigate to any supported AI chat platform
2. Scroll to the position you want to bookmark
3. Click the floating **📌** button in the bottom-right corner
4. A confirmation toast will appear

### Viewing Your Bookmarks

1. Click the ScrollStamp icon in your browser toolbar
2. View all saved bookmarks with timestamps
3. Each bookmark shows the page URL and scroll position

### Returning to a Bookmark

1. Open the extension popup
2. Click on any saved bookmark
3. The page automatically scrolls to that position

### Managing Bookmarks

| Action | How To |
|--------|--------|
| Delete Single | Click the **✕** button on any bookmark |
| Clear All | Click "Clear All" at the bottom of the popup |

---

## ⚙️ How It Works

ScrollStamp v1 operates using a simple but effective approach:

1. **Position Detection** — Calculates current scroll position as a percentage of total page height
2. **Storage** — Saves bookmark data to Chrome's local storage with timestamp and URL
3. **Restoration** — Multiplies saved percentage by current page height to restore position

```javascript
// Simplified logic
const scrollPercentage = (scrollTop / scrollHeight) * 100;
// Later, to restore:
const scrollPosition = (scrollPercentage / 100) * scrollHeight;
```

---

## ⚠️ Known Limitations

| Limitation | Description |
|------------|-------------|
| Dynamic Content | Position may shift if page content changes after bookmarking |
| Lazy Loading | Pages with lazy-loaded content may not restore precisely |
| Single Page Apps | URL changes without full page reload may affect accuracy |
| No Message Context | Cannot identify specific messages, only scroll positions |

---

## 🔧 Technical Details

### Manifest Configuration

```json
{
  "manifest_version": 3,
  "name": "ScrollStamp",
  "version": "1.0.0",
  "permissions": ["storage", "activeTab"],
  "content_scripts": [{
    "matches": ["*://*.openai.com/*", "*://*.claude.ai/*", ...]
  }]
}
```

### Storage Schema

```javascript
{
  "scrollstamp_[url_hash]": [
    {
      "id": "unique_id",
      "percentage": 45.7,
      "timestamp": 1704326400000,
      "url": "https://chat.openai.com/c/..."
    }
  ]
}
```

---

## 🔄 Upgrade Path

**Considering upgrading to v2?** ScrollStamp v2 introduces message-based bookmarking for more precise navigation:

| Feature | v1 | v2 |
|---------|----|----|
| Bookmark Type | Scroll Position | Message-Based |
| Precision | Good | Excellent |
| Message Preview | ❌ | ✅ |
| Visual Feedback | Basic | Enhanced |
| Content Change Resilience | Low | High |

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
# Clone the repo
git clone https://github.com/yourusername/scrollstamp.git

# Navigate to v1 directory
cd scrollstamp/scrollstamp-v1

# Load in Chrome as unpacked extension
# Make changes and reload extension to test
```

---

## 🐛 Bug Reports

Found an issue? Please open a GitHub issue with:

- **Browser Version** — e.g., Chrome 120.0.6099.109
- **Platform** — Which AI chat platform you were using
- **Steps to Reproduce** — Detailed steps to recreate the issue
- **Expected Behavior** — What should have happened
- **Actual Behavior** — What actually happened
- **Screenshots** — If applicable

---

## 📄 License

This project is licensed under the MIT License.

```
MIT License

Copyright (c) 2024 ScrollStamp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 📞 Support

- **Documentation** — You're reading it!
- **Issues** — [GitHub Issues](https://github.com/yourusername/scrollstamp/issues)
- **Discussions** — [GitHub Discussions](https://github.com/yourusername/scrollstamp/discussions)

---

## 🙏 Acknowledgments

- Thanks to all contributors and users
- Built for the AI chat community
- Inspired by the need to navigate long AI conversations

---

<p align="center">
  <strong>ScrollStamp v1</strong><br>
  Simple scroll position bookmarking for AI chats
</p>

<p align="center">
  Made by Sathwik Perla for the AI chat community
</p>
