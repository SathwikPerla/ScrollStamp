# ScrollStamp

**Bookmarks save the page. ScrollStamp saves the spot.**

A Chrome extension that bookmarks the exact text you were reading — on any webpage, and inside long AI chat conversations. Select text, save it, come back later and land precisely where you left off.

100% local. Zero network requests. Zero dependencies.

<!-- TODO: replace with your Chrome Web Store URL -->
[**Install from the Chrome Web Store →**](https://chromewebstore.google.com/detail/YOUR_EXTENSION_ID)

<!-- TODO: add demo.gif — a save + jump in one take -->

---

## The problem

A browser bookmark stores a URL. That's fine for a blog post you'll read top-to-bottom. It's useless for the way people actually read now:

- You had a 200-message ChatGPT conversation. The one answer you needed is forty screens down. The URL takes you to the top.
- You were halfway through a 12,000-word documentation page. The bookmark takes you to the top.
- You found the one paragraph that mattered in a long article. The bookmark takes you to the top.

Every bookmark you've ever made throws away the only information you actually wanted: **where you were.**

Chrome shipped a partial answer — text fragment links (`#:~:text=`). But you can't create one from a selection in two clicks, they don't survive a page that re-renders its text, and they don't work at all in AI chats, where the content isn't in the URL and isn't even in the DOM until you scroll to it.

## The solution

ScrollStamp anchors to **content, not coordinates.**

Select text → click Bookmark → it saves the text itself, plus the 40 characters preceding it for disambiguation. On restore, it searches the live page for that text and scrolls it into view.

Because it anchors semantically, a bookmark survives things that break every pixel-offset approach: window resizes, font changes, layout shifts, injected ads, collapsed sections, and content that renders later.

Works on any website. Detects and adapts to six AI chat platforms: **ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek.**

## Why this is harder than it sounds

Naive "find the text and scroll to it" fails four different ways. Handling all four is the actual product.

**1. Text on a page is not the text you saved.**
Pages reflow whitespace constantly — a newline becomes a space, React re-renders a paragraph with different indentation. Exact-match search finds nothing and the bookmark silently dies. ScrollStamp normalizes whitespace on both sides, but maintains an index map back to the original character offsets, so the highlight still lands on the exact real characters. *(`getNormalizedTextAndMap`, `findTextRange`)*

**2. The page moves while you're scrolling to it.**
Lazy images load, fonts swap, embeds expand. Measure once and scroll, and you land in the wrong place. ScrollStamp re-resolves the target on every pass and iterates until it settles within 6px across two consecutive measurements — never trusting a single reading. *(`convergeScroll`)*

**3. In AI chats, the target often doesn't exist yet.**
Long conversations are virtualized: only messages near the viewport are in the DOM. You cannot scroll to an element that isn't rendered, and `scrollTop` is capped by the current `scrollHeight`. ScrollStamp drives the scroll container toward a saved ratio to force progressive rendering, re-searching each pass until the target materializes, then hands off to the converger. *(`renderThenResearch`)*

**4. The window isn't what's scrolling.**
Every AI chat scrolls an inner `<div>`, not the document. ScrollStamp walks up the tree to find the real scroll container before touching anything. *(`findScrollContainer`)*

Restoring the highlight uses the CSS Custom Highlight API, so it paints without mutating the page's DOM — important on React and Vue sites that break when something else touches their tree.

## Privacy

Verifiable in the source, not just claimed:

- **No network requests.** Not one. `grep -r "fetch(\|XMLHttpRequest\|sendBeacon" .` returns nothing.
- **No analytics, no telemetry, no tracking, no third-party SDKs.**
- **No remote code.** Everything runs in the local extension sandbox.
- **No accounts, no sync, no servers.** Bookmarks live in `chrome.storage.local` on your machine and never leave it.
- **No dependencies.** Zero npm packages, zero supply chain.

Selected text is read only to locate your bookmark, and only ever processed locally.

Full policy: [`privacy.html`](privacy.html)

## Per-site control

ScrollStamp is on by default everywhere. Toggle it off for any site from the popup and the bookmark button stops appearing there — applied instantly to open tabs, no reload needed.

## Install

**From the store:** [Chrome Web Store](https://chromewebstore.google.com/detail/YOUR_EXTENSION_ID) <!-- TODO -->

**From source:**

```bash
git clone https://github.com/SathwikPerla/ScrollStamp.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the cloned folder

## Limitations

Stated plainly, because a bookmarking tool that lies about where it works is worse than one with a smaller footprint:

- **PDFs are not supported.** Chrome's built-in PDF viewer renders text inside a plugin rather than the DOM, so there is nothing for an extension to select or anchor to. The popup says so explicitly instead of failing quietly.
- **AI platform detection is selector-based.** A major redesign can break message detection until selectors are updated. A heuristic tree-walk fallback covers most cases.
- **Text must still exist.** If a page's content changed after you bookmarked it, ScrollStamp falls back to the containing message or the saved scroll position.

## Architecture

Manifest V3, three contexts, no build step:

| File | Role |
|---|---|
| `content.js` | The engine — selection capture, text anchoring, scroll convergence, highlighting |
| `popup.js` | Bookmark list, per-site toggle, jump/edit/delete |
| `background.js` | Service worker; re-injects into open tabs on install/update |

The content script writes only its own page's storage key. The popup reads storage directly and uses messaging only to detect mode and trigger a scroll.

## Roadmap

- PDF support via a bundled PDF.js viewer (gives PDFs a real text layer, which makes the existing engine work unchanged)
- Search across saved bookmarks
- Export / import
- Folders or tags

## Contributing

Issues and PRs welcome. If a bookmark fails to restore on a specific site, open an issue with the URL — those are the most useful reports.

## License

MIT
