(function () {
  "use strict";

  var pageTitle = document.getElementById("pageTitle");
  var stampCount = document.getElementById("stampCount");
  var stampsList = document.getElementById("stampsList");
  var viewStampsBtn = document.getElementById("viewStampsBtn");
  var clearStampsBtn = document.getElementById("clearStampsBtn");

  var currentUrl = "";
  var currentStamps = [];

  // Get active tab and load stamps
  function init() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        var tab = tabs[0];
        currentUrl = tab.url.split("#")[0];
        pageTitle.textContent = tab.title || "Unknown Page";

        loadStamps();
      }
    });
  }

  // Load stamps for current page
  function loadStamps() {
    chrome.storage.local.get([currentUrl], function (result) {
      currentStamps = result[currentUrl] || [];
      renderStamps();
    });
  }

  // Render stamps list
  function renderStamps() {
    var count = currentStamps.length;
    stampCount.textContent = count + (count === 1 ? " stamp" : " stamps");

    // Update button states
    viewStampsBtn.disabled = count === 0;
    clearStampsBtn.disabled = count === 0;

    if (count === 0) {
      stampsList.innerHTML =
        '<div class="stamps-empty">' +
        '<div class="stamps-empty-icon">📍</div>' +
        "No stamps on this page yet<br>Click the 📌 button to create one!" +
        "</div>";
      return;
    }

    stampsList.innerHTML = "";

    currentStamps.forEach(function (stamp, index) {
      var item = document.createElement("div");
      item.className = "stamp-item";

      var percentage = getScrollPercentage(stamp.scrollY);
      var timeAgo = getTimeAgo(stamp.createdAt);

      item.innerHTML =
        '<div class="stamp-item-info">' +
        '<div class="stamp-item-label">' +
        escapeHtml(stamp.label) +
        "</div>" +
        '<div class="stamp-item-meta">' +
        percentage +
        "% • " +
        timeAgo +
        "</div>" +
        "</div>" +
        '<span class="stamp-item-arrow">→</span>';

      item.addEventListener("click", function () {
        scrollToStamp(stamp.scrollY);
      });

      stampsList.appendChild(item);
    });
  }

  // Get scroll percentage (approximate)
  function getScrollPercentage(scrollY) {
    // We estimate based on typical page heights
    // The content script has accurate values
    return Math.round((scrollY / Math.max(scrollY + 1000, 1)) * 100);
  }

  // Get human-readable time ago
  function getTimeAgo(dateString) {
    var date = new Date(dateString);
    var now = new Date();
    var seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return "Just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";

    return date.toLocaleDateString();
  }

  // Scroll to stamp on page
  function scrollToStamp(scrollY) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          {
            action: "scrollToStamp",
            scrollY: scrollY,
          },
          function (response) {
            // Close popup after scrolling
            window.close();
          }
        );
      }
    });
  }

  // View stamps on page (opens panel)
  viewStampsBtn.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          {
            action: "showPanel",
          },
          function (response) {
            window.close();
          }
        );
      }
    });
  });

  // Clear all stamps for current page
  clearStampsBtn.addEventListener("click", function () {
    if (currentStamps.length === 0) return;

    var confirmed = confirm(
      "Clear all " + currentStamps.length + " stamps for this page?"
    );
    if (!confirmed) return;

    chrome.storage.local.remove([currentUrl], function () {
      currentStamps = [];
      renderStamps();
    });
  });

  // Escape HTML
  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize
  init();
})();
