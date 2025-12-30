// ScrollStamp v2 - Message-based bookmarking for AI chat apps

(function () {
  "use strict";

  // Platform-specific selectors for AI assistant messages
  const PLATFORM_SELECTORS = {
    chatgpt: {
      assistant: '[data-message-author-role="assistant"]',
      container: "main",
      messageText: ".markdown",
    },
    claude: {
      assistant: '[data-testid="assistant-message"], .font-claude-message',
      container: "main",
      messageText: ".prose",
    },
    gemini: {
      assistant: '[data-message-author="1"], .model-response-text',
      container: "main",
      messageText: ".message-content",
    },
    perplexity: {
      assistant: '[data-testid="answer-content"], .prose',
      container: "main",
      messageText: ".prose",
    },
    grok: {
      assistant: '[data-testid="assistant-message"]',
      container: "main",
      messageText: ".message-content",
    },
    deepseek: {
      assistant: ".ds-markdown",
      container: "main",
      messageText: ".ds-markdown",
    },
  };

  function isChromeStorageAvailable() {
    return (
      typeof chrome !== "undefined" && chrome.storage && chrome.storage.local
    );
  }


  let floatingBtn = null;
  let currentPlatform = null;

  // Detect which AI platform we're on
  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes("chatgpt") || host.includes("chat.openai"))
      return "chatgpt";
    if (host.includes("claude")) return "claude";
    if (host.includes("gemini")) return "gemini";
    if (host.includes("perplexity")) return "perplexity";
    if (host.includes("grok")) return "grok";
    if (host.includes("deepseek")) return "deepseek";
    return null;
  }

  // Get all assistant messages on the page
  function getAssistantMessages() {
    if (!currentPlatform) return [];
    const selector = PLATFORM_SELECTORS[currentPlatform]?.assistant;
    if (!selector) return [];

    // Try multiple selectors (comma-separated)
    const messages = document.querySelectorAll(selector);
    return Array.from(messages);
  }

  // Find the nearest assistant message to viewport center
  function findNearestAssistantMessage() {
    const messages = getAssistantMessages();
    if (messages.length === 0) return null;

    const viewportCenter = window.innerHeight / 2;
    let nearest = null;
    let minDistance = Infinity;

    messages.forEach((msg, index) => {
      const rect = msg.getBoundingClientRect();
      // Check if message is in or near viewport
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        const msgCenter = rect.top + rect.height / 2;
        const distance = Math.abs(msgCenter - viewportCenter);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = { element: msg, index };
        }
      }
    });

    // If none in viewport, find closest to top of viewport
    if (!nearest) {
      messages.forEach((msg, index) => {
        const rect = msg.getBoundingClientRect();
        const distance = Math.abs(rect.top);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = { element: msg, index };
        }
      });
    }

    return nearest;
  }

  // Extract text preview from message
  function getMessagePreview(element) {
    const textSelector = PLATFORM_SELECTORS[currentPlatform]?.messageText;
    const textEl = textSelector ? element.querySelector(textSelector) : element;
    const text = (textEl || element).textContent || "";
    return text.trim().substring(0, 100).replace(/\s+/g, " ");
  }

  // Generate a stable identifier for a message
  function generateMessageId(element, index) {
    const preview = getMessagePreview(element);
    // Create hash from preview text
    let hash = 0;
    for (let i = 0; i < preview.length; i++) {
      const char = preview.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `msg_${index}_${Math.abs(hash).toString(36)}`;
  }

  // Create a stamp object
  function createStamp(messageInfo) {
    const preview = getMessagePreview(messageInfo.element);
    return {
      id: generateMessageId(messageInfo.element, messageInfo.index),
      index: messageInfo.index,
      preview: preview,
      timestamp: Date.now(),
      url: window.location.href,
      platform: currentPlatform,
    };
  }

  // Save stamp to storage
 async function saveStamp(stamp) {
   if (!isChromeStorageAvailable()) {
     console.warn("ScrollStamp: chrome.storage not available yet");
     return false;
   }

   const storageKey = `scrollstamp_${btoa(window.location.pathname).substring(
     0,
     20
   )}`;

   return new Promise((resolve) => {
     chrome.storage.local.get([storageKey], (result) => {
       const stamps = result[storageKey] || [];
       const exists = stamps.some((s) => s.id === stamp.id);

       if (!exists) {
         stamps.push(stamp);
         chrome.storage.local.set({ [storageKey]: stamps }, () => {
           resolve(true);
         });
       } else {
         resolve(false);
       }
     });
   });
 }


  // Scroll to a specific message by finding it again
  function scrollToMessage(stamp) {
    const messages = getAssistantMessages();

    // Try to find by index first
    if (stamp.index < messages.length) {
      const targetByIndex = messages[stamp.index];
      const preview = getMessagePreview(targetByIndex);

      // Verify it's the right message by comparing preview
      if (preview.startsWith(stamp.preview.substring(0, 30))) {
        smoothScrollTo(targetByIndex);
        return true;
      }
    }

    // Fallback: search by text preview
    for (const msg of messages) {
      const preview = getMessagePreview(msg);
      if (preview.startsWith(stamp.preview.substring(0, 30))) {
        smoothScrollTo(msg);
        return true;
      }
    }

    return false;
  }

  // Smooth scroll to element
  function smoothScrollTo(element) {
    element.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    // Highlight briefly
    element.classList.add("scrollstamp-highlight");
    setTimeout(() => {
      element.classList.remove("scrollstamp-highlight");
    }, 2000);
  }

  // Create floating pin button
  function createFloatingButton() {
    if (floatingBtn) return;

    floatingBtn = document.createElement("div");
    floatingBtn.id = "scrollstamp-pin";
    floatingBtn.innerHTML = "📌";
    floatingBtn.title = "Bookmark this AI message";

    floatingBtn.addEventListener("click", async () => {
      const nearest = findNearestAssistantMessage();
      if (nearest) {
        const stamp = createStamp(nearest);
        const saved = await saveStamp(stamp);

        if (saved) {
          showToast("Message bookmarked!");
          floatingBtn.classList.add("scrollstamp-success");
          setTimeout(
            () => floatingBtn.classList.remove("scrollstamp-success"),
            500
          );
        } else {
          showToast("Already bookmarked");
        }
      } else {
        showToast("No AI message found nearby");
      }
    });

    document.body.appendChild(floatingBtn);
  }

  // Show toast notification
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

  // Listen for messages from popup
if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getStamps") {
      const storageKey = `scrollstamp_${btoa(
        window.location.pathname
      ).substring(0, 20)}`;
      chrome.storage.local.get([storageKey], (result) => {
        sendResponse({ stamps: result[storageKey] || [] });
      });
      return true;
    }

    if (request.action === "scrollTo") {
      const success = scrollToMessage(request.stamp);
      sendResponse({ success });
      return true;
    }

    if (request.action === "deleteStamp") {
      const storageKey = `scrollstamp_${btoa(
        window.location.pathname
      ).substring(0, 20)}`;
      chrome.storage.local.get([storageKey], (result) => {
        const stamps = (result[storageKey] || []).filter(
          (s) => s.id !== request.stampId
        );
        chrome.storage.local.set({ [storageKey]: stamps }, () => {
          sendResponse({ success: true });
        });
      });
      return true;
    }
  });
}

  // Initialize
  function init() {
    currentPlatform = detectPlatform();
   if (currentPlatform && typeof chrome !== "undefined") {
     createFloatingButton();
     console.log(`ScrollStamp v2 initialized for ${currentPlatform}`);
   }

  }

  // Wait for page to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Re-init on SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(init, 500);
    }
  }).observe(document.body, { subtree: true, childList: true });
})();
