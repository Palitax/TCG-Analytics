// TCG Card Tracker - Webapp helper content script
// Injected into localhost and production webapp pages to bridge communications.

// Mark the page root so the Webapp knows the extension is installed and active
document.documentElement.setAttribute('data-tcg-tracker-extension-active', 'true');

// Listen for the custom DOM event from the Webapp
document.addEventListener('TCG_TRACKER_SYNC_ALL', (event) => {
  if (event.detail && event.detail.urls) {
    chrome.runtime.sendMessage({ action: "openTabs", urls: event.detail.urls });
  }
});
// Listen for requests for clipped images from the Webapp
document.addEventListener('TCG_TRACKER_GET_CLIPPED_IMAGES', (event) => {
  const { cardId } = event.detail || {};
  chrome.runtime.sendMessage({ action: "getClippedImages", cardId }, (res) => {
    if (res && res.success) {
      document.dispatchEvent(new CustomEvent('TCG_TRACKER_CLIPPED_IMAGES_REPLY', {
        detail: { images: res.images || [] }
      }));
    }
  });
});
