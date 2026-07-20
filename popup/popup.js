// Elements
const panelLoading = document.getElementById('state-loading');
const panelLoggedOut = document.getElementById('state-logged-out');
const panelLoggedIn = document.getElementById('state-logged-in');

const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const userEmail = document.getElementById('user-email');

const btnSyncAll = document.getElementById('btn-sync-all');
const btnSyncAllText = document.getElementById('btn-sync-all-text');
const wishlistStatus = document.getElementById('wishlist-status');
let wishlistCards = [];

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

// Fetch bookmarked cards and update popup UI
async function updateWishlistUI() {
  btnSyncAll.disabled = true;
  wishlistStatus.textContent = "Lade Wishlist...";
  
  chrome.runtime.sendMessage({ action: "getMarkedCards" }, (response) => {
    if (response && response.success) {
      wishlistCards = response.cards || [];
      const count = wishlistCards.length;
      btnSyncAllText.textContent = `Sync all (${count})`;
      
      if (count > 0) {
        btnSyncAll.disabled = false;
        wishlistStatus.textContent = `${count} Karte(n) auf deiner Merkliste.`;
      } else {
        btnSyncAll.disabled = true;
        wishlistStatus.textContent = "Keine Karten auf deiner Merkliste.";
      }
    } else {
      btnSyncAll.disabled = true;
      btnSyncAllText.textContent = "Sync all (0)";
      wishlistStatus.textContent = "Fehler beim Laden der Merkliste.";
      console.error("Failed to load wishlist:", response?.error);
    }
  });
}

// Check session state and initialize views
async function init() {
  showPanel(panelLoading);
  
  // Fetch current authentication state from service worker
  chrome.runtime.sendMessage({ action: "getSession" }, async (response) => {
    if (response && response.authenticated) {
      userEmail.textContent = response.user.email;
      showPanel(panelLoggedIn);
      updateWishlistUI();
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
      updateWishlistUI();
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

// Add click listener to Sync All button
btnSyncAll.addEventListener('click', async () => {
  if (wishlistCards.length === 0) return;
  
  btnSyncAll.disabled = true;
  btnSyncAll.classList.add('loading');
  wishlistStatus.textContent = "Öffne Karten im Browser...";
  
  try {
    for (const card of wishlistCards) {
      const cardPath = card.card_id.startsWith('/') ? card.card_id : `/${card.card_id}`;
      const url = `https://www.cardmarket.com${cardPath}`;
      // Open in background tab so popup stays open
      await chrome.tabs.create({ url: url, active: false });
    }
    wishlistStatus.textContent = `${wishlistCards.length} Karte(n) erfolgreich geöffnet!`;
  } catch (err) {
    wishlistStatus.textContent = "Fehler beim Öffnen der Tabs.";
    console.error("Error opening tabs:", err);
  } finally {
    btnSyncAll.classList.remove('loading');
    btnSyncAll.disabled = false;
  }
});

// Run
init();
