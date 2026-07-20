import { supabase } from './supabase.js';
import { animate } from 'motion';

// Global state variables
let currentUser = null;
let currentView = 'loading'; // 'loading', 'login', 'dashboard', 'detail'
let activeDashboardTab = 'watchlist'; // 'watchlist' or 'analytics'
let markedCards = [];
let activeSortOption = 'custom';
try {
  activeSortOption = localStorage.getItem('watchlist_sort_option') || 'custom';
} catch (err) {}
let searchHistory = [];
try {
  searchHistory = JSON.parse(localStorage.getItem('search_history') || '[]');
} catch (err) {
  console.warn('localStorage is restricted or unavailable:', err);
}

function safeSaveSearchHistory() {
  try {
    localStorage.setItem('search_history', JSON.stringify(searchHistory));
  } catch (err) {
    console.warn('Failed to save search history to localStorage:', err);
  }
}

let activeCardDetails = null; // Holds detail view data

function checkIsMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
}

// Language dictionary
const LANGUAGE_NAMES_GERMAN = {
  "ALL": "Alle Sprachen",
  "EN": "Englisch",
  "DE": "Deutsch",
  "FR": "Französisch",
  "ES": "Spanisch",
  "IT": "Italienisch",
  "Simplified Chinese": "Chinesisch (verinfacht)",
  "Traditional Chinese": "Chinesisch (traditionell)",
  "JP": "Japanisch",
  "KO": "Koreanisch",
  "RU": "Russisch"
};

// Flag mapping helper
function getFlagHtml(type, code) {
  if (!code || code === 'ALL' || code === 'Unbekannt') return '';
  
  const cleanCode = code.trim().toUpperCase();
  let flagCode = cleanCode;

  if (type === 'language') {
    const langToCountry = {
      'EN': 'GB', 'DE': 'DE', 'FR': 'FR', 'ES': 'ES', 'IT': 'IT',
      'JP': 'JP', 'KO': 'KR', 'RU': 'RU', 'ZH': 'CN'
    };
    flagCode = langToCountry[cleanCode] || cleanCode;
  }

  // Handle UK / Great Britain flag naming mismatch
  if (flagCode === 'EN' || flagCode === 'GB' || flagCode === 'UK') {
    flagCode = 'gb';
  } else {
    flagCode = flagCode.toLowerCase();
  }

  return `<img class="flag-img" src="https://flagcdn.com/16x12/${flagCode}.png" alt="${cleanCode} Flag" onerror="this.style.display='none'">`;
}

// Clean card name from raw database path URL
function cleanCardName(cardId) {
  if (!cardId) return '';
  let clean = decodeURIComponent(cardId);
  if (clean.includes('/')) {
    clean = clean.split('/').filter(Boolean).pop() || clean;
  }
  return clean;
}

// Compress and resize base64 image using canvas to save storage
function compressImage(base64Str, maxWidth = 400) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', 0.75);
      resolve(compressed);
    };
    img.onerror = () => resolve(base64Str);
    img.src = base64Str;
  });
}

// Return stored image URL directly (Base64 or standard asset link)
function getProxiedImageUrl(url) {
  if (!url) return '/logo.png';
  return url;
}

// Fullscreen Lightbox Modal for zooming card images
function showLightbox(imgSrc) {
  const existing = document.getElementById('app-lightbox');
  if (existing) existing.remove();

  const isMobileLayout = checkIsMobile();
  const closeBtnHtml = isMobileLayout ? '' : `
    <button class="lightbox-close" title="Schließen">
      <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="20" height="20">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  `;

  const lightbox = document.createElement('div');
  lightbox.id = 'app-lightbox';
  lightbox.className = 'lightbox-overlay';
  lightbox.innerHTML = `
    <div class="lightbox-content">
      <img src="${imgSrc}" class="lightbox-img" onerror="this.src='/logo.png'">
      ${closeBtnHtml}
    </div>
  `;

  document.body.appendChild(lightbox);

  // Close lightbox on click overlay, image or close button
  lightbox.addEventListener('click', () => {
    lightbox.classList.remove('active');
    setTimeout(() => lightbox.remove(), 250);
  });

  // Fade in animation
  setTimeout(() => lightbox.classList.add('active'), 10);
}

// Robust comment and metadata extractor matching extension parser
function parseHistoryItem(item) {
  let matchedLang = item.language;
  let matchedCountry = item.seller_country;
  let matchedCond = item.condition;
  let imageUrl = null;
  let cleanComment = item.comment || '';

  if (item.comment && item.comment.startsWith('[')) {
    const closeBracketIdx = item.comment.indexOf(']');
    if (closeBracketIdx > 1) {
      const metaContent = item.comment.slice(1, closeBracketIdx);
      cleanComment = item.comment.slice(closeBracketIdx + 1).trim();
      
      const parts = metaContent.split('|');
      if (parts.length >= 3) {
        matchedLang = parts[0] || item.language;
        matchedCountry = parts[1] || item.seller_country;
        matchedCond = parts[2] || item.condition;
        if (parts.length >= 4) {
          imageUrl = parts[3] || null;
        }
      }
    }
  }

  return {
    ...item,
    price: parseFloat(item.price),
    matchedLanguage: matchedLang,
    matchedCountry: matchedCountry,
    matchedCondition: matchedCond,
    imageUrl: imageUrl,
    comment: cleanComment
  };
}

// Initialize PWA App
async function init() {
  setView('loading');
  try {
    const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;
    
    if (session) {
      currentUser = session.user;
      await fetchMarkedCards();
      setView('dashboard');
    } else {
      setView('login');
    }
  } catch (err) {
    console.error('Initialization failed, falling back to login screen:', err);
    setView('login');
  }

  // Listen for auth state changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    try {
      if (session) {
        currentUser = session.user;
        await fetchMarkedCards();
        setView('dashboard');
      } else {
        currentUser = null;
        markedCards = [];
        setView('login');
      }
    } catch (err) {
      console.error('Auth state change handler failed:', err);
      setView('login');
    }
  });
}

// Fetch bookmarked cards for active user
async function fetchMarkedCards() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabase
      .from('marked_cards')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    let listData = data || [];
    const orderKey = `watchlist_order_${currentUser.id}`;
    let savedOrder = [];
    try {
      savedOrder = JSON.parse(localStorage.getItem(orderKey) || '[]');
    } catch (e) {}

    if (savedOrder.length > 0) {
      listData.sort((a, b) => {
        const idxA = savedOrder.indexOf(a.card_id);
        const idxB = savedOrder.indexOf(b.card_id);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    }

    // Fetch global card images if any
    const cardIds = listData.map(c => c.card_id);
    if (cardIds.length > 0) {
      try {
        const { data: globalImages, error: globalImagesErr } = await supabase
          .from('card_images')
          .select('card_id, image_url')
          .in('card_id', cardIds);
        
        if (!globalImagesErr && globalImages) {
          const imageMap = {};
          for (const img of globalImages) {
            imageMap[img.card_id] = img.image_url;
          }
          for (const card of listData) {
            if (imageMap[card.card_id]) {
              card.image_url = imageMap[card.card_id];
            }
          }
        }
      } catch (err) {
        console.error('Error fetching global card images:', err.message);
      }

      // Bulk fetch price history for all cards
      try {
        const { data: priceData, error: priceErr } = await supabase
          .from('price_history')
          .select('card_id, price, comment, scanned_at')
          .in('card_id', cardIds)
          .order('scanned_at', { ascending: true });

        if (!priceErr && priceData) {
          const historyMap = {};
          for (const row of priceData) {
            if (!historyMap[row.card_id]) {
              historyMap[row.card_id] = [];
            }
            historyMap[row.card_id].push(parseHistoryItem(row));
          }

          for (const card of listData) {
            const history = historyMap[card.card_id] || [];
            if (history.length > 0) {
              const latest = history[history.length - 1];
              const baseline = history[0];
              card.latest_price = latest.price;
              card.baseline_price = baseline.price;
              card.diff_percent = baseline.price > 0 ? ((latest.price - baseline.price) / baseline.price) * 100 : 0;

              // Fallback image url from history
              if (!card.image_url) {
                for (let i = history.length - 1; i >= 0; i--) {
                  if (history[i].imageUrl) {
                    card.image_url = history[i].imageUrl;
                    break;
                  }
                }
              }
            } else {
              card.latest_price = null;
              card.baseline_price = null;
              card.diff_percent = 0;
            }
          }
        }
      } catch (err) {
        console.error('Error fetching bulk prices:', err.message);
      }
    }

    markedCards = listData;
  } catch (err) {
    console.error('Error loading bookmarks:', err.message);
  }
}

// Main View Router
async function setView(view) {
  currentView = view;
  await render();

  if (view !== 'loading') {
    const widget = document.getElementById('cache-recovery-widget');
    if (widget) widget.style.display = 'none';
  }
}

async function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  let viewEl = null;

  if (currentView === 'loading') {
    viewEl = document.createElement('div');
    viewEl.className = 'spinner-box';
    viewEl.innerHTML = `
      <div class="spinner"></div>
      <p>Verbindung wird hergestellt...</p>
    `;
    app.appendChild(viewEl);
  } else if (currentView === 'login') {
    viewEl = renderLogin(app);
  } else if (currentView === 'dashboard') {
    viewEl = await renderDashboard(app);
  } else if (currentView === 'detail') {
    viewEl = renderDetail(app);
  }

  if (viewEl) {
    animate(viewEl, { opacity: [0, 1], y: [15, 0] }, { duration: 0.28, ease: "easeOut" });
  }
}

// RENDER: Login panel
function renderLogin(container) {
  const div = document.createElement('div');
  div.className = 'login-panel';
  div.innerHTML = `
    <img class="login-logo" src="/logo.png" alt="Logo">
    <h1 class="login-title">TCG Card Tracker</h1>
    <p class="login-desc">Melde dich mit deinem Account an, um deine Merkliste zu synchronisieren und Preisverläufe abzufragen.</p>
    <button id="btn-login" class="gsi-material-button">
      <div class="gsi-material-button-state"></div>
      <div class="gsi-material-button-content-wrapper">
        <div class="gsi-material-button-icon">
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" xmlns:xlink="http://www.w3.org/1999/xlink" style="display: block;">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
            <path fill="none" d="M0 0h48v48H0z"></path>
          </svg>
        </div>
        <span class="gsi-material-button-contents">Sign in with Google</span>
        <span style="display: none;">Sign in with Google</span>
      </div>
    </button>
  `;
  container.appendChild(div);

  div.querySelector('#btn-login').addEventListener('click', async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          prompt: 'select_account'
        }
      }
    });
  });
  return div;
}

function showLogoutModal() {
  const modal = document.createElement('div');
  modal.className = 'custom-modal-overlay';
  modal.innerHTML = `
    <div class="custom-modal glass-panel">
      <h3 style="margin-top: 0; color: var(--text-primary); font-size: 1.1rem; font-weight: 700;">Abmelden</h3>
      <p style="color: var(--text-secondary); font-size: 0.88rem; line-height: 1.5; margin: 8px 0 20px 0;">
        Möchtest du dich abmelden oder den Google-Account wechseln?
      </p>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button id="modal-btn-switch" style="
          background-color: var(--primary);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 10px;
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
        ">Google-Account wechseln</button>
        
        <button id="modal-btn-logout" style="
          background-color: rgba(239, 68, 68, 0.15);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          padding: 10px;
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
        ">Ausloggen</button>
        
        <button id="modal-btn-cancel" style="
          background-color: transparent;
          color: var(--text-muted);
          border: 1px solid var(--border-glass);
          border-radius: 8px;
          padding: 10px;
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;
        ">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close animation helper
  const closeModal = () => {
    animate(modal, { opacity: [1, 0] }, { duration: 0.2 }).finished.then(() => modal.remove());
  };

  // Animate in
  animate(modal, { opacity: [0, 1] }, { duration: 0.2 });
  animate(modal.querySelector('.custom-modal'), { transform: ['scale(0.95)', 'scale(1)'] }, { duration: 0.2, ease: "easeOut" });

  modal.querySelector('#modal-btn-cancel').addEventListener('click', closeModal);

  modal.querySelector('#modal-btn-logout').addEventListener('click', async () => {
    closeModal();
    await supabase.auth.signOut();
  });

  modal.querySelector('#modal-btn-switch').addEventListener('click', async () => {
    closeModal();
    await supabase.auth.signOut();
    // Re-auth immediately with prompt selector
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          prompt: 'select_account'
        }
      }
    });
  });

  // Close on clicking overlay background
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
}

// RENDER: Dashboard Panel
async function renderDashboard(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'dashboard-wrapper';
  container.appendChild(wrapper);

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <div class="header-logo">
      <img src="/logo.png" alt="Logo">
      <span class="header-title">TCG Card Tracker</span>
    </div>
    <div style="display: flex; align-items: center; gap: 12px;">
      <span class="header-user-email" style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;">
        ${currentUser ? currentUser.email : ''}
      </span>
      <button id="btn-logout" class="btn-logout" title="Ausloggen">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    </div>
  `;
  wrapper.appendChild(header);

  header.querySelector('#btn-logout').addEventListener('click', () => {
    showLogoutModal();
  });

  // Search Container (Quick Search is always persistent at the top)
  const searchSection = document.createElement('div');
  searchSection.className = 'search-container';
  searchSection.innerHTML = `
    <div class="search-input-wrapper">
      <input type="text" id="inp-search" class="search-input" placeholder="Kartennummer suchen (z.B. OP15-119)..." autocomplete="off">
    </div>
    <div id="search-results" class="search-results-overlay" style="display: none;"></div>
  `;
  wrapper.appendChild(searchSection);

  const inpSearch = searchSection.querySelector('#inp-search');
  const divResults = searchSection.querySelector('#search-results');

  // Handle Search Input Typing
  let searchTimeout = null;
  inpSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = inpSearch.value.trim();

    if (query === '') {
      divResults.style.display = 'none';
      return;
    }

    searchTimeout = setTimeout(async () => {
      divResults.style.display = 'block';
      divResults.innerHTML = `
        <div class="spinner-box" style="height: 100px;">
          <div class="spinner" style="width: 24px; height: 24px;"></div>
        </div>
      `;

      try {
        const { data, error } = await supabase
          .from('price_history')
          .select('card_id, tcg, comment')
          .ilike('card_id', `%${query}%`)
          .limit(20);

        if (error) throw error;

        const uniqueCards = [];
        const seen = new Set();
        for (const row of data || []) {
          if (!seen.has(row.card_id)) {
            seen.add(row.card_id);
            const parsed = parseHistoryItem(row);
            uniqueCards.push({
              card_id: row.card_id,
              tcg: row.tcg,
              imageUrl: parsed.imageUrl
            });
          }
        }

        // Enrich uniqueCards with global custom images
        const cardIds = uniqueCards.map(c => c.card_id);
        if (cardIds.length > 0) {
          try {
            const { data: globalImages, error: globalImagesErr } = await supabase
              .from('card_images')
              .select('card_id, image_url')
              .in('card_id', cardIds);
            
            if (!globalImagesErr && globalImages) {
              const imageMap = {};
              for (const img of globalImages) {
                imageMap[img.card_id] = img.image_url;
              }
              for (const c of uniqueCards) {
                if (imageMap[c.card_id]) {
                  c.imageUrl = imageMap[c.card_id];
                }
              }
            }
          } catch (err) {
            console.error('Error fetching global search images:', err.message);
          }
        }

        if (uniqueCards.length === 0) {
          divResults.innerHTML = `
            <div class="empty-state">
              <p>Keine gescannten Karten gefunden.</p>
            </div>
          `;
          return;
        }

        divResults.innerHTML = uniqueCards.map(c => `
          <div class="search-result-item glass-panel" data-card="${c.card_id}" data-tcg="${c.tcg}">
            <img class="search-result-img" src="${getProxiedImageUrl(c.imageUrl)}" referrerpolicy="no-referrer" onerror="this.src='/logo.png'">
            <div class="search-result-info">
              <span class="search-result-name">${cleanCardName(c.card_id)}</span>
              <span class="search-result-tcg">${c.tcg}</span>
            </div>
          </div>
        `).join('');

        divResults.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', async () => {
            const cardId = item.dataset.card;
            const tcg = item.dataset.tcg;
            addToHistory(cardId, tcg);
            divResults.style.display = 'none';
            inpSearch.value = '';
            await loadCardDetails(cardId, tcg);
          });
        });

      } catch (err) {
        divResults.innerHTML = `<p style="color: #f87171; padding: 16px;">Fehler: ${err.message}</p>`;
      }
    }, 400);
  });

  // Hide search overlay if clicked outside
  document.addEventListener('click', (e) => {
    if (!searchSection.contains(e.target)) {
      divResults.style.display = 'none';
    }
  });

  // Render 2 Landing Buttons for Tab toggles below the search input
  const buttonsSection = document.createElement('div');
  buttonsSection.className = 'cm-landing-buttons-container';
  buttonsSection.innerHTML = `
    <div class="cm-landing-buttons">
      <button id="btn-tab-watchlist" class="cm-landing-btn ${activeDashboardTab === 'watchlist' ? 'active' : ''}">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.377.728-.377.879 0l2.09 5.011 5.4 1.018a.5.5 0 01.29.839l-3.834 3.738 1.05 5.378a.5.5 0 01-.707.567L12 17.766l-4.664 2.483a.5.5 0 01-.707-.567l1.05-5.378-3.834-3.738a.5.5 0 01.29-.839l5.4-1.018 2.09-5.011z" />
        </svg>
        Watchlist (${markedCards.length})
      </button>
      <button id="btn-tab-analytics" class="cm-landing-btn ${activeDashboardTab === 'analytics' ? 'active' : ''}">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Analytics
      </button>
    </div>
  `;
  wrapper.appendChild(buttonsSection);

  // Sub-container for active tab
  const tabContentWrapper = document.createElement('div');
  tabContentWrapper.id = 'dashboard-tab-content';
  wrapper.appendChild(tabContentWrapper);

  const btnWatchlist = buttonsSection.querySelector('#btn-tab-watchlist');
  const btnAnalytics = buttonsSection.querySelector('#btn-tab-analytics');

  const renderActiveTab = () => {
    tabContentWrapper.innerHTML = '';
    if (activeDashboardTab === 'watchlist') {
      renderWatchlistTab(tabContentWrapper);
    } else {
      renderAnalyticsTab(tabContentWrapper);
    }
  };

  btnWatchlist.addEventListener('click', () => {
    if (activeDashboardTab === 'watchlist') return;
    activeDashboardTab = 'watchlist';
    btnWatchlist.classList.add('active');
    btnAnalytics.classList.remove('active');
    renderActiveTab();
  });

  btnAnalytics.addEventListener('click', () => {
    if (activeDashboardTab === 'analytics') return;
    activeDashboardTab = 'analytics';
    btnAnalytics.classList.add('active');
    btnWatchlist.classList.remove('active');
    renderActiveTab();
  });

  // Render initial selected tab content
  renderActiveTab();
  return wrapper;
}

// Sub-Tab Watchlist Renderer
function renderWatchlistTab(container) {
  const dashboard = document.createElement('div');
  dashboard.className = 'dashboard-content';
  dashboard.innerHTML = '';
  container.appendChild(dashboard);

  if (markedCards.length === 0) {
    dashboard.innerHTML += `
      <div class="empty-state glass-panel">
        <svg class="empty-state-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.377.728-.377.879 0l2.09 5.011 5.4 1.018a.5.5 0 01.29.839l-3.834 3.738 1.05 5.378a.5.5 0 01-.707.567L12 17.766l-4.664 2.483a.5.5 0 01-.707-.567l1.05-5.378-3.834-3.738a.5.5 0 01.29-.839l5.4-1.018 2.09-5.011z" />
        </svg>
        <p>Deine Watchlist ist leer. Scanne eine Karte mit dem Addon und markiere sie mit dem Stern.</p>
      </div>
    `;
    return;
  }

  // Sort the cards based on selected sort option
  let sortedCards = [...markedCards];
  if (activeSortOption === 'price-asc') {
    sortedCards.sort((a, b) => {
      const pA = a.latest_price !== null && a.latest_price !== undefined ? a.latest_price : Infinity;
      const pB = b.latest_price !== null && b.latest_price !== undefined ? b.latest_price : Infinity;
      return pA - pB;
    });
  } else if (activeSortOption === 'price-desc') {
    sortedCards.sort((a, b) => {
      const pA = a.latest_price !== null && a.latest_price !== undefined ? a.latest_price : -Infinity;
      const pB = b.latest_price !== null && b.latest_price !== undefined ? b.latest_price : -Infinity;
      return pB - pA;
    });
  } else if (activeSortOption === 'diff-desc') {
    sortedCards.sort((a, b) => {
      const dA = a.diff_percent !== undefined ? a.diff_percent : 0;
      const dB = b.diff_percent !== undefined ? b.diff_percent : 0;
      return dB - dA;
    });
  } else if (activeSortOption === 'diff-asc') {
    sortedCards.sort((a, b) => {
      const dA = a.diff_percent !== undefined ? a.diff_percent : 0;
      const dB = b.diff_percent !== undefined ? b.diff_percent : 0;
      return dA - dB;
    });
  }

  // Watchlist Header & Sync All Actions & Sorting Controls
  const headerSection = document.createElement('div');
  headerSection.className = 'watchlist-header-actions';
  headerSection.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; width: 100%; padding: 0 4px;';
  headerSection.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 12px;">
      <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);">Watchlist (${markedCards.length})</span>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
        <button id="btn-web-sync-all" style="
          background-color: var(--primary);
          color: white;
          border: none;
          border-radius: 6px;
          padding: 8px 16px;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(251, 133, 0, 0.25);
        ">
          <svg style="width: 13px; height: 13px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          Sync all
        </button>
        <span id="sync-all-hint" style="font-size: 0.68rem; color: var(--text-muted); display: none; text-align: right;">
          Tipp: Pop-ups erlauben, falls nicht alle Tabs öffnen.
        </span>
      </div>
    </div>
    
    <div class="watchlist-filter-row" style="display: flex; justify-content: flex-start; align-items: center; gap: 12px; width: 100%;">
      <div class="watchlist-sort-container">
        <svg style="width: 14px; height: 14px; color: var(--text-muted);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
        <select id="select-watchlist-sort" class="watchlist-sort-select">
          <option value="custom" ${activeSortOption === 'custom' ? 'selected' : ''}>Eigene Reihenfolge</option>
          <option value="price-asc" ${activeSortOption === 'price-asc' ? 'selected' : ''}>Preis: Aufsteigend</option>
          <option value="price-desc" ${activeSortOption === 'price-desc' ? 'selected' : ''}>Preis: Absteigend</option>
          <option value="diff-desc" ${activeSortOption === 'diff-desc' ? 'selected' : ''}>Gewinn: Meiste %</option>
          <option value="diff-asc" ${activeSortOption === 'diff-asc' ? 'selected' : ''}>Verlust: Meiste %</option>
        </select>
      </div>
    </div>
  `;
  dashboard.appendChild(headerSection);

  const btnWebSyncAll = headerSection.querySelector('#btn-web-sync-all');
  const syncHint = headerSection.querySelector('#sync-all-hint');
  const selectSort = headerSection.querySelector('#select-watchlist-sort');

  selectSort.addEventListener('change', () => {
    activeSortOption = selectSort.value;
    try {
      localStorage.setItem('watchlist_sort_option', activeSortOption);
    } catch (e) {}
    container.innerHTML = '';
    renderWatchlistTab(container);
  });

  btnWebSyncAll.addEventListener('mouseenter', () => {
    btnWebSyncAll.style.backgroundColor = 'var(--primary-hover)';
  });
  btnWebSyncAll.addEventListener('mouseleave', () => {
    btnWebSyncAll.style.backgroundColor = 'var(--primary)';
  });

  btnWebSyncAll.addEventListener('click', () => {
    const urls = markedCards.map(card => {
      const cardPath = card.card_id.startsWith('/') ? card.card_id : `/${card.card_id}`;
      return `https://www.cardmarket.com${cardPath}`;
    });

    const isExtensionActive = document.documentElement.hasAttribute('data-tcg-tracker-extension-active');
    syncHint.style.display = 'block';

    if (isExtensionActive) {
      syncHint.textContent = `Öffne ${urls.length} Tabs im Hintergrund...`;
      syncHint.style.color = '#34d399'; // Green success color
      document.dispatchEvent(new CustomEvent('TCG_TRACKER_SYNC_ALL', { detail: { urls } }));
    } else {
      syncHint.textContent = 'Tipp: Pop-ups erlauben oder Erweiterung aktivieren, falls nicht alle Tabs öffnen.';
      syncHint.style.color = 'var(--text-muted)';
      for (const url of urls) {
        window.open(url, '_blank');
      }
    }
    
    setTimeout(() => {
      syncHint.style.display = 'none';
    }, 8000);
  });

  const list = document.createElement('div');
  list.className = 'watchlist-list';
  dashboard.appendChild(list);

  // Global variables to track dragged element for desktop drag-sort
  let draggedItem = null;

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (activeSortOption !== 'custom') return;
    if (!draggedItem) return;
    const afterElement = getDragAfterElement(list, e.clientY);
    if (afterElement == null) {
      list.appendChild(draggedItem);
    } else {
      list.insertBefore(draggedItem, afterElement);
    }
  });

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.watchlist-item-wrapper:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: -Infinity }).element;
  }

  function saveWatchlistOrder() {
    const newOrder = Array.from(list.querySelectorAll('.watchlist-item-wrapper')).map(el => {
      const cardEl = el.querySelector('.watchlist-item');
      return cardEl.dataset.cardUuid;
    });
    const orderKey = `watchlist_order_${currentUser.id}`;
    try {
      localStorage.setItem(orderKey, JSON.stringify(newOrder));
    } catch (e) {}

    // Update in-memory array to match
    markedCards.sort((a, b) => {
      const idxA = newOrder.indexOf(a.card_id);
      const idxB = newOrder.indexOf(b.card_id);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }

  for (const card of sortedCards) {
    const wrapper = document.createElement('div');
    wrapper.className = 'watchlist-item-wrapper';
    wrapper.setAttribute('draggable', activeSortOption === 'custom' ? 'true' : 'false');

    const isMobileDevice = checkIsMobile();
    const desktopDeleteBtnHtml = isMobileDevice ? '' : `
      <button class="watchlist-item-desktop-delete" title="Vom Merkzettel entfernen">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="10" height="10">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;

    const priceText = card.latest_price !== null && card.latest_price !== undefined ? `${card.latest_price.toFixed(2)} €` : '-- €';
    let diffText = '...';
    let diffClass = '';
    if (card.diff_percent !== undefined) {
      if (card.diff_percent < 0) {
        diffText = `${card.diff_percent.toFixed(2)}%`;
        diffClass = 'gain'; // dropped is good
      } else if (card.diff_percent > 0) {
        diffText = `+${card.diff_percent.toFixed(2)}%`;
        diffClass = 'loss'; // rose is bad
      } else {
        diffText = '0.00%';
        diffClass = 'stable';
      }
    }

    wrapper.innerHTML = `
      <div class="watchlist-item-swipe-bg">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="20" height="20">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span>Löschen</span>
      </div>
      <div class="watchlist-item glass-panel" data-card-id="${card.id}" data-card-uuid="${card.card_id}">
        ${desktopDeleteBtnHtml}
        <img class="watchlist-item-img" src="${getProxiedImageUrl(card.image_url)}" referrerpolicy="no-referrer" onerror="this.src='/logo.png'">
        <div class="watchlist-item-info">
          <span class="watchlist-item-tcg">${card.tcg}</span>
          <span class="watchlist-item-name">${cleanCardName(card.card_id)}</span>
        </div>
        <div class="watchlist-item-price-col">
          <span class="watchlist-item-price" id="price-${card.id}">${priceText}</span>
          <span class="diff-badge ${diffClass}" id="diff-${card.id}">${diffText}</span>
        </div>
      </div>
    `;
    list.appendChild(wrapper);

    // Desktop Drag events for sorting
    wrapper.addEventListener('dragstart', (e) => {
      if (activeSortOption !== 'custom') {
        e.preventDefault();
        return;
      }
      if (e.target.closest('button, img, a')) {
        e.preventDefault();
        return;
      }
      draggedItem = wrapper;
      wrapper.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    wrapper.addEventListener('dragend', () => {
      wrapper.classList.remove('dragging');
      draggedItem = null;
      saveWatchlistOrder();
    });

    const cardEl = wrapper.querySelector('.watchlist-item');

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isDragging = false;
    let hasMoved = false;
    let isSwiping = false;
    let isSorting = false;
    let touchDraggedItem = null;
    const threshold = 120;

    let wrappers = [];
    let currentIndex = -1;
    let itemHeight = 0;

    const handleStart = (clientX, clientY) => {
      if (!checkIsMobile()) return;
      startX = clientX;
      startY = clientY;
      isDragging = true;
      hasMoved = false;
      isSwiping = false;
      isSorting = false;
      cardEl.style.transition = 'none';

      wrappers = [...list.querySelectorAll('.watchlist-item-wrapper')];
      currentIndex = wrappers.indexOf(wrapper);
      itemHeight = wrapper.offsetHeight;
    };

    const handleMove = (clientX, clientY) => {
      if (!isDragging) return;
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;

      if (!isSwiping && !isSorting) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
          isSwiping = true;
        } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
          if (activeSortOption === 'custom') {
            isSorting = true;
            touchDraggedItem = wrapper;
            touchDraggedItem.classList.add('dragging');
            touchDraggedItem.style.zIndex = '1000';
          }
        }
      }

      if (isSwiping) {
        if (deltaX < 0) {
          currentX = deltaX;
          cardEl.style.transform = `translateX(${deltaX}px)`;
          if (Math.abs(deltaX) > 10) {
            hasMoved = true;
          }
        }
      } else if (isSorting && touchDraggedItem) {
        hasMoved = true;
        touchDraggedItem.style.transform = `translateY(${deltaY}px)`;

        const shift = Math.round(deltaY / itemHeight);
        const targetIndex = Math.max(0, Math.min(wrappers.length - 1, currentIndex + shift));

        wrappers.forEach((w, idx) => {
          if (w === wrapper) return;
          w.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
          if (currentIndex < targetIndex) {
            if (idx > currentIndex && idx <= targetIndex) {
              w.style.transform = `translateY(${-itemHeight}px)`;
            } else {
              w.style.transform = '';
            }
          } else if (currentIndex > targetIndex) {
            if (idx < currentIndex && idx >= targetIndex) {
              w.style.transform = `translateY(${itemHeight}px)`;
            } else {
              w.style.transform = '';
            }
          } else {
            w.style.transform = '';
          }
        });
      }
    };

    const handleEnd = (changedTouches) => {
      if (!isDragging) return;
      isDragging = false;
      
      if (isSwiping) {
        cardEl.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        
        if (currentX < -threshold) {
          cardEl.style.transform = 'translateX(-100%)';
          setTimeout(async () => {
            if (confirm(`Möchtest du "${cleanCardName(card.card_id)}" wirklich vom Merkzettel entfernen?`)) {
              try {
                const { error } = await supabase
                  .from('marked_cards')
                  .delete()
                  .eq('user_id', currentUser.id)
                  .eq('card_id', card.card_id);

                if (error) throw error;

                await fetchMarkedCards();
                render();
              } catch (err) {
                alert("Fehler beim Entfernen: " + err.message);
                cardEl.style.transform = 'translateX(0)';
              }
            } else {
              cardEl.style.transform = 'translateX(0)';
            }
          }, 150);
        } else {
          cardEl.style.transform = 'translateX(0)';
        }
      } else if (isSorting && touchDraggedItem) {
        touchDraggedItem.classList.remove('dragging');
        
        wrappers.forEach(w => {
          w.style.transform = '';
          w.style.transition = '';
          w.style.zIndex = '';
        });
        touchDraggedItem.style.transform = '';
        touchDraggedItem.style.zIndex = '';

        const clientY = (changedTouches && changedTouches[0]) ? changedTouches[0].clientY : startY;
        const finalDeltaY = clientY - startY;
        const finalShift = Math.round(finalDeltaY / itemHeight);
        const finalTargetIndex = Math.max(0, Math.min(wrappers.length - 1, currentIndex + finalShift));

        if (finalTargetIndex !== currentIndex) {
          if (finalTargetIndex === wrappers.length - 1) {
            list.appendChild(wrapper);
          } else {
            const referenceNode = wrappers[finalTargetIndex + (finalTargetIndex > currentIndex ? 1 : 0)];
            list.insertBefore(wrapper, referenceNode);
          }
          saveWatchlistOrder();
        }

        touchDraggedItem = null;
      }

      currentX = 0;
      isSwiping = false;
      isSorting = false;
    };

    // Touch events for mobile swiping or sorting
    cardEl.addEventListener('touchstart', (e) => {
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    cardEl.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;

      if (!isSwiping && !isSorting) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
          isSwiping = true;
        } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
          if (activeSortOption === 'custom') {
            isSorting = true;
            touchDraggedItem = wrapper;
            touchDraggedItem.classList.add('dragging');
            touchDraggedItem.style.zIndex = '1000';
          }
        }
      }

      if (isSorting) {
        if (e.cancelable) e.preventDefault();
        handleMove(touch.clientX, touch.clientY);
      } else if (isSwiping) {
        handleMove(touch.clientX, touch.clientY);
      }
    }, { passive: false });

    cardEl.addEventListener('touchend', (e) => handleEnd(e.changedTouches), { passive: true });

    // Mouse events (fallback - only desktop click detection, drag sort handles dragging)
    cardEl.addEventListener('click', () => {
      if (hasMoved) {
        hasMoved = false;
        return;
      }
      loadCardDetails(card.card_id, card.tcg);
    });

    // Lightbox image trigger
    const imgEl = cardEl.querySelector('.watchlist-item-img');
    if (imgEl) {
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid triggering details card navigation
        showLightbox(card.image_url || '/logo.png');
      });
    }

    // Bind desktop 'x' delete button click
    const desktopDeleteBtn = cardEl.querySelector('.watchlist-item-desktop-delete');
    if (desktopDeleteBtn) {
      desktopDeleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Avoid triggering details card navigation
        if (confirm(`Möchtest du "${cleanCardName(card.card_id)}" wirklich vom Merkzettel entfernen?`)) {
          try {
            desktopDeleteBtn.disabled = true;
            const { error } = await supabase
              .from('marked_cards')
              .delete()
              .eq('user_id', currentUser.id)
              .eq('card_id', card.card_id);

            if (error) throw error;

            await fetchMarkedCards(); // Refresh local list
            render(); // Refresh current dashboard view
          } catch (err) {
            alert("Fehler beim Entfernen: " + err.message);
            desktopDeleteBtn.disabled = false;
          }
        }
      });
    }
  }
}

// Sub-Tab Analytics & Search History Renderer
function renderAnalyticsTab(container) {
  const dashboard = document.createElement('div');
  dashboard.className = 'dashboard-content analytics-tab-view';
  dashboard.innerHTML = '';
  container.appendChild(dashboard);

  const recentSearches = searchHistory.slice(0, 5);

  if (recentSearches.length === 0) {
    dashboard.innerHTML += `
      <div class="empty-state glass-panel" style="padding: 32px 16px;">
        <svg class="empty-state-icon" style="width: 32px; height: 32px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p style="font-size: 0.85rem; margin-top: 8px;">Kein Suchverlauf vorhanden. Nutze das obere Suchfeld, um Karten zu suchen.</p>
      </div>
    `;
    return;
  }

  const list = document.createElement('div');
  list.className = 'analytics-history-list';
  dashboard.appendChild(list);

  recentSearches.forEach((item, idx) => {
    const cardId = typeof item === 'object' ? item.cardId : item;
    const tcg = typeof item === 'object' ? item.tcg : 'Unbekannt';

    const itemEl = document.createElement('div');
    itemEl.className = 'analytics-history-item glass-panel';
    itemEl.innerHTML = `
      <div class="analytics-history-item-left">
        <svg class="analytics-history-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div style="display: flex; flex-direction: column;">
          <span class="analytics-history-text">${cleanCardName(cardId)}</span>
          <span class="analytics-history-tcg">${tcg}</span>
        </div>
      </div>
      <button class="btn-delete-history-item" data-idx="${idx}" title="Eintrag löschen">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="14" height="14">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;
    list.appendChild(itemEl);

    itemEl.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-delete-history-item')) return;
      await loadCardDetails(cardId, tcg);
    });

    itemEl.querySelector('.btn-delete-history-item').addEventListener('click', (e) => {
      e.stopPropagation();
      searchHistory.splice(idx, 1);
      safeSaveSearchHistory();
      renderAnalyticsTab(container);
    });
  });
}

// Search History storage helpers
function addToHistory(cardId, tcg) {
  searchHistory = searchHistory.filter(h => {
    const id = typeof h === 'object' ? h.cardId : h;
    return id !== cardId;
  });

  searchHistory.unshift({ cardId, tcg });
  searchHistory = searchHistory.slice(0, 10);
  safeSaveSearchHistory();
}

// Load the single latest price record for each bookmark grid card
async function loadLatestPriceForDashboard(card) {
  try {
    const { data, error } = await supabase
      .from('price_history')
      .select('price, comment, scanned_at')
      .eq('card_id', card.card_id)
      .order('scanned_at', { ascending: true });

    if (error) throw error;
    if (data && data.length > 0) {
      const history = data.map(parseHistoryItem);
      const latest = history[history.length - 1];
      const baseline = history[0];

      // Dynamic Image Extraction Fallback
      let foundImageUrl = card.image_url;
      if (!foundImageUrl) {
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].imageUrl) {
            foundImageUrl = history[i].imageUrl;
            break;
          }
        }
      }

      if (foundImageUrl) {
        const imgEl = document.querySelector(`.watchlist-item[data-card-id="${card.id}"] .watchlist-item-img`);
        if (imgEl) {
          imgEl.src = getProxiedImageUrl(foundImageUrl);
        }
      }

      const priceEl = document.getElementById(`price-${card.id}`);
      const diffEl = document.getElementById(`diff-${card.id}`);

      if (priceEl) priceEl.textContent = `${latest.price.toFixed(2)} €`;

      if (diffEl) {
        const diffPercent = baseline.price > 0 ? ((latest.price - baseline.price) / baseline.price) * 100 : 0;
        let diffText = '0.00%';
        let diffClass = 'stable';
        
        if (diffPercent < 0) {
          diffText = `${diffPercent.toFixed(2)}%`;
          diffClass = 'gain'; // dropped is good
        } else if (diffPercent > 0) {
          diffText = `+${diffPercent.toFixed(2)}%`;
          diffClass = 'loss'; // rose is bad
        }
        
        diffEl.className = `diff-badge ${diffClass}`;
        diffEl.textContent = diffText;
      }
    }
  } catch (err) {
    console.error('Error fetching grid price details:', err.message);
  }
}

// Load full price list and filters for card details panel
async function loadCardDetails(cardId, tcg) {
  setView('loading');
  try {
    const { data: historyData, error: historyErr } = await supabase
      .from('price_history')
      .select('*')
      .eq('card_id', cardId)
      .order('scanned_at', { ascending: true });

    if (historyErr) throw historyErr;

    const parsedHistory = (historyData || []).map(parseHistoryItem);

    // Fetch global custom image if any
    let globalImageUrl = null;
    try {
      const { data: globalImgData, error: globalImgErr } = await supabase
        .from('card_images')
        .select('image_url')
        .eq('card_id', cardId)
        .maybeSingle();
      if (!globalImgErr && globalImgData) {
        globalImageUrl = globalImgData.image_url;
      }
    } catch (err) {
      console.error('Error fetching global card image:', err.message);
    }

    // Extract unique filter combinations available in scanned data
    const conditions = Array.from(new Set(parsedHistory.map(h => h.condition)));
    const locations = Array.from(new Set(parsedHistory.map(h => h.seller_country)));
    
    // Languages available: decode all options
    const languages = Array.from(new Set(parsedHistory.map(h => h.language)));

    // Read initial bookmarked state for details toggle state
    const bookmarkRecord = markedCards.find(m => m.card_id === cardId);
    const isCurrentlyMarked = !!bookmarkRecord;
    const bookmarkImageUrl = bookmarkRecord ? bookmarkRecord.image_url : null;

    activeCardDetails = {
      cardId,
      tcg,
      rawHistory: parsedHistory,
      conditions: conditions.sort(),
      locations: locations.sort(),
      languages: languages.sort(),
      isMarked: isCurrentlyMarked,
      imageUrl: globalImageUrl || bookmarkImageUrl || (parsedHistory.length > 0 ? parsedHistory[0].imageUrl : null),
      
      // Default initial local filters: matching first scanned entry configuration
      selectedCondition: conditions[0] || 'NM',
      selectedLocation: locations[0] || 'DE',
      selectedLanguage: languages[0] || 'ALL'
    };

    setView('detail');

  } catch (err) {
    console.error('Error loading card details view:', err.message);
    setView('dashboard');
  }
}

// RENDER: Detail View Panel
function renderDetail(container) {
  const details = activeCardDetails;
  if (!details) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'detail-wrapper';
  container.appendChild(wrapper);

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <button id="btn-back" class="btn-back">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Zurück
    </button>
    <button id="btn-detail-star" class="btn-detail-star" title="Merkzettel umschalten">
      <svg class="star-icon" viewBox="0 0 24 24" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  `;
  wrapper.appendChild(header);

  const starBtn = header.querySelector('#btn-detail-star');
  const starIcon = starBtn.querySelector('svg');
  
  const updateStarIconStyle = () => {
    if (details.isMarked) {
      starIcon.setAttribute('fill', '#facc15');
      starIcon.setAttribute('stroke', '#facc15');
    } else {
      starIcon.setAttribute('fill', 'none');
      starIcon.setAttribute('stroke', 'rgba(255, 255, 255, 0.6)');
    }
  };
  updateStarIconStyle();

  header.querySelector('#btn-back').addEventListener('click', async () => {
    await fetchMarkedCards();
    setView('dashboard');
  });

  // Toggle bookmark in DB
  starBtn.addEventListener('click', async () => {
    starBtn.style.pointerEvents = 'none';
    const originalMarkedState = details.isMarked;
    try {
      if (originalMarkedState) {
        // Delete bookmark
        const { error } = await supabase
          .from('marked_cards')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('card_id', details.cardId);

        if (error) throw error;
        details.isMarked = false;
      } else {
        // Create bookmark
        const bookmarkData = {
          user_id: currentUser.id,
          tcg: details.tcg,
          card_id: details.cardId,
          image_url: details.imageUrl
        };
        const { error } = await supabase
          .from('marked_cards')
          .insert(bookmarkData);

        if (error) throw error;
        details.isMarked = true;
      }
      await fetchMarkedCards(); // Refresh markedCards local copy from database!
      updateStarIconStyle();
    } catch (err) {
      console.error('Bookmark toggle failed:', err.message);
    } finally {
      starBtn.style.pointerEvents = 'auto';
    }
  });
  const detailBody = document.createElement('div');
  detailBody.className = 'detail-view';
  wrapper.appendChild(detailBody);

  // 1. Meta Header Area
  const metaHeader = document.createElement('div');
  metaHeader.className = 'detail-meta-header';
  metaHeader.innerHTML = `
    <span class="hero-tcg">${details.tcg}</span>
    <h1 class="hero-title">${cleanCardName(details.cardId)}</h1>
    <a href="https://www.cardmarket.com${details.cardId}" target="_blank" rel="noopener noreferrer" class="cardmarket-link" style="font-size: 0.78rem; color: #60a5fa; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; transition: color 0.2s;">
      Zeige Karte auf Cardmarket
      <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  `;
  detailBody.appendChild(metaHeader);

  // 2. Image Area
  const imageBox = document.createElement('div');
  imageBox.className = 'detail-image-box';
  imageBox.innerHTML = `
    <div class="hero-img-wrapper" style="position: relative; display: block;">
      <img class="hero-img" src="${getProxiedImageUrl(details.imageUrl)}" referrerpolicy="no-referrer" onerror="this.src='/logo.png'">
      <input type="file" id="input-card-file" accept="image/*" style="display: none;">
      <button id="btn-upload-image" class="app-btn-edit-image">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Bild ändern
      </button>
    </div>
  `;
  detailBody.appendChild(imageBox);

  const btnUploadImage = imageBox.querySelector('#btn-upload-image');
  const inputCardFile = imageBox.querySelector('#input-card-file');

  if (btnUploadImage && inputCardFile) {
    btnUploadImage.addEventListener('click', (e) => {
      e.stopPropagation();
      inputCardFile.click();
    });

    inputCardFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        btnUploadImage.disabled = true;
        btnUploadImage.textContent = "Lädt...";

        const base64Raw = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });

        // Compress to Max Width 400px (ideal thumbnail resolution)
        const compressedBase64 = await compressImage(base64Raw, 400);

        // 1. Save globally in card_images table (replaces the previous one if it exists)
        const { error: globalErr } = await supabase
          .from('card_images')
          .upsert({
            card_id: details.cardId,
            tcg: details.tcg,
            image_url: compressedBase64,
            updated_at: new Date().toISOString()
          });

        if (globalErr) throw globalErr;

        // 2. Keep the private watchlist record updated
        await supabase
          .from('marked_cards')
          .delete()
          .eq('card_id', details.cardId)
          .eq('user_id', currentUser.id);

        const { error } = await supabase
          .from('marked_cards')
          .insert({
            user_id: currentUser.id,
            tcg: details.tcg,
            card_id: details.cardId,
            image_url: compressedBase64
          });

        if (error) throw error;

        await fetchMarkedCards(); // Refresh local watchlist copy in memory!

        details.imageUrl = compressedBase64;
        const heroImg = imageBox.querySelector('.hero-img');
        if (heroImg) {
          heroImg.src = compressedBase64;
        }

        alert("Bild erfolgreich hochgeladen und gespeichert!");
      } catch (err) {
        alert("Fehler beim Hochladen: " + err.message);
      } finally {
        btnUploadImage.disabled = false;
        btnUploadImage.innerHTML = `
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Bild ändern
        `;
      }
    });
  }

  // Lightbox zoom triggers for detail view hero image
  const heroImgEl = imageBox.querySelector('.hero-img');
  if (heroImgEl) {
    heroImgEl.addEventListener('click', (e) => {
      e.stopPropagation();
      showLightbox(details.imageUrl || '/logo.png');
    });
  }

  // Filters Controls
  const filterSection = document.createElement('div');
  filterSection.className = 'detail-filters';
  filterSection.innerHTML = `
    <div class="filter-item">
      <label>Zustand</label>
      <select id="sel-cond" class="app-dropdown">
        ${details.conditions.map(c => `<option value="${c}" ${c === details.selectedCondition ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="filter-item">
      <label>Sprache</label>
      <select id="sel-lang" class="app-dropdown">
        ${details.languages.map(l => `<option value="${l}" ${l === details.selectedLanguage ? 'selected' : ''}>${LANGUAGE_NAMES_GERMAN[l] || l}</option>`).join('')}
      </select>
    </div>
    <div class="filter-item">
      <label>Standort</label>
      <select id="sel-loc" class="app-dropdown">
        ${details.locations.map(loc => `<option value="${loc}" ${loc === details.selectedLocation ? 'selected' : ''}>${loc}</option>`).join('')}
      </select>
    </div>
  `;
  detailBody.appendChild(filterSection);

  // Output cards stats viewport
  const statsSection = document.createElement('div');
  statsSection.className = 'detail-offer-section';
  detailBody.appendChild(statsSection);

  // SVG Chart Section Container
  const chartSection = document.createElement('div');
  chartSection.className = 'app-chart-container glass-panel';
  detailBody.appendChild(chartSection);

  // Render prices and plot line graph
  const updatePricesAndChart = () => {
    // 1. Filter raw history data locally on the client
    const filteredHistory = details.rawHistory.filter(h => 
      h.condition === details.selectedCondition &&
      h.language === details.selectedLanguage &&
      h.seller_country === details.selectedLocation
    );

    statsSection.innerHTML = '';
    chartSection.innerHTML = '';

    if (filteredHistory.length === 0) {
      statsSection.innerHTML = `<p style="grid-column: span 2; text-align: center; color: var(--text-muted); padding: 12px;">Keine Scandaten für diese Filterkombination.</p>`;
      chartSection.style.display = 'none';
      return;
    }

    chartSection.style.display = 'flex';

    const latest = filteredHistory[filteredHistory.length - 1];
    const baseline = filteredHistory[0];

    // Format metadata strings
    const latestFlag = getFlagHtml('language', latest.matchedLanguage);
    const latestSellerFlag = getFlagHtml('seller', latest.matchedCountry);
    const latestDate = new Date(latest.scanned_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

    const baselineFlag = getFlagHtml('language', baseline.matchedLanguage);
    const baselineSellerFlag = getFlagHtml('seller', baseline.matchedCountry);
    const baselineDate = new Date(baseline.scanned_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

    // Compare prices and append % change badge
    const diffPercent = baseline.price > 0 ? ((latest.price - baseline.price) / baseline.price) * 100 : 0;
    let diffBadgeHtml = '<span class="diff-badge stable">0.00%</span>';
    if (diffPercent < 0) {
      diffBadgeHtml = `<span class="diff-badge gain">${diffPercent.toFixed(2)}%</span>`;
    } else if (diffPercent > 0) {
      diffBadgeHtml = `<span class="diff-badge loss">+${diffPercent.toFixed(2)}%</span>`;
    }

    statsSection.innerHTML = `
      <div class="detail-tile glass-panel">
        <div class="tile-tag tag-current" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span>Aktuell</span>
          ${diffBadgeHtml}
        </div>
        <div class="tile-price">${latest.price.toFixed(2)} €</div>
        <div class="tile-meta">
          <span>Karte: ${latestFlag} <span class="cm-badge cm-cond-${latest.matchedCondition}">${latest.matchedCondition}</span></span>
          <span>Händler: ${latestSellerFlag} (${latest.matchedCountry})</span>
          <span>Datum: ${latestDate}</span>
        </div>
      </div>
      <div class="detail-tile glass-panel">
        <div class="tile-tag tag-first">Erster Scan</div>
        <div class="tile-price">${baseline.price.toFixed(2)} €</div>
        <div class="tile-meta">
          <span>Karte: ${baselineFlag} <span class="cm-badge cm-cond-${baseline.matchedCondition}">${baseline.matchedCondition}</span></span>
          <span>Händler: ${baselineSellerFlag} (${baseline.matchedCountry})</span>
          <span>Datum: ${baselineDate}</span>
        </div>
      </div>
    `;

    // 2. Render SVG Chart
    if (filteredHistory.length < 2) {
      chartSection.innerHTML = `
        <div class="chart-header"><span class="chart-title">Preisentwicklung</span></div>
        <p style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 16px 0;">Sammle mehr Preisdaten durch zukünftige Scans, um die Kurve anzuzeigen.</p>
      `;
      return;
    }

    // Chart boundary calculations
    const prices = filteredHistory.map(h => h.price);
    const times = filteredHistory.map(h => new Date(h.scanned_at).getTime());

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    const priceRange = maxPrice - minPrice;
    const timeRange = maxTime - minTime || 1.0;

    const avgPrice = (minPrice + maxPrice) / 2 || 1.0;
    const minDelta = Math.max(1.0, avgPrice * 0.1);

    let yMin, yMax;
    if (priceRange < minDelta) {
      yMin = avgPrice - minDelta / 2;
      yMax = avgPrice + minDelta / 2;
    } else {
      yMin = minPrice - priceRange * 0.15;
      yMax = maxPrice + priceRange * 0.15;
    }
    const yRange = yMax - yMin || 1.0;

    const svgPoints = filteredHistory.map(h => {
      const t = new Date(h.scanned_at).getTime();
      const x = ((t - minTime) / timeRange) * 100;
      const y = 90 - ((h.price - yMin) / yRange) * 80;
      const dateText = new Date(h.scanned_at).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      return { x, y, price: h.price, dateText, comment: h.comment || '' };
    });

    const pathData = svgPoints.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
    const areaData = pathData + ' L ' + svgPoints[svgPoints.length - 1].x.toFixed(1) + ' 90 L ' + svgPoints[0].x.toFixed(1) + ' 90 Z';

    const firstLabel = new Date(minTime).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const lastLabel = new Date(maxTime).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

    chartSection.innerHTML = `
      <div class="chart-header">
        <span class="chart-title">Preisentwicklung</span>
      </div>
      <div class="chart-body">
        <div class="chart-y-axis">
          <span>${yMax.toFixed(2)}€</span>
          <span>${avgPrice.toFixed(2)}€</span>
          <span>${yMin.toFixed(2)}€</span>
        </div>
        <div class="chart-main">
          <div class="chart-canvas" id="canvas-wrapper">
            <svg class="chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
                  <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0"/>
                </linearGradient>
              </defs>
              <line x1="0" y1="10" x2="100" y2="10" class="chart-grid" />
              <line x1="0" y1="50" x2="100" y2="50" class="chart-grid" />
              <line x1="0" y1="90" x2="100" y2="90" class="chart-grid" />
              <path d="${areaData}" fill="url(#chart-grad)" />
              <path d="${pathData}" class="chart-line" />
            </svg>
            <div id="chart-cursor-line" class="chart-touch-line" style="display: none;"></div>
            <div id="chart-cursor-dot" class="chart-touch-dot" style="display: none;"></div>
            <div id="chart-cursor-tooltip" class="chart-touch-tooltip" style="display: none;"></div>
          </div>
          <div class="chart-x-axis">
            <span>${firstLabel}</span>
            <span>${lastLabel}</span>
          </div>
        </div>
      </div>
    `;

    // 3. Interactive touch / hover dragging listeners inside WebApp
    const wrapper = chartSection.querySelector('#canvas-wrapper');
    const cursorLine = chartSection.querySelector('#chart-cursor-line');
    const cursorDot = chartSection.querySelector('#chart-cursor-dot');
    const cursorTooltip = chartSection.querySelector('#chart-cursor-tooltip');

    const handlePointerMove = (clientX, clientY) => {
      const rect = wrapper.getBoundingClientRect();
      const mouseX = ((clientX - rect.left) / rect.width) * 100;

      let closest = null;
      let minDiff = Infinity;
      for (const pt of svgPoints) {
        const diff = Math.abs(pt.x - mouseX);
        if (diff < minDiff) {
          minDiff = diff;
          closest = pt;
        }
      }

      if (closest) {
        cursorLine.style.left = closest.x.toFixed(1) + '%';
        cursorLine.style.display = 'block';

        cursorDot.style.left = closest.x.toFixed(1) + '%';
        cursorDot.style.top = closest.y.toFixed(1) + '%';
        cursorDot.style.display = 'block';

        // Tooltip position (keep within boundaries)
        const tooltipX = clientX - rect.left;
        cursorTooltip.style.left = tooltipX + 'px';
        cursorTooltip.style.top = '10px';
        cursorTooltip.style.display = 'block';

        const commentHtml = closest.comment 
          ? `<div style="font-size: 0.6rem; color: rgba(255,255,255,0.5); font-style: italic; max-width: 120px; white-space: normal; margin-top: 2px;">"${closest.comment}"</div>`
          : '';

        cursorTooltip.innerHTML = `
          <div style="font-weight: 700;">${closest.price.toFixed(2)} €</div>
          <div style="font-size: 0.55rem; color: rgba(255,255,255,0.4);">${closest.dateText}</div>
          ${commentHtml}
        `;
      }
    };

    const handlePointerLeave = () => {
      cursorLine.style.display = 'none';
      cursorDot.style.display = 'none';
      cursorTooltip.style.display = 'none';
    };

    // Mouse Events (Fallback)
    wrapper.addEventListener('mousemove', (e) => {
      handlePointerMove(e.clientX, e.clientY);
    });
    wrapper.addEventListener('mouseleave', handlePointerLeave);

    // Mobile Touch Events (Primary)
    wrapper.addEventListener('touchstart', (e) => {
      handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    });
    wrapper.addEventListener('touchmove', (e) => {
      e.preventDefault(); // Prevents page scrolling while scrubbing graph
      handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    });
    wrapper.addEventListener('touchend', handlePointerLeave);
  };

  // Bind dropdown filters selectors change event
  const selCond = filterSection.querySelector('#sel-cond');
  const selLang = filterSection.querySelector('#sel-lang');
  const selLoc = filterSection.querySelector('#sel-loc');

  const onFilterChange = () => {
    details.selectedCondition = selCond.value;
    details.selectedLanguage = selLang.value;
    details.selectedLocation = selLoc.value;
    updatePricesAndChart();
  };

  selCond.addEventListener('change', onFilterChange);
  selLang.addEventListener('change', onFilterChange);
  selLoc.addEventListener('change', onFilterChange);

  // Watchlist previous/next navigation
  const currentIndex = markedCards.findIndex(m => m.card_id === details.cardId);
  if (currentIndex !== -1) {
    const prevCard = currentIndex > 0 ? markedCards[currentIndex - 1] : null;
    const nextCard = currentIndex < markedCards.length - 1 ? markedCards[currentIndex + 1] : null;

    if (!checkIsMobile()) {
      // Desktop Pfeile links und rechts
      if (prevCard) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'detail-nav-btn prev-btn';
        prevBtn.title = `Vorherige Karte: ${cleanCardName(prevCard.card_id)}`;
        prevBtn.innerHTML = `
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="24" height="24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        `;
        prevBtn.addEventListener('click', () => {
          loadCardDetails(prevCard.card_id, prevCard.tcg);
        });
        wrapper.appendChild(prevBtn);
      }
      if (nextCard) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'detail-nav-btn next-btn';
        nextBtn.title = `Nächste Karte: ${cleanCardName(nextCard.card_id)}`;
        nextBtn.innerHTML = `
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="24" height="24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        `;
        nextBtn.addEventListener('click', () => {
          loadCardDetails(nextCard.card_id, nextCard.tcg);
        });
        wrapper.appendChild(nextBtn);
      }
    } else {
      // Mobile swipe gestures on the detail page wrapper
      let touchStartX = 0;
      let touchStartY = 0;
      
      wrapper.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      wrapper.addEventListener('touchend', (e) => {
        if (e.changedTouches.length === 0) return;
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        // Verify it was a horizontal swipe of significant distance (> 80px)
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 80) {
          if (deltaX > 0 && prevCard) {
            loadCardDetails(prevCard.card_id, prevCard.tcg);
          } else if (deltaX < 0 && nextCard) {
            loadCardDetails(nextCard.card_id, nextCard.tcg);
          }
        }
      }, { passive: true });
    }
  }

  // --- Clipped Images Suggestions Logic ---
  const renderClippedImages = (images) => {
    let suggestionsContainer = detailBody.querySelector('#clipped-images-suggestions');
    if (images.length === 0) {
      if (suggestionsContainer) suggestionsContainer.remove();
      return;
    }

    if (!suggestionsContainer) {
      suggestionsContainer = document.createElement('div');
      suggestionsContainer.id = 'clipped-images-suggestions';
      suggestionsContainer.className = 'glass-panel';
      suggestionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px; margin-top: 12px; border-radius: 8px; width: 100%;';
      suggestionsContainer.innerHTML = `
        <span style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); text-align: left;">Geclippte Bilder</span>
        <div class="suggestions-grid" style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin;"></div>
      `;
      detailBody.appendChild(suggestionsContainer);
    }

    const grid = suggestionsContainer.querySelector('.suggestions-grid');
    grid.innerHTML = '';

    for (const imgRecord of images) {
      const itemWrapper = document.createElement('div');
      itemWrapper.style.cssText = 'position: relative; flex-shrink: 0; width: 44px; height: 44px;';

      const imgBtn = document.createElement('button');
      imgBtn.style.cssText = 'border: 2px solid var(--border-glass); border-radius: 6px; padding: 0; background: transparent; cursor: pointer; width: 100%; height: 100%; overflow: hidden; transition: all 0.2s ease; display: block;';

      const thumb = document.createElement('img');
      thumb.src = imgRecord.image;
      thumb.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
      imgBtn.appendChild(thumb);

      imgBtn.addEventListener('mouseenter', () => {
        imgBtn.style.borderColor = 'var(--primary)';
        imgBtn.style.transform = 'scale(1.05)';
      });
      imgBtn.addEventListener('mouseleave', () => {
        imgBtn.style.borderColor = 'var(--border-glass)';
        imgBtn.style.transform = 'scale(1)';
      });

      imgBtn.addEventListener('click', async () => {
        if (confirm("Möchtest du dieses geclippte Bild als Anzeigebild für diese Karte übernehmen?")) {
          try {
            const compressedBase64 = await compressImage(imgRecord.image, 400);

            // 1. Save globally in card_images table
            const { error: globalErr } = await supabase
              .from('card_images')
              .upsert({
                card_id: details.cardId,
                tcg: details.tcg,
                image_url: compressedBase64,
                updated_at: new Date().toISOString()
              });

            if (globalErr) throw globalErr;

            // 2. Keep the private watchlist record updated
            await supabase
              .from('marked_cards')
              .delete()
              .eq('card_id', details.cardId)
              .eq('user_id', currentUser.id);

            const { error } = await supabase
              .from('marked_cards')
              .insert({
                user_id: currentUser.id,
                tcg: details.tcg,
                card_id: details.cardId,
                image_url: compressedBase64
              });

            if (error) throw error;

            await fetchMarkedCards(); // Refresh local watchlist copy
            details.imageUrl = compressedBase64;
            const heroImg = detailBody.querySelector('.hero-img');
            if (heroImg) {
              heroImg.src = compressedBase64;
            }
            alert("Bild erfolgreich übernommen!");
          } catch (err) {
            alert("Fehler beim Übernehmen: " + err.message);
          }
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = 'Bild löschen';
      deleteBtn.style.cssText = 'position: absolute; top: -4px; right: -4px; width: 14px; height: 14px; border-radius: 50%; background: rgba(220, 53, 69, 0.9); border: none; color: white; font-size: 10px; font-weight: bold; line-height: 12px; text-align: center; cursor: pointer; z-index: 10; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transition: all 0.2s ease;';

      deleteBtn.addEventListener('mouseenter', () => {
        deleteBtn.style.background = '#dc3545';
        deleteBtn.style.transform = 'scale(1.2)';
      });
      deleteBtn.addEventListener('mouseleave', () => {
        deleteBtn.style.background = 'rgba(220, 53, 69, 0.9)';
        deleteBtn.style.transform = 'scale(1)';
      });

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm("Möchtest du dieses geclippte Bild löschen?")) {
          const handleDeleteReply = (deleteEvent) => {
            document.removeEventListener('TCG_TRACKER_CLIPPED_IMAGES_REPLY', handleDeleteReply);
            renderClippedImages(deleteEvent.detail.images || []);
          };
          document.addEventListener('TCG_TRACKER_CLIPPED_IMAGES_REPLY', handleDeleteReply);

          document.dispatchEvent(new CustomEvent('TCG_TRACKER_DELETE_CLIPPED_IMAGE', {
            detail: { cardId: details.cardId, image: imgRecord.image, timestamp: imgRecord.timestamp }
          }));
        }
      });

      itemWrapper.appendChild(imgBtn);
      itemWrapper.appendChild(deleteBtn);
      grid.appendChild(itemWrapper);
    }
  };

  const handleClippedImagesReply = async (event) => {
    document.removeEventListener('TCG_TRACKER_CLIPPED_IMAGES_REPLY', handleClippedImagesReply);
    renderClippedImages(event.detail.images || []);
  };

  document.addEventListener('TCG_TRACKER_CLIPPED_IMAGES_REPLY', handleClippedImagesReply);

  // Auto clean-up if no extension reply is received
  setTimeout(() => {
    document.removeEventListener('TCG_TRACKER_CLIPPED_IMAGES_REPLY', handleClippedImagesReply);
  }, 1000);

  // Dispatch request to get clipped images
  document.dispatchEvent(new CustomEvent('TCG_TRACKER_GET_CLIPPED_IMAGES', {
    detail: { cardId: details.cardId }
  }));

  // Initial draw
  updatePricesAndChart();
  return wrapper;
}

// Start PWA Router
init();

// Trigger Vercel Webhook Sync
