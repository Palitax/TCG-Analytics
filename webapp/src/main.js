import { supabase } from './supabase.js';

// Global state variables
let currentUser = null;
let currentView = 'loading'; // 'loading', 'login', 'dashboard', 'detail'
let markedCards = [];
let searchHistory = JSON.parse(localStorage.getItem('search_history') || '[]');
let activeCardDetails = null; // Holds detail view data

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
  const { data: { session } } = await supabase.auth.getSession();
  
  if (session) {
    currentUser = session.user;
    await fetchMarkedCards();
    setView('dashboard');
  } else {
    setView('login');
  }

  // Listen for auth state changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      await fetchMarkedCards();
      setView('dashboard');
    } else {
      currentUser = null;
      markedCards = [];
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
    markedCards = data || [];
  } catch (err) {
    console.error('Error loading bookmarks:', err.message);
  }
}

// Main View Router
function setView(view) {
  currentView = view;
  render();
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  if (currentView === 'loading') {
    app.innerHTML = `
      <div class="spinner-box">
        <div class="spinner"></div>
        <p>Verbindung wird hergestellt...</p>
      </div>
    `;
  } else if (currentView === 'login') {
    renderLogin(app);
  } else if (currentView === 'dashboard') {
    renderDashboard(app);
  } else if (currentView === 'detail') {
    renderDetail(app);
  }
}

// RENDER: Login panel
function renderLogin(container) {
  const div = document.createElement('div');
  div.className = 'login-panel';
  div.innerHTML = `
    <img class="login-logo" src="/favicon.svg" alt="Logo">
    <h1 class="login-title">TCG Card Tracker</h1>
    <p class="login-desc">Melde dich mit deinem Account an, um deine Merkliste zu synchronisieren und Preisverläufe abzufragen.</p>
    <button id="btn-login" class="btn-primary">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.111 4.114-3.414 0-6.19-2.776-6.19-6.19 0-3.414 2.776-6.19 6.19-6.19 1.483 0 2.825.524 3.897 1.405l3.13-3.13C18.99 1.837 15.82 1 12.24 1c-6.076 0-11 4.924-11 11s4.924 11 11 11c6.076 0 11-4.924 11-11 0-.78-.07-1.533-.188-2.285H12.24z"/>
      </svg>
      Mit Google einloggen
    </button>
  `;
  container.appendChild(div);

  div.querySelector('#btn-login').addEventListener('click', async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
  });
}

// RENDER: Dashboard Panel
async function renderDashboard(container) {
  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = `
    <div class="header-logo">
      <img src="/favicon.svg" alt="Logo">
      <span class="header-title">TCG Card Tracker</span>
    </div>
    <button id="btn-logout" class="btn-logout" title="Ausloggen">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    </button>
  `;
  container.appendChild(header);

  header.querySelector('#btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  // Search Container
  const searchSection = document.createElement('div');
  searchSection.className = 'search-container';
  searchSection.innerHTML = `
    <div class="search-input-wrapper">
      <input type="text" id="inp-search" class="search-input" placeholder="Kartennummer suchen (z.B. OP15-119)..." autocomplete="off">
    </div>
    <div id="search-history" class="search-history-dropdown" style="display: none;"></div>
    <div id="search-results" class="search-results-overlay" style="display: none;"></div>
  `;
  container.appendChild(searchSection);

  const inpSearch = searchSection.querySelector('#inp-search');
  const divHistory = searchSection.querySelector('#search-history');
  const divResults = searchSection.querySelector('#search-results');

  // Load search history dropdown list
  const updateHistoryDropdown = () => {
    if (searchHistory.length === 0) {
      divHistory.style.display = 'none';
      return;
    }
    divHistory.innerHTML = searchHistory.map(item => `
      <div class="history-item" data-val="${item}">
        <span class="history-text">${item}</span>
        <button class="btn-delete-history" data-val="${item}">
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="16">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    `).join('');
  };

  inpSearch.addEventListener('focus', () => {
    if (inpSearch.value.trim() === '') {
      updateHistoryDropdown();
      if (searchHistory.length > 0) divHistory.style.display = 'block';
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchSection.contains(e.target)) {
      divHistory.style.display = 'none';
    }
  });

  // Handle Search Input Ttyping
  let searchTimeout = null;
  inpSearch.addEventListener('input', () => {
    divHistory.style.display = 'none';
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
        // Query price history rows matching card ID query target
        const { data, error } = await supabase
          .from('price_history')
          .select('card_id, tcg, comment')
          .ilike('card_id', `%${query}%`)
          .limit(20);

        if (error) throw error;

        // Group results to avoid duplicate card IDs in list
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
            <img class="search-result-img" src="${c.imageUrl || '/favicon.svg'}" onerror="this.src='/favicon.svg'">
            <div class="search-result-info">
              <span class="search-result-name">${c.card_id}</span>
              <span class="search-result-tcg">${c.tcg}</span>
            </div>
          </div>
        `).join('');

        divResults.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', async () => {
            const cardId = item.dataset.card;
            const tcg = item.dataset.tcg;
            addToHistory(cardId);
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

  // Event delegation inside search dropdown
  divHistory.addEventListener('click', async (e) => {
    const item = e.target.closest('.history-item');
    const deleteBtn = e.target.closest('.btn-delete-history');

    if (deleteBtn) {
      e.stopPropagation();
      const val = deleteBtn.dataset.val;
      searchHistory = searchHistory.filter(h => h !== val);
      localStorage.setItem('search_history', JSON.stringify(searchHistory));
      updateHistoryDropdown();
      if (searchHistory.length === 0) divHistory.style.display = 'none';
      return;
    }

    if (item) {
      const val = item.dataset.val;
      divHistory.style.display = 'none';
      inpSearch.value = '';
      
      // Perform a fresh lookup based on card ID
      divResults.style.display = 'block';
      divResults.innerHTML = `<div class="spinner-box" style="height: 100px;"><div class="spinner" style="width: 24px; height: 24px;"></div></div>`;
      
      try {
        const { data, error } = await supabase
          .from('price_history')
          .select('card_id, tcg, comment')
          .eq('card_id', val)
          .limit(1);

        if (error) throw error;
        if (data && data.length > 0) {
          await loadCardDetails(data[0].card_id, data[0].tcg);
          divResults.style.display = 'none';
        } else {
          divResults.innerHTML = `<p style="color: #f87171; padding: 16px;">Karte nicht mehr gefunden.</p>`;
        }
      } catch (err) {
        divResults.innerHTML = `<p style="color: #f87171; padding: 16px;">Fehler: ${err.message}</p>`;
      }
    }
  });

  // Marked Cards Section
  const dashboard = document.createElement('div');
  dashboard.className = 'dashboard-content';
  dashboard.innerHTML = `<h2 class="section-title">Markierte Karten</h2>`;
  container.appendChild(dashboard);

  if (markedCards.length === 0) {
    dashboard.innerHTML += `
      <div class="empty-state glass-panel">
        <svg class="empty-state-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.377.728-.377.879 0l2.09 5.011 5.4 1.018a.5.5 0 01.29.839l-3.834 3.738 1.05 5.378a.5.5 0 01-.707.567L12 17.766l-4.664 2.483a.5.5 0 01-.707-.567l1.05-5.378-3.834-3.738a.5.5 0 01.29-.839l5.4-1.018 2.09-5.011z" />
        </svg>
        <p>Noch keine markierten Karten. Scanne eine Karte mit dem Addon und markiere sie mit dem Stern.</p>
      </div>
    `;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'marked-grid';
  dashboard.appendChild(grid);

  // Render cards from markedCards array
  for (const card of markedCards) {
    const cardEl = document.createElement('div');
    cardEl.className = 'marked-card glass-panel';
    cardEl.innerHTML = `
      <div class="card-img-wrapper">
        <img class="card-img" src="${card.image_url || '/favicon.svg'}" onerror="this.src='/favicon.svg'">
      </div>
      <div class="card-info">
        <span class="card-tcg-label">${card.tcg}</span>
        <span class="card-name">${card.card_id}</span>
      </div>
      <div class="card-price-row">
        <span class="card-price" id="price-${card.id}">-- €</span>
        <span class="diff-badge" id="diff-${card.id}">...</span>
      </div>
    `;
    grid.appendChild(cardEl);

    cardEl.addEventListener('click', () => {
      loadCardDetails(card.card_id, card.tcg);
    });

    // Async load latest price for card grid list item
    loadLatestPriceForDashboard(card);
  }
}

// Search History storage helpers
function addToHistory(query) {
  searchHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
  localStorage.setItem('search_history', JSON.stringify(searchHistory));
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

    // Extract unique filter combinations available in scanned data
    const conditions = Array.from(new Set(parsedHistory.map(h => h.condition)));
    const locations = Array.from(new Set(parsedHistory.map(h => h.seller_country)));
    
    // Languages available: decode all options
    const languages = Array.from(new Set(parsedHistory.map(h => h.language)));

    // Read initial bookmarked state for details toggle state
    const isCurrentlyMarked = markedCards.some(m => m.card_id === cardId);

    activeCardDetails = {
      cardId,
      tcg,
      rawHistory: parsedHistory,
      conditions: conditions.sort(),
      locations: locations.sort(),
      languages: languages.sort(),
      isMarked: isCurrentlyMarked,
      imageUrl: parsedHistory.length > 0 ? parsedHistory[0].imageUrl : null,
      
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
  if (!details) return;

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
  container.appendChild(header);

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
      updateStarIconStyle();
    } catch (err) {
      console.error('Bookmark toggle failed:', err.message);
    } finally {
      starBtn.style.pointerEvents = 'auto';
    }
  });

  // Card Info Hero Section
  const detailBody = document.createElement('div');
  detailBody.className = 'detail-view';
  detailBody.innerHTML = `
    <div class="card-hero-section">
      <div class="hero-img-wrapper">
        <img class="hero-img" src="${details.imageUrl || '/favicon.svg'}" onerror="this.src='/favicon.svg'">
      </div>
      <div class="hero-meta">
        <span class="hero-tcg">${details.tcg}</span>
        <h1 class="hero-title">${details.cardId}</h1>
      </div>
    </div>
  `;
  container.appendChild(detailBody);

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

  // Initial draw
  updatePricesAndChart();
}

// Start PWA Router
init();
