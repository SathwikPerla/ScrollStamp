// ScrollStamp - Background Service Worker
// Injects content script into all existing tabs when the extension is installed or updated

// chrome.runtime.onStartup.addListener(async () => {
//   const tabs = await chrome.tabs.query({});

//   for (const tab of tabs) {
//     if (!tab.id || !tab.url || !/^https?:/i.test(tab.url)) continue;

//     // try {
//     //   await chrome.scripting.insertCSS({
//     //     target: { tabId: tab.id },
//     //     files: ["content.css"],
//     //   });
//     // } catch (_) {}

//     // try {
//     //   await chrome.scripting.executeScript({
//     //     target: { tabId: tab.id },
//     //     files: ["content.js"],
//     //   });
//     // } catch (_) {}
//   }
// });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && /^https?:/.test(tab.url)) {
    chrome.scripting
      .executeScript({
        target: { tabId },
        files: ["content.js"],
      })
      .catch(() => {});

    chrome.scripting
      .insertCSS({
        target: { tabId },
        files: ["content.css"],
      })
      .catch(() => {});
  }
});