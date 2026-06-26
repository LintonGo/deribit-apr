// Deribit APR Calculator - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const aprToggle = document.getElementById('aprToggle');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  let isEnabled = true;

  // Load saved state
  chrome.storage.sync.get(['aprEnabled'], (result) => {
    if (result.aprEnabled !== undefined) {
      isEnabled = result.aprEnabled;
      aprToggle.checked = isEnabled;
    }
    updateUI();
  });

  // Toggle handler
  aprToggle.addEventListener('change', () => {
    isEnabled = aprToggle.checked;

    // Save to storage
    chrome.storage.sync.set({ aprEnabled: isEnabled });

    // Update UI
    updateUI();

    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      const supportedSites = ['deribit.com', 'tibired.com'];
      if (currentTab && currentTab.url &&
        supportedSites.some(site => currentTab.url.includes(site))) {
        chrome.tabs.sendMessage(currentTab.id, {
          type: 'APR_TOGGLE',
          enabled: isEnabled
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Could not send message to content script');
          }
        });
      }
    });
  });

  // Check current tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    const supportedSites = ['deribit.com', 'tibired.com'];

    const isSupported = currentTab && currentTab.url &&
      supportedSites.some(site => currentTab.url.includes(site));

    if (isSupported) {
      const siteName = currentTab.url.includes('tibired') ? 'Tibired' : 'Deribit';

      // Get status from content script
      chrome.tabs.sendMessage(currentTab.id, { type: 'GET_STATUS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Could not connect to content script');
          statusText.textContent = 'Loading...';
          return;
        }

        if (response) {
          isEnabled = response.enabled !== undefined ? response.enabled : true;
          aprToggle.checked = isEnabled;
          updateUI();

          if (isEnabled) {
            statusText.textContent = `Active on ${siteName}`;
          } else {
            statusText.textContent = `Disabled on ${siteName}`;
          }
        }
      });
    } else {
      statusDot.classList.add('inactive');
      statusText.textContent = 'Not on supported site';
    }
  });

  function updateUI() {
    if (isEnabled) {
      statusDot.classList.remove('inactive', 'disabled');
    } else {
      statusDot.classList.add('disabled');
      statusDot.classList.remove('inactive');
    }
  }
});