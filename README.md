# 📌 ScrollStamp v2.1

> Smart bookmarking for the web — Message-based for AI chats, scroll-based for everything else.

ScrollStamp is a browser extension that intelligently adapts its bookmarking behavior based on the website you're visiting. On AI chat platforms, it bookmarks specific assistant messages. On all other websites, it bookmarks your scroll position.

---

## 🎯 How It Works

| Site Type | Mode | What Gets Bookmarked |
|-----------|------|---------------------|
| AI Chat Platforms | **Message Mode** | Specific AI assistant responses |
| All Other Websites | **Scroll Mode** | Scroll position (with context preview) |

The extension automatically detects which mode to use — no configuration needed.

---

## ✨ Features

### Universal Features
- 📌 **Floating Pin Button** — One-click bookmarking on any page
- 💾 **Persistent Storage** — Bookmarks survive browser restarts
- 🔍 **Smart Previews** — See context for each bookmark
- ⏱️ **Timestamps** — Know when you saved each bookmark
- 🎯 **Precise Navigation** — Jump directly to your saved position
- 🎨 **Visual Feedback** — Toast notifications and highlight animations

### Message Mode (AI Chats)
- 🤖 **Platform Detection** — Auto-detects ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek
- 💬 **Message Identification** — Bookmarks the nearest AI response
- 📝 **Text Previews** — Shows first 100 characters of the message
- 🔄 **SPA Support** — Works with single-page app navigation

### Scroll Mode (All Websites)
- 📍 **Position Tracking** — Saves exact scroll position
- 📊 **Percentage Display** — Shows scroll percentage (e.g., "45%")
- 📖 **Context Capture** — Extracts visible text as preview
- 🏷️ **Page Titles** — Includes page title for easy identification

---

## 🌐 Supported AI Platforms

| Platform | Domain | Status |
|----------|--------|--------|
| ChatGPT | `chatgpt.com`, `chat.openai.com` | ✅ Full Support |
| Claude | `claude.ai` | ✅ Full Support |
| Gemini | `gemini.google.com` | ✅ Full Support |
| Perplexity | `perplexity.ai` | ✅ Full Support |
| Grok | `grok.x.ai` | ✅ Full Support |
| DeepSeek | `chat.deepseek.com` | ✅ Full Support |

All other websites automatically use **Scroll Mode**.

---

## 📁 Project Structure

```
scrollstamp/
├── manifest.json      # Extension configuration
├── content.js         # Unified content script (v1 + v2 logic)
├── content.css        # Floating button & highlight styles
├── popup.html         # Extension popup interface
├── popup.css          # Popup styling
├── popup.js           # Popup logic & stamp management
└── README.md          # This file
```

---

## 🚀 Installation

### From Source (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `scrollstamp` folder
6. The 📌 icon should appear in your toolbar

---

## 📖 Usage

### Creating a Bookmark

1. Navigate to any webpage
2. Scroll to the position or AI message you want to save
3. Click the floating 📌 button (bottom-right corner)
4. A toast notification confirms the bookmark

### Viewing Bookmarks

1. Click the ScrollStamp icon in your browser toolbar
2. See all your bookmarks sorted by date
3. The popup shows the current mode (AI platform name or "Scroll")

### Navigating to a Bookmark

1. Open the popup
2. Click on any bookmark
3. The page scrolls to that position/message
4. A highlight animation shows the exact location

### Deleting Bookmarks

- **Single**: Click the ✕ button on any bookmark
- **All**: Click "Clear All" at the bottom of the popup

---

## 🎨 Visual Indicators

| Element | Meaning |
|---------|---------|
| 💬 | Message-based bookmark (AI chat) |
| 📍 | Scroll-based bookmark (regular website) |
| Purple badge | AI chat mode (shows platform name) |
| Green badge | Scroll mode |

---

## 🔧 Technical Details

### Storage Schema

```javascript
// Message-based bookmark (v2)
{
  id: "msg_0_abc123",
  type: "message",
  index: 0,
  preview: "Here's how to implement...",
  timestamp: 1704067200000,
  url: "https://chatgpt.com/c/123",
  platform: "chatgpt"
}

// Scroll-based bookmark (v1)
{
  id: "scroll_45_xyz789",
  type: "scroll",
  scrollPercent: 45,
  scrollY: 1250,
  preview: "Section about advanced topics...",
  pageTitle: "Documentation - MyApp",
  timestamp: 1704067200000,
  url: "https://example.com/docs",
  platform: "web"
}
```

### Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Save bookmarks locally |
| `activeTab` | Access current tab for bookmarking |

---

## 📋 Version History

### v2.1.0 (Current) — Unified Release
- ✨ Combined v1 and v2 into single extension
- 🔄 Automatic mode detection
- 🌐 Works on all websites
- 📍 Scroll-based fallback for non-AI sites

### v2.0.0 — Message-Based Bookmarking
- 💬 AI message detection
- 🎯 Precise message navigation
- 🤖 Multi-platform support

### v1.0.0 — Scroll Position Bookmarking
- 📍 Scroll percentage tracking
- 💾 Chrome storage integration
- 🔖 Basic popup interface

---

## 🗺️ Roadmap

### v2.2.0 (Planned)
- 📁 Bookmark folders/categories
- 🔍 Search within bookmarks
- ⌨️ Keyboard shortcuts
- 📤 Export/Import bookmarks

### v3.0.0 (Future)
- 🔄 Cross-device sync
- 🏷️ Custom labels/tags
- 📝 Notes on bookmarks
- 🎨 Theme customization

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test on multiple platforms
5. Submit a pull request

---

## 📄 License

MIT License — feel free to use, modify, and distribute.

---

## 💬 Support

- **Issues**: Report bugs via GitHub Issues
- **Features**: Request features via GitHub Discussions
- **Questions**: Open a Discussion thread

---

<div align="center">

Made with ❤️ for bookmarking enthusiasts

**📌 ScrollStamp** — Never lose your place again

</div>
