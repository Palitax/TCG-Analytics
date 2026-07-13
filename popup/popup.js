// Elements
const panelLoading = document.getElementById('state-loading');
const panelLoggedOut = document.getElementById('state-logged-out');
const panelLoggedIn = document.getElementById('state-logged-in');

const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const userEmail = document.getElementById('user-email');
const selectCondition = document.getElementById('select-condition');
const selectLanguage = document.getElementById('select-language');

// Toggle active display states
function showPanel(panel) {
  panelLoading.classList.remove('active');
  panelLoggedOut.classList.remove('active');
  panelLoggedIn.classList.remove('active');
  
  panel.classList.add('active');
}

// Refresh scanning indicator on the active Cardmarket tab
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
  
  // 1. Fetch current authentication state from service worker
  chrome.runtime.sendMessage({ action: "getSession" }, async (response) => {
    if (response && response.authenticated) {
      userEmail.textContent = response.user.email;
      
      // 2. Load preferred condition
      const { targetCondition = 'NM' } = await chrome.storage.local.get('targetCondition');
      selectCondition.value = targetCondition;
      
      // 3. Load preferred language
      const { targetLanguage = 'ALL' } = await chrome.storage.local.get('targetLanguage');
      selectLanguage.value = targetLanguage;
      
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
    } else {
      alert("Fehler bei der Anmeldung: " + (response?.error || "Unbekannter Fehler"));
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

selectCondition.addEventListener('change', async (e) => {
  const value = e.target.value;
  await chrome.storage.local.set({ targetCondition: value });
  triggerTabScan();
});

selectLanguage.addEventListener('change', async (e) => {
  const value = e.target.value;
  await chrome.storage.local.set({ targetLanguage: value });
  triggerTabScan();
});

// Run
init();
