// Elements
const panelLoading = document.getElementById('state-loading');
const panelLoggedOut = document.getElementById('state-logged-out');
const panelLoggedIn = document.getElementById('state-logged-in');

const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const userEmail = document.getElementById('user-email');

// Toggle active display states
function showPanel(panel) {
  panelLoading.classList.remove('active');
  panelLoggedOut.classList.remove('active');
  panelLoggedIn.classList.remove('active');
  
  panel.classList.add('active');
}

// Refresh scanning indicator on the active tab
async function triggerTabScan() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('cardmarket.com')) {
      chrome.tabs.sendMessage(tab.id, { action: "refreshScan" }, () => {
        if (chrome.runtime.lastError) {
          // Script might not be fully loaded, safe to ignore
        }
      });
    }
  } catch (err) {
    console.error("Failed to trigger tab scan:", err);
  }
}

// Check session state and initialize views
async function init() {
  showPanel(panelLoading);
  const loadingText = panelLoading.querySelector('p');
  if (loadingText) {
    loadingText.textContent = "Verbindung wird hergestellt...";
  }
  
  // Fetch current authentication state from service worker
  chrome.runtime.sendMessage({ action: "getSession" }, async (response) => {
    if (response && response.authenticated && response.user) {
      userEmail.textContent = response.user.email;
      showPanel(panelLoggedIn);
    } else {
      showPanel(panelLoggedOut);
    }
  });
}

// Event Listeners
btnLogin.addEventListener('click', () => {
  showPanel(panelLoading);
  
  chrome.runtime.sendMessage({ action: "login" }, (response) => {
    if (response && response.success) {
      userEmail.textContent = response.user.email;
      showPanel(panelLoggedIn);
      triggerTabScan();
    } else if (response && response.fallbackOpened) {
      const loadingText = panelLoading.querySelector('p');
      if (loadingText) {
        loadingText.textContent = "Anmeldung im Browser geöffnet... Bitte dort einloggen.";
      }
    } else {
      showPanel(panelLoggedOut);
    }
  });
});

btnLogout.addEventListener('click', () => {
  showPanel(panelLoading);
  
  chrome.runtime.sendMessage({ action: "logout" }, (response) => {
    if (response && response.success) {
      showPanel(panelLoggedOut);
      triggerTabScan();
    } else {
      showPanel(panelLoggedIn);
    }
  });
});

// Auto-update popup UI when session storage changes
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.session) {
      init();
      triggerTabScan();
    }
  });
}

// Run
init();

