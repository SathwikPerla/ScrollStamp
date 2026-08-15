// ScrollStamp — Popup Script

const PLATFORM_LOGOS = {
  chatgpt:    "icons/chatgpt.png",
  claude:     "icons/claude.png",
  gemini:     "icons/gemini.png",
  deepseek:   "icons/deepseek.png",
  perplexity: "icons/perplexity.png",
  grok:       "icons/grok.png",
};

const DISABLED_SITES_KEY = "scrollstamp_disabled_sites";

// Keys under the scrollstamp_ prefix that are settings/state, not bookmark lists.
// Anything listed here is skipped when reading stamps and preserved by Clear All.
const RESERVED_KEYS = [
  "scrollstamp_pending",
  "scrollstamp_uid",
  "scrollstamp_dau",
  "scrollstamp_mau",
  "scrollstamp_opens",
  DISABLED_SITES_KEY,
];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await ensureContentScriptReady();
  detectCurrentMode();
  initSiteToggle();
  loadStamps();
  document.getElementById("clear-all").addEventListener("click", clearAllStamps);
}

// ─── Per-site Enable/Disable ────────────────────

async function initSiteToggle() {
  const toggle = document.getElementById("site-toggle");
  const label = document.getElementById("site-hostname");
  const row = document.getElementById("site-control");

  // Must run on every exit path — the row stays hidden until this fires.
  const reveal = () => row.classList.add("resolved");

  const unavailable = () => {
    label.textContent = "Not available on this page";
    toggle.setAttribute("aria-checked", "false");
    toggle.disabled = true;
    reveal();
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    unavailable();
    return;
  }

  let hostname;
  try {
    // Strip www. before storing so a site served on both apex and www is one
    // entry — content.js normalizes the same way when checking.
    hostname = new URL(tab.url).hostname.replace(/^www\./, "");
  } catch (_) {
    unavailable();
    return;
  }

  const render = (enabled) => {
    toggle.setAttribute("aria-checked", String(enabled));
    toggle.title = `${enabled ? "Disable" : "Enable"} ScrollStamp on ${hostname}`;
    label.textContent = enabled ? hostname : `${hostname} — off`;
  };

  chrome.storage.local.get([DISABLED_SITES_KEY], (result) => {
    render(!(result[DISABLED_SITES_KEY] || []).includes(hostname));
    reveal();
    // Enable animation only from here on, so the first paint doesn't slide.
    requestAnimationFrame(() => toggle.classList.add("ready"));
  });

  toggle.addEventListener("click", () => {
    chrome.storage.local.get([DISABLED_SITES_KEY], (result) => {
      const disabled = result[DISABLED_SITES_KEY] || [];
      const wasDisabled = disabled.includes(hostname);
      const next = wasDisabled
        ? disabled.filter((h) => h !== hostname)
        : [...disabled, hostname];
      // The content script watches this key and applies it to the open page.
      chrome.storage.local.set({ [DISABLED_SITES_KEY]: next }, () => render(wasDisabled));
    });
  });
}

// ─── Content Script Readiness ───────────────────

async function ensureContentScriptReady() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) return;

  const alive = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { action: "getMode" }, (response) => {
      resolve(!chrome.runtime.lastError && !!response);
    });
  });

  if (alive) return;

  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (_) {}
}

// ─── Mode Detection ─────────────────────────────

async function detectCurrentMode() {
  const modeBadge = document.getElementById("mode-badge");
  const emptyHint = document.getElementById("empty-hint");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { action: "getMode" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        modeBadge.textContent = "Scroll";
        modeBadge.className = "mode-badge scroll-mode";
        emptyHint.textContent = "Select text on any page to bookmark it";
        return;
      }

      if (response.isAIChat) {
        modeBadge.textContent = response.platform;
        modeBadge.className = "mode-badge ai-mode";
        emptyHint.textContent = "Select text in any AI message to bookmark it";
      } else if (response.isPDF) {
        // Chrome's native PDF viewer renders text inside a plugin, not the DOM,
        // so there's nothing for the content script to select or anchor to.
        modeBadge.textContent = "✕ PDF not supported";
        modeBadge.className = "mode-badge unsupported-mode";
        emptyHint.textContent = "PDFs aren't supported yet — works on any web page";
      } else {
        modeBadge.textContent = "Scroll";
        modeBadge.className = "mode-badge scroll-mode";
        emptyHint.textContent = "Select text on any page to bookmark it";
      }
    });
  } catch (_) {}
}

// ─── Load & Render Stamps ───────────────────────

async function loadStamps() {
  const stampsList = document.getElementById("stamps-list");
  const emptyState = document.getElementById("empty-state");

  chrome.storage.local.get(null, (items) => {
    const allStamps = [];

    Object.keys(items).forEach((key) => {
      if (!key.startsWith("scrollstamp_")) return;
      // Skip non-bookmark keys (settings, analytics, pending, uid)
      if (RESERVED_KEYS.includes(key)) return;
      const stamps = items[key];
      if (Array.isArray(stamps)) {
        stamps.forEach((stamp) => allStamps.push({ ...stamp, storageKey: key }));
      }
    });

    allStamps.sort((a, b) => b.timestamp - a.timestamp);

    if (allStamps.length === 0) {
      emptyState.style.display = "flex";
      stampsList.style.display = "none";
      return;
    }

    emptyState.style.display = "none";
    stampsList.style.display = "flex";
    stampsList.innerHTML = "";
    allStamps.forEach((stamp) => stampsList.appendChild(createStampElement(stamp)));
  });
}

function createStampElement(stamp) {
  const li = document.createElement("li");

  const typeClass = stamp.type || "scroll";
  li.className = `stamp-item type-${typeClass}`;

  const isSelection = stamp.type === "selection";
  const isMessage   = stamp.type === "message";
  const isPdf       = stamp.type === "pdf";

  const typeLabel = isMessage
    ? stamp.platform
    : isPdf
    ? "PDF"
    : isSelection
    ? "clip"
    : `${stamp.scrollPercent ?? 0}%`;

  // Icon — platform logo for AI types, emoji otherwise
  const iconSpan = document.createElement("span");
  iconSpan.className = "stamp-icon";
  if ((isSelection || isMessage) && stamp.platform && PLATFORM_LOGOS[stamp.platform]) {
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL(PLATFORM_LOGOS[stamp.platform]);
    img.alt = stamp.platform;
    img.className = "stamp-platform-logo";
    iconSpan.appendChild(img);
  } else {
    iconSpan.textContent = isSelection ? "✂️" : isMessage ? "💬" : isPdf ? "📄" : "📍";
  }

  // Title — prefer custom title, fall back to preview or pageTitle
  let displayTitle = stamp.title || stamp.preview || "No preview";
  if (!isMessage && !stamp.title && stamp.pageTitle) displayTitle = stamp.pageTitle;

  // Hostname
  let hostname = stamp.hostname || "";
  if (!hostname && stamp.url) {
    try { hostname = new URL(stamp.url).hostname; } catch (_) {}
  }
  const shortHostname = hostname.replace(/^www\./, "").substring(0, 25);

  // Content area
  const content = document.createElement("div");
  content.className = "stamp-content";

  const titleRow = document.createElement("div");
  titleRow.className = "stamp-title-row";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "stamp-title-input";
  titleInput.value = displayTitle;
  titleInput.placeholder = "Add title…";
  titleInput.title = "Click pencil to edit";
  titleInput.readOnly = true;
  titleInput.style.pointerEvents = "none";

  const editBtn = document.createElement("button");
  editBtn.className = "stamp-edit-btn";
  editBtn.title = "Edit title";
  editBtn.textContent = "✏️";

  titleRow.appendChild(titleInput);
  titleRow.appendChild(editBtn);

  const meta = document.createElement("div");
  meta.className = "stamp-meta";

  const typeBadge = document.createElement("span");
  typeBadge.className = `stamp-type ${typeClass}`;
  typeBadge.textContent = typeLabel;

  const hostnameEl = document.createElement("span");
  hostnameEl.className = "stamp-hostname";
  hostnameEl.title = hostname;
  hostnameEl.textContent = shortHostname;

  const timeEl = document.createElement("span");
  timeEl.className = "stamp-time";
  timeEl.textContent = formatTimeAgo(stamp.timestamp);

  meta.appendChild(typeBadge);
  meta.appendChild(hostnameEl);
  meta.appendChild(timeEl);

  content.appendChild(titleRow);
  content.appendChild(meta);

  // Delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "stamp-delete";
  deleteBtn.title = "Delete bookmark";
  deleteBtn.textContent = "✕";

  li.appendChild(iconSpan);
  li.appendChild(content);
  li.appendChild(deleteBtn);

  // ── Event handlers ──

  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    titleInput.readOnly = false;
    titleInput.style.pointerEvents = "auto";
    titleInput.focus();
    titleInput.select();
  });

  titleInput.addEventListener("blur", () => {
    titleInput.readOnly = true;
    titleInput.style.pointerEvents = "none";
    updateStampTitle(stamp, titleInput.value);
  });

  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); titleInput.blur(); }
    if (e.key === "Escape") {
      e.preventDefault();
      titleInput.value = stamp.title || stamp.preview || "No preview";
      titleInput.blur();
    }
  });

  li.addEventListener("click", (e) => {
    if (e.target === deleteBtn || e.target === editBtn || e.target === titleInput) return;
    scrollToStamp(stamp);
  });

  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteStamp(stamp);
  });

  return li;
}

// ─── Title Update ───────────────────────────────

function updateStampTitle(stamp, newTitle) {
  chrome.storage.local.get([stamp.storageKey], (result) => {
    const stamps = result[stamp.storageKey] || [];
    const idx = stamps.findIndex((s) => s.id === stamp.id);
    if (idx !== -1) {
      stamps[idx].title = newTitle;
      chrome.storage.local.set({ [stamp.storageKey]: stamps });
    }
  });
}

// ─── Navigation ─────────────────────────────────

async function scrollToStamp(stamp) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  try {
    const currentUrl = new URL(tab.url);
    const stampUrl   = new URL(stamp.url);
    const isSamePage = currentUrl.origin === stampUrl.origin &&
                       currentUrl.pathname === stampUrl.pathname;

    if (isSamePage) {
      chrome.tabs.sendMessage(tab.id, { action: "scrollTo", stamp });
    } else {
      // Save the scroll target; the content script on the new page will pick it up
      await chrome.storage.local.set({ scrollstamp_pending: { stamp } });
      chrome.tabs.update(tab.id, { url: stamp.url });
    }
  } catch (_) {
    chrome.tabs.sendMessage(tab.id, { action: "scrollTo", stamp });
  }

  window.close();
}

// ─── Delete ─────────────────────────────────────

function deleteStamp(stamp) {
  chrome.storage.local.get([stamp.storageKey], (result) => {
    const stamps = (result[stamp.storageKey] || []).filter((s) => s.id !== stamp.id);
    if (stamps.length === 0) {
      chrome.storage.local.remove(stamp.storageKey, loadStamps);
    } else {
      chrome.storage.local.set({ [stamp.storageKey]: stamps }, loadStamps);
    }
  });
}

function clearAllStamps() {
  if (!confirm("Delete all bookmarks?")) return;
  chrome.storage.local.get(null, (items) => {
    const keysToRemove = Object.keys(items).filter((k) => {
      if (!k.startsWith("scrollstamp_")) return false;
      // Keep non-bookmark keys intact
      return !RESERVED_KEYS.includes(k);
    });
    chrome.storage.local.remove(keysToRemove, loadStamps);
  });
}

// ─── Utilities ──────────────────────────────────

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60)    return "just now";
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
