(function () {
  "use strict";

  // Prevent multiple injections
  if (window.__scrollStampLoaded) return;
  window.__scrollStampLoaded = true;

  // Create the floating stamp button
  const stampButton = document.createElement("div");
  stampButton.id = "scrollstamp-button";
  stampButton.innerHTML = "📌";
  stampButton.title = "Create ScrollStamp";

  // Create the label that appears on hover
  const stampLabel = document.createElement("span");
  stampLabel.id = "scrollstamp-label";
  stampLabel.textContent = "Stamp";
  stampButton.appendChild(stampLabel);

  // Create toast notification container
  const toast = document.createElement("div");
  toast.id = "scrollstamp-toast";
  document.body.appendChild(toast);

  // Add button to page
  document.body.appendChild(stampButton);

  // Show toast notification
  function showToast(message, duration = 2000) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(function () {
      toast.classList.remove("show");
    }, duration);
  }

  // Get current page URL (normalized)
  function getPageUrl() {
    return window.location.href.split("#")[0];
  }

  // Get scroll percentage
  function getScrollPercentage(scrollY) {
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) return 0;
    return Math.round((scrollY / docHeight) * 100);
  }

  // Save a stamp
  function saveStamp(scrollY, label) {
    var url = getPageUrl();
    var stamp = {
      scrollY: scrollY,
      label: label || "Stamp at " + getScrollPercentage(scrollY) + "%",
      createdAt: new Date().toISOString(),
    };

    chrome.storage.local.get([url], function (result) {
      var stamps = result[url] || [];
      stamps.push(stamp);

      var data = {};
      data[url] = stamps;

      chrome.storage.local.set(data, function () {
        showToast("✓ Stamp saved!");
      });
    });
  }

  // Handle stamp button click
  stampButton.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();

    var currentScrollY = window.scrollY;
    var percentage = getScrollPercentage(currentScrollY);

    // Prompt for optional label
    var label = prompt(
      "Add a label for this stamp (optional):\n\nScroll position: " +
        percentage +
        "%",
      ""
    );

    // If user cancelled the prompt, don't save
    if (label === null) return;

    saveStamp(currentScrollY, label.trim() || null);
  });

  // Create stamps panel
  var stampsPanel = document.createElement("div");
  stampsPanel.id = "scrollstamp-panel";
  stampsPanel.innerHTML =
    '<div class="scrollstamp-panel-header"><span>📌 Stamps</span><button id="scrollstamp-panel-close">×</button></div><div id="scrollstamp-panel-list"></div>';
  document.body.appendChild(stampsPanel);

  // Close panel button
  document
    .getElementById("scrollstamp-panel-close")
    .addEventListener("click", function () {
      stampsPanel.classList.remove("show");
    });

  // Double-click to show stamps panel
  stampButton.addEventListener("dblclick", function (e) {
    e.preventDefault();
    e.stopPropagation();
    showStampsPanel();
  });

  // Show stamps panel
  function showStampsPanel() {
    var url = getPageUrl();
    var listContainer = document.getElementById("scrollstamp-panel-list");

    chrome.storage.local.get([url], function (result) {
      var stamps = result[url] || [];

      if (stamps.length === 0) {
        listContainer.innerHTML =
          '<div class="scrollstamp-empty">No stamps on this page yet.<br>Click 📌 to create one!</div>';
      } else {
        listContainer.innerHTML = "";

        stamps.forEach(function (stamp, index) {
          var item = document.createElement("div");
          item.className = "scrollstamp-item";

          var percentage = getScrollPercentage(stamp.scrollY);

          item.innerHTML =
            '<div class="scrollstamp-item-info">' +
            '<span class="scrollstamp-item-label">' +
            escapeHtml(stamp.label) +
            "</span>" +
            '<span class="scrollstamp-item-percent">' +
            percentage +
            "% down</span>" +
            "</div>" +
            '<button class="scrollstamp-item-delete" data-index="' +
            index +
            '">🗑️</button>';

          // Click to scroll
          item
            .querySelector(".scrollstamp-item-info")
            .addEventListener("click", function () {
              window.scrollTo({
                top: stamp.scrollY,
                behavior: "smooth",
              });
              stampsPanel.classList.remove("show");

              // Brief highlight effect at destination
              setTimeout(function () {
                showScrollIndicator(stamp.scrollY);
              }, 500);
            });

          // Delete button
          item
            .querySelector(".scrollstamp-item-delete")
            .addEventListener("click", function (e) {
              e.stopPropagation();
              deleteStamp(index);
            });

          listContainer.appendChild(item);
        });
      }

      stampsPanel.classList.add("show");
    });
  }

  // Delete a stamp
  function deleteStamp(index) {
    var url = getPageUrl();

    chrome.storage.local.get([url], function (result) {
      var stamps = result[url] || [];
      stamps.splice(index, 1);

      var data = {};
      data[url] = stamps;

      chrome.storage.local.set(data, function () {
        showStampsPanel(); // Refresh panel
        showToast("Stamp deleted");
      });
    });
  }

  // Show scroll indicator at destination
  function showScrollIndicator(scrollY) {
    var indicator = document.createElement("div");
    indicator.id = "scrollstamp-indicator";
    indicator.style.top = scrollY + "px";
    document.body.appendChild(indicator);

    // Trigger animation
    requestAnimationFrame(function () {
      indicator.classList.add("show");
    });

    // Remove after animation
    setTimeout(function () {
      indicator.classList.remove("show");
      setTimeout(function () {
        if (indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      }, 300);
    }, 1000);
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    if (request.action === "getStamps") {
      var url = getPageUrl();
      chrome.storage.local.get([url], function (result) {
        sendResponse({
          stamps: result[url] || [],
          url: url,
          title: document.title,
        });
      });
      return true; // Keep channel open for async response
    }

    if (request.action === "scrollToStamp") {
      window.scrollTo({
        top: request.scrollY,
        behavior: "smooth",
      });
      setTimeout(function () {
        showScrollIndicator(request.scrollY);
      }, 500);
      sendResponse({ success: true });
    }

    if (request.action === "clearStamps") {
      var url = getPageUrl();
      chrome.storage.local.remove([url], function () {
        sendResponse({ success: true });
      });
      return true;
    }

    if (request.action === "showPanel") {
      showStampsPanel();
      sendResponse({ success: true });
    }
  });
})();
