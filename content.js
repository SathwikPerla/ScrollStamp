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
  let isSiteDisabled = false;

  // Hostnames the user has switched ScrollStamp off for. Blocklist, not
  // allowlist — the extension stays on by default everywhere.
  const DISABLED_SITES_KEY = "scrollstamp_disabled_sites";

  // ============================================
  // AI MESSAGE BOOKMARKING
  // ============================================

  // Re-reading the whole conversation is not free on a long chat, and the
  // Claude/Grok fallback below forces a layout for every candidate it inspects.
  // The hunt asks for this list twice per cycle, so a very short memo removes the
  // duplicate read. The window is far shorter than any polling interval, so no
  // caller can observe a meaningfully stale list.
  let messagesMemo = { at: 0, list: null };

  function getAssistantMessages() {
    if (!currentPlatform || !AI_PLATFORM_SELECTORS[currentPlatform]) return [];

    const now = Date.now();
    if (messagesMemo.list && now - messagesMemo.at < 40) return messagesMemo.list;

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

    messagesMemo = { at: now, list: messages };
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

  // One glide, not a chase.
  //
  // The old approach measured the target, corrected instantly, measured again,
  // and repeated up to ten times. Every correction was a visible hop, and on a
  // page still rendering content above the target it produced exactly the
  // "jumps here and there, sometimes more jerking" the arrival had become.
  //
  // Instead: wait for the layout to stop changing, then perform a single smooth
  // scroll to a position that is already correct. Only if reflow moved the target
  // while the animation ran does one silent snap follow.
  //
  // The trade-off is deliberate. It no longer chases a target that keeps
  // drifting, so on a page that reflows heavily right after arrival the landing
  // can finish slightly off instead of being corrected repeatedly. That repeated
  // correction was the jitter, and the settle-wait beforehand is what makes the
  // single glide land correctly in the first place.
  function arriveSmoothly(resolveTarget, desiredTop, onDone) {
    const SETTLE_TICK = 90;
    const SETTLE_STABLE = 2;   // consecutive unchanged heights counts as settled
    const SETTLE_MAX = 8;      // ~720ms ceiling, so a busy page cannot stall the jump
    const SNAP_PX = 24;        // below this, drift is not worth another movement

    let lastHeight = -1;
    let stableTicks = 0;
    let ticks = 0;

    const glide = () => {
      const t = resolveTarget();
      if (!t) return;

      const delta = t.rect.top - desiredTop;
      if (Math.abs(delta) <= 2) {
        if (onDone) onDone(t);
        return;
      }

      if (t.container) {
        t.container.scrollTo({ top: t.container.scrollTop + delta, behavior: "smooth" });
      } else {
        window.scrollTo({ top: window.scrollY + delta, behavior: "smooth" });
      }

      // Give the animation time to finish before looking again. Reading a rect
      // mid-flight describes where the target is passing through, not where it
      // will rest.
      const animationMs = Math.min(900, 320 + Math.abs(delta) * 0.3);
      setTimeout(() => {
        const after = resolveTarget();
        if (!after) return;

        const drift = after.rect.top - desiredTop;
        if (Math.abs(drift) > SNAP_PX) {
          // Instant and once only. At this distance it reads as the page
          // settling rather than as a second scroll.
          if (after.container) after.container.scrollTop += drift;
          else window.scrollBy(0, drift);
        }

        if (onDone) onDone(resolveTarget() || after);
      }, animationMs);
    };

    // Content rendering above the target keeps changing its position, so measure
    // only once the height holds still. This is what lets a single glide be
    // accurate enough to need no follow-up.
    const settle = () => {
      const t = resolveTarget();
      const container = t && t.container;
      const height = container ? container.scrollHeight : document.documentElement.scrollHeight;

      if (height === lastHeight) stableTicks++;
      else stableTicks = 0;
      lastHeight = height;

      if (stableTicks >= SETTLE_STABLE || ++ticks >= SETTLE_MAX) return glide();
      setTimeout(settle, SETTLE_TICK);
    };

    settle();
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

  // Among candidate positions, the one closest to where the message sat when it
  // was bookmarked. Used only to break ties, never to identify on its own.
  function pickNearest(candidates, index) {
    if (typeof index !== "number" || index < 0) return candidates[0];
    let best = candidates[0];
    let bestDistance = Math.abs(best - index);
    for (const c of candidates) {
      const distance = Math.abs(c - index);
      if (distance < bestDistance) { bestDistance = distance; best = c; }
    }
    return best;
  }

  // Resolve a saved assistant message back to a live DOM element.
  //
  // Matching is by content, with the stored index used only as a tie-breaker.
  // That ordering matters: paging older messages in shifts every index, so an
  // index-first lookup silently drifts onto the wrong message. Text does not
  // shift. The stored preview is compared at full length (100 chars) before any
  // shorter prefix is tried, because assistant replies routinely share an
  // opening phrase and a 30-char prefix is not distinctive enough to pick
  // between them.
  function previewMatchesAnchor(preview, anchor) {
    if (!preview) return false;
    if (preview === anchor) return true;
    if (preview.startsWith(anchor)) return true;
    // Either side can be the truncated one. The length floor stops a short
    // preview from matching half the conversation.
    return preview.length >= 40 && anchor.startsWith(preview);
  }

  // Remembers the element resolved last, so the repeated re-resolves during a
  // scroll do not re-read every message in the conversation.
  let lastMessageMatch = null;

  function findMessageElement(anchorPreview, index) {
    const messages = getAssistantMessages();
    if (messages.length === 0) return null;

    const anchor = (anchorPreview || "").trim();
    if (!anchor) {
      return typeof index === "number" && index >= 0 && index < messages.length
        ? messages[index]
        : null;
    }

    const remember = (element) => {
      if (element) lastMessageMatch = { anchor, index, element };
      return element;
    };

    // Fast path 1: the element found moments ago, re-validated. The arrival and
    // the hunt both re-resolve repeatedly, and previewing every message on each
    // pass would mean hundreds of textContent reads per second in a long chat.
    //
    // The stored index is part of the cache key, not just the anchor. Two
    // bookmarks in one conversation can share a 100-char opening, so keying on
    // text alone would hand the second click the first one's element.
    const cached = lastMessageMatch;
    if (cached && cached.anchor === anchor && cached.index === index && cached.element.isConnected) {
      if (previewMatchesAnchor(getMessagePreview(cached.element), anchor)) return cached.element;
    }

    // Fast path 2: the stored index still points at the right message. That is
    // the common case whenever nothing has been paged in above it.
    if (typeof index === "number" && index >= 0 && index < messages.length) {
      if (previewMatchesAnchor(getMessagePreview(messages[index]), anchor)) {
        return remember(messages[index]);
      }
    }

    // Full scan. Only reached when the index has shifted or gone stale.
    const previews = messages.map(getMessagePreview);
    const collect = (test) => {
      const hits = [];
      previews.forEach((p, i) => { if (test(p)) hits.push(i); });
      return hits;
    };

    // Strongest signal: the stored preview reproduced exactly.
    let hits = collect((p) => p === anchor);
    if (hits.length) return remember(messages[pickNearest(hits, index)]);

    hits = collect((p) => previewMatchesAnchor(p, anchor));
    if (hits.length) return remember(messages[pickNearest(hits, index)]);

    // Looser tiers for messages the platform has since re-rendered slightly.
    // The 30-char tier is deliberately the same width the original matcher used,
    // so anything that resolved before still resolves now. The difference is that
    // it is reached last rather than first, and that ties go to the message
    // nearest the stored index instead of simply the first one in the document.
    for (const width of [40, 30]) {
      const shortAnchor = anchor.substring(0, width);
      if (shortAnchor.length < 20) continue;
      hits = collect((p) => p.startsWith(shortAnchor));
      if (hits.length) return remember(messages[pickNearest(hits, index)]);
    }

    return null;
  }

  // ============================================
  // TARGET HUNT (one click, however long it takes)
  // ============================================

  // A bookmarked message usually is not in the DOM when the jump begins: chats
  // page older messages in on demand, or virtualize the list so only the visible
  // window exists. The hunt keeps driving the container until the target really
  // appears, so one click is enough however far back the message sits.
  //
  // The previous implementation gave up after about 5.6 seconds, or sooner once
  // the scroll position stopped moving, which is what forced the click-again-and
  // -again behaviour: each click loaded one more page and then stopped. Two
  // things changed. It now stops only when the container has genuinely stopped
  // growing, meaning the start of the conversation has been reached; and it stops
  // trusting the saved scroll ratio, which was measured against the page height
  // at bookmark time and points somewhere else entirely once pagination has
  // changed that height.
  //
  // GROW walks the view up to make the platform paginate, probing after each
  // step. SEEK then covers virtualized lists, where the height was full size all
  // along and nothing grows.
  let activeHunt = null;

  function cancelHunt(reason) {
    if (!activeHunt) return;
    const hunt = activeHunt;
    activeHunt = null;
    clearTimeout(hunt.timer);
    hunt.detach();
    if (reason === "user") hideToast();
  }

  function huntForTarget(stamp, resolve, desiredTop) {
    cancelHunt("superseded");

    const PROBE_MS = 300;
    // Small on purpose. This only has to produce a real upward scroll event; at
    // 300px the page visibly shook for the whole hunt, and at this size the
    // jitter is not noticeable against content loading in above.
    const NUDGE_PX = 24;
    // Stalling is measured in TIME, not in probe count. A huge conversation on a
    // slow connection can take seconds to return one page of history, and a
    // count-based limit would read that pause as "the history is exhausted" and
    // stop early — the exact failure being fixed.
    const STALL_MS = 5000;
    // Short, quick first pass at the saved position, before any pagination.
    const FAST_SEEK_PROBES = 2;
    const FAST_SEEK_MS = 150;
    // Only nudge after loading has been quiet this long, so an arriving page is
    // never interrupted and the view stays still while content streams in.
    const QUIET_MS = 500;
    const SWEEP_PROBES = 20;      // wide sweep once growth has genuinely stopped
    const RUNAWAY_MS = 600000;    // 10 minutes, purely a guard against an endless loop

    const startedAt = Date.now();
    const hunt = { timer: null, detach: () => {} };
    activeHunt = hunt;

    // The hunt moves the page on the user's behalf, so any real gesture hands
    // control straight back. Plain scroll events are deliberately not in this
    // set, because the hunt generates those itself.
    const onUserGesture = () => cancelHunt("user");
    const passiveCapture = { capture: true, passive: true };
    window.addEventListener("wheel", onUserGesture, passiveCapture);
    window.addEventListener("touchstart", onUserGesture, passiveCapture);
    window.addEventListener("keydown", onUserGesture, true);
    hunt.detach = () => {
      window.removeEventListener("wheel", onUserGesture, passiveCapture);
      window.removeEventListener("touchstart", onUserGesture, passiveCapture);
      window.removeEventListener("keydown", onUserGesture, true);
    };

    const settle = () => {
      if (activeHunt === hunt) activeHunt = null;
      hunt.detach();
    };

    const succeed = () => {
      settle();
      hideToast();
      arriveSmoothly(resolve, desiredTop, highlightArrival);
    };

    const fail = () => {
      settle();
      // Window-scrolled pages and older bookmarks have no container anchor, so
      // the saved offset is the only thing left to try.
      if (typeof stamp.scrollY === "number" && stamp.scrollY > 0) {
        hideToast();
        window.scrollTo({ top: stamp.scrollY, behavior: "smooth" });
        return;
      }
      showToast("Couldn't find that bookmark on this page");
    };

    // Probe around the saved position rather than trusting it outright: the ratio
    // was captured against a different page height, so it is a hint about roughly
    // where to look. `reach` controls how far the sweep widens.
    const seekTo = (container, maxScroll, n, total, reach) => {
      if (typeof stamp.containerScrollRatio === "number") {
        const spread = ((n - 1) / total) * reach;
        const offset = n % 2 ? -spread : spread;
        const ratio = Math.min(1, Math.max(0, stamp.containerScrollRatio + offset));
        container.scrollTop = ratio * maxScroll;
        return true;
      }
      if (typeof stamp.containerScrollY === "number") {
        container.scrollTop = Math.min(stamp.containerScrollY, maxScroll);
        return true;
      }
      return false;
    };

    let phase = "seek";
    let seekProbes = 0;
    let sweepProbes = 0;
    let tallest = -1;
    let mostMessages = -1;
    let nudged = false;
    let announced = false;
    let toastShown = false;
    let lastNudgeAt = 0;
    // Every sign of life pushes this forward: the container appearing, the page
    // growing taller, another message arriving. The hunt only gives up once
    // nothing at all has happened for STALL_MS, so it keeps going for as long as
    // the conversation keeps loading, however many rounds that takes.
    let lastProgressAt = Date.now();

    const probe = () => {
      if (activeHunt !== hunt) return;
      if (resolve()) return succeed();
      if (Date.now() - startedAt > RUNAWAY_MS) return fail();

      const container = findMainScrollContainer();
      if (!container) {
        // In a chat this only means messages have not rendered yet on a fresh
        // navigation, so waiting is right. Anywhere else there is no inner
        // scroller to paginate and never will be, so fall straight back to the
        // saved offset instead of stalling for seconds first.
        if (!isAIChat) return fail();
        if (Date.now() - lastProgressAt > STALL_MS) return fail();
        hunt.timer = setTimeout(probe, PROBE_MS);
        return;
      }

      if (!announced) {
        announced = true;
        lastProgressAt = Date.now(); // the container appearing is progress
      }

      const height = container.scrollHeight;
      const count = getAssistantMessages().length;
      const grew = height > tallest + 4 || count > mostMessages;
      if (height > tallest) tallest = height;
      if (count > mostMessages) mostMessages = count;
      if (grew) lastProgressAt = Date.now();

      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);

      // SEEK runs first and is short. A target that is merely off-screen in a
      // virtualized list renders as soon as its window is scrolled into view, so
      // trying the saved position costs a few hundred milliseconds. Paginating
      // the whole history is the slow path and should not be entered until this
      // has failed — going there first is what made a nearby bookmark take
      // seconds, because it scrolled to the top and then waited out the stall.
      if (phase === "seek") {
        seekProbes++;
        if (seekProbes <= FAST_SEEK_PROBES && seekTo(container, maxScroll, seekProbes, FAST_SEEK_PROBES, 0.08)) {
          hunt.timer = setTimeout(probe, FAST_SEEK_MS);
          return;
        }
        phase = "grow";
      }

      if (phase === "grow") {
        // Only the slow path is worth announcing; a quick restore should not
        // flash a toast on its way past.
        if (!toastShown) {
          toastShown = true;
          showToast("Finding your bookmark…", { persist: true });
        }

        if (Date.now() - lastProgressAt < STALL_MS) {
          const now = Date.now();
          // Sit still while content is arriving, and nudge only once loading has
          // gone quiet. The nudge is a trigger, not a metronome: nudging every
          // single cycle is what kept the page jittering even at 24px.
          //
          // The alternation matters. Assigning the value scrollTop already holds
          // fires no scroll event at all, so a platform that paginates from a
          // scroll listener or a top sentinel would load one page and then stop.
          if (now - lastProgressAt > QUIET_MS && now - lastNudgeAt > QUIET_MS) {
            container.scrollTop = nudged ? 0 : Math.min(NUDGE_PX, container.scrollHeight);
            nudged = !nudged;
            lastNudgeAt = now;
          }
          hunt.timer = setTimeout(probe, PROBE_MS);
          return;
        }

        // Nothing new for STALL_MS, so the whole history really is loaded.
        // Either the list is virtualized, or this bookmark is stale.
        phase = "sweep";
      }

      // Last resort: widen the sweep around the saved position across the whole
      // now-loaded conversation.
      sweepProbes++;
      if (sweepProbes > SWEEP_PROBES) return fail();
      if (!seekTo(container, maxScroll, sweepProbes, SWEEP_PROBES, 0.5)) return fail();

      hunt.timer = setTimeout(probe, PROBE_MS);
    };

    probe();
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
      arriveSmoothly(resolve, desiredTop, highlightArrival);
      return true;
    }
    return huntForTarget(stamp, resolve, desiredTop);
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
      arriveSmoothly(resolve, desiredTop, highlightArrival);
      return true;
    }

    // Target not in the DOM yet — hunt until it renders, then converge.
    return huntForTarget(stamp, resolve, desiredTop);
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

  // Re-read the per-site switch. Called on init and whenever the popup flips it,
  // so toggling takes effect on the open page without a reload.
  function refreshDisabledState() {
    if (!isContextAlive()) return;
    chrome.storage.local.get([DISABLED_SITES_KEY], (result) => {
      if (chrome.runtime.lastError) return;
      // Same www.-stripping the popup applies before storing.
      const host = window.location.hostname.replace(/^www\./, "");
      isSiteDisabled = (result[DISABLED_SITES_KEY] || []).includes(host);
      if (isSiteDisabled) {
        hideSelectionButton();
        closeSaveForm();
      }
    });
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

  function hideToast() {
    const existing = document.getElementById("scrollstamp-toast");
    if (!existing) return;
    existing.classList.add("scrollstamp-toast-hide");
    setTimeout(() => existing.remove(), 300);
  }

  // `options.persist` keeps the toast up until the caller clears it, which the
  // hunt needs: it can run for a while, and a message that vanished after two
  // seconds would leave the page looking frozen.
  function showToast(message, options = {}) {
    const existing = document.getElementById("scrollstamp-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "scrollstamp-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    if (options.persist) return;

    setTimeout(() => {
      // A toast replaced in the meantime is already detached; leave the new one be.
      if (!toast.isConnected) return;
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
    icon.appendChild(createPinSvg(22, 22));

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
    form.appendChild(input);
    form.appendChild(actions);

    // Position near selection, clamped to viewport
    const formW = 264;
    const formH = 130;
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
    const img = document.createElement("img");
    if (isContextAlive()) {
      try {
        img.src = chrome.runtime.getURL("icon.png");
      } catch (_) {}
    }
    img.width = width;
    img.height = height;
    img.alt = "ScrollStamp";
    img.style.display = "block";
    img.style.objectFit = "contain";
    img.style.borderRadius = "3px";
    img.classList.add("scrollstamp-img-pin");
    return img;
  }

  function getSelectionButton() {
    if (selectionBtn && document.body.contains(selectionBtn)) return selectionBtn;

    selectionBtn = document.createElement("button");
    selectionBtn.id = "scrollstamp-select-btn";
    selectionBtn.setAttribute("aria-label", "Bookmark selected text");

    const pin = document.createElement("span");
    pin.className = "ssb-pin";
    pin.appendChild(createPinSvg(18, 18));

    const text = document.createElement("span");
    text.className = "ssb-text";
    text.textContent = "Bookmark";

    selectionBtn.appendChild(pin);
    selectionBtn.appendChild(text);
    document.body.appendChild(selectionBtn);
    return selectionBtn;
  }

  function showSelectionButton(rect) {
    if (isSiteDisabled) return;
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
      if (isSiteDisabled) return;
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
    // A second click supersedes the first rather than racing it for the scroll
    // position. Note the return value now means "started", not "found" — a hunt
    // may still be running when this returns.
    cancelHunt("superseded");
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

    refreshDisabledState();
    checkPendingScroll();
  }

  // Keep the open page in sync when the popup toggles this site on or off.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[DISABLED_SITES_KEY]) refreshDisabledState();
    });
  } catch (_) {}

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
