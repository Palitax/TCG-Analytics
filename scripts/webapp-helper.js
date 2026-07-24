// TCG Card Tracker - Webapp helper content script
// Injected into localhost and production webapp pages to bridge communications.

// Mark the page root so the Webapp knows the extension is installed and active
document.documentElement.setAttribute('data-tcg-tracker-extension-active', 'true');

// Helper to safely send messages to background service worker without throwing context invalidation errors
function safeSendMessage(message, callback) {
  try {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.id) {
      return;
    }
    const runtime = chrome.runtime;
    runtime.sendMessage(message, (res) => {
      try {
        const lastErr = runtime?.lastError;
        if (lastErr) return;
        if (callback && res) callback(res);
      } catch (cbErr) {
        // Ignored safely if extension context invalidated
      }
    });
  } catch (e) {
    // Ignored safely if extension context invalidated
  }
}

// Listen for the custom DOM event from the Webapp
document.addEventListener('TCG_TRACKER_SYNC_ALL', (event) => {
  if (event.detail && event.detail.urls) {
    safeSendMessage({ action: "openTabs", urls: event.detail.urls });
  }
});

// Listen for requests for clipped images from the Webapp
document.addEventListener('TCG_TRACKER_GET_CLIPPED_IMAGES', (event) => {
  const { cardId } = event.detail || {};
  safeSendMessage({ action: "getClippedImages", cardId }, (res) => {
    if (res && res.success) {
      document.dispatchEvent(new CustomEvent('TCG_TRACKER_CLIPPED_IMAGES_REPLY', {
        detail: { images: res.images || [] }
      }));
    }
  });
});

// Listen for delete requests for clipped images from the Webapp
document.addEventListener('TCG_TRACKER_DELETE_CLIPPED_IMAGE', (event) => {
  const { cardId, image, timestamp } = event.detail || {};
  safeSendMessage({ action: "deleteClippedImage", cardId, image, timestamp }, (res) => {
    if (res && res.success) {
      document.dispatchEvent(new CustomEvent('TCG_TRACKER_CLIPPED_IMAGES_REPLY', {
        detail: { images: res.images || [] }
      }));
    }
  });
});
