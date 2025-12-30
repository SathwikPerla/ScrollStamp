// ScrollStamp v2 - Popup Script

document.addEventListener("DOMContentLoaded", init);

function init() {
  loadStamps();

  document
    .getElementById("clear-all")
    .addEventListener("click", clearAllStamps);
}

async function loadStamps() {
  const stampsList = document.getElementById("stamps-list");
  const emptyState = document.getElementById("empty-state");

  // Get all stamps from storage
  chrome.storage.local.get(null, (items) => {
    const allStamps = [];

    // Collect all stamps from all pages
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

    // Sort by timestamp (newest first)
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

  li.innerHTML = `
    <span class="stamp-icon">📌</span>
    <div class="stamp-content">
      <div class="stamp-preview">${escapeHtml(
        stamp.preview || "AI Response"
      )}</div>
      <div class="stamp-meta">
        <span class="stamp-platform">${stamp.platform || "chat"}</span>
        <span>${timeAgo}</span>
      </div>
    </div>
    <button class="stamp-delete" title="Delete bookmark">✕</button>
  `;

  // Click to scroll
  li.addEventListener("click", (e) => {
    if (e.target.classList.contains("stamp-delete")) return;
    scrollToStamp(stamp);
  });

  // Delete button
  li.querySelector(".stamp-delete").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteStamp(stamp);
  });

  return li;
}

async function scrollToStamp(stamp) {
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) return;

  // Check if we're on the right page
  if (!tab.url.includes(new URL(stamp.url).pathname.split("/")[1])) {
    // Navigate to the page first
    chrome.tabs.update(tab.id, { url: stamp.url }, () => {
      // Wait for page load then scroll
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, {
          action: "scrollTo",
          stamp: stamp,
        });
      }, 2000);
    });
  } else {
    // Already on page, just scroll
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
