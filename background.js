// Deribit APR Calculator - Background Service Worker

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default values on first install
    chrome.storage.sync.set({
      strategy: 'put',
      showDaysToExpiry: true
    });

    console.log('[Deribit APR] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[Deribit APR] Extension updated');
  }
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['strategy', 'showDaysToExpiry'], (result) => {
      sendResponse(result);
    });
    return true; // Required for async response
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.sync.set(message.settings, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Keep service worker alive
setInterval(() => {
  // Heartbeat to keep service worker active
}, 20000);