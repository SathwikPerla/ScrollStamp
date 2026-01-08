// ScrollStamp - Unified Popup Script

document.addEventListener("DOMContentLoaded", init);

async function init() {
  loadStamps();
  detectCurrentMode();
  document
    .getElementById("clear-all")
    .addEventListener("click", clearAllStamps);
}

async function detectCurrentMode() {
  const modeBadge = document.getElementById("mode-badge");
  const emptyHint = document.getElementById("empty-hint");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: "getMode" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          modeBadge.textContent = "Scroll";
          modeBadge.className = "mode-badge scroll-mode";
          emptyHint.textContent = "Click 📌 to bookmark scroll positions";
          return;
        }

        if (response.isAIChat) {
          modeBadge.textContent = response.platform;
          modeBadge.className = "mode-badge ai-mode";
          emptyHint.textContent = "Click 📌 to bookmark AI messages";
        } else if (response.isPDF) {
          modeBadge.textContent = "PDF";
          modeBadge.className = "mode-badge pdf-mode";
          emptyHint.textContent = "Click 📌 to bookmark PDF positions";
        } else {
          modeBadge.textContent = "Scroll";
          modeBadge.className = "mode-badge scroll-mode";
          emptyHint.textContent = "Click 📌 to bookmark scroll positions";
        }
      });
    }
  } catch (e) {
    modeBadge.textContent = "Scroll";
    modeBadge.className = "mode-badge scroll-mode";
  }
}

async function loadStamps() {
  const stampsList = document.getElementById("stamps-list");
  const emptyState = document.getElementById("empty-state");

  chrome.storage.local.get(null, (items) => {
    const allStamps = [];

    Object.keys(items).forEach((key) => {
      if (key.startsWith("scrollstamp_")) {
        const stamps = items[key];
        if (Array.isArray(stamps)) {
          stamps.forEach((stamp) => {
            allStamps.push({ ...stamp, storageKey: key });
          });
        }
      }
    });

    allStamps.sort((a, b) => b.timestamp - a.timestamp);

    if (allStamps.length === 0) {
      emptyState.style.display = "flex";
      stampsList.style.display = "none";
      return;
    }

    emptyState.style.display = "none";
    stampsList.style.display = "block";
    stampsList.innerHTML = "";

    allStamps.forEach((stamp) => {
      const li = createStampElement(stamp);
      stampsList.appendChild(li);
    });
  });
}

function createStampElement(stamp) {
  const li = document.createElement("li");
  li.className = "stamp-item";

  const timeAgo = formatTimeAgo(stamp.timestamp);
  const isMessage = stamp.type === "message";
  const isPdf = stamp.type === "pdf";
  const icon = isMessage ? "💬" : isPdf ? "📄" : "📍";
  const typeClass = isMessage ? "message" : isPdf ? "pdf" : "scroll";
  const typeLabel = isMessage
    ? stamp.platform
    : isPdf
    ? "PDF"
    : `${stamp.scrollPercent || 0}%`;

  // Get display title - use custom title if set, otherwise preview
  let displayTitle = stamp.title || stamp.preview || "No preview";
  if (!isMessage && !stamp.title && stamp.pageTitle) {
    displayTitle = stamp.pageTitle;
  }

  // Extract hostname for display
  let hostname = stamp.hostname || "";
  if (!hostname && stamp.url) {
    try {
      hostname = new URL(stamp.url).hostname;
    } catch (e) {
      hostname = "";
    }
  }
  // Shorten hostname for display
  const shortHostname = hostname.replace(/^www\./, "").substring(0, 25);

  li.innerHTML = `
    <span class="stamp-icon">${icon}</span>
    <div class="stamp-content">
      <div class="stamp-title-row">
        <input type="text" class="stamp-title-input" value="${escapeHtml(
          displayTitle
        )}" placeholder="Add title..." title="Click to edit title" />
        <button class="stamp-edit-btn" title="Edit title">✏️</button>
      </div>
      <div class="stamp-meta">
        <span class="stamp-type ${typeClass}">${typeLabel}</span>
        <span class="stamp-hostname" title="${hostname}">${shortHostname}</span>
        <span>${timeAgo}</span>
      </div>
    </div>
    <button class="stamp-delete" title="Delete bookmark">✕</button>
  `;

  const titleInput = li.querySelector(".stamp-title-input");
  const editBtn = li.querySelector(".stamp-edit-btn");

  // Title input is readonly by default - ONLY editable via pencil icon
  titleInput.readOnly = true;
  titleInput.style.cursor = "default";
  titleInput.style.pointerEvents = "none"; // Prevent any text selection/interaction

  // Handle title editing - ONLY via pencil icon click
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    titleInput.readOnly = false;
    titleInput.style.cursor = "text";
    titleInput.style.pointerEvents = "auto";
    titleInput.focus();
    titleInput.select();
  });

  // Save on blur and restore readonly state
  titleInput.addEventListener("blur", () => {
    titleInput.readOnly = true;
    titleInput.style.cursor = "default";
    titleInput.style.pointerEvents = "none";
    updateStampTitle(stamp, titleInput.value);
  });

  // Handle keyboard shortcuts when editing
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      titleInput.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      titleInput.value = stamp.title || stamp.preview || "No preview";
      titleInput.blur();
    }
  });

  li.addEventListener("click", (e) => {
    if (
      e.target.classList.contains("stamp-delete") ||
      e.target.classList.contains("stamp-title-input") ||
      e.target.classList.contains("stamp-edit-btn")
    )
      return;
    scrollToStamp(stamp);
  });

  li.querySelector(".stamp-delete").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteStamp(stamp);
  });

  return li;
}

async function updateStampTitle(stamp, newTitle) {
  chrome.storage.local.get([stamp.storageKey], (result) => {
    const stamps = result[stamp.storageKey] || [];
    const stampIndex = stamps.findIndex((s) => s.id === stamp.id);
    if (stampIndex !== -1) {
      stamps[stampIndex].title = newTitle;
      chrome.storage.local.set({ [stamp.storageKey]: stamps });
    }
  });
}

async function scrollToStamp(stamp) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) return;

  // Check if we need to navigate to the page first
  const currentPath = new URL(tab.url).pathname;
  const stampPath = new URL(stamp.url).pathname;

  if (currentPath !== stampPath) {
    chrome.tabs.update(tab.id, { url: stamp.url }, () => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, {
          action: "scrollTo",
          stamp: stamp,
        });
      }, 2000);
    });
  } else {
    chrome.tabs.sendMessage(tab.id, {
      action: "scrollTo",
      stamp: stamp,
    });
  }

  window.close();
}

async function deleteStamp(stamp) {
  chrome.storage.local.get([stamp.storageKey], (result) => {
    const stamps = (result[stamp.storageKey] || []).filter(
      (s) => s.id !== stamp.id
    );

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
    const keysToRemove = Object.keys(items).filter((key) =>
      key.startsWith("scrollstamp_")
    );
    chrome.storage.local.remove(keysToRemove, loadStamps);
  });
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
