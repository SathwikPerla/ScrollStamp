// ScrollStamp v2.2 — Unified bookmarking extension

(function () {
  "use strict";

  // Prevent double-injection: manifest content_scripts + background.js onInstalled
  // both inject this file; without this guard, all listeners fire twice.
  if (window.__scrollstampLoaded) return;
  window.__scrollstampLoaded = true;

  // ============================================
  // PLATFORM DETECTION
  // ============================================

  const AI_PLATFORM_SELECTORS = {
    chatgpt: {
      assistant: '[data-message-author-role="assistant"]',
      messageText: ".markdown",
    },
    claude: {
      assistant: '[data-testid="assistant-message"], .font-claude-message',
      messageText: ".prose",
    },
    gemini: {
      assistant: '[data-message-author="1"], .model-response-text',
      messageText: ".message-content",
    },
    perplexity: {
      assistant: '[data-testid="answer-content"], .prose',
      messageText: ".prose",
    },
    grok: {
      assistant: '[data-testid="assistant-message"]',
      messageText: ".message-content",
    },
    deepseek: {
      assistant: ".ds-markdown",
      messageText: ".ds-markdown",
    },
  };

  function detectAIPlatform() {
    const host = window.location.hostname;
    if (host.includes("chatgpt") || host.includes("chat.openai")) return "chatgpt";
    if (host.includes("claude")) return "claude";
    if (host.includes("gemini")) return "gemini";
    if (host.includes("perplexity")) return "perplexity";
    if (host.includes("grok")) return "grok";
    if (host.includes("deepseek")) return "deepseek";
    return null;
  }

  function isPDFPage() {
    const url = window.location.href.toLowerCase();
    const contentType = document.contentType || "";
    return (
      url.endsWith(".pdf") ||
      contentType.includes("pdf") ||
      document.querySelector('embed[type="application/pdf"]') !== null ||
      document.body?.children[0]?.tagName === "EMBED"
    );
  }

  let selectionBtn = null;
  let hasActiveSelection = false;
  let currentPlatform = null;
  let isAIChat = false;
  let isPDF = false;
  let listenersAttached = false;

  // ============================================
  // AI MESSAGE BOOKMARKING
  // ============================================

  function getAssistantMessages() {
    if (!currentPlatform || !AI_PLATFORM_SELECTORS[currentPlatform]) return [];
    const selector = AI_PLATFORM_SELECTORS[currentPlatform].assistant;
    let messages = Array.from(document.querySelectorAll(selector));

    // Fallback tree-walk for Claude/Grok when strict selectors return nothing
    if (messages.length === 0 && (currentPlatform === "claude" || currentPlatform === "grok")) {
      const fallbackSelectors = [
        "article",
        "div[data-testid*='conversation']",
        "div[data-testid*='message']",
        'div[class*="message"]',
        'div[class*="response"]',
        'div[class*="assistant"]',
        'div[class*="answer"]',
      ];
      const candidates = new Set();
      for (const sel of fallbackSelectors) {
        document.querySelectorAll(sel).forEach((el) => candidates.add(el));
      }
      messages = Array.from(candidates).filter((el) => {
        const deepNode = el.querySelector(".prose, .markdown, [class*='content'], [class*='text']");
        const text = ((deepNode || el).textContent || "").trim();
        if (text.length < 30) return false;
        const rect = el.getBoundingClientRect();
        return rect.height > 20 && rect.width > 50;
      });
    }

    return messages;
  }

  function findNearestAssistantMessage() {
    const messages = getAssistantMessages();
    if (messages.length === 0) return null;

    const viewportCenter = window.innerHeight / 2;
    let nearest = null;
    let minDistance = Infinity;

    messages.forEach((msg, index) => {
      const rect = msg.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
        if (distance < minDistance) { minDistance = distance; nearest = { element: msg, index }; }
      }
    });

    if (!nearest) {
      messages.forEach((msg, index) => {
        const distance = Math.abs(msg.getBoundingClientRect().top);
        if (distance < minDistance) { minDistance = distance; nearest = { element: msg, index }; }
      });
    }

    return nearest;
  }

  function getMessagePreview(element) {
    const textSelector = AI_PLATFORM_SELECTORS[currentPlatform]?.messageText;
    const textEl = textSelector ? element.querySelector(textSelector) : element;
    return ((textEl || element).textContent || "").trim().substring(0, 100).replace(/\s+/g, " ");
  }

  function generateMessageId(element, index) {
    const preview = getMessagePreview(element);
    let hash = 0;
    for (let i = 0; i < preview.length; i++) {
      hash = (hash << 5) - hash + preview.charCodeAt(i);
      hash = hash & hash;
    }
    return `msg_${index}_${Math.abs(hash).toString(36)}`;
  }

  // Walk up to find the nearest scrollable container (AI SPAs scroll an inner div, not window).
  function findScrollContainer(element) {
    let el = element?.parentElement;
    while (el && el !== document.documentElement) {
      const { overflowY } = window.getComputedStyle(el);
      if ((overflowY === "scroll" || overflowY === "auto") && el.scrollHeight > el.clientHeight) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // Best-effort handle on the main chat scroll container, even when we have no
  // target element yet (used by the render-then-research fallback).
  function findMainScrollContainer() {
    const messages = getAssistantMessages();
    for (const msg of messages) {
      const c = findScrollContainer(msg);
      if (c) return c;
    }
    return null;
  }

  // Snapshot the scroll container position at bookmark time. Saved as both an
  // absolute offset and a ratio so a far jump can force lazy content to render
  // even if the page height has since changed.
  function captureContainerAnchor(element) {
    const container = element ? findScrollContainer(element) : findMainScrollContainer();
    if (!container) return {};
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    return {
      containerScrollY: container.scrollTop,
      containerScrollRatio: maxScroll > 0 ? container.scrollTop / maxScroll : 0,
    };
  }

  // Iteratively scroll so the resolved target settles at `desiredTop` viewport px.
  // The target is re-resolved every pass to absorb reflow from lazily-rendered
  // content — this is what removes the "click again and again" behaviour. The
  // first big jump is smooth for UX; corrections are instant so each measurement
  // reflects the real position (a mid-animation rect would compound the error).
  function convergeScroll(resolveTarget, desiredTop, onArrive) {
    const TOLERANCE = 6;
    const MAX_ATTEMPTS = 12;
    let attempts = 0;
    let stableHits = 0;

    const pass = () => {
      attempts++;
      const t = resolveTarget();
      if (!t) return; // target vanished (re-render); leave the view where it is

      const delta = t.rect.top - desiredTop;

      if (Math.abs(delta) <= TOLERANCE) {
        // Confirm across two consecutive passes — one pass can land right before
        // the next reflow nudges things again.
        stableHits++;
        if (stableHits >= 2 || attempts >= MAX_ATTEMPTS) {
          if (onArrive) onArrive(t);
          return;
        }
        setTimeout(pass, 80);
        return;
      }

      stableHits = 0;
      if (t.container) {
        t.container.scrollTop += delta;
      } else {
        window.scrollBy(0, delta);
      }

      if (attempts >= MAX_ATTEMPTS) {
        if (onArrive) onArrive(t);
        return;
      }
      setTimeout(pass, 90);
    };

    pass();
  }

  // Highlight whatever the converger arrived at (a text range or a whole message).
  function highlightArrival(t) {
    if (t.kind === "range" && t.range) {
      setTimeout(() => highlightRange(t.range), 200);
    } else if (t.element) {
      t.element.classList.add("scrollstamp-highlight");
      setTimeout(() => t.element.classList.remove("scrollstamp-highlight"), 2000);
    }
  }

  // Resolve a saved assistant message back to a live DOM element, by index first
  // then by content prefix (index survives appends; content survives re-ordering).
  function findMessageElement(anchorPreview, index) {
    const messages = getAssistantMessages();
    if (messages.length === 0) return null;
    const anchor = (anchorPreview || "").substring(0, 30);
    if (index !== undefined && index !== null && index >= 0 && index < messages.length) {
      if (!anchor || getMessagePreview(messages[index]).startsWith(anchor)) return messages[index];
    }
    if (anchor) {
      for (const msg of messages) {
        if (getMessagePreview(msg).startsWith(anchor)) return msg;
      }
    }
    return null;
  }

  // When the target isn't in the DOM (far jump / virtualized / not-yet-rendered),
  // drive the container toward the saved anchor to force rendering, re-searching
  // until the target appears, then hand off to the converger.
  function renderThenResearch(stamp, resolve, desiredTop) {
    const container = findMainScrollContainer();
    const hasRatio = typeof stamp.containerScrollRatio === "number";
    const hasAbs = typeof stamp.containerScrollY === "number";

    if (!container || (!hasRatio && !hasAbs)) {
      // Legacy stamps / window-scrolled pages: best we can do is the saved Y.
      if (typeof stamp.scrollY === "number" && stamp.scrollY > 0) {
        window.scrollTo({ top: stamp.scrollY, behavior: "smooth" });
        return true;
      }
      return false;
    }

    let lastScrollTop = -1;
    let stableCount = 0;
    let tries = 0;
    const MAX_TRIES = 40; // Allow sufficient time for long virtualized pages to load

    const retry = () => {
      tries++;
      const currentTarget = resolve();
      if (currentTarget) {
        convergeScroll(resolve, desiredTop, highlightArrival);
        return;
      }

      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const destY = hasRatio
        ? stamp.containerScrollRatio * maxScroll
        : Math.min(stamp.containerScrollY, maxScroll);

      container.scrollTop = destY;

      // Track if scroll position has stabilized (meaning no new virtual elements are loading)
      if (Math.abs(container.scrollTop - lastScrollTop) < 5) {
        stableCount++;
      } else {
        stableCount = 0;
      }
      lastScrollTop = container.scrollTop;

      // Keep driving the scroll container if target isn't found, 
      // max retries aren't met, and new content is still loading.
      if (tries < MAX_TRIES && stableCount < 6) {
        setTimeout(retry, 140);
      }
    };

    retry();
    return true;
  }

  function createMessageStamp(messageInfo) {
    return {
      id: generateMessageId(messageInfo.element, messageInfo.index),
      type: "message",
      index: messageInfo.index,
      preview: getMessagePreview(messageInfo.element),
      title: "",
      timestamp: Date.now(),
      url: window.location.href,
      hostname: window.location.hostname,
      platform: currentPlatform,
      // Coarse scroll-container anchor; lets the restore force lazy content to
      // render when the message isn't in the DOM at jump time.
      ...captureContainerAnchor(messageInfo.element),
    };
  }

  function scrollToMessage(stamp) {
    const desiredTop = 80; // bring the message top near the top of the viewport
    const resolve = () => {
      const el = findMessageElement(stamp.preview, stamp.index);
      if (!el) return null;
      return { rect: el.getBoundingClientRect(), container: findScrollContainer(el), element: el, kind: "message" };
    };

    if (resolve()) {
      convergeScroll(resolve, desiredTop, highlightArrival);
      return true;
    }
    return renderThenResearch(stamp, resolve, desiredTop);
  }

  // ============================================
  // SELECTION BOOKMARKING (all pages)
  // ============================================

  function getScrollPercentage() {
    if (isPDF) {
      const pdfContainer = document.querySelector("#viewerContainer");
      if (pdfContainer) {
        const sh = pdfContainer.scrollHeight - pdfContainer.clientHeight;
        if (sh > 0) return Math.round((pdfContainer.scrollTop / sh) * 100);
      }
    }
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    return scrollHeight <= 0 ? 0 : Math.round((scrollTop / scrollHeight) * 100);
  }

  function createSelectionStamp(selectedText, contextBefore, messageEl, messageIndex) {
    return {
      id: `sel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: "selection",
      selectedText,
      contextBefore,
      messageIndex,
      messagePreview: messageEl ? getMessagePreview(messageEl) : "",
      preview: selectedText.substring(0, 100).replace(/\s+/g, " "),
      title: "",
      timestamp: Date.now(),
      url: window.location.href,
      hostname: window.location.hostname,
      platform: currentPlatform || "web",
      scrollY: window.scrollY,
      scrollPercent: getScrollPercentage(),
      // Coarse scroll-container anchor — the real scroller in AI chats is an
      // inner div, so window.scrollY alone can't restore far-off selections.
      ...captureContainerAnchor(messageEl),
    };
  }

  // Helper to normalize text and build a map of indices
  function getNormalizedTextAndMap(text) {
    let normalized = "";
    const map = []; // map[i] = index in original text
    let isPrevWhitespace = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const isWhitespace = /\s/.test(char);

      if (isWhitespace) {
        if (!isPrevWhitespace && normalized.length > 0) {
          normalized += " ";
          map.push(i);
          isPrevWhitespace = true;
        }
      } else {
        normalized += char;
        map.push(i);
        isPrevWhitespace = false;
      }
    }
    if (normalized.endsWith(" ")) {
      normalized = normalized.slice(0, -1);
      map.pop();
    }
    return { normalized, map };
  }

  function findTextRange(root, searchText, contextBefore) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let fullText = "";
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: fullText.length });
      fullText += node.textContent;
    }
    if (!nodes.length) return null;

    const { normalized: normalizedFullText, map: fullToOriginalMap } = getNormalizedTextAndMap(fullText);
    const { normalized: normSearch } = getNormalizedTextAndMap(searchText || "");
    const { normalized: normContext } = getNormalizedTextAndMap(contextBefore || "");

    if (!normSearch) return null;

    let normStart = -1;
    if (normContext) {
      const ctxIdx = normalizedFullText.indexOf(normContext + normSearch);
      if (ctxIdx >= 0) normStart = ctxIdx + normContext.length;
    }
    if (normStart < 0) {
      normStart = normalizedFullText.indexOf(normSearch);
    }
    if (normStart < 0) return null;

    const normEnd = normStart + normSearch.length;
    const textStart = fullToOriginalMap[normStart];
    const textEnd = fullToOriginalMap[normEnd - 1] + 1;

    if (textStart === undefined || textEnd === undefined) return null;

    let startNode = null, startOffset = 0, endNode = null, endOffset = 0;

    for (const { node: n, start } of nodes) {
      const end = start + n.textContent.length;
      if (!startNode && textStart >= start && textStart < end) {
        startNode = n;
        startOffset = textStart - start;
      }
      if (!endNode && textEnd > start && textEnd <= end) {
        endNode = n;
        endOffset = textEnd - start;
        break;
      }
    }
    if (!startNode || !endNode) return null;

    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch {
      return null;
    }
  }

  function highlightRange(range) {
    if (typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights) {
      try {
        const highlight = new Highlight(range);
        CSS.highlights.set("scrollstamp-custom-highlight", highlight);
        setTimeout(() => {
          CSS.highlights.delete("scrollstamp-custom-highlight");
        }, 2500);
        return;
      } catch (e) {
        console.error("ScrollStamp: CSS Highlight error", e);
      }
    }

    try {
      const mark = document.createElement("mark");
      mark.className = "scrollstamp-text-highlight";
      range.surroundContents(mark);
      setTimeout(() => {
        const parent = mark.parentNode;
        if (parent) {
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
        }
      }, 2500);
    } catch {
      // surroundContents throws when the range spans element boundaries; scroll already worked
    }
  }

  function scrollToSelection(stamp) {
    const desiredTop = 120;

    // Re-resolve the target every pass: prefer the exact text range, fall back to
    // the whole message. Re-finding (not caching a rect) is what lets the
    // converger track the target as lazy content reflows the page.
    const resolve = () => {
      const messageEl = isAIChat ? findMessageElement(stamp.messagePreview, stamp.messageIndex) : null;
      const searchRoot = messageEl || document.body;
      const range = findTextRange(searchRoot, stamp.selectedText, stamp.contextBefore || "");
      if (range) {
        return {
          rect: range.getBoundingClientRect(),
          container: findScrollContainer(range.startContainer.parentElement || searchRoot),
          range,
          kind: "range",
        };
      }
      if (messageEl) {
        return {
          rect: messageEl.getBoundingClientRect(),
          container: findScrollContainer(messageEl),
          element: messageEl,
          kind: "message",
        };
      }
      return null;
    };

    if (resolve()) {
      convergeScroll(resolve, desiredTop, highlightArrival);
      return true;
    }

    // Target not in the DOM yet — render it, then converge.
    return renderThenResearch(stamp, resolve, desiredTop);
  }

  // ============================================
  // SCROLL-POSITION BOOKMARKING (non-AI pages)
  // ============================================

  function getPageTitle() {
    return document.title || window.location.hostname;
  }

  function getContextPreview() {
    const elements = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    for (const el of elements) {
      if (["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "ARTICLE", "SECTION"].includes(el.tagName)) {
        const text = el.textContent?.trim();
        if (text && text.length > 10) return text.substring(0, 100).replace(/\s+/g, " ");
      }
    }
    return `${getScrollPercentage()}% scrolled`;
  }

  function createScrollStamp() {
    const scrollPercent = getScrollPercentage();
    let scrollY = window.scrollY || window.pageYOffset || 0;
    if (isPDF) {
      const pdfContainer = document.querySelector("#viewerContainer");
      if (pdfContainer) scrollY = pdfContainer.scrollTop;
    }
    return {
      id: `scroll_${scrollPercent}_${Date.now().toString(36)}`,
      type: isPDF ? "pdf" : "scroll",
      scrollPercent,
      scrollY,
      preview: getContextPreview(),
      pageTitle: getPageTitle(),
      title: "",
      timestamp: Date.now(),
      url: window.location.href,
      hostname: window.location.hostname,
      platform: isPDF ? "PDF" : "web",
    };
  }

  function scrollToPosition(stamp) {
    if (stamp.type === "pdf") {
      const pdfContainer = document.querySelector("#viewerContainer");
      if (pdfContainer && stamp.scrollY !== undefined) {
        pdfContainer.scrollTo({ top: stamp.scrollY, behavior: "smooth" });
        return true;
      }
    }
    if (stamp.scrollY !== undefined && stamp.scrollY > 0) {
      window.scrollTo({ top: stamp.scrollY, behavior: "smooth" });
      return true;
    }
    if (stamp.scrollPercent !== undefined && stamp.scrollPercent > 0) {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: (stamp.scrollPercent / 100) * scrollHeight, behavior: "smooth" });
      return true;
    }
    return false;
  }

  // ============================================
  // STORAGE
  // ============================================

  function getStorageKey() {
    return `scrollstamp_${btoa(window.location.pathname).substring(0, 20)}`;
  }

  function isContextAlive() {
    try { return !!chrome?.runtime?.id; } catch { return false; }
  }

  async function saveStamp(stamp) {
    const storageKey = getStorageKey();
    if (!isContextAlive()) return { status: "error", reason: "context_dead" };

    const tryRead = (retries) => new Promise((resolve) => {
      chrome.storage.local.get([storageKey], (result) => {
        if (chrome.runtime.lastError || !isContextAlive()) {
          if (retries > 0) return setTimeout(() => resolve(tryRead(retries - 1)), 200);
          return resolve({ status: "error", reason: "storage_read_failed" });
        }
        resolve({ status: "ok", stamps: result[storageKey] || [] });
      });
    });

    try {
      const readResult = await tryRead(1);
      if (readResult.status === "error") return readResult;

      const stamps = readResult.stamps;
      if (stamps.some((s) => s.id === stamp.id)) return { status: "duplicate" };
      stamps.push(stamp);

      return new Promise((resolve) => {
        chrome.storage.local.set({ [storageKey]: stamps }, () => {
          if (chrome.runtime.lastError || !isContextAlive()) {
            resolve({ status: "error", reason: "storage_write_failed" });
          } else {
            resolve({ status: "saved" });
          }
        });
      });
    } catch {
      return { status: "error", reason: "exception" };
    }
  }

  // ============================================
  // TOAST
  // ============================================

  function showToast(message) {
    const existing = document.getElementById("scrollstamp-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "scrollstamp-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("scrollstamp-toast-hide");
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ============================================
  // SAVE FORM (replaces browser prompt())
  // ============================================

  function closeSaveForm() {
    document.getElementById("scrollstamp-save-form")?.remove();
  }

  function showSaveForm(anchorRect, defaultName, onSave, onCancel) {
    closeSaveForm();

    const form = document.createElement("div");
    form.id = "scrollstamp-save-form";

    const header = document.createElement("div");
    header.className = "ssf-header";

    const icon = document.createElement("span");
    icon.className = "ssf-icon";
    icon.appendChild(createPinSvg(16, 16));

    const label = document.createElement("span");
    label.className = "ssf-label";
    label.textContent = "Save Bookmark";

    const closeBtn = document.createElement("button");
    closeBtn.className = "ssf-close";
    closeBtn.setAttribute("aria-label", "Cancel");
    closeBtn.textContent = "✕";

    header.appendChild(icon);
    header.appendChild(label);
    header.appendChild(closeBtn);

    const preview = document.createElement("div");
    preview.className = "ssf-preview";
    preview.textContent = defaultName.length > 60 ? defaultName.substring(0, 57) + "…" : defaultName;

    const input = document.createElement("input");
    input.className = "ssf-input";
    input.type = "text";
    input.maxLength = 120;
    input.placeholder = "Bookmark name…";
    input.value = defaultName;

    const actions = document.createElement("div");
    actions.className = "ssf-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ssf-btn ssf-cancel-btn";
    cancelBtn.textContent = "Cancel";

    const saveBtn = document.createElement("button");
    saveBtn.className = "ssf-btn ssf-save-btn";
    saveBtn.textContent = "Save";

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    form.appendChild(header);
    form.appendChild(preview);
    form.appendChild(input);
    form.appendChild(actions);

    // Position near selection, clamped to viewport
    const formW = 264;
    const formH = 162;
    let top = Math.max(8, anchorRect.top - formH - 8);
    let left = Math.min(window.innerWidth - formW - 8, Math.max(8, anchorRect.left));
    if (top < 8 && anchorRect.bottom + formH + 8 < window.innerHeight) {
      top = anchorRect.bottom + 8;
    }
    form.style.top = `${top}px`;
    form.style.left = `${left}px`;

    document.body.appendChild(form);
    requestAnimationFrame(() => { input.focus(); input.select(); });

    const handleSave = () => {
      const title = input.value.trim() || defaultName;
      closeSaveForm();
      onSave(title);
    };

    const handleCancel = () => {
      closeSaveForm();
      onCancel();
    };

    saveBtn.addEventListener("click", handleSave);
    cancelBtn.addEventListener("click", handleCancel);
    closeBtn.addEventListener("click", handleCancel);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); handleSave(); }
      if (e.key === "Escape") { e.preventDefault(); handleCancel(); }
    });

    const clickOutside = (e) => {
      if (!form.contains(e.target)) {
        document.removeEventListener("mousedown", clickOutside, true);
        handleCancel();
      }
    };
    setTimeout(() => document.addEventListener("mousedown", clickOutside, true), 100);
  }

  // ============================================
  // SELECTION BUTTON (all pages)
  // ============================================

  function createPinSvg(width = 14, height = 14) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.classList.add("scrollstamp-svg-pin");

    const p1 = document.createElementNS(svgNS, "path");
    p1.setAttribute("d", "M12 17v5");
    svg.appendChild(p1);

    const p2 = document.createElementNS(svgNS, "path");
    p2.setAttribute("d", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.89A.5.5 0 0 0 6.36 14h11.28a.5.5 0 0 0 .25-.56l-1.78-.89A2 2 0 0 1 15 10.76V6h-6v4.76z");
    svg.appendChild(p2);

    const p3 = document.createElementNS(svgNS, "path");
    p3.setAttribute("d", "M15 6V3a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3");
    svg.appendChild(p3);

    return svg;
  }

  function getSelectionButton() {
    if (selectionBtn && document.body.contains(selectionBtn)) return selectionBtn;

    selectionBtn = document.createElement("button");
    selectionBtn.id = "scrollstamp-select-btn";
    selectionBtn.setAttribute("aria-label", "Bookmark selected text");

    const pin = document.createElement("span");
    pin.className = "ssb-pin";
    pin.appendChild(createPinSvg(13, 13));

    const text = document.createElement("span");
    text.className = "ssb-text";
    text.textContent = "Bookmark";

    selectionBtn.appendChild(pin);
    selectionBtn.appendChild(text);
    document.body.appendChild(selectionBtn);
    return selectionBtn;
  }

  function showSelectionButton(rect) {
    const btn = getSelectionButton();
    const btnHeight = 28;
    let top, left;

    if (isAIChat) {
      // Place it below the selection for AI chats to avoid overlapping native popovers/menus
      top = rect.bottom + 10;

      // Prevent overlapping with the bottom chat prompt input box (e.g. ChatGPT, Claude, Gemini, etc.)
      let limitY = window.innerHeight;
      const chatInput = document.getElementById("prompt-textarea") || 
                        document.querySelector('div[contenteditable="true"]') ||
                        document.querySelector('textarea[placeholder*="Ask"], textarea[placeholder*="Message"], textarea[placeholder*="Reply"]');
      if (chatInput) {
        const inputRect = chatInput.getBoundingClientRect();
        if (inputRect.top > window.innerHeight * 0.5) {
          limitY = inputRect.top - 20; // 20px safety buffer above input box
        }
      }

      if (top + btnHeight > limitY) {
        btn.style.display = "none";
        closeSaveForm();
        return;
      }

      top = Math.max(8, Math.min(window.innerHeight - btnHeight - 8, top));
      // Keep it horizontally aligned with the left edge of the selection, or adjusted if offscreen
      const btnWidth = 110;
      left = rect.left;
      if (left + btnWidth > window.innerWidth) {
        left = Math.max(8, window.innerWidth - btnWidth - 10);
      }
    } else {
      // Align vertically with the center of the selection to avoid top-aligned popovers on other pages
      top = rect.top + (rect.height - btnHeight) / 2;
      top = Math.max(8, Math.min(window.innerHeight - btnHeight - 8, top));

      // Place horizontally to the right of the selection (or left if at screen boundary)
      const btnWidth = 110; // approximate width of the button
      left = rect.right + 10;
      if (left + btnWidth > window.innerWidth) {
        left = Math.max(8, rect.left - btnWidth - 10);
      }
    }

    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
    btn.style.display = "flex";
    hasActiveSelection = true;
  }

  function hideSelectionButton() {
    if (selectionBtn) selectionBtn.style.display = "none";
    hasActiveSelection = false;
  }

  function attachSelectionListener() {
    const btn = getSelectionButton();

    btn.addEventListener("mousedown", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) { hideSelectionButton(); return; }

      const range = selection.getRangeAt(0);
      const selectedText = selection.toString().trim();
      if (!selectedText) { hideSelectionButton(); return; }

      const startNode = range.startContainer;
      const nodeText = startNode.textContent || "";
      const contextBefore = nodeText.substring(Math.max(0, range.startOffset - 40), range.startOffset);

      let messageEl = null, messageIndex = -1;
      if (isAIChat) {
        const messages = getAssistantMessages();
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].contains(range.commonAncestorContainer)) {
            messageEl = messages[i]; messageIndex = i; break;
          }
        }
      }

      const stamp = createSelectionStamp(selectedText, contextBefore, messageEl, messageIndex);
      const anchorRect = range.getBoundingClientRect();

      hideSelectionButton();
      selection.removeAllRanges();

      showSaveForm(anchorRect, stamp.preview, async (title) => {
        stamp.title = title;
        const result = await saveStamp(stamp);
        if (result.status === "saved") showToast("Bookmarked!");
        else if (result.status === "duplicate") showToast("Already bookmarked");
        else showToast("Failed to save — try again");
      }, () => {});
    });

    document.addEventListener("mouseup", (e) => {
      if (e.target?.closest?.("#scrollstamp-select-btn, #scrollstamp-save-form")) return;

      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) { hideSelectionButton(); return; }

        const text = selection.toString().trim();
        if (text.length < 3) { hideSelectionButton(); return; }

        const range = selection.getRangeAt(0);
        const ancestor = range.commonAncestorContainer;

        if (isAIChat) {
          const inAIMessage = getAssistantMessages().some((msg) => msg.contains(ancestor));
          if (!inAIMessage) { hideSelectionButton(); return; }
        } else {
          const el = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor;
          if (el?.closest?.("input, textarea, select, [contenteditable]")) {
            hideSelectionButton(); return;
          }
        }

        showSelectionButton(range.getBoundingClientRect());
      }, 10);
    });

    document.addEventListener("mousedown", (e) => {
      if (e.target?.closest?.("#scrollstamp-select-btn, #scrollstamp-save-form")) return;
      hideSelectionButton();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { hideSelectionButton(); closeSaveForm(); }
    });

    const handleScroll = () => {
      if (!hasActiveSelection) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        hideSelectionButton();
        closeSaveForm();
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Check if selection is within the viewport (vertical check)
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;

      if (isVisible) {
        showSelectionButton(rect);
      } else {
        // Just hide the selection button and close the save form visually, keeping hasActiveSelection true
        if (selectionBtn) selectionBtn.style.display = "none";
        closeSaveForm();
      }
    };

    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
  }

  // ============================================
  // PENDING SCROLL (cross-page navigation)
  // ============================================

  function checkPendingScroll() {
    if (!isContextAlive()) return;

    chrome.storage.local.get("scrollstamp_pending", (result) => {
      if (chrome.runtime.lastError || !result.scrollstamp_pending) return;

      const { stamp } = result.scrollstamp_pending;

      try {
        const pendingUrl = new URL(stamp.url);
        const currentUrl = new URL(window.location.href);
        if (currentUrl.origin !== pendingUrl.origin || currentUrl.pathname !== pendingUrl.pathname) return;
      } catch {
        return;
      }

      chrome.storage.local.remove("scrollstamp_pending");

      // Retry until DOM is ready (AI chats render messages asynchronously)
      let attempts = 0;
      const tryScroll = () => {
        attempts++;
        if ((stamp.type === "message" || stamp.type === "selection") && isAIChat) {
          if (getAssistantMessages().length === 0 && attempts < 12) {
            return setTimeout(tryScroll, 400);
          }
        }
        handleScrollTo(stamp);
      };

      setTimeout(tryScroll, 600);
    });
  }

  // ============================================
  // MESSAGE HANDLING
  // ============================================

  function handleScrollTo(stamp) {
    if (stamp.type === "selection") return scrollToSelection(stamp);
    if (stamp.type === "message") return scrollToMessage(stamp);
    return scrollToPosition(stamp);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!isContextAlive()) return false;

    if (request.action === "getStamps") {
      chrome.storage.local.get([getStorageKey()], (result) => {
        sendResponse({ stamps: result[getStorageKey()] || [] });
      });
      return true;
    }

    if (request.action === "scrollTo") {
      const success = handleScrollTo(request.stamp);
      sendResponse({ success });
      return true;
    }

    if (request.action === "deleteStamp") {
      const key = getStorageKey();
      chrome.storage.local.get([key], (result) => {
        const stamps = (result[key] || []).filter((s) => s.id !== request.stampId);
        chrome.storage.local.set({ [key]: stamps }, () => sendResponse({ success: true }));
      });
      return true;
    }

    if (request.action === "getMode") {
      sendResponse({ isAIChat, isPDF, platform: currentPlatform });
      return true;
    }

    if (request.action === "updateTitle") {
      const key = getStorageKey();
      chrome.storage.local.get([key], (result) => {
        const stamps = result[key] || [];
        const idx = stamps.findIndex((s) => s.id === request.stampId);
        if (idx !== -1) {
          stamps[idx].title = request.title;
          chrome.storage.local.set({ [key]: stamps }, () => sendResponse({ success: true }));
        } else {
          sendResponse({ success: false });
        }
      });
      return true;
    }
  });

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    currentPlatform = detectAIPlatform();
    isAIChat = currentPlatform !== null;
    isPDF = isPDFPage();

    // Attach listeners once; subsequent init calls (SPA nav) only re-detect platform
    if (!listenersAttached) {
      attachSelectionListener();
      listenersAttached = true;
    }

    checkPendingScroll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Re-detect platform on SPA navigation without duplicating listeners
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        currentPlatform = detectAIPlatform();
        isAIChat = currentPlatform !== null;
        isPDF = isPDFPage();
        checkPendingScroll();
      }, 500);
    }
  }).observe(document.documentElement, { subtree: true, childList: true });
})();
