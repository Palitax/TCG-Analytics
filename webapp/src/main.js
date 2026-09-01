import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { animate } from 'motion';
import { Chart, registerables } from 'chart.js';
import { BulkScanner } from './bulk-scanner.js';
import { SetBuilder } from './set-builder.js';
import { StreamOverlay } from './stream-overlay.js';
import { extractCardCode, parseCardCodeComponents } from './csv-parser.js';
import { formatCardMeta, translateCardName, translateSetName } from './tcg-translations.js';
import { fetchTCGPlayerPrice, getTCGPlayerSearchUrl } from './tcgplayer-service.js';
import { saveManualPrice, removeManualPrice } from './manual-prices.js';
Chart.register(...registerables);

// WebKit / motion animation safety wrapper
function safeAnimate(element, keyframes, options) {
  if (!element) return;
  try {
    if (typeof animate === 'function') {
      const anim = animate(element, keyframes, options);
      if (anim && typeof anim.catch === 'function') {
        anim.catch(() => {});
      }
      return anim;
    }
  } catch (e) {
    console.warn('Animation skipped:', e);
  }
}

// Global state variables
let currentUser = null;
let currentView = 'loading'; // 'loading', 'login', 'dashboard', 'detail'
let activeDashboardTab = 'watchlist'; // 'watchlist', 'collection', 'analytics', 'bulk-scan', or 'stream-overlay'
let lastOriginScreen = 'watchlist';
let activeStreamQueue = [];
let streamOverlayInstance = null;
let bulkScannerInstance = new BulkScanner();
let setBuilderInstance = new SetBuilder();
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

let activeSearchQuery = ''; // Active search query for filtering tabs
let analyticsSelectedConditions = ['ALL']; // Array for multi-select Condition filter
let analyticsSelectedLanguages = ['ALL'];  // Array for multi-select Language filter
let analyticsSelectedLocations = ['ALL'];  // Array for multi-select Seller Location filter
let analyticsSelectedTCGs = ['ALL'];       // Array for multi-select TCG filter
let collectionCards = []; // Cards in collection
let activeCardDetails = null; // Active card details object
let gridCards = []; // Active search/analytics grid cards
let activeTcgFilter = 'all'; // TCG filter for tabs ('all', 'OnePiece', 'Pokemon', 'Riftbound', 'DragonBall')
let collectionValueHistory = []; // Historical values of collection market value
let isBackgroundFetching = false; // Flag to indicate active database load operation
let watchlistSyncOffset = 0; // Current batch offset for syncing watchlist tabs in chunks of 20
let collectionSyncOffset = 0; // Current batch offset for syncing collection tabs in chunks of 20
const SYNC_BATCH_SIZE = 20;

function executeSyncUrls(urls, rangeStart, rangeEnd, totalCount, hintEl) {
  const isExtensionActive = document.documentElement.hasAttribute('data-tcg-tracker-extension-active');
  if (hintEl) hintEl.style.display = 'block';

  if (isExtensionActive) {
    if (hintEl) {
      if (rangeStart === 1 && rangeEnd === totalCount) {
        hintEl.textContent = `Öffne alle ${totalCount} Tabs im Hintergrund...`;
      } else {
        hintEl.textContent = `Öffne Karten ${rangeStart}–${rangeEnd} von ${totalCount} im Hintergrund...`;
      }
      hintEl.style.color = '#34d399';
    }
    document.dispatchEvent(new CustomEvent('TCG_TRACKER_SYNC_ALL', { detail: { urls } }));
  } else {
    if (hintEl) {
      if (rangeStart === 1 && rangeEnd === totalCount) {
        hintEl.textContent = 'Tipp: Pop-ups erlauben oder Erweiterung aktivieren, falls nicht alle Tabs öffnen.';
      } else {
        hintEl.textContent = `Öffne ${rangeStart}–${rangeEnd} von ${totalCount}... (Pop-ups erlauben)`;
      }
      hintEl.style.color = 'var(--text-muted)';
    }
    for (const url of urls) {
      window.open(url, '_blank');
    }
  }

  setTimeout(() => {
    if (hintEl) hintEl.style.display = 'none';
  }, 6000);
}

function initBatchSyncContainer(containerEl, totalCount, getUrlsFn, getOffsetFn, setOffsetFn) {
  if (!containerEl) return;

  const updateUI = () => {
    const offset = getOffsetFn();
    const hasMoreThanBatch = totalCount > SYNC_BATCH_SIZE;

    let primaryBtnHtml = '';
    let showReset = false;
    let showAllDirect = hasMoreThanBatch;

    if (!hasMoreThanBatch) {
      primaryBtnHtml = `
        <button class="btn btn-primary btn-sm btn-batch-sync-primary" style="display: inline-flex; align-items: center; gap: 6px;">
          <svg style="width: 13px; height: 13px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          Sync all (${totalCount})
        </button>
      `;
    } else {
      const nextStart = offset + 1;
      const nextEnd = Math.min(offset + SYNC_BATCH_SIZE, totalCount);

      if (offset === 0) {
        primaryBtnHtml = `
          <button class="btn btn-primary btn-sm btn-batch-sync-primary" style="display: inline-flex; align-items: center; gap: 6px;">
            <svg style="width: 13px; height: 13px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            Erste ${SYNC_BATCH_SIZE} öffnen (1–${nextEnd})
          </button>
        `;
      } else if (offset < totalCount) {
        showReset = true;
        primaryBtnHtml = `
          <button class="btn btn-primary btn-sm btn-batch-sync-primary" style="display: inline-flex; align-items: center; gap: 6px;">
            <svg style="width: 13px; height: 13px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
            Proceed (${nextStart}–${nextEnd})
          </button>
        `;
      } else {
        showReset = true;
        primaryBtnHtml = `
          <button class="btn btn-secondary btn-sm btn-batch-sync-primary" style="display: inline-flex; align-items: center; gap: 6px; color: #22c55e;">
            <svg style="width: 13px; height: 13px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Alle ${totalCount} geöffnet ✓
          </button>
        `;
      }
    }

    containerEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end;">
        ${primaryBtnHtml}
        ${showAllDirect ? `
          <button class="btn btn-secondary btn-sm btn-batch-sync-all" title="Alle ${totalCount} Karten auf einmal öffnen">
            Alle (${totalCount})
          </button>
        ` : ''}
        ${showReset ? `
          <button class="btn btn-secondary btn-sm btn-batch-sync-reset" title="Batch-Fortschritt zurücksetzen" style="padding: 0 8px; display: inline-flex; align-items: center; justify-content: center;">
            <svg style="width: 13px; height: 13px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        ` : ''}
      </div>
      <span class="batch-sync-hint" style="font-size: 0.68rem; color: var(--text-muted); display: none; text-align: right;"></span>
    `;

    const hintEl = containerEl.querySelector('.batch-sync-hint');
    const primaryBtn = containerEl.querySelector('.btn-batch-sync-primary');
    const allDirectBtn = containerEl.querySelector('.btn-batch-sync-all');
    const resetBtn = containerEl.querySelector('.btn-batch-sync-reset');

    if (primaryBtn) {
      primaryBtn.addEventListener('click', () => {
        const allUrls = getUrlsFn();
        if (!allUrls || allUrls.length === 0) return;

        if (!hasMoreThanBatch) {
          executeSyncUrls(allUrls, 1, allUrls.length, allUrls.length, hintEl);
          return;
        }

        const currentOffset = getOffsetFn();
        if (currentOffset >= totalCount) {
          setOffsetFn(0);
          updateUI();
          return;
        }

        const curStart = currentOffset;
        const curEnd = Math.min(curStart + SYNC_BATCH_SIZE, totalCount);
        const batchUrls = allUrls.slice(curStart, curEnd);

        executeSyncUrls(batchUrls, curStart + 1, curEnd, totalCount, hintEl);
        setOffsetFn(curEnd);
        updateUI();
      });
    }

    if (allDirectBtn) {
      allDirectBtn.addEventListener('click', () => {
        const allUrls = getUrlsFn();
        if (!allUrls || allUrls.length === 0) return;
        executeSyncUrls(allUrls, 1, allUrls.length, allUrls.length, hintEl);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        setOffsetFn(0);
        updateUI();
      });
    }
  };

  updateUI();
}

function loadCachedUserData(userId) {
  try {
    const cachedQueue = localStorage.getItem('cache_stream_queue');
    if (cachedQueue) {
      const parsedQueue = JSON.parse(cachedQueue);
      if (parsedQueue && parsedQueue.length > 0) {
        activeStreamQueue = parsedQueue;
      }
    }
  } catch(e) {}

  if (!userId) return;
  try {
    const cachedMarked = localStorage.getItem(`cache_marked_${userId}`);
    if (cachedMarked) {
      const parsed = JSON.parse(cachedMarked);
      markedCards = (parsed || []).filter(item => 
        item.card_id !== '__STREAM_QUEUE__' && 
        item.tcg !== 'StreamQueue' && 
        (!item.card_id || !item.card_id.startsWith('STREAM_'))
      );
    }

    const cachedColl = localStorage.getItem(`cache_coll_${userId}`);
    if (cachedColl) collectionCards = JSON.parse(cachedColl);

    const cachedHist = localStorage.getItem(`cache_hist_${userId}`);
    if (cachedHist) collectionValueHistory = JSON.parse(cachedHist);
  } catch (e) {
    console.warn('Failed to load cached user data:', e);
  }
}

function saveCachedUserData(userId) {
  try {
    if (activeStreamQueue && activeStreamQueue.length > 0) {
      localStorage.setItem('cache_stream_queue', JSON.stringify(activeStreamQueue));
    }
  } catch(e) {}

  if (!userId) return;
  try {
    const cleanMarked = (markedCards || []).filter(item => 
      item.card_id !== '__STREAM_QUEUE__' && 
      item.tcg !== 'StreamQueue' && 
      (!item.card_id || !item.card_id.startsWith('STREAM_'))
    );
    localStorage.setItem(`cache_marked_${userId}`, JSON.stringify(cleanMarked));
    localStorage.setItem(`cache_coll_${userId}`, JSON.stringify(collectionCards));
    localStorage.setItem(`cache_hist_${userId}`, JSON.stringify(collectionValueHistory));
  } catch (e) {
    console.warn('Failed to save user data cache:', e);
  }
}

function checkIsMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function showLoadingProgress(show) {
  let bar = document.getElementById('top-loading-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'top-loading-bar';
    bar.className = 'top-loading-bar';
    document.body.appendChild(bar);
  }

  let overlay = document.getElementById('center-loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'center-loading-overlay';
    overlay.className = 'center-loading-overlay';
    overlay.innerHTML = `
      <div class="center-loading-card glass-panel">
        <div class="spinner"></div>
        <span class="loading-status-text">Daten werden geladen...</span>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  if (show) {
    bar.style.width = '0%';
    bar.style.opacity = '1';
    bar.classList.add('active');
    overlay.classList.add('active');
    setTimeout(() => {
      if (bar.classList.contains('active')) {
        bar.style.width = '70%';
      }
    }, 50);
  } else {
    bar.style.width = '100%';
    setTimeout(() => {
      bar.style.opacity = '0';
      bar.classList.remove('active');
      overlay.classList.remove('active');
      setTimeout(() => {
        bar.style.width = '0%';
      }, 300);
    }, 200);
  }
}

function showToast(message) {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = 'position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 10000; display: flex; flex-direction: column; gap: 8px; pointer-events: none;';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  toast.innerHTML = `
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18" height="18">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <span>${message}</span>
  `;
  toastContainer.appendChild(toast);
  
  // Animate in from top
  safeAnimate(toast, { opacity: [0, 1], y: [-20, 0] }, { duration: 0.25, ease: "easeOut" });
  
  // Remove after 3 seconds
  setTimeout(() => {
    try {
      safeAnimate(toast, { opacity: 0, y: -20 }, { duration: 0.25, ease: "easeIn" });
    } catch (e) {}
    setTimeout(() => toast.remove(), 250);
  }, 3000);
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
function cleanCardName(cardId, tcg = 'Pokemon') {
  if (!cardId) return '';
  const meta = formatCardMeta(cardId, '', '', '', tcg);
  if (meta.setNameDe && meta.setNameDe !== 'Pokémon TCG' && meta.setNameDe !== 'TCG Set') {
    return `${meta.nameDe}${meta.variant ? ` (${meta.variant})` : ''} (${meta.setNameDe})`;
  }
  return meta.nameDe || cardId;
}

// Split card name into Character Name, Card Number, Set, and Variant
function splitCardTitle(cardId, tcg = 'Pokemon') {
  const meta = formatCardMeta(cardId, '', '', '', tcg);
  return {
    name: meta.nameDe || 'Karte',
    number: meta.cardCode || '',
    setName: meta.setNameDe || '',
    variant: meta.variant || null,
    variantLabel: meta.variantLabel || ''
  };
}

// Helper to detect if an image URL is a placeholder or missing
function isPlaceholderImage(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  return (
    lower === '/logo.png' ||
    lower.includes('placeholder') ||
    lower.includes('no-image') ||
    lower.includes('no_image') ||
    lower.includes('default-card') ||
    lower.includes('/items/1/') ||
    lower.includes('static.cardmarket.com/img/046e7f12e1324838ae62691656eb28ea')
  );
}

// Local browser image cache helpers
function getCachedCardImage(cardId) {
  if (!cardId) return null;
  try {
    const val = localStorage.getItem(`img_cache_${cardId}`);
    if (val && !isPlaceholderImage(val)) return val;
    return null;
  } catch (e) {
    return null;
  }
}

// Global keyboard listener for Card Detail View navigation
let detailKeydownListener = null;

function cleanupDetailKeydownListener() {
  if (detailKeydownListener) {
    document.removeEventListener('keydown', detailKeydownListener);
    detailKeydownListener = null;
  }
}

// Helper to get filtered & sorted Watchlist cards according to user active filters and sort choice
function getSortedWatchlistCards() {
  let sortedCards = (markedCards || []).filter(item => 
    item.card_id !== '__STREAM_QUEUE__' && 
    item.tcg !== 'StreamQueue' && 
    (!item.card_id || !item.card_id.startsWith('STREAM_'))
  );
  if (activeSearchQuery && activeSearchQuery.trim()) {
    const q = activeSearchQuery.toLowerCase();
    const qWords = q.replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean);
    sortedCards = sortedCards.filter(c => {
      const cardIdStr = (c.card_id || '').toLowerCase().replace(/[-_]/g, ' ');
      const cleanNameStr = cleanCardName(c.card_id).toLowerCase().replace(/[-_]/g, ' ');
      const tcgStr = (c.tcg || '').toLowerCase();

      return qWords.every(w => cardIdStr.includes(w) || cleanNameStr.includes(w) || tcgStr.includes(w));
    });
  }

  if (activeTcgFilter !== 'all') {
    const filterTcg = activeTcgFilter.toLowerCase();
    sortedCards = sortedCards.filter(c => {
      const tcgStr = (c.tcg || '').toLowerCase();
      if (filterTcg === 'onepiece') return tcgStr === 'onepiece' || tcgStr === 'one piece';
      if (filterTcg === 'dragonball') return tcgStr === 'dragonball' || tcgStr === 'dragon ball' || tcgStr === 'dragonballsuper' || tcgStr === 'dragon ball super';
      return tcgStr === filterTcg;
    });
  }

  if (activeSortOption === 'no-image') {
    sortedCards.sort((a, b) => {
      const hasImgA = !!(a.image_url || getCachedCardImage(a.card_id));
      const hasImgB = !!(b.image_url || getCachedCardImage(b.card_id));
      if (hasImgA === hasImgB) return 0;
      return hasImgA ? 1 : -1; // Cards without image come FIRST
    });
  } else if (activeSortOption === 'date-desc') {
    sortedCards.sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    });
  } else if (activeSortOption === 'price-asc') {
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

  return sortedCards;
}

// Helper to get filtered & sorted Collection cards according to user active filters and sort choice
function getSortedCollectionCards() {
  let sortedCards = [...collectionCards];
  if (activeSearchQuery && activeSearchQuery.trim()) {
    const q = activeSearchQuery.toLowerCase();
    const qWords = q.replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean);
    sortedCards = sortedCards.filter(c => {
      const cardIdStr = (c.card_id || '').toLowerCase().replace(/[-_]/g, ' ');
      const cleanNameStr = cleanCardName(c.card_id).toLowerCase().replace(/[-_]/g, ' ');
      const tcgStr = (c.tcg || '').toLowerCase();

      return qWords.every(w => cardIdStr.includes(w) || cleanNameStr.includes(w) || tcgStr.includes(w));
    });
  }

  if (activeTcgFilter !== 'all') {
    const filterTcg = activeTcgFilter.toLowerCase();
    sortedCards = sortedCards.filter(c => {
      const tcgStr = (c.tcg || '').toLowerCase();
      if (filterTcg === 'onepiece') return tcgStr === 'onepiece' || tcgStr === 'one piece';
      if (filterTcg === 'dragonball') return tcgStr === 'dragonball' || tcgStr === 'dragon ball' || tcgStr === 'dragonballsuper' || tcgStr === 'dragon ball super';
      return tcgStr === filterTcg;
    });
  }

  for (const card of sortedCards) {
    const buyPrice = card.purchase_price !== null && card.purchase_price !== undefined ? parseFloat(card.purchase_price) : null;
    const basePrice = buyPrice !== null ? buyPrice : (card.baseline_price || 0);
    const latestPrice = card.latest_price || 0;
    card.resolved_diff_percent = basePrice > 0 ? ((latestPrice - basePrice) / basePrice) * 100 : 0;
  }

  if (activeSortOption === 'no-image') {
    sortedCards.sort((a, b) => {
      const hasImgA = !!(a.image_url || getCachedCardImage(a.card_id));
      const hasImgB = !!(b.image_url || getCachedCardImage(b.card_id));
      if (hasImgA === hasImgB) return 0;
      return hasImgA ? 1 : -1; // Cards without image come FIRST
    });
  } else if (activeSortOption === 'date-desc') {
    sortedCards.sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    });
  } else if (activeSortOption === 'price-asc') {
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
      const dA = a.resolved_diff_percent !== undefined ? a.resolved_diff_percent : 0;
      const dB = b.resolved_diff_percent !== undefined ? b.resolved_diff_percent : 0;
      return dB - dA;
    });
  } else if (activeSortOption === 'diff-asc') {
    sortedCards.sort((a, b) => {
      const dA = a.resolved_diff_percent !== undefined ? a.resolved_diff_percent : 0;
      const dB = b.resolved_diff_percent !== undefined ? b.resolved_diff_percent : 0;
      return dA - dB;
    });
  }

  return sortedCards;
}

function setCachedCardImage(cardId, imageUrl) {
  if (!cardId || !imageUrl) return;
  try {
    if (imageUrl.startsWith('data:') && imageUrl.length > 150000) return;
    localStorage.setItem(`img_cache_${cardId}`, imageUrl);
  } catch (e) {
    // LocalStorage quota reached, ignore
  }
}

// Convert Base64 data URL to Blob for Supabase Storage upload
function base64ToBlob(base64Str) {
  const parts = base64Str.split(';base64,');
  const contentType = (parts[0] && parts[0].split(':')[1]) || 'image/jpeg';
  const raw = window.atob(parts[1] || parts[0]);
  const uInt8Array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  return new Blob([uInt8Array], { type: contentType });
}

// Compress and resize base64 image using canvas to save storage
function compressImage(base64Str, maxWidth = 350) {
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
      const compressed = canvas.toDataURL('image/jpeg', 0.65);
      resolve(compressed);
    };
    img.onerror = () => resolve(base64Str);
    img.src = base64Str;
  });
}

// Upload image to Supabase Storage bucket 'card-images'
async function uploadImageToStorage(cardId, base64Str) {
  try {
    const cleanId = (cardId || '').replace(/^\/+/, '');
    const sanitizedId = cleanId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const fileName = `card_${sanitizedId}.webp`;

    let compressed = base64Str;
    let blob = null;

    if (base64Str.startsWith('data:')) {
      compressed = await compressImage(base64Str, 800);
      blob = base64ToBlob(compressed);
    }

    if (blob) {
      const { data, error } = await supabase.storage
        .from('card-images')
        .upload(fileName, blob, {
          contentType: 'image/webp',
          cacheControl: '31536000',
          upsert: true
        });

      if (!error) {
        const { data: publicUrlData } = supabase.storage
          .from('card-images')
          .getPublicUrl(fileName);

        const publicUrl = publicUrlData?.publicUrl || `${SUPABASE_URL}/storage/v1/object/public/card-images/${fileName}`;
        setCachedCardImage(cardId, publicUrl);
        return publicUrl;
      } else {
        console.warn('Supabase storage upload failed:', error.message);
      }
    }

    // Fallback if Storage upload failed or base64 without blob: return compressed base64 data URL so cloud sync still works!
    return compressed || base64Str;
  } catch (err) {
    console.warn('Storage upload exception:', err.message);
    return base64Str;
  }
}

// Automatically sync any locally cached images in localStorage (from Mac clippings) to Supabase Cloud DB
async function syncLocalImageCacheToCloud() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('img_cache_')) {
        keys.push(k);
      }
    }

    if (keys.length === 0) return;

    const cardIds = keys.map(k => k.replace('img_cache_', '')).filter(Boolean);

    // Fetch existing image records from Supabase card_images table
    const { data: dbImages } = await supabase
      .from('card_images')
      .select('card_id, image_url')
      .in('card_id', cardIds.slice(0, 100));

    const validDbMap = new Map();
    if (dbImages) {
      for (const item of dbImages) {
        if (item.card_id && item.image_url) {
          validDbMap.set(item.card_id, item.image_url);
        }
      }
    }

    for (const key of keys) {
      const cardId = key.replace('img_cache_', '');
      const localImg = localStorage.getItem(key);
      if (!cardId || !localImg) continue;

      const existingDbUrl = validDbMap.get(cardId);

      // If missing in DB or pointing to unverified storage, push local image to cloud
      if (!existingDbUrl || (existingDbUrl.includes('/storage/') && !localImg.startsWith('http'))) {
        try {
          const finalUrl = localImg.startsWith('data:') 
            ? await uploadImageToStorage(cardId, localImg)
            : localImg;

          if (finalUrl) {
            await supabase
              .from('card_images')
              .upsert({
                card_id: cardId,
                image_url: finalUrl,
                updated_at: new Date().toISOString()
              }, { onConflict: 'card_id' });

            if (currentUser?.id) {
              await supabase
                .from('marked_cards')
                .update({ image_url: finalUrl })
                .eq('user_id', currentUser.id)
                .eq('card_id', cardId);
            }
          }
        } catch (syncErr) {
          console.warn('Failed to sync image to cloud:', cardId, syncErr);
        }
      }
    }
  } catch (e) {
    console.warn('Error in syncLocalImageCacheToCloud:', e);
  }
}


// Return stored image URL directly (Base64, Supabase Storage, or proxied Cardmarket link)
function getProxiedImageUrl(url) {
  if (!url) return '/logo.png';
  if (typeof url === 'string') {
    // Route ALL Cardmarket images via Vercel image proxy
    if (url.includes('cardmarket.com')) {
      const isWeb = typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http');
      const origin = isWeb ? window.location.origin : '';
      return `${origin}/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
    // Route official One Piece card images via wsrv.nl proxy to prevent CORP/CORS blocks
    if (url.includes('onepiece-cardgame.com') || url.includes('optcg-api')) {
      return `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
    }
    if (url.includes('api-supabase.rohdedigital.de') && typeof SUPABASE_URL === 'string' && SUPABASE_URL.includes('/supabase-proxy')) {
      return url.replace('https://api-supabase.rohdedigital.de', SUPABASE_URL);
    }
  }
  return url;
}



// Robust global fallback for card images (e.g. falls back from German to English scans if German scan is missing)
window.handleCardImageError = function(img) {
  if (!img) return;
  const currentSrc = img.getAttribute('src') || img.src || '';
  if (currentSrc.includes('assets.tcgdex.net/de/')) {
    img.src = currentSrc.replace('/assets.tcgdex.net/de/', '/assets.tcgdex.net/en/');
    return;
  }
  img.src = '/logo.png';
};

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
      <img src="${imgSrc}" class="lightbox-img" onerror="handleCardImageError(this)">
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

function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

// Initialize PWA App
async function init() {
  setView('loading');
  
  // Register Supabase auth state change listener to keep extension continuously synced
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session && session.access_token) {
        currentUser = session.user;
        document.dispatchEvent(new CustomEvent('TCG_TRACKER_SYNC_SESSION', {
          detail: { session }
        }));
      }
    });
  } catch (e) {
    console.warn('[PWA Init] Auth state change listener error:', e);
  }

  // 1. Verify active Supabase auth session (triggers token auto-refresh if expiring)
  try {
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ data: { session: null } }), 2500));
    const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]);
    if (session && session.user) {
      currentUser = session.user;
      document.dispatchEvent(new CustomEvent('TCG_TRACKER_SYNC_SESSION', {
        detail: { session }
      }));
    }
  } catch (e) {
    console.warn('[PWA Init] Supabase getSession warning:', e);
  }

  // 2. Fallback: Check local storage for session if Supabase client did not resolve it yet
  if (!currentUser) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('supabase') || key.includes('auth-token') || key.includes('tcg_user_session'))) {
          const val = localStorage.getItem(key);
          if (val) {
            const parsed = JSON.parse(val);
            if (parsed && parsed.user && parsed.user.id) {
              const exp = parsed.expires_at || (parsed.access_token ? decodeJWT(parsed.access_token)?.exp : null);
              const nowSec = Math.floor(Date.now() / 1000);
              if (!exp || exp > nowSec) {
                currentUser = parsed.user;
                if (parsed.access_token) {
                  document.dispatchEvent(new CustomEvent('TCG_TRACKER_SYNC_SESSION', {
                    detail: { session: parsed }
                  }));
                }
                break;
              } else {
                localStorage.removeItem(key);
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  // Handle OAuth redirect token fragment from Google
  if (window.location.hash.includes('access_token=')) {
    try {
      const hashString = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const hashParams = new URLSearchParams(hashString);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (accessToken) {
        const payload = decodeJWT(accessToken);
        if (payload && payload.sub) {
          currentUser = {
            id: payload.sub,
            email: payload.email || 'user@tcg-tracker.local',
            user_metadata: payload.user_metadata || {}
          };

          const sessionObj = {
            access_token: accessToken,
            refresh_token: refreshToken || '',
            user: currentUser,
            expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 30
          };

          try {
            localStorage.setItem('sb-api-supabase-auth-token', JSON.stringify(sessionObj));
            localStorage.setItem('tcg_user_session', JSON.stringify(sessionObj));
          } catch (e) {}

          window.history.replaceState(null, '', window.location.pathname + '#/watchlist');
          
          document.dispatchEvent(new CustomEvent('TCG_TRACKER_SYNC_SESSION', {
            detail: { session: sessionObj }
          }));

          if (window.location.href.includes('from=extension')) {
            showToast('Erfolgreich in der Extension angemeldet! Du kannst diesen Tab schließen.');
          }

          loadCachedUserData(currentUser.id);
          navigate('/watchlist', false);
          return;
        }
      }
    } catch (e) {
      console.warn('Manual OAuth token extraction warning:', e);
    }
  }

  // Clean hash fragment if returning from OAuth with error or provider token
  if (window.location.hash.includes('error=') || window.location.hash.includes('provider_token')) {
    try {
      window.history.replaceState(null, '', window.location.pathname + '#/watchlist');
    } catch(e) {}
  }

  // Handle hashchange for back/forward buttons
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.slice(1) || '/watchlist';
    if (!hash.includes('access_token=')) {
      navigate(hash, false);
    }
  });

  // If user is logged in, load dashboard or current route
  if (currentUser) {
    if (window.location.href.includes('from=extension')) {
      showToast('Erfolgreich in der Extension angemeldet! Du kannst diesen Tab schließen.');
    }
    loadCachedUserData(currentUser.id);
    let currentPath = window.location.hash.slice(1) || '/watchlist';
    if (currentPath.includes('access_token=') || currentPath.includes('error=') || currentPath.includes('provider_token') || currentPath === '/login' || currentPath === '/') {
      currentPath = '/watchlist';
    }
    navigate(currentPath, false);
    return;
  }

  // Safety fallback
  navigate('/login', false);
}

async function fetchBulkPriceHistory(cardIds) {
  if (!cardIds || cardIds.length === 0) return [];
  const validIds = Array.from(new Set(cardIds.filter(id => id && typeof id === 'string')));
  if (validIds.length === 0) return [];

  const chunkSize = 20;
  const results = [];
  for (let i = 0; i < validIds.length; i += chunkSize) {
    const chunk = validIds.slice(i, i + chunkSize);
    try {
      const encodedChunk = chunk.map(id => `"${id.replace(/"/g, '""')}"`).join(',');
      const url = `${SUPABASE_URL}/rest/v1/price_history?select=card_id,price,comment,scanned_at&card_id=in.(${encodeURIComponent(encodedChunk)})&order=scanned_at.asc`;
      
      const resp = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        credentials: 'omit',
        signal: AbortSignal.timeout(6000)
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data) results.push(...data);
      }
    } catch (e) {
      console.error('Chunked price_history fetch exception:', e);
    }
  }
  return results;
}

async function fetchBulkCardImages(cardIds) {
  if (!cardIds || cardIds.length === 0) return [];
  
  const allSearchIds = new Set();
  for (const rawId of cardIds) {
    if (!rawId || typeof rawId !== 'string') continue;
    const clean = rawId.replace(/^\/+/, '');
    if (clean) {
      allSearchIds.add(clean);
      allSearchIds.add('/' + clean);
    }
  }

  const validIds = Array.from(allSearchIds);
  if (validIds.length === 0) return [];

  const chunkSize = 20;
  const results = [];
  for (let i = 0; i < validIds.length; i += chunkSize) {
    const chunk = validIds.slice(i, i + chunkSize);
    try {
      const encodedChunk = chunk.map(id => `"${id.replace(/"/g, '""')}"`).join(',');
      const url = `${SUPABASE_URL}/rest/v1/card_images?select=card_id,image_url&card_id=in.(${encodeURIComponent(encodedChunk)})`;

      const resp = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        credentials: 'omit',
        signal: AbortSignal.timeout(6000)
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data) results.push(...data);
      }
    } catch (e) {
      console.error('Chunked card_images fetch exception:', e);
    }
  }
  return results;
}

// Fetch collection cards for active user
async function fetchCollectionCards() {
  if (!currentUser) return;
  try {
    let listData = [];
    const url = `${SUPABASE_URL}/rest/v1/collection_cards?select=*&user_id=eq.${encodeURIComponent(currentUser.id)}&order=created_at.desc`;
    try {
      const resp = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        credentials: 'omit',
        signal: AbortSignal.timeout(6000)
      });
      if (resp.ok) {
        listData = await resp.json();
      }
    } catch (fErr) {}

    const cardIds = (listData || []).map(c => c.card_id);
    if (cardIds.length > 0) {
      try {
        const globalImages = await fetchBulkCardImages(cardIds);
        const imageMap = new Map();
        if (globalImages) {
          for (const img of globalImages) {
            if (img.card_id && img.image_url) {
              const clean = img.card_id.replace(/^\/+/, '');
              imageMap.set(img.card_id, img.image_url);
              imageMap.set(clean, img.image_url);
              imageMap.set('/' + clean, img.image_url);
              imageMap.set(clean.toLowerCase(), img.image_url);
              imageMap.set(('/' + clean).toLowerCase(), img.image_url);
            }
          }
        }

        for (const card of listData) {
          const cleanId = (card.card_id || '').replace(/^\/+/, '');
          const freshUrl = imageMap.get(card.card_id) ||
                           imageMap.get(cleanId) ||
                           imageMap.get('/' + cleanId) ||
                           imageMap.get(cleanId.toLowerCase());

          if (freshUrl) {
            card.image_url = freshUrl;
            setCachedCardImage(card.card_id, freshUrl);
          } else {
            card.image_url = getCachedCardImage(card.card_id) || card.image_url || null;
          }
        }

      } catch (err) {
        console.error('Error fetching global card images for collection:', err.message);
      }

      // Bulk fetch price history for all cards
      try {
        const priceData = await fetchBulkPriceHistory(cardIds);

        if (priceData) {
          const historyMap = {};
          const latestPrices = {};
          const historyPoints = [];

          for (const row of priceData) {
            if (!historyMap[row.card_id]) {
              historyMap[row.card_id] = [];
            }
            historyMap[row.card_id].push(parseHistoryItem(row));

            // Track cumulative collection value at this time point
            latestPrices[row.card_id] = parseFloat(row.price);
            const currentTotal = Object.values(latestPrices).reduce((sum, p) => sum + p, 0);
            if (row.scanned_at) {
              historyPoints.push({
                scanned_at: row.scanned_at,
                value: currentTotal
              });
            }
          }

          // Downsample to daily points for smooth rendering
          const dayMap = {};
          for (const pt of historyPoints) {
            const dayStr = new Date(pt.scanned_at).toISOString().split('T')[0];
            dayMap[dayStr] = pt; // keep the latest cumulative point of that day
          }
          const sortedDays = Object.keys(dayMap).sort();
          collectionValueHistory = sortedDays.map(day => dayMap[day]);

          for (const card of listData) {
            const history = historyMap[card.card_id] || [];
            if (history.length > 0) {
              const latest = history[history.length - 1];
              const baseline = history[0];
              card.latest_price = latest.price;
              card.baseline_price = baseline.price;
              card.diff_percent = baseline.price > 0 ? ((latest.price - baseline.price) / baseline.price) * 100 : 0;

              // Fallback image url from history if still missing
              if (!card.image_url) {
                for (let i = history.length - 1; i >= 0; i--) {
                  if (history[i].imageUrl) {
                    card.image_url = history[i].imageUrl;
                    setCachedCardImage(card.card_id, card.image_url);
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
        console.error('Error fetching collection bulk prices:', err.message);
      }
    }

    collectionCards = listData;
    saveCachedUserData(currentUser?.id);
  } catch (err) {
    console.error('Error loading collection cards:', err.message);
  }
}

// Fetch bookmarked cards for active user
async function fetchMarkedCards() {
  if (!currentUser) return;
  try {
    let listData = [];
    const url = `${SUPABASE_URL}/rest/v1/marked_cards?select=id,card_id,tcg,comment,target_price,condition,language,seller_country,created_at&user_id=eq.${encodeURIComponent(currentUser.id)}&order=created_at.desc`;
    try {
      const resp = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        credentials: 'omit',
        signal: AbortSignal.timeout(6000)
      });
      if (resp.ok) {
        listData = await resp.json();
      }
    } catch (fErr) {}
    
    // Purge legacy stream queue items from database so they never clutter the watchlist
    try {
      supabase
        .from('marked_cards')
        .delete()
        .eq('user_id', currentUser.id)
        .or('tcg.eq.StreamQueue,card_id.ilike.STREAM_%')
        .then(() => {})
        .catch(err => console.warn('Purge stream queue warning:', err?.message || err));
    } catch (purgeErr) {}


    listData = (listData || []).filter(item => 
      item.card_id !== '__STREAM_QUEUE__' && 
      item.tcg !== 'StreamQueue' && 
      (!item.card_id || !item.card_id.startsWith('STREAM_'))
    );
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

    const cardIds = listData.map(c => c.card_id);
    if (cardIds.length > 0) {
      try {
        const globalImages = await fetchBulkCardImages(cardIds);
        const imageMap = new Map();
        if (globalImages) {
          for (const img of globalImages) {
            if (img.card_id && img.image_url) {
              const clean = img.card_id.replace(/^\/+/, '');
              imageMap.set(img.card_id, img.image_url);
              imageMap.set(clean, img.image_url);
              imageMap.set('/' + clean, img.image_url);
              imageMap.set(clean.toLowerCase(), img.image_url);
              imageMap.set(('/' + clean).toLowerCase(), img.image_url);
            }
          }
        }

        for (const card of listData) {
          const cleanId = (card.card_id || '').replace(/^\/+/, '');
          const freshUrl = imageMap.get(card.card_id) ||
                           imageMap.get(cleanId) ||
                           imageMap.get('/' + cleanId) ||
                           imageMap.get(cleanId.toLowerCase());

          if (freshUrl) {
            card.image_url = freshUrl;
            setCachedCardImage(card.card_id, freshUrl);
          } else {
            card.image_url = getCachedCardImage(card.card_id) || card.image_url || null;
          }
        }

      } catch (err) {
        console.error('Error fetching global card images:', err.message);
      }

      // Bulk fetch price history for all cards
      try {
        const priceData = await fetchBulkPriceHistory(cardIds);

        if (priceData) {
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
    saveCachedUserData(currentUser?.id);
  } catch (err) {
    console.error('Error loading bookmarks:', err.message);
  }
}

// Hash-based routing navigation helper
async function navigate(path, pushState = true) {
  const hash = path || '/watchlist';
  const queryIdx = hash.indexOf('?');
  const pathname = queryIdx === -1 ? hash : hash.slice(0, queryIdx);
  const search = queryIdx === -1 ? '' : hash.slice(queryIdx);
  const searchParams = new URLSearchParams(search);

  if (pushState) {
    try {
      if (window.location.hash !== '#' + hash) {
        window.history.pushState(null, '', '#' + hash);
      }
    } catch(e) {
      window.location.hash = hash;
    }
  }
  
  if (pathname === '/login') {
    await setView('login');
    return;
  }
  
  if (!currentUser) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        currentUser = session.user;
        document.dispatchEvent(new CustomEvent('TCG_TRACKER_SYNC_SESSION', {
          detail: { session }
        }));
      }
    } catch (e) {}

    if (!currentUser) {
      try {
        const rawStored = localStorage.getItem('sb-api-supabase-auth-token');
        if (rawStored) {
          const parsedStored = JSON.parse(rawStored);
          if (parsedStored && parsedStored.user && parsedStored.user.id) {
            currentUser = parsedStored.user;
          }
        }
      } catch (e) {}
    }

    if (!currentUser) {
      await setView('login');
      return;
    }
  }

  // Navigate to dashboard tabs instantly
  if (pathname === '/' || pathname === '/watchlist' || pathname === '/analytics' || pathname === '/collection' || pathname === '/bulk-scan' || pathname === '/stream-overlay') {
    if (pathname === '/analytics' || pathname === '/search') {
      activeDashboardTab = 'analytics';
      lastOriginScreen = 'analytics';
    } else if (pathname === '/collection') {
      activeDashboardTab = 'collection';
      lastOriginScreen = 'collection';
    } else if (pathname === '/bulk-scan') {
      activeDashboardTab = 'bulk-scan';
      lastOriginScreen = 'bulk-scan';
    } else if (pathname === '/stream-overlay') {
      activeDashboardTab = 'stream-overlay';
      lastOriginScreen = 'stream-overlay';
    } else {
      activeDashboardTab = 'watchlist';
      lastOriginScreen = 'watchlist';
    }
    
    if (pathname !== '/stream-overlay' && streamOverlayInstance) {
      streamOverlayInstance.destroy();
      streamOverlayInstance = null;
    }

    const existingTabWrapper = document.getElementById('dashboard-tab-content');
    if (currentView === 'dashboard' && existingTabWrapper) {
      // Highlight active tab button
      document.querySelectorAll('.cm-landing-btn').forEach(btn => btn.classList.remove('active'));
      const activeBtn = document.getElementById(`btn-tab-${activeDashboardTab}`);
      if (activeBtn) activeBtn.classList.add('active');

      existingTabWrapper.innerHTML = '';
      if (activeDashboardTab === 'watchlist') {
        renderWatchlistTab(existingTabWrapper);
      } else if (activeDashboardTab === 'collection') {
        renderCollectionTab(existingTabWrapper);
      } else if (activeDashboardTab === 'bulk-scan') {
        renderBulkScanTab(existingTabWrapper);
      } else if (activeDashboardTab === 'stream-overlay') {
        renderStreamOverlayTab(existingTabWrapper);
      } else {
        await renderAnalyticsTab(existingTabWrapper);
      }
    } else {
      await setView('dashboard');
    }

    // Only trigger background DB fetch if cache is older than 30 seconds
    const now = Date.now();
    const isCacheStale = now - lastDataFetchTime > 30000;
    const isMemoryEmpty = markedCards.length === 0 && collectionCards.length === 0;

    if (isMemoryEmpty || isCacheStale) {
      if (isMemoryEmpty) showLoadingProgress(true);
      isBackgroundFetching = true;

      Promise.all([
        fetchMarkedCards(),
        fetchCollectionCards()
      ]).then(() => {
        lastDataFetchTime = Date.now();
        showLoadingProgress(false);
        isBackgroundFetching = false;
        syncLocalImageCacheToCloud();

        const tabContentWrapper = document.getElementById('dashboard-tab-content');
        if (tabContentWrapper && currentView === 'dashboard') {
          if (activeDashboardTab === 'watchlist') {
            renderWatchlistTab(tabContentWrapper);
          } else if (activeDashboardTab === 'collection') {
            renderCollectionTab(tabContentWrapper);
          } else if (activeDashboardTab === 'bulk-scan') {
            renderBulkScanTab(tabContentWrapper);
          } else if (activeDashboardTab === 'stream-overlay') {
            renderStreamOverlayTab(tabContentWrapper);
          }
        }
      }).catch(err => {
        showLoadingProgress(false);
        isBackgroundFetching = false;
        console.error('Background data update failed:', err);
      });
    }
  } else if (pathname === '/detail') {
    const cardId = searchParams.get('card_id');
    const tcg = searchParams.get('tcg');
    if (cardId && tcg) {
      await loadCardDetails(cardId, tcg, false);
    } else {
      await navigate('/watchlist', false);
    }
  } else {
    // Fallback
    await navigate('/watchlist', false);
  }
}

// Main View Router
async function setView(view) {
  cleanupDetailKeydownListener();
  currentView = view;
  await render();

  if (view !== 'loading') {
    const widget = document.getElementById('cache-recovery-widget');
    if (widget) widget.style.display = 'none';
  }
}

async function render() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';

  let viewEl = null;

  try {
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
  } catch (renderErr) {
    console.error('Fatal rendering error in view [' + currentView + ']:', renderErr);
    viewEl = document.createElement('div');
    viewEl.className = 'glass-panel';
    viewEl.style.cssText = 'max-width: 420px; margin: 60px auto; padding: 24px; text-align: center; color: #fff; font-family: -apple-system, sans-serif;';
    viewEl.innerHTML = `
      <h3 style="color: #ef4444; margin-bottom: 12px; font-size: 1.1rem;">Anzeigefehler aufgetreten</h3>
      <button onclick="window.location.hash='#/watchlist'; window.location.reload();" class="btn btn-primary" style="margin: 0 auto;">
        Zur Watchlist zurückkehren
      </button>
    `;
    app.appendChild(viewEl);
  }

  if (viewEl) {
    safeAnimate(viewEl, { opacity: [0, 1], y: [15, 0] }, { duration: 0.28, ease: "easeOut" });
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
    <div style="margin-top: 16px; text-align: center;">
      <button id="btn-reset-session" style="
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 0.78rem;
        cursor: pointer;
        text-decoration: underline;
        opacity: 0.7;
      ">Browser-Cache & Login-Session zurücksetzen</button>
    </div>
  `;
  container.appendChild(div);

  div.querySelector('#btn-reset-session').addEventListener('click', () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
    window.location.reload();
  });

  div.querySelector('#btn-login').addEventListener('click', async () => {
    try {
      // Clear leftover auth tokens before initiating Google login
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && (key.includes('supabase') || key.includes('auth-token'))) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {}

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            prompt: 'select_account'
          }
        }
      });
      if (error) throw error;
    } catch (err) {
      console.warn('Google login error, performing direct OAuth redirect fallback:', err);
      const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.origin)}`;
      window.location.href = authUrl;
    }
  });
  return div;
}

function showLogoutModal() {
  const modal = document.createElement('div');
  modal.className = 'custom-modal-overlay';
  modal.innerHTML = `
    <div class="custom-modal">
      <h3 style="margin-top: 0; color: #ffffff; font-size: 1.1rem; font-weight: 600;">Abmelden</h3>
      <p style="color: var(--text-secondary); font-size: 0.875rem; line-height: 1.5; margin: 4px 0 16px 0;">
        Möchtest du dich abmelden oder den Google-Account wechseln?
      </p>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button id="modal-btn-switch" class="btn btn-primary">Google-Account wechseln</button>
        <button id="modal-btn-logout" class="btn btn-destructive">Ausloggen</button>
        <button id="modal-btn-cancel" class="btn btn-secondary">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close animation helper
  const closeModal = () => {
    try {
      safeAnimate(modal, { opacity: [1, 0] }, { duration: 0.2 });
    } catch (e) {}
    setTimeout(() => modal.remove(), 200);
  };

  // Animate in
  safeAnimate(modal, { opacity: [0, 1] }, { duration: 0.2 });
  safeAnimate(modal.querySelector('.custom-modal'), { transform: ['scale(0.95)', 'scale(1)'] }, { duration: 0.2, ease: "easeOut" });

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
  // Always derive activeDashboardTab from URL hash
  const currentHash = window.location.hash.slice(1) || '/watchlist';
  if (currentHash.includes('collection')) {
    activeDashboardTab = 'collection';
  } else if (currentHash.includes('analytics')) {
    activeDashboardTab = 'analytics';
  } else if (currentHash.includes('bulk-scan')) {
    activeDashboardTab = 'bulk-scan';
  } else if (currentHash.includes('stream-overlay')) {
    activeDashboardTab = 'stream-overlay';
  } else {
    activeDashboardTab = 'watchlist';
  }

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
      <input type="text" id="inp-search" class="search-input" placeholder="Kartennummer oder Name suchen..." autocomplete="off" value="${activeSearchQuery}">
      <button id="btn-search-submit" class="btn-search-submit" title="Suchen">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span>Suchen</span>
      </button>
    </div>
    <div id="search-results" class="search-results-overlay" style="display: none;"></div>
  `;
  wrapper.appendChild(searchSection);

  const inpSearch = searchSection.querySelector('#inp-search');
  const btnSearchSubmit = searchSection.querySelector('#btn-search-submit');
  const divResults = searchSection.querySelector('#search-results');

  const executeSearch = () => {
    clearTimeout(searchTimeout);
    divResults.style.display = 'none';
    activeSearchQuery = inpSearch.value.trim();
    renderActiveTab();
  };

  inpSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeSearch();
    }
  });

  btnSearchSubmit.addEventListener('click', () => {
    executeSearch();
  });

  // Handle Search Input Typing
  let searchTimeout = null;
  inpSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = inpSearch.value.trim();

    if (query === '') {
      divResults.style.display = 'none';
      if (activeSearchQuery !== '') {
        activeSearchQuery = '';
        renderActiveTab();
      }
      return;
    }

    searchTimeout = setTimeout(async () => {
      divResults.style.display = 'block';
      divResults.innerHTML = `
        <div class="spinner-box" style="min-height: 120px; padding: 20px;">
          <div class="spinner"></div>
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
        try {
          const cids = uniqueCards.map(c => c.card_id);
          if (cids.length > 0) {
            const encodedCardIds = cids.map(id => encodeURIComponent(id)).join(',');
            const { data: imgData } = await supabase
              .from('card_images')
              .select('card_id, image_url')
              .or(`card_id.in.(${encodedCardIds})`);

            if (imgData && imgData.length > 0) {
              const imgMap = {};
              for (const item of imgData) {
                imgMap[item.card_id] = item.image_url;
              }
              for (const card of uniqueCards) {
                if (imgMap[card.card_id]) {
                  card.imageUrl = imgMap[card.card_id];
                }
              }
            }
          }
        } catch (e) {}

        if (uniqueCards.length === 0) {
          divResults.innerHTML = `
            <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
              Keine Karten gefunden für "${query}"
            </div>
          `;
          return;
        }

        divResults.innerHTML = `
          <div class="search-results-list">
            ${uniqueCards.map(c => `
              <div class="search-result-item" data-card-id="${c.card_id}" data-tcg="${c.tcg}">
                <div class="search-result-img">
                  ${c.imageUrl ? `<img src="${c.imageUrl}" alt="${c.card_id}" loading="lazy">` : `<div class="search-result-img-placeholder">TCG</div>`}
                </div>
                <div class="search-result-info">
                  <div class="search-result-title">${c.card_id}</div>
                  <div class="search-result-sub">${c.tcg ? c.tcg.toUpperCase() : ''}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;

        divResults.querySelectorAll('.search-result-item').forEach(el => {
          el.addEventListener('click', () => {
            const cardId = el.dataset.cardId;
            const tcg = el.dataset.tcg;
            divResults.style.display = 'none';
            inpSearch.value = '';
            activeSearchQuery = '';
            navigate(`/detail?card_id=${encodeURIComponent(cardId)}&tcg=${encodeURIComponent(tcg)}`);
          });
        });

      } catch (err) {
        console.error('Quick search error:', err);
        divResults.innerHTML = `
          <div style="padding: 16px; text-align: center; color: var(--text-danger); font-size: 0.88rem;">
            Suchfehler: ${err.message}
          </div>
        `;
      }
    }, 300);
  });

  // Hide search overlay on click outside
  document.addEventListener('click', (e) => {
    if (!searchSection.contains(e.target)) {
      divResults.style.display = 'none';
    }
  });

  // Render 3 Landing Buttons for Tab toggles below the search input
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
      <button id="btn-tab-collection" class="cm-landing-btn ${activeDashboardTab === 'collection' ? 'active' : ''}">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 14px; height: 14px;">
          <rect x="3" y="3" width="12" height="12" rx="2" />
          <path d="M9 15v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
        </svg>
        Collection (${collectionCards.length})
      </button>
      <button id="btn-tab-analytics" class="cm-landing-btn ${activeDashboardTab === 'analytics' ? 'active' : ''}">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Analytics
      </button>
      <button id="btn-tab-bulk-scan" class="cm-landing-btn ${activeDashboardTab === 'bulk-scan' ? 'active' : ''}">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 14px; height: 14px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Bulk Scan / CSV
      </button>
      <button id="btn-tab-stream-overlay" class="cm-landing-btn ${activeDashboardTab === 'stream-overlay' ? 'active' : ''}">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 14px; height: 14px;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        Stream Overlay
      </button>
    </div>
  `;
  wrapper.appendChild(buttonsSection);

  // Sub-container for active tab
  const tabContentWrapper = document.createElement('div');
  tabContentWrapper.id = 'dashboard-tab-content';
  wrapper.appendChild(tabContentWrapper);

  const btnWatchlist = buttonsSection.querySelector('#btn-tab-watchlist');
  const btnCollection = buttonsSection.querySelector('#btn-tab-collection');
  const btnAnalytics = buttonsSection.querySelector('#btn-tab-analytics');
  const btnBulkScan = buttonsSection.querySelector('#btn-tab-bulk-scan');
  const btnStreamOverlay = buttonsSection.querySelector('#btn-tab-stream-overlay');

  const renderActiveTab = async () => {
    tabContentWrapper.innerHTML = '';
    if (activeDashboardTab === 'watchlist') {
      renderWatchlistTab(tabContentWrapper);
    } else if (activeDashboardTab === 'collection') {
      renderCollectionTab(tabContentWrapper);
    } else if (activeDashboardTab === 'bulk-scan') {
      renderBulkScanTab(tabContentWrapper);
    } else if (activeDashboardTab === 'stream-overlay') {
      renderStreamOverlayTab(tabContentWrapper);
    } else {
      await renderAnalyticsTab(tabContentWrapper);
    }
  };

  btnWatchlist.addEventListener('click', () => {
    navigate('/watchlist');
  });

  btnCollection.addEventListener('click', () => {
    navigate('/collection');
  });

  btnAnalytics.addEventListener('click', () => {
    navigate('/analytics');
  });

  btnBulkScan.addEventListener('click', () => {
    navigate('/bulk-scan');
  });

  btnStreamOverlay.addEventListener('click', () => {
    navigate('/stream-overlay');
  });

  // Render initial selected tab content
  renderActiveTab();
  return wrapper;
}

// Sub-Tab Watchlist Renderer
function renderWatchlistTab(container) {
  container.innerHTML = '';
  const dashboard = document.createElement('div');
  dashboard.className = 'dashboard-content';
  dashboard.innerHTML = '';
  container.appendChild(dashboard);

  if (markedCards.length === 0) {
    if (isBackgroundFetching) {
      dashboard.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
          ${Array(3).fill().map(() => `
            <div class="skeleton-item glass-panel" style="display: flex; align-items: center; padding: 12px 14px; gap: 16px; min-height: 116px; opacity: 0.6; animation: skeleton-pulse 1.5s infinite ease-in-out;">
              <div style="width: 66px; height: 92px; background: rgba(255,255,255,0.06); border-radius: 6px;"></div>
              <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
                <div style="width: 60px; height: 12px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
                <div style="width: 140px; height: 16px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; width: 80px;">
                <div style="width: 60px; height: 16px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
                <div style="width: 45px; height: 18px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      dashboard.innerHTML += `
        <div class="empty-state glass-panel">
          <svg class="empty-state-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.377.728-.377.879 0l2.09 5.011 5.4 1.018a.5.5 0 01.29.839l-3.834 3.738 1.05 5.378a.5.5 0 01-.707.567L12 17.766l-4.664 2.483a.5.5 0 01-.707-.567l1.05-5.378-3.834-3.738a.5.5 0 01.29-.839l5.4-1.018 2.09-5.011z" />
          </svg>
          <p>Deine Watchlist ist leer. Scanne eine Karte mit dem Addon und markiere sie mit dem Stern.</p>
        </div>
      `;
    }
    return;
  }

  // Filter & sort cards using active filters and sort choice
  const sortedCards = getSortedWatchlistCards();

  // Watchlist Header & Sync All Actions & Sorting Controls
  const headerSection = document.createElement('div');
  headerSection.className = 'watchlist-header-actions';
  headerSection.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; width: 100%; padding: 0 4px;';
  headerSection.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 12px; flex-wrap: wrap;">
      <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);">Watchlist (${sortedCards.length}${activeSearchQuery ? ` von ${markedCards.length}` : ''})</span>
      <div id="watchlist-sync-actions-container" style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;"></div>
    </div>
    
    <div class="watchlist-filter-row" style="display: flex; justify-content: flex-start; align-items: center; gap: 12px; width: 100%; flex-wrap: wrap;">
      <div class="watchlist-sort-container">
        <svg style="width: 14px; height: 14px; color: var(--text-muted);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
        <select id="select-watchlist-sort" class="watchlist-sort-select">
          <option value="custom" ${activeSortOption === 'custom' ? 'selected' : ''}>Eigene Reihenfolge</option>
          <option value="no-image" ${activeSortOption === 'no-image' ? 'selected' : ''}>Ohne Bild zuerst</option>
          <option value="date-desc" ${activeSortOption === 'date-desc' ? 'selected' : ''}>Zuletzt hinzugefügt</option>
          <option value="price-asc" ${activeSortOption === 'price-asc' ? 'selected' : ''}>Preis: Aufsteigend</option>
          <option value="price-desc" ${activeSortOption === 'price-desc' ? 'selected' : ''}>Preis: Absteigend</option>
          <option value="diff-desc" ${activeSortOption === 'diff-desc' ? 'selected' : ''}>Gewinn: Meiste %</option>
          <option value="diff-asc" ${activeSortOption === 'diff-asc' ? 'selected' : ''}>Verlust: Meiste %</option>
        </select>
      </div>

      <div class="watchlist-sort-container">
        <svg style="width: 14px; height: 14px; color: var(--text-muted);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v8M8 12h8" />
        </svg>
        <select id="select-watchlist-tcg" class="watchlist-sort-select">
          <option value="all" ${activeTcgFilter === 'all' ? 'selected' : ''}>Alle TCGs</option>
          <option value="OnePiece" ${activeTcgFilter === 'OnePiece' ? 'selected' : ''}>One Piece</option>
          <option value="Pokemon" ${activeTcgFilter === 'Pokemon' ? 'selected' : ''}>Pokémon</option>
          <option value="Riftbound" ${activeTcgFilter === 'Riftbound' ? 'selected' : ''}>Riftbound</option>
          <option value="DragonBall" ${activeTcgFilter === 'DragonBall' ? 'selected' : ''}>Dragon Ball</option>
        </select>
      </div>
    </div>
  `;
  dashboard.appendChild(headerSection);

  if (sortedCards.length === 0) {
    const emptySearchEl = document.createElement('div');
    emptySearchEl.className = 'empty-state glass-panel';
    emptySearchEl.style.cssText = 'padding: 32px 16px; margin-top: 12px; text-align: center;';
    emptySearchEl.innerHTML = `
      <svg class="empty-state-icon" style="width: 32px; height: 32px; margin: 0 auto;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <p style="font-size: 0.85rem; margin-top: 8px;">Keine markierten Karten für "${activeSearchQuery}" auf deiner Watchlist gefunden.</p>
      <button id="btn-reset-watchlist-search" style="margin-top: 12px; background: rgba(255,255,255,0.08); border: 1px solid var(--border-glass); color: #fff; padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; cursor: pointer;">Suche zurücksetzen</button>
    `;
    dashboard.appendChild(emptySearchEl);
    emptySearchEl.querySelector('#btn-reset-watchlist-search').addEventListener('click', () => {
      activeSearchQuery = '';
      const inpSearch = document.querySelector('#inp-search');
      if (inpSearch) inpSearch.value = '';
      container.innerHTML = '';
      renderWatchlistTab(container);
    });
    return;
  }

  const watchlistSyncContainer = headerSection.querySelector('#watchlist-sync-actions-container');
  initBatchSyncContainer(
    watchlistSyncContainer,
    sortedCards.length,
    () => sortedCards.map(c => `https://www.cardmarket.com${c.card_id.startsWith('/') ? c.card_id : '/' + c.card_id}`),
    () => watchlistSyncOffset,
    (val) => { watchlistSyncOffset = val; }
  );

  const selectSort = headerSection.querySelector('#select-watchlist-sort');
  const selectTcg = headerSection.querySelector('#select-watchlist-tcg');

  selectSort.addEventListener('change', () => {
    activeSortOption = selectSort.value;
    watchlistSyncOffset = 0;
    try {
      localStorage.setItem('watchlist_sort_option', activeSortOption);
    } catch (e) {}
    container.innerHTML = '';
    renderWatchlistTab(container);
  });

  selectTcg.addEventListener('change', () => {
    activeTcgFilter = selectTcg.value;
    watchlistSyncOffset = 0;
    container.innerHTML = '';
    renderWatchlistTab(container);
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
    const isCollected = collectionCards.some(c => c.card_id === card.card_id);
    
    const desktopDeleteBtnHtml = isMobileDevice ? '' : `
      <button class="watchlist-item-desktop-delete" title="Vom Merkzettel entfernen">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="16" height="16">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;

    const desktopCollectBtnHtml = isMobileDevice ? '' : `
      <button class="watchlist-item-desktop-collect ${isCollected ? 'collected' : ''}" title="${isCollected ? 'Aus Sammlung entfernen' : 'Zu Sammlung hinzufügen'}" style="color: ${isCollected ? '#34d399' : 'rgba(255, 255, 255, 0.6)'};">
        ${isCollected ? `
          <svg fill="none" stroke="#34d399" stroke-width="3" viewBox="0 0 24 24" width="16" height="16" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ` : `
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="16" height="16">
            <rect x="3" y="3" width="12" height="12" rx="2" />
            <path d="M9 15v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
          </svg>
        `}
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

    const titleInfo = splitCardTitle(card.card_id);

    wrapper.innerHTML = `
      <div class="watchlist-item-swipe-bg">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="20" height="20">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span>Löschen</span>
      </div>
      <div class="watchlist-item glass-panel" data-card-id="${card.id}" data-card-uuid="${card.card_id}">
        <div class="watchlist-item-img-container">
          <img class="watchlist-item-img" src="${getProxiedImageUrl(card.image_url)}" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" onerror="handleCardImageError(this)">
          ${desktopCollectBtnHtml}
          ${desktopDeleteBtnHtml}
        </div>
        <div class="watchlist-item-info">
          <span class="watchlist-item-tcg">${card.tcg}</span>
          <span class="watchlist-item-name">${titleInfo.name}</span>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
            ${titleInfo.setName ? `<span style="font-size: 0.72rem; color: #a1a1aa;">📁 ${titleInfo.setName}</span>` : ''}
            ${titleInfo.number ? `<span class="watchlist-item-number" style="margin: 0;">${titleInfo.number}</span>` : ''}
            ${titleInfo.variant ? `<span style="font-size: 0.68rem; font-weight: 700; color: #d8b4fe; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); padding: 1px 6px; border-radius: 4px;">✨ ${titleInfo.variant}</span>` : ''}
          </div>
        </div>
        <div class="watchlist-item-price-col">
          <span class="watchlist-item-price" id="price-${card.id}">${priceText}</span>
          <span class="diff-badge ${diffClass}" id="diff-${card.id}">${diffText}</span>
          <a href="${getTCGPlayerSearchUrl(titleInfo, card)}" target="_blank" rel="noopener noreferrer" class="tcgplayer-link-chip" style="font-size: 0.68rem; color: #60a5fa; margin-top: 2px; text-decoration: none; display: inline-flex; align-items: center; gap: 2px; font-weight: 600;" title="Auf TCGPlayer ansehen" onclick="event.stopPropagation();">
            TCGP ↗
          </a>
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
      loadCardDetails(card.card_id, card.tcg, true, card.image_url);
    });

    // Lightbox image trigger
    const imgEl = cardEl.querySelector('.watchlist-item-img');
    if (imgEl) {
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid triggering details card navigation
        showLightbox(card.image_url || '/logo.png');
      });
    }

    // Bind desktop '+' collect button click
    const desktopCollectBtn = cardEl.querySelector('.watchlist-item-desktop-collect');
    if (desktopCollectBtn) {
      desktopCollectBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Avoid triggering details card navigation
        desktopCollectBtn.disabled = true;
        try {
          if (isCollected) {
            const { error } = await supabase
              .from('collection_cards')
              .delete()
              .eq('user_id', currentUser.id)
              .eq('card_id', card.card_id);
            if (error) throw error;
            showToast('Karte aus Collection entfernt!');
          } else {
            const collectData = {
              user_id: currentUser.id,
              tcg: card.tcg,
              card_id: card.card_id,
              image_url: card.image_url
            };
            const { error } = await supabase
              .from('collection_cards')
              .insert(collectData);
            if (error) throw error;
            showToast('Karte zur Collection hinzugefügt!');
          }
          await fetchCollectionCards(); // Refresh collection list
          container.innerHTML = '';
          renderWatchlistTab(container); // Refresh watchlist view to update collect checkmark state
        } catch (err) {
          alert('Fehler beim Aktualisieren der Collection: ' + err.message);
        } finally {
          desktopCollectBtn.disabled = false;
        }
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

// Render collection cumulative value line graph using Chart.js
function drawCollectionChart(chartContainer, historyData) {
  if (!historyData || historyData.length < 2) {
    chartContainer.innerHTML = `
      <div class="chart-header" style="margin-bottom: 4px;">
        <span class="chart-title" style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">Sammlungswert-Verlauf</span>
      </div>
      <p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 16px 0;">Sammle mehr historische Preisdaten, um den Verlaufsgraphen anzuzeigen.</p>
    `;
    return;
  }

  const sortedHistory = [...historyData].sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at));
  const labels = sortedHistory.map(h => new Date(h.scanned_at).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  }));
  const values = sortedHistory.map(h => h.value);

  chartContainer.innerHTML = `
    <div class="chart-header" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <span class="chart-title" style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">Sammlungswert-Verlauf</span>
    </div>
    <div class="chart-canvas-container">
      <canvas id="collectionValueChart"></canvas>
    </div>
  `;

  const canvas = chartContainer.querySelector('#collectionValueChart');
  const ctx = canvas.getContext('2d');

  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, 180);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Wert',
        data: values,
        borderColor: '#ffffff',
        borderWidth: 2,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointRadius: values.length < 15 ? 3 : 0,
        pointHoverRadius: 5,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#09090b',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#18181b',
          titleColor: '#a1a1aa',
          bodyColor: '#ffffff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 8,
          bodyFont: {
            family: '-apple-system, BlinkMacSystemFont, sans-serif',
            size: 11,
            weight: '600'
          },
          titleFont: {
            family: '-apple-system, BlinkMacSystemFont, sans-serif',
            size: 9
          },
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                label += context.parsed.y.toFixed(2) + ' €';
              }
              return label;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.4)',
            font: {
              size: 9,
              family: '-apple-system, BlinkMacSystemFont, sans-serif'
            },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
            drawTicks: false
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.4)',
            font: {
              size: 9,
              family: '-apple-system, BlinkMacSystemFont, sans-serif'
            },
            padding: 8,
            callback: function(value) {
              return value.toFixed(0) + ' €';
            }
          }
        }
      }
    }
  });
}

// Sub-Tab Collection Renderer
function renderCollectionTab(container) {
  container.innerHTML = '';
  const dashboard = document.createElement('div');
  dashboard.className = 'dashboard-content';
  dashboard.innerHTML = '';
  container.appendChild(dashboard);

  if (collectionCards.length === 0) {
    if (isBackgroundFetching) {
      dashboard.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
          ${Array(3).fill().map(() => `
            <div class="skeleton-item glass-panel" style="display: flex; align-items: center; padding: 12px 14px; gap: 16px; min-height: 116px; opacity: 0.6; animation: skeleton-pulse 1.5s infinite ease-in-out;">
              <div style="width: 66px; height: 92px; background: rgba(255,255,255,0.06); border-radius: 6px;"></div>
              <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
                <div style="width: 60px; height: 12px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
                <div style="width: 140px; height: 16px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; width: 80px;">
                <div style="width: 60px; height: 16px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
                <div style="width: 45px; height: 18px; background: rgba(255,255,255,0.06); border-radius: 4px;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      dashboard.innerHTML += `
        <div class="empty-state glass-panel">
          <svg class="empty-state-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="width: 32px; height: 32px; stroke: var(--text-muted); margin: 0 auto 12px auto;">
            <rect x="3" y="3" width="12" height="12" rx="2" />
            <path d="M9 15v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
          </svg>
          <p>Deine Collection ist leer. Scanne eine Karte mit der Erweiterung und füge sie mit dem Collection-Symbol zu deiner Sammlung hinzu.</p>
        </div>
      `;
    }
    return;
  }

  // Filter & sort collection cards using active filters and sort choice
  const sortedCards = getSortedCollectionCards();

  // Calculate total collection value
  const totalValue = sortedCards.reduce((sum, card) => sum + (card.latest_price || 0), 0);
  const totalCost = sortedCards.reduce((sum, card) => {
    const buyPrice = card.purchase_price !== null && card.purchase_price !== undefined ? parseFloat(card.purchase_price) : (card.baseline_price || 0);
    return sum + buyPrice;
  }, 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  // Display Summary Container (Current Value & Profit/Loss)
  const summaryContainer = document.createElement('div');
  summaryContainer.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;';
  
  const profitColor = totalProfit >= 0 ? '#34d399' : '#f87171';
  const profitSign = totalProfit >= 0 ? '+' : '';
  
  summaryContainer.innerHTML = `
    <div class="collection-value-card glass-panel" style="padding: 16px; text-align: center; border-radius: 12px;">
      <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Wert Sammlung</span>
      <h2 style="font-size: 1.6rem; font-weight: 800; color: #34d399; margin: 4px 0 0 0; text-shadow: 0 0 10px rgba(52, 211, 153, 0.2);">${totalValue.toFixed(2)} €</h2>
    </div>
    <div class="collection-value-card glass-panel" style="padding: 16px; text-align: center; border-radius: 12px; border: 1.5px solid ${totalProfit >= 0 ? '#10b981' : '#f43f5e'};">
      <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">Gewinn / Verlust</span>
      <h2 style="font-size: 1.6rem; font-weight: 800; color: ${profitColor}; margin: 4px 0 0 0;">
        ${profitSign}${totalProfit.toFixed(2)} € 
        <span style="font-size: 0.85rem; font-weight: 600;">(${profitSign}${totalProfitPercent.toFixed(2)}%)</span>
      </h2>
    </div>
  `;
  dashboard.appendChild(summaryContainer);

  // Render Collection Chart Container
  const chartCard = document.createElement('div');
  chartCard.className = 'glass-panel';
  chartCard.style.cssText = 'padding: 16px; margin-bottom: 20px; border-radius: 12px;';
  dashboard.appendChild(chartCard);
  drawCollectionChart(chartCard, collectionValueHistory);

  // Header & Controls
  const headerSection = document.createElement('div');
  headerSection.className = 'watchlist-header-actions';
  headerSection.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; width: 100%; padding: 0 4px;';
  headerSection.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 12px; flex-wrap: wrap;">
      <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);">Sammlung (${sortedCards.length}${activeSearchQuery || activeTcgFilter !== 'all' ? ` von ${collectionCards.length}` : ''})</span>
      <div id="collection-sync-actions-container" style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;"></div>
    </div>
    
    <div class="watchlist-filter-row" style="display: flex; justify-content: flex-start; align-items: center; gap: 12px; width: 100%; flex-wrap: wrap;">
      <div class="watchlist-sort-container">
        <svg style="width: 14px; height: 14px; color: var(--text-muted);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
        <select id="select-collection-sort" class="watchlist-sort-select">
          <option value="custom" ${activeSortOption === 'custom' ? 'selected' : ''}>Eigene Reihenfolge</option>
          <option value="no-image" ${activeSortOption === 'no-image' ? 'selected' : ''}>Ohne Bild zuerst</option>
          <option value="date-desc" ${activeSortOption === 'date-desc' ? 'selected' : ''}>Zuletzt hinzugefügt</option>
          <option value="price-asc" ${activeSortOption === 'price-asc' ? 'selected' : ''}>Preis: Aufsteigend</option>
          <option value="price-desc" ${activeSortOption === 'price-desc' ? 'selected' : ''}>Preis: Absteigend</option>
          <option value="diff-desc" ${activeSortOption === 'diff-desc' ? 'selected' : ''}>Gewinn: Meiste %</option>
          <option value="diff-asc" ${activeSortOption === 'diff-asc' ? 'selected' : ''}>Verlust: Meiste %</option>
        </select>
      </div>

      <div class="watchlist-sort-container">
        <svg style="width: 14px; height: 14px; color: var(--text-muted);" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v8M8 12h8" />
        </svg>
        <select id="select-collection-tcg" class="watchlist-sort-select">
          <option value="all" ${activeTcgFilter === 'all' ? 'selected' : ''}>Alle TCGs</option>
          <option value="OnePiece" ${activeTcgFilter === 'OnePiece' ? 'selected' : ''}>One Piece</option>
          <option value="Pokemon" ${activeTcgFilter === 'Pokemon' ? 'selected' : ''}>Pokémon</option>
          <option value="Riftbound" ${activeTcgFilter === 'Riftbound' ? 'selected' : ''}>Riftbound</option>
          <option value="DragonBall" ${activeTcgFilter === 'DragonBall' ? 'selected' : ''}>Dragon Ball</option>
        </select>
      </div>
    </div>
  `;
  dashboard.appendChild(headerSection);

  const collectionSyncContainer = headerSection.querySelector('#collection-sync-actions-container');
  initBatchSyncContainer(
    collectionSyncContainer,
    sortedCards.length,
    () => sortedCards.map(card => {
      const cardPath = card.card_id.startsWith('/') ? card.card_id : `/${card.card_id}`;
      return `https://www.cardmarket.com${cardPath}`;
    }),
    () => collectionSyncOffset,
    (val) => { collectionSyncOffset = val; }
  );

  const selectSort = headerSection.querySelector('#select-collection-sort');
  const selectTcg = headerSection.querySelector('#select-collection-tcg');

  selectSort.addEventListener('change', () => {
    activeSortOption = selectSort.value;
    collectionSyncOffset = 0;
    try {
      localStorage.setItem('watchlist_sort_option', activeSortOption);
    } catch (e) {}
    container.innerHTML = '';
    renderCollectionTab(container);
  });

  selectTcg.addEventListener('change', () => {
    activeTcgFilter = selectTcg.value;
    collectionSyncOffset = 0;
    container.innerHTML = '';
    renderCollectionTab(container);
  });

  if (sortedCards.length === 0) {
    const emptySearchEl = document.createElement('div');
    emptySearchEl.className = 'empty-state glass-panel';
    emptySearchEl.style.cssText = 'padding: 32px 16px; margin-top: 12px; text-align: center;';
    emptySearchEl.innerHTML = `
      <svg class="empty-state-icon" style="width: 32px; height: 32px; margin: 0 auto;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <p style="font-size: 0.85rem; margin-top: 8px;">Keine passende Karten in deiner Sammlung gefunden.</p>
      <button id="btn-reset-collection-search" style="margin-top: 12px; background: rgba(255,255,255,0.08); border: 1px solid var(--border-glass); color: #fff; padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; cursor: pointer;">Suche zurücksetzen</button>
    `;
    dashboard.appendChild(emptySearchEl);
    emptySearchEl.querySelector('#btn-reset-collection-search').addEventListener('click', () => {
      activeSearchQuery = '';
      activeTcgFilter = 'all';
      const inpSearch = document.querySelector('#inp-search');
      if (inpSearch) inpSearch.value = '';
      container.innerHTML = '';
      renderCollectionTab(container);
    });
    return;
  }

  const list = document.createElement('div');
  list.className = 'watchlist-list';
  dashboard.appendChild(list);

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

  function saveCollectionOrder() {
    const newOrder = Array.from(list.querySelectorAll('.watchlist-item-wrapper')).map(el => {
      const cardEl = el.querySelector('.watchlist-item');
      return cardEl.dataset.cardUuid;
    });
    const orderKey = `collection_order_${currentUser.id}`;
    try {
      localStorage.setItem(orderKey, JSON.stringify(newOrder));
    } catch (e) {}
    collectionCards.sort((a, b) => {
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
      <button class="watchlist-item-desktop-delete" title="Aus Sammlung entfernen">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="10" height="10">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;

    const priceText = card.latest_price !== null && card.latest_price !== undefined ? `${card.latest_price.toFixed(2)} €` : '-- €';
    const buyPrice = (card.purchase_price !== null && card.purchase_price !== undefined) 
      ? parseFloat(card.purchase_price) 
      : ((card.buy_price !== null && card.buy_price !== undefined) ? parseFloat(card.buy_price) : null);
    const basePrice = buyPrice !== null ? buyPrice : (card.baseline_price || 0);
    const latestPrice = card.latest_price || 0;
    
    let diffText = '...';
    let diffClass = '';
    
    const profit = latestPrice - basePrice;
    const profitPercent = basePrice > 0 ? (profit / basePrice) * 100 : 0;

    if (latestPrice > 0 && basePrice > 0) {
      if (profit >= 0) {
        diffText = `+${profitPercent.toFixed(2)}%`;
        diffClass = 'gain';
      } else {
        diffText = `${profitPercent.toFixed(2)}%`;
        diffClass = 'loss';
      }
    } else {
      diffText = '0.00%';
      diffClass = 'stable';
    }

    const titleInfo = splitCardTitle(card.card_id);

    wrapper.innerHTML = `
      <div class="watchlist-item-swipe-bg">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="20" height="20">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        <span>Entfernen</span>
      </div>
      <div class="watchlist-item glass-panel" data-card-id="${card.id}" data-card-uuid="${card.card_id}">
        <div class="watchlist-item-img-container">
          <img class="watchlist-item-img" src="${getProxiedImageUrl(card.image_url)}" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" onerror="handleCardImageError(this)">
          ${desktopDeleteBtnHtml}
        </div>
        <div class="watchlist-item-info">
          <span class="watchlist-item-tcg">${card.tcg}</span>
          <span class="watchlist-item-name">${titleInfo.name}</span>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
            ${titleInfo.setName ? `<span style="font-size: 0.72rem; color: #a1a1aa;">📁 ${titleInfo.setName}</span>` : ''}
            ${titleInfo.number ? `<span class="watchlist-item-number" style="margin: 0;">${titleInfo.number}</span>` : ''}
            ${titleInfo.variant ? `<span style="font-size: 0.68rem; font-weight: 700; color: #d8b4fe; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); padding: 1px 6px; border-radius: 4px;">✨ ${titleInfo.variant}</span>` : ''}
          </div>
          <span class="collection-item-purchase-price" style="font-size: 0.72rem; color: var(--primary); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; font-weight: 500; text-decoration: underline;" data-action="set-purchase-price">
            <svg style="width: 10px; height: 10px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </svg>
            EK: ${buyPrice !== null ? `${buyPrice.toFixed(2)} €` : '-- €'}
          </span>
        </div>
        <div class="watchlist-item-price-col">
          <span class="watchlist-item-price" id="collection-price-${card.id}">${priceText}</span>
          <span class="diff-badge ${diffClass}" id="collection-diff-${card.id}">${diffText}</span>
          <a href="${getTCGPlayerSearchUrl(titleInfo, card)}" target="_blank" rel="noopener noreferrer" class="tcgplayer-link-chip" style="font-size: 0.68rem; color: #60a5fa; margin-top: 2px; text-decoration: none; display: inline-flex; align-items: center; gap: 2px; font-weight: 600;" title="Auf TCGPlayer ansehen" onclick="event.stopPropagation();">
            TCGP ↗
          </a>
        </div>
      </div>
    `;
    list.appendChild(wrapper);

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
      saveCollectionOrder();
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
            if (confirm(`Möchtest du "${cleanCardName(card.card_id)}" wirklich aus deiner Sammlung entfernen?`)) {
              try {
                const { error } = await supabase
                  .from('collection_cards')
                  .delete()
                  .eq('user_id', currentUser.id)
                  .eq('card_id', card.card_id);

                if (error) throw error;
                await fetchCollectionCards();
                container.innerHTML = '';
                renderCollectionTab(container);
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
          saveCollectionOrder();
        }
        touchDraggedItem = null;
      }
      currentX = 0;
      isSwiping = false;
      isSorting = false;
    };

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

    const setPurchaseBtn = cardEl.querySelector('[data-action="set-purchase-price"]');
    if (setPurchaseBtn) {
      setPurchaseBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentVal = card.purchase_price !== null && card.purchase_price !== undefined ? card.purchase_price : '';
        const newPriceStr = prompt(`Gib deinen Einkaufspreis (EK) für "${cleanCardName(card.card_id)}" ein (€) (leer lassen zum Zurücksetzen):`, currentVal);
        if (newPriceStr === null) return; // Cancel
        
        let valToSet = null;
        if (newPriceStr.trim() !== '') {
          const parsed = parseFloat(newPriceStr.trim().replace(',', '.'));
          if (isNaN(parsed) || parsed < 0) {
            alert('Bitte gib eine gültige positive Zahl ein.');
            return;
          }
          valToSet = parsed;
        }

        try {
          const { error } = await supabase
            .from('collection_cards')
            .update({ purchase_price: valToSet })
            .eq('user_id', currentUser.id)
            .eq('card_id', card.card_id);

          if (error) throw error;

          // Fetch latest data and fully refresh the collection view
          await fetchCollectionCards();
          container.innerHTML = '';
          renderCollectionTab(container);
        } catch (err) {
          alert('Fehler beim Aktualisieren des Einkaufspreises: ' + err.message);
        }
      });
    }

    cardEl.addEventListener('click', () => {
      if (hasMoved) {
        hasMoved = false;
        return;
      }
      loadCardDetails(card.card_id, card.tcg, true, card.image_url);
    });

    const imgEl = cardEl.querySelector('.watchlist-item-img');
    if (imgEl) {
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation();
        showLightbox(card.image_url || '/logo.png');
      });
    }

    const desktopDeleteBtn = cardEl.querySelector('.watchlist-item-desktop-delete');
    if (desktopDeleteBtn) {
      desktopDeleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Möchtest du "${cleanCardName(card.card_id)}" wirklich aus deiner Sammlung entfernen?`)) {
          try {
            desktopDeleteBtn.disabled = true;
            const { error } = await supabase
              .from('collection_cards')
              .delete()
              .eq('user_id', currentUser.id)
              .eq('card_id', card.card_id);

            if (error) throw error;
            await fetchCollectionCards();
            container.innerHTML = '';
            renderCollectionTab(container);
          } catch (err) {
            alert("Fehler beim Entfernen: " + err.message);
            desktopDeleteBtn.disabled = false;
          }
        }
      });
    }
  }
}

// Reusable Multi-Select Dropdown Component for Analytics Filters
function createMultiSelectDropdown({ label, options, selectedValues, onChange }) {
  const container = document.createElement('div');
  container.className = 'analytics-multiselect';
  container.style.cssText = 'position: relative; display: inline-block;';

  const updateTriggerText = () => {
    if (selectedValues.length === 0 || selectedValues.includes('ALL')) {
      return `Alle ${label}`;
    }
    if (selectedValues.length === 1) {
      const opt = options.find(o => o.value === selectedValues[0]);
      return `${label}: ${opt ? opt.short || opt.label : selectedValues[0]}`;
    }
    return `${label}: ${selectedValues.length} ausgewählt`;
  };

  const btn = document.createElement('button');
  btn.className = 'watchlist-sort-select';
  btn.style.cssText = 'padding: 6px 12px; font-size: 0.78rem; border-radius: 8px; background: rgba(255,255,255,0.06); color: #fff; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 1px solid var(--border-glass); font-weight: 500; min-height: 32px;';
  btn.innerHTML = `<span>${updateTriggerText()}</span> <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`;

  const popover = document.createElement('div');
  popover.className = 'glass-panel';
  popover.style.cssText = 'display: none; position: absolute; top: calc(100% + 4px); left: 0; z-index: 1000; min-width: 200px; max-height: 260px; overflow-y: auto; padding: 8px; border-radius: 10px; background: rgba(20, 24, 33, 0.96); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 10px 30px rgba(0,0,0,0.6);';

  for (const opt of options) {
    const labelEl = document.createElement('label');
    labelEl.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px 8px; font-size: 0.78rem; cursor: pointer; color: #e2e8f0; border-radius: 6px; transition: background 0.15s; user-select: none; margin-bottom: 2px;';
    labelEl.addEventListener('mouseenter', () => labelEl.style.background = 'rgba(255,255,255,0.08)');
    labelEl.addEventListener('mouseleave', () => labelEl.style.background = 'transparent');

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.value = opt.value;
    chk.checked = selectedValues.includes(opt.value);
    chk.style.cssText = 'accent-color: #60a5fa; cursor: pointer; width: 14px; height: 14px;';

    chk.addEventListener('change', () => {
      if (opt.value === 'ALL') {
        if (chk.checked) {
          selectedValues.length = 0;
          selectedValues.push('ALL');
        } else {
          selectedValues.length = 0;
        }
      } else {
        const allIdx = selectedValues.indexOf('ALL');
        if (allIdx !== -1) selectedValues.splice(allIdx, 1);

        if (chk.checked) {
          if (!selectedValues.includes(opt.value)) selectedValues.push(opt.value);
        } else {
          const idx = selectedValues.indexOf(opt.value);
          if (idx !== -1) selectedValues.splice(idx, 1);
        }

        if (selectedValues.length === 0) {
          selectedValues.push('ALL');
        }
      }

      // Sync all checkbox states in popover
      const allChks = popover.querySelectorAll('input[type="checkbox"]');
      allChks.forEach(c => {
        if (c.value === 'ALL') {
          c.checked = selectedValues.includes('ALL') || selectedValues.length === 0;
        } else {
          c.checked = selectedValues.includes(c.value);
        }
      });

      btn.querySelector('span').textContent = updateTriggerText();
      onChange(selectedValues);
    });

    labelEl.appendChild(chk);
    labelEl.appendChild(document.createTextNode(opt.label));
    popover.appendChild(labelEl);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = popover.style.display === 'block';
    document.querySelectorAll('.analytics-multiselect .glass-panel').forEach(p => p.style.display = 'none');
    popover.style.display = isVisible ? 'none' : 'block';
  });

  document.addEventListener('click', () => {
    popover.style.display = 'none';
  });

  popover.addEventListener('click', (e) => e.stopPropagation());

  container.appendChild(btn);
  container.appendChild(popover);
  return container;
}

// Sub-Tab Analytics & Search History Renderer
async function renderAnalyticsTab(container) {
  const dashboard = document.createElement('div');
  dashboard.className = 'dashboard-content analytics-tab-view';
  dashboard.innerHTML = '';
  container.appendChild(dashboard);

  // Render Filter Bar for Condition, Language, Seller Location, TCG (Multi-Select)
  const filterBar = document.createElement('div');
  filterBar.className = 'glass-panel';
  filterBar.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 14px; margin-bottom: 16px; border-radius: 12px; z-index: 50; position: relative;';
  filterBar.innerHTML = `<div id="analytics-filter-controls" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; width: 100%;"></div>`;
  dashboard.appendChild(filterBar);

  const controlsContainer = filterBar.querySelector('#analytics-filter-controls');

  const onFilterChange = () => {
    container.innerHTML = '';
    renderAnalyticsTab(container);
  };

  // 1. TCG Multi-Select
  const tcgDropdown = createMultiSelectDropdown({
    label: 'TCGs',
    options: [
      { value: 'ALL', label: 'Alle TCGs' },
      { value: 'Pokemon', label: 'Pokémon' },
      { value: 'OnePiece', label: 'One Piece' }
    ],
    selectedValues: analyticsSelectedTCGs,
    onChange: onFilterChange
  });
  controlsContainer.appendChild(tcgDropdown);

  // 2. Condition Multi-Select
  const condDropdown = createMultiSelectDropdown({
    label: 'Zustände',
    options: [
      { value: 'ALL', label: 'Alle Zustände' },
      { value: 'NM', label: 'Near Mint (NM)', short: 'NM' },
      { value: 'EX', label: 'Excellent (EX)', short: 'EX' },
      { value: 'GD', label: 'Good (GD)', short: 'GD' },
      { value: 'LP', label: 'Light Played (LP)', short: 'LP' },
      { value: 'PL', label: 'Played (PL)', short: 'PL' },
      { value: 'PO', label: 'Poor (PO)', short: 'PO' }
    ],
    selectedValues: analyticsSelectedConditions,
    onChange: onFilterChange
  });
  controlsContainer.appendChild(condDropdown);

  // 3. Language Multi-Select
  const langDropdown = createMultiSelectDropdown({
    label: 'Sprachen',
    options: [
      { value: 'ALL', label: 'Alle Sprachen' },
      { value: 'DE', label: 'Deutsch (DE)', short: 'DE' },
      { value: 'EN', label: 'Englisch (EN)', short: 'EN' },
      { value: 'JP', label: 'Japanisch (JP)', short: 'JP' },
      { value: 'FR', label: 'Französisch (FR)', short: 'FR' },
      { value: 'ES', label: 'Spanisch (ES)', short: 'ES' },
      { value: 'IT', label: 'Italienisch (IT)', short: 'IT' }
    ],
    selectedValues: analyticsSelectedLanguages,
    onChange: onFilterChange
  });
  controlsContainer.appendChild(langDropdown);

  // 4. Seller Location Multi-Select
  const locDropdown = createMultiSelectDropdown({
    label: 'Standorte',
    options: [
      { value: 'ALL', label: 'Alle Standorte' },
      { value: 'DE', label: 'Deutschland (DE)', short: 'DE' },
      { value: 'EN', label: 'Großbritannien / EU (EN)', short: 'UK/EU' },
      { value: 'AT', label: 'Österreich (AT)', short: 'AT' },
      { value: 'CH', label: 'Schweiz (CH)', short: 'CH' },
      { value: 'NL', label: 'Niederlande (NL)', short: 'NL' },
      { value: 'FR', label: 'Frankreich (FR)', short: 'FR' },
      { value: 'ES', label: 'Spanien (ES)', short: 'ES' },
      { value: 'IT', label: 'Italienisch (IT)', short: 'IT' }
    ],
    selectedValues: analyticsSelectedLocations,
    onChange: onFilterChange
  });
  controlsContainer.appendChild(locDropdown);

  if (activeSearchQuery) {
    const loadingBox = document.createElement('div');
    loadingBox.className = 'spinner-box';
    loadingBox.style.height = '150px';
    loadingBox.innerHTML = '<div class="spinner"></div>';
    dashboard.appendChild(loadingBox);

    try {
      const qClean = activeSearchQuery.replace(/[\/\\%_]/g, '');
      const altQ = activeSearchQuery.replace('/', '-');
      const numMatch = activeSearchQuery.match(/(\d+)/);
      const numOnly = numMatch ? numMatch[1] : '';

      const searchFilter = [
        `card_id.ilike.%${encodeURIComponent(activeSearchQuery)}%`,
        `card_id.ilike.%${encodeURIComponent(altQ)}%`,
        `card_id.ilike.%${encodeURIComponent(qClean)}%`,
        `comment.ilike.%${encodeURIComponent(activeSearchQuery)}%`
      ];

      const parsedComp = parseCardCodeComponents(activeSearchQuery);
      if (parsedComp) {
        if (parsedComp.fullVariantSlug) searchFilter.push(`card_id.ilike.%${encodeURIComponent(parsedComp.fullVariantSlug)}%`);
        if (parsedComp.setCardCode) searchFilter.push(`card_id.ilike.%${encodeURIComponent(parsedComp.setCardCode)}%`);
        if (parsedComp.searchCode) searchFilter.push(`card_id.ilike.%${encodeURIComponent(parsedComp.searchCode)}%`);
      }

      if (numOnly && numOnly.length >= 2) {
        searchFilter.push(`card_id.ilike.%${encodeURIComponent(numOnly)}%`);
      }

      const { data, error } = await supabase
        .from('price_history')
        .select('card_id, tcg, price, comment, scanned_at')
        .or(searchFilter.join(','))
        .order('scanned_at', { ascending: true });

      if (error) throw error;

      loadingBox.remove();

      const uniqueCardsMap = {};
      for (const row of data || []) {
        const item = parseHistoryItem(row);

        // Apply Multi-Select Condition Filter
        if (analyticsSelectedConditions.length > 0 && !analyticsSelectedConditions.includes('ALL')) {
          if (!item.matchedCondition || !analyticsSelectedConditions.includes(item.matchedCondition.toUpperCase())) {
            continue;
          }
        }

        // Apply Multi-Select Language Filter
        if (analyticsSelectedLanguages.length > 0 && !analyticsSelectedLanguages.includes('ALL')) {
          if (!item.matchedLanguage || !analyticsSelectedLanguages.includes(item.matchedLanguage.toUpperCase())) {
            continue;
          }
        }

        // Apply Multi-Select Seller Location Filter
        if (analyticsSelectedLocations.length > 0 && !analyticsSelectedLocations.includes('ALL')) {
          if (!item.matchedCountry || !analyticsSelectedLocations.includes(item.matchedCountry.toUpperCase())) {
            continue;
          }
        }

        if (!uniqueCardsMap[row.card_id]) {
          uniqueCardsMap[row.card_id] = {
            card_id: row.card_id,
            tcg: row.tcg,
            history: []
          };
        }
        uniqueCardsMap[row.card_id].history.push(item);
      }

      let scannedCards = Object.values(uniqueCardsMap).map(c => {
        const history = c.history;
        const latest = history[history.length - 1];
        const baseline = history[0];
        let img = null;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].imageUrl && !isPlaceholderImage(history[i].imageUrl)) {
            img = history[i].imageUrl;
            break;
          }
        }
        return {
          card_id: c.card_id,
          tcg: c.tcg,
          latest_price: latest ? latest.price : null,
          diff_percent: (baseline && latest && baseline.price > 0) ? ((latest.price - baseline.price) / baseline.price) * 100 : 0,
          image_url: img
        };
      });

      // Filter scanned cards by TCG multi-selection if specified
      if (analyticsSelectedTCGs.length > 0 && !analyticsSelectedTCGs.includes('ALL')) {
        scannedCards = scannedCards.filter(c => analyticsSelectedTCGs.includes(c.tcg));
      }

      // Enrich with global custom images
      const cardIdsToLookup = new Set();
      for (const c of scannedCards) {
        if (c.card_id) {
          cardIdsToLookup.add(c.card_id);
          if (c.card_id.startsWith('/')) {
            cardIdsToLookup.add(c.card_id.slice(1));
          } else {
            cardIdsToLookup.add('/' + c.card_id);
          }
        }
      }

      if (cardIdsToLookup.size > 0) {
        try {
          const { data: globalImages, error: globalImagesErr } = await supabase
            .from('card_images')
            .select('card_id, image_url')
            .in('card_id', Array.from(cardIdsToLookup));

          if (!globalImagesErr && globalImages) {
            const imageMap = {};
            for (const img of globalImages) {
              if (img.image_url && !isPlaceholderImage(img.image_url)) {
                imageMap[img.card_id] = img.image_url;
                if (img.card_id.startsWith('/')) {
                  imageMap[img.card_id.slice(1)] = img.image_url;
                } else {
                  imageMap['/' + img.card_id] = img.image_url;
                }
              }
            }
            for (const c of scannedCards) {
              if (imageMap[c.card_id]) {
                c.image_url = imageMap[c.card_id];
              }
            }
          }
        } catch (err) {
          console.error('Error fetching global card images in analytics:', err.message);
        }

        // Strict Set + Number Image Resolution for missing or placeholder images (0% false matching)
        const missingImgCards = scannedCards.filter(c => isPlaceholderImage(c.image_url));
        if (missingImgCards.length > 0) {
          for (const card of missingImgCards) {
            const meta = formatCardMeta(card.card_id, '', '', '', card.tcg);
            const parsed = parseCardCodeComponents(meta.cardCode, meta.nameEn, meta.setNameDe);
            const num = parsed?.cardNum || meta.cardCode.replace(/^[A-Za-z]+[-_\s]*/, '').split('/')[0].replace(/\D/g, '');
            const setSlug = (meta.setNameDe || parsed?.setCode || '').replace(/[-_\s]+/g, '-').trim();

            if (setSlug && num && num.length >= 1 && num.length <= 4) {
              try {
                const { data: matchedImg } = await supabase
                  .from('card_images')
                  .select('image_url')
                  .ilike('card_id', `%${setSlug}%`)
                  .ilike('card_id', `%${num}%`)
                  .limit(5);

                const validMatch = matchedImg?.find(m => m.image_url && !isPlaceholderImage(m.image_url));
                if (validMatch) {
                  card.image_url = validMatch.image_url;
                }
              } catch (err) {}
            }
          }
        }
      }

      // Also search catalog images from card_images so imported cards without price history appear
      try {
        const qClean = activeSearchQuery.replace(/[\/\\%_]/g, '');
        const { data: catalogImages } = await supabase
          .from('card_images')
          .select('card_id, image_url')
          .ilike('card_id', `%${qClean}%`)
          .limit(1000);

        if (catalogImages && catalogImages.length > 0) {
          // Filter out TCG Pocket mobile game cards (image_url or card_id containing /tcgp/)
          let filteredCatalog = catalogImages.filter(item => 
            !item.image_url.includes('/tcgp/') && 
            !item.card_id.includes('/tcgp/') && 
            !item.card_id.includes('PROMO-A') &&
            !isPlaceholderImage(item.image_url)
          );

          if (analyticsSelectedTCGs.length > 0 && !analyticsSelectedTCGs.includes('ALL')) {
            filteredCatalog = filteredCatalog.filter(item => {
              const cardIdLower = item.card_id.toLowerCase();
              const isOnePiece = cardIdLower.includes('onepiece') || cardIdLower.includes('optcg') || /^\/?(OP|ST|EB|PRB|onepiece_)/i.test(item.card_id);
              const itemTcg = isOnePiece ? 'OnePiece' : 'Pokemon';
              return analyticsSelectedTCGs.includes(itemTcg);
            });
          }

          // Deduplicate catalog entries sharing the exact same image_url, preferring full card_id with set name & fraction number
          const imageMapByUrl = new Map();
          for (const item of filteredCatalog) {
            const existing = imageMapByUrl.get(item.image_url);
            if (!existing) {
              imageMapByUrl.set(item.image_url, item);
            } else {
              const curScore = (item.card_id.includes('/') ? 2 : 0) + (/\d+[-/]\d+/.test(item.card_id) ? 3 : 0) + item.card_id.length;
              const oldScore = (existing.card_id.includes('/') ? 2 : 0) + (/\d+[-/]\d+/.test(existing.card_id) ? 3 : 0) + existing.card_id.length;
              if (curScore > oldScore) {
                imageMapByUrl.set(item.image_url, item);
              }
            }
          }

          const existingIds = new Set(scannedCards.map(c => c.card_id));
          for (const item of imageMapByUrl.values()) {
            if (!existingIds.has(item.card_id)) {
              existingIds.add(item.card_id);
              const cardIdLower = item.card_id.toLowerCase();
              const isOnePiece = cardIdLower.includes('onepiece') || cardIdLower.includes('optcg') || /^\/?(OP|ST|EB|PRB|onepiece_)/i.test(item.card_id);

              scannedCards.push({
                card_id: item.card_id,
                tcg: isOnePiece ? 'OnePiece' : 'Pokemon',
                latest_price: null,
                diff_percent: 0,
                image_url: item.image_url
              });
            }
          }
        }
      } catch (err) {}

      if (scannedCards.length === 0) {
        dashboard.innerHTML = `
          <div class="empty-state glass-panel" style="padding: 32px 16px;">
            <svg class="empty-state-icon" style="width: 32px; height: 32px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p style="font-size: 0.85rem; margin-top: 8px;">Keine gescannten Karten für "${activeSearchQuery}" in der Datenbank gefunden.</p>
            <button id="btn-clear-search-analytics" style="margin-top: 12px; background: rgba(255,255,255,0.08); border: 1px solid var(--border-glass); color: #fff; padding: 6px 14px; border-radius: 6px; font-size: 0.78rem; cursor: pointer;">Suche zurücksetzen</button>
          </div>
        `;
        const btnClear = dashboard.querySelector('#btn-clear-search-analytics');
        if (btnClear) {
          btnClear.addEventListener('click', () => {
            activeSearchQuery = '';
            const inpSearch = document.querySelector('#inp-search');
            if (inpSearch) inpSearch.value = '';
            container.innerHTML = '';
            renderAnalyticsTab(container);
          });
        }
        return;
      }

      const headerSec = document.createElement('div');
      headerSec.style.cssText = 'display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 12px; padding: 0 4px;';
      headerSec.innerHTML = `
        <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);">Gescannte Karten (${scannedCards.length})</span>
      `;
      dashboard.appendChild(headerSec);

      const list = document.createElement('div');
      list.className = 'watchlist-list';
      dashboard.appendChild(list);

      for (const card of scannedCards) {
        const priceText = card.latest_price !== null && card.latest_price !== undefined ? `${card.latest_price.toFixed(2)} €` : '-- €';
        let diffText = '0.00%';
        let diffClass = 'stable';
        if (card.diff_percent < 0) {
          diffText = `${card.diff_percent.toFixed(2)}%`;
          diffClass = 'gain';
        } else if (card.diff_percent > 0) {
          diffText = `+${card.diff_percent.toFixed(2)}%`;
          diffClass = 'loss';
        }

        const titleInfo = splitCardTitle(card.card_id, card.tcg);

        const itemEl = document.createElement('div');
        itemEl.className = 'watchlist-item-wrapper';
        itemEl.innerHTML = `
          <div class="watchlist-item glass-panel" data-card-id="${card.card_id}">
            <div class="watchlist-item-img-container">
              <img class="watchlist-item-img" src="${getProxiedImageUrl(card.image_url)}" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" onerror="handleCardImageError(this)">
            </div>
            <div class="watchlist-item-info">
              <span class="watchlist-item-tcg">${card.tcg}</span>
              <span class="watchlist-item-name">${titleInfo.name}</span>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
                ${titleInfo.setName ? `<span style="font-size: 0.72rem; color: #a1a1aa;">📁 ${titleInfo.setName}</span>` : ''}
                ${titleInfo.number ? `<span class="watchlist-item-number" style="margin: 0;">${titleInfo.number}</span>` : ''}
                ${titleInfo.variant ? `<span style="font-size: 0.68rem; font-weight: 700; color: #d8b4fe; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); padding: 1px 6px; border-radius: 4px;">✨ ${titleInfo.variant}</span>` : ''}
              </div>
            </div>
            <div class="watchlist-item-price-col">
              <span class="watchlist-item-price">${priceText}</span>
              <span class="diff-badge ${diffClass}">${diffText}</span>
              <a href="${getTCGPlayerSearchUrl(titleInfo, card)}" target="_blank" rel="noopener noreferrer" class="tcgplayer-link-chip" style="font-size: 0.68rem; color: #60a5fa; margin-top: 2px; text-decoration: none; display: inline-flex; align-items: center; gap: 2px; font-weight: 600;" title="Auf TCGPlayer ansehen" onclick="event.stopPropagation();">
                TCGP ↗
              </a>
            </div>
          </div>
        `;
        list.appendChild(itemEl);

        if (card.image_url) {
          try { localStorage.setItem(`img_cache_${card.card_id}`, card.image_url); } catch (e) {}
        }

        const cardEl = itemEl.querySelector('.watchlist-item');
        cardEl.addEventListener('click', () => {
          addToHistory(card.card_id, card.tcg);
          loadCardDetails(card.card_id, card.tcg, true, card.image_url);
        });

        const imgEl = itemEl.querySelector('.watchlist-item-img');
        if (imgEl) {
          imgEl.addEventListener('click', (e) => {
            e.stopPropagation();
            showLightbox(card.image_url || '/logo.png');
          });
        }
      }
    } catch (err) {
      loadingBox.remove();
      dashboard.innerHTML = `<p style="color: #f87171; padding: 16px;">Fehler beim Laden: ${err.message}</p>`;
    }
    return;
  }

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
      container.innerHTML = '';
      renderAnalyticsTab(container);
    });
  });
}

function buildCardmarketSearchUrl(item) {
  let cardId = '';
  let rawFullName = '';
  let code = '';
  let rawSet = '';
  let rawCond = 'NM';
  let rawLoc = 'DE';
  let rawLang = 'EN';

  if (typeof item === 'string') {
    cardId = item;
  } else if (item) {
    cardId = item.cardDetails?.cardmarket_url || item.cardId || item.card_id || '';
    rawFullName = item.detectedName || item.rawName || item.name || '';
    code = item.detectedCode || item.rawCode || item.code || '';
    rawSet = item.rawSet || item.cardDetails?.set_name || item.cardDetails?.expansion || '';
    rawCond = item.rawCondition || 'NM';
    rawLoc = item.rawLocation || 'DE';
    rawLang = item.rawLanguage || 'EN';
  }

  const CONDITION_URL_MAP = {
    "MT": "1", "NM": "2", "EX": "3", "GD": "4", "LP": "5", "PL": "6", "PO": "7"
  };
  const LANGUAGE_URL_MAP = {
    "EN": "1", "FR": "2", "DE": "3", "ES": "4", "IT": "5", "JP": "7", "ZH": "8", "KO": "10"
  };

  const minConditionVal = CONDITION_URL_MAP[rawCond] || '2';
  const sellerCountryVal = rawLoc === 'DE' ? '7' : '';
  const languageVal = LANGUAGE_URL_MAP[rawLang] || '1';

  // Direct Cardmarket URL path if matched in DB e.g. "/de/OnePiece/Products/Singles/..." or "https://www.cardmarket.com..."
  if (cardId && (cardId.startsWith('/') || cardId.includes('cardmarket.com'))) {
    let baseUrl = cardId.startsWith('/') ? `https://www.cardmarket.com${cardId}` : cardId;
    try {
      const urlObj = new URL(baseUrl);
      urlObj.searchParams.set('minCondition', minConditionVal);
      if (sellerCountryVal) urlObj.searchParams.set('sellerCountry', sellerCountryVal);
      if (languageVal) urlObj.searchParams.set('language', languageVal);
      return urlObj.toString();
    } catch (e) {}
  }

  // Parse details from cardId path if available e.g. "/Pokemon/Products/Singles/Obsidian-Flammen/Glurak-ex-183-165"
  if (cardId.includes('/')) {
    const parts = cardId.split('/').filter(Boolean);
    const lastPart = parts.pop() || '';
    if (parts.length >= 1) {
      const setSlug = parts[parts.length - 1];
      if (setSlug && setSlug.toLowerCase() !== 'singles' && setSlug.toLowerCase() !== 'products') {
        if (!rawSet) rawSet = setSlug.replace(/[-_]/g, ' ').trim();
      }
    }
    if (!rawFullName) {
      rawFullName = lastPart.replace(/[-_]/g, ' ').trim();
    }
  }

  // Extract set name from parentheses if present
  if (!rawSet && rawFullName.includes('(')) {
    const match = rawFullName.match(/\(([^)]+)\)/);
    if (match && match[1]) rawSet = match[1].trim();
  }

  let cleanName = rawFullName.replace(/\([^)]*\)/g, '').split(/\s+LV\./i)[0].trim();
  if (!cleanName || cleanName.toLowerCase() === 'karte') cleanName = '';
  let cleanSet = (rawSet || '').trim();
  
  if (!code) {
    code = extractCardCode(rawFullName) || '';
  }

  let searchQuery = '';

  const parsedComp = parseCardCodeComponents(code, rawFullName, cleanSet);
  if (parsedComp) {
    const cardNum = parsedComp.cardNumPad || parsedComp.cardNum;
    // 1. Asian Compound Codes (e.g. CBB4C 2306/07 or CBB4C 2306 -> CBB4C23)
    if (parsedComp.isCompound && parsedComp.setCardCode) {
      searchQuery = parsedComp.setCardCode; // e.g. 'CBB4C23', 'CBB1C07'
    } else if (parsedComp.setCode && cardNum) {
      if (/^(OP|ST|EB|PRB|FB|FS|BT|RA|LOB|MP)\d*/i.test(parsedComp.setCode)) {
        searchQuery = `${parsedComp.setCode}-${cardNum}`;
      } else {
        searchQuery = `${parsedComp.setCode}${cardNum}`;
      }
    }
  }

  if (!searchQuery && code) {
    const setNumMatch = code.match(/^([A-Za-z0-9\-_]{2,10})[-\s]+(\d{1,4})(?:[\/-]\d{1,4})?$/);
    if (setNumMatch) {
      const setPrefix = setNumMatch[1].toUpperCase();
      const cardNum = setNumMatch[2];
      if (/^(OP|ST|EB|PRB|FB|FS|BT|RA|LOB|MP)\d*/i.test(setPrefix)) {
        searchQuery = `${setPrefix}-${cardNum}`;
      } else {
        searchQuery = `${setPrefix}${cardNum}`;
      }
    } else if (/^[A-Za-z0-9]{2,6}[-\s]+[A-Za-z0-9\-]+$/.test(code)) {
      searchQuery = code.replace(/\/\d+$/, '');
    } else if (/^\d{1,4}\/\d{2,4}$/.test(code) || /^\d+$/.test(code)) {
      searchQuery = cleanName ? `${cleanName} ${code}` : code;
    } else {
      searchQuery = code.replace(/^([A-Za-z0-9]{2,6})\s+(\d{1,4})/i, '$1$2');
    }
  } else if (!searchQuery) {
    searchQuery = [cleanName, cleanSet].filter(Boolean).join(' ') || 'Karte';
  }

  function getGameSlug(item, code = '') {
    const tcg = (item.detectedTcg || item.tcg || '').toLowerCase();
    const c = code.toUpperCase();
    if (tcg === 'onepiece' || tcg === 'one piece' || c.startsWith('OP') || c.startsWith('ST') || c.startsWith('EB') || c.startsWith('PRB')) return 'OnePiece';
    if (tcg === 'yugioh' || tcg === 'yu-gi-oh') return 'YuGiOh';
    if (tcg === 'lorcana') return 'Lorcana';
    if (tcg === 'dragonball' || tcg === 'dragon ball' || c.startsWith('FB') || c.startsWith('FS') || c.startsWith('BT')) return 'DragonBall';
    if (tcg === 'magic' || tcg === 'mtg') return 'Magic';
    if (tcg === 'starwarsunlimited' || tcg === 'star wars') return 'StarWarsUnlimited';
    if (tcg === 'digimon') return 'Digimon';
    return 'Pokemon';
  }

  const gameSlug = getGameSlug(item, code);
  const cmSearchUrl = new URL(`https://www.cardmarket.com/de/${gameSlug}/Products/Search`);
  cmSearchUrl.searchParams.set('searchString', searchQuery.trim());
  if (minConditionVal) cmSearchUrl.searchParams.set('minCondition', minConditionVal);
  if (sellerCountryVal) cmSearchUrl.searchParams.set('sellerCountry', sellerCountryVal);
  if (languageVal) cmSearchUrl.searchParams.set('language', languageVal);

  return cmSearchUrl.toString();
}

// Bulk Scan Tab Renderer
function renderBulkScanTab(container) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'dashboard-content bulk-scan-view';
  wrapper.innerHTML = `
    <div class="glass-panel bulk-scan-container">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2 style="font-size: 1.35rem; font-weight: 700; color: #fff; margin: 0 0 0.25rem 0; display: flex; align-items: center; gap: 10px;">
            <svg style="width: 22px; height: 22px; color: #a1a1aa;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Bulk Scan & Whatnot CSV Importer
          </h2>
          <p style="color: #94a3b8; font-size: 0.9rem; margin: 0;">Lade eine Whatnot Bulk-Upload CSV (z. B. aus ScanConverter3000) oder PaperStream / TCG CSV hoch, um Kartendaten & Marktpreise abzufragen.</p>
        </div>
        <button class="shadcn-btn shadcn-btn-secondary" id="btn-new-csv-upload" style="display: none;">
          <svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Neue CSV laden
        </button>
      </div>

      <div class="dropzone-box" id="csv-dropzone" style="cursor: pointer;">
        <div class="dropzone-icon" style="margin-bottom: 12px;">
          <svg style="width: 44px; height: 44px; color: #71717a; margin: 0 auto; display: block;" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <h3 style="color: #f8fafc; font-size: 1.15rem; margin: 0 0 0.5rem 0; font-weight: 700;">Whatnot / ScanConverter3000 / TCG CSV-Datei hier ablegen</h3>
        <p style="color: #94a3b8; font-size: 0.9rem; margin: 0 0 1.25rem 0;">oder Klicke auf die gesamte Fläche zum Durchsuchen deiner Dateien</p>
        <input type="file" id="csv-file-input" accept=".csv,.txt" style="display: none;" />
        <button class="shadcn-btn shadcn-btn-primary" id="btn-select-csv" type="button">
          <svg style="width: 15px; height: 15px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          CSV-Datei auswählen
        </button>
      </div>

      <div id="bulk-processing-indicator" style="display: none; text-align: center; padding: 2.5rem 1.5rem;">
        <div class="spinner" style="margin: 0 auto 1.25rem auto;"></div>
        <p id="bulk-progress-text" style="color: #e2e8f0; font-size: 1rem; font-weight: 600; margin: 0 0 0.75rem 0;">Analysiere Scans & frage Cardmarket Live-Preise ab...</p>
        <div style="max-width: 380px; height: 8px; background: rgba(255,255,255,0.08); border-radius: 999px; margin: 0 auto; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
          <div id="bulk-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); transition: width 0.1s ease; border-radius: 999px;"></div>
        </div>
      </div>

      <div id="bulk-results-area" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin: 1.5rem 0 1.25rem 0; flex-wrap: wrap; gap: 1rem;">
          <h3 style="color: #fff; font-size: 1.15rem; margin: 0; font-weight: 700;" id="scan-summary-title">Gescannt: 0 Karten</h3>
          <div style="display: flex; gap: 0.85rem; flex-wrap: wrap; align-items: center;">
            <button class="shadcn-btn shadcn-btn-secondary" id="btn-open-set-builder" type="button" title="Pipeline Builder: Karten in konfigurierbare Sets & Mystery Packs aufteilen und sortieren" style="border-color: rgba(168, 85, 247, 0.4); color: #d8b4fe;">
              <svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              ✨ Pipeline Builder
            </button>
            <button class="shadcn-btn shadcn-btn-secondary" id="btn-refresh-bulk-db" type="button" title="Fragt Supabase neu ab nach kürzlich gescannten Preisen & Bildern">
              <svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              DB-Daten aktualisieren
            </button>
            <button class="shadcn-btn shadcn-btn-primary" id="btn-send-to-overlay" type="button">
              <svg style="width: 15px; height: 15px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              An Stream Overlay senden
            </button>
            <button class="shadcn-btn shadcn-btn-secondary" id="btn-save-scans-coll" type="button">
              <svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              In Sammlung speichern
            </button>
            <button class="shadcn-btn shadcn-btn-secondary" id="btn-export-enriched-csv" type="button">
              <svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              CSV herunterladen
            </button>
          </div>
        </div>

        <div class="review-table-container glass-panel">
          <table class="review-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Karte / Code</th>
                <th>Titel</th>
                <th>Letzter CM Preis</th>
                <th>Letzter Check & Filter</th>
                <th>Status</th>
                <th style="text-align: right;">Cardmarket</th>
              </tr>
            </thead>
            <tbody id="scan-review-tbody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  container.appendChild(wrapper);

  const dropzone = wrapper.querySelector('#csv-dropzone');
  const fileInput = wrapper.querySelector('#csv-file-input');
  const btnSelect = wrapper.querySelector('#btn-select-csv');
  const btnNewUpload = wrapper.querySelector('#btn-new-csv-upload');
  const btnRefreshBulkDb = wrapper.querySelector('#btn-refresh-bulk-db');
  const btnOpenSetBuilder = wrapper.querySelector('#btn-open-set-builder');
  const processingInd = wrapper.querySelector('#bulk-processing-indicator');
  const resultsArea = wrapper.querySelector('#bulk-results-area');
  const tbody = wrapper.querySelector('#scan-review-tbody');
  const summaryTitle = wrapper.querySelector('#scan-summary-title');
  const btnSendOverlay = wrapper.querySelector('#btn-send-to-overlay');
  const btnSaveColl = wrapper.querySelector('#btn-save-scans-coll');
  const btnExportCsv = wrapper.querySelector('#btn-export-enriched-csv');

  if (btnOpenSetBuilder) {
    btnOpenSetBuilder.addEventListener('click', () => {
      openSetBuilderModal(setBuilderInstance.getSets().length > 0 ? 'overview' : 'generate');
    });
  }

  btnRefreshBulkDb.addEventListener('click', async () => {
    if (!bulkScannerInstance.scanItems || bulkScannerInstance.scanItems.length === 0) return;
    btnRefreshBulkDb.disabled = true;
    const origText = btnRefreshBulkDb.textContent;
    btnRefreshBulkDb.textContent = '🔄 DB wird durchsucht...';
    try {
      const items = bulkScannerInstance.scanItems;
      const CONCURRENCY = 6;
      let currentIndex = 0;
      const worker = async () => {
        while (currentIndex < items.length) {
          const idx = currentIndex++;
          await bulkScannerInstance.enrichItemWithMarketData(items[idx]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
      renderResults(bulkScannerInstance.scanItems);

      // If Stream Overlay is currently active, sync updated queue in realtime
      if (activeStreamQueue && activeStreamQueue.length > 0) {
        activeStreamQueue = [...bulkScannerInstance.scanItems];
        saveCachedUserData(currentUser?.id);
        await syncStreamQueueToSupabase(activeStreamQueue, streamOverlayInstance?.currentIndex || 0);
      }
    } catch (e) {
      console.error('Error refreshing DB market data:', e);
    } finally {
      btnRefreshBulkDb.disabled = false;
      btnRefreshBulkDb.textContent = origText;
    }
  });

  // Entire dropzone area opens file picker on click (with event recursion check)
  dropzone.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    fileInput.click();
  });

  btnSelect.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  btnNewUpload.addEventListener('click', () => {
    dropzone.style.display = 'block';
    resultsArea.style.display = 'none';
    btnNewUpload.style.display = 'none';
    fileInput.value = '';
    setBuilderInstance.clearAllSets(bulkScannerInstance.scanItems || []);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });

  async function handleFile(file) {
    if (!file) return;
    dropzone.style.display = 'none';
    processingInd.style.display = 'block';

    const progressText = wrapper.querySelector('#bulk-progress-text');
    const progressBar = wrapper.querySelector('#bulk-progress-bar');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = 'Analysiere Scans & CSV-Daten...';

    const onProgress = (current, total, cardName) => {
      if (progressText && progressBar) {
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        progressText.textContent = `Verarbeite ${current} von ${total} Karten (${cardName || ''})... ${pct}%`;
        progressBar.style.width = `${pct}%`;
      }
    };

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const text = event.target.result;
          const items = await bulkScannerInstance.processCSVText(text, onProgress);
          setBuilderInstance.clearAllSets(items);

          processingInd.style.display = 'none';
          resultsArea.style.display = 'block';
          btnNewUpload.style.display = 'inline-block';
          renderResults(items);
        } catch (err) {
          console.error('Error processing CSV:', err);
          alert('Fehler beim Verarbeiten der CSV-Datei: ' + err.message);
          processingInd.style.display = 'none';
          dropzone.style.display = 'block';
        }
      };
      reader.onerror = (e) => {
        console.error('FileReader error:', e);
        alert('Fehler beim Lesen der Datei.');
        processingInd.style.display = 'none';
        dropzone.style.display = 'block';
      };
      reader.readAsText(file);
    } catch (e) {
      console.error('handleFile exception:', e);
      processingInd.style.display = 'none';
      dropzone.style.display = 'block';
    }
  }

  // Active popover tracker for closing when clicking outside
  let activeSetAssignPopover = null;
  document.addEventListener('click', (e) => {
    if (activeSetAssignPopover && !activeSetAssignPopover.contains(e.target) && !e.target.closest('.btn-table-set-assign')) {
      activeSetAssignPopover.remove();
      activeSetAssignPopover = null;
    }
  });

  function renderResults(items) {
    summaryTitle.textContent = `Gescannt: ${items.length} Karten`;
    tbody.innerHTML = '';

    items.forEach((item, index) => {
      const tr = document.createElement('tr');
      const hasFoundPrice = item.lastPrice !== null && item.lastPrice !== undefined && !item.isManualPrice;
      const isManualPrice = item.isManualPrice === true;
      const priceVal = item.lastPrice !== null && item.lastPrice !== undefined ? item.lastPrice : '';
      const checkRelative = item.lastCheckRelative || item.lastCheckDate;
      const checkDetails = checkRelative ? `${checkRelative} • ${item.filterInfo || 'Standard'}` : 'Keine DB-Daten';
      const isMatched = item.status === 'matched';
      const cmUrl = buildCardmarketSearchUrl(item);
      const imgMarkup = item.imageUrl ? `<img src="${getProxiedImageUrl(item.imageUrl)}" class="scan-card-thumb" style="width: 28px; height: 38px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 1px solid rgba(255,255,255,0.2);" alt="Thumb" title="Klicken für Großansicht" />` : '';

      const nameDe = item.nameDe || item.detectedName || item.rawName || 'Karte';
      const nameEn = item.nameEn || item.detectedName || '';
      const setNameDe = item.setNameDe || item.rawSet || '';

      const currentSet = item.setId ? setBuilderInstance.getSet(item.setId) : null;
      const setBadgeHtml = currentSet
        ? `<button type="button" class="card-set-badge assigned btn-table-set-assign" data-card-id="${item.id}" title="Aktuell in Set '${currentSet.name}'. Klicken zum Verschieben oder Entfernen.">📦 ${currentSet.name} ▾</button>`
        : `<button type="button" class="card-set-badge unassigned btn-table-set-assign" data-card-id="${item.id}" title="Zu einem Set hinzufügen">+ Set</button>`;

      const priceCellHtml = hasFoundPrice
        ? `<div style="color: #10b981; font-weight: 700;">${item.lastPrice.toFixed(2)} €</div>`
        : `
          <div style="display: flex; align-items: center; gap: 4px;">
            <input type="number" step="0.01" min="0" class="form-input manual-price-input" placeholder="0.00" value="${priceVal !== '' ? priceVal : ''}" style="width: 70px; padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.35); border: 1px solid ${isManualPrice ? 'rgba(34, 197, 94, 0.6)' : 'rgba(255,255,255,0.18)'}; color: #10b981; font-weight: 700; border-radius: 6px;" title="Manueller Cardmarket Preis" />
            <span style="color: #94a3b8; font-size: 0.8rem; font-weight: 600;">€</span>
          </div>
        `;

      const origIdx = item.originalIndex !== undefined ? item.originalIndex : index + 1;

      tr.innerHTML = `
        <td><strong style="color: #38bdf8;">#${origIdx}</strong></td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${imgMarkup}
            <div>
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap;">
                <input type="text" class="form-input code-input" value="${item.detectedCode ? item.detectedCode.replace(/^([A-Za-z0-9]{2,6})\s+(\d{1,4})/i, '$1$2') : ''}" style="min-width: 95px; max-width: 125px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 6px; padding: 3px 6px; font-size: 0.8rem;" />
                ${setBadgeHtml}
              </div>
              ${item.variant ? `<div style="font-size: 0.68rem; font-weight: 700; color: #d8b4fe; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); padding: 1px 5px; border-radius: 4px; display: inline-block; margin-top: 2px;">✨ ${item.variant.replace(/\D/g, '') ? `Version ${item.variant.replace(/\D/g, '')}` : item.variant}</div>` : ''}
            </div>
          </div>
        </td>
        <td>
          <div>
            <strong>${nameDe}</strong>
            ${nameEn && nameEn !== nameDe ? `<span style="color: #a1a1aa; font-size: 0.75rem; margin-left: 4px;">(${nameEn})</span>` : ''}
          </div>
          ${setNameDe ? `<div style="color: #71717a; font-size: 0.75rem; margin-top: 2px;">📁 ${setNameDe}</div>` : ''}
        </td>
        <td>
          ${priceCellHtml}
          ${item.tcgplayerPrice ? `<div style="font-size: 0.72rem; color: #60a5fa; font-weight: 600; margin-top: 2px;">$ ${Number(item.tcgplayerPrice).toFixed(2)} (USD)</div>` : ''}
        </td>
        <td style="color: #94a3b8; font-size: 0.85rem;">${checkDetails}</td>
        <td>
          <span class="status-badge ${isMatched ? 'matched' : 'needs_review'}" style="display: inline-flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${isMatched ? '#22c55e' : '#a1a1aa'};"></span>
            ${isMatched ? 'In DB' : 'Nicht in DB'}
          </span>
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; flex-wrap: nowrap;">
            ${!isMatched ? `
              <button type="button" class="btn btn-secondary btn-sm btn-find-card-analytics" style="padding: 4px 8px; font-size: 0.75rem; cursor: pointer; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;" title="Sucht nach dieser Karte im Analytics & DB-Tab">
                <svg style="width: 11px; height: 11px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Finden
              </button>
            ` : ''}
            <a href="${item.tcgplayerUrl || getTCGPlayerSearchUrl(null, item)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 0.75rem; border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;" title="Auf TCGPlayer ansehen">
              TCGP ↗
            </a>
            <a href="${cmUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm cm-check-link" style="padding: 4px 8px; font-size: 0.75rem;">
              CM ↗
            </a>
          </div>
        </td>
      `;

      // Set Assignment Popover button handler
      const btnSetAssign = tr.querySelector('.btn-table-set-assign');
      if (btnSetAssign) {
        btnSetAssign.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activeSetAssignPopover) {
            activeSetAssignPopover.remove();
            activeSetAssignPopover = null;
          }

          const existingSets = setBuilderInstance.getSets();
          const popover = document.createElement('div');
          popover.className = 'set-assign-popover';

          let setOptionsHtml = '';
          if (existingSets.length === 0) {
            setOptionsHtml = `<div style="padding: 6px 10px; color: var(--theme-muted); font-size: 0.75rem;">Noch keine Sets erstellt.</div>`;
          } else {
            setOptionsHtml = existingSets.map((s) => {
              const isCurr = item.setId === s.id;
              return `
                <div class="set-assign-option ${isCurr ? 'current' : ''}" data-set-id="${s.id}">
                  <span>📦 ${s.name}</span>
                  <span style="font-size: 0.72rem; color: var(--theme-muted);">${s.cards.length}/${s.targetSize}</span>
                </div>
              `;
            }).join('');
          }

          popover.innerHTML = `
            <div style="padding: 4px 8px 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 0.72rem; font-weight: 700; color: #a1a1aa; text-transform: uppercase;">
              Set für Karte #${origIdx} wählen
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px; margin: 4px 0;">
              ${setOptionsHtml}
            </div>
            <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 4px; display: flex; flex-direction: column; gap: 2px;">
              <div class="set-assign-option" id="popover-create-new-set" style="color: #60a5fa;">
                <span>➕ Neues Set erstellen</span>
              </div>
              ${item.setId ? `
                <div class="set-assign-option" id="popover-remove-from-set" style="color: #ef4444;">
                  <span>❌ Aus Set entfernen</span>
                </div>
              ` : ''}
            </div>
          `;

          // Position popover relative to button
          document.body.appendChild(popover);
          const rect = btnSetAssign.getBoundingClientRect();
          popover.style.position = 'fixed';
          popover.style.top = `${Math.min(window.innerHeight - 260, rect.bottom + 6)}px`;
          popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 240, rect.left))}px`;
          activeSetAssignPopover = popover;

          // Event handlers for popover options
          popover.querySelectorAll('.set-assign-option[data-set-id]').forEach((opt) => {
            opt.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const targetSetId = opt.getAttribute('data-set-id');
              const targetSet = setBuilderInstance.getSet(targetSetId);
              if (!targetSet) return;

              if (item.setId && item.setId !== targetSetId) {
                const oldSet = setBuilderInstance.getSet(item.setId);
                const oldSetName = oldSet ? oldSet.name : 'anderem Set';
                const confirmed = confirm(`Möchtest du diese Karte #${origIdx} (${nameDe}) wirklich aus '${oldSetName}' nach '${targetSet.name}' verschieben?`);
                if (!confirmed) return;
              }

              setBuilderInstance.assignCardToSet(item, targetSetId);
              popover.remove();
              activeSetAssignPopover = null;
              renderResults(bulkScannerInstance.scanItems);
              showToast(`Karte #${origIdx} zu '${targetSet.name}' hinzugefügt!`);
            });
          });

          const optCreateNew = popover.querySelector('#popover-create-new-set');
          if (optCreateNew) {
            optCreateNew.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const defaultName = `Set #${setBuilderInstance.getSets().length + 1}`;
              const newName = prompt('Name für das neue Set:', defaultName);
              if (newName && newName.trim()) {
                const created = setBuilderInstance.createEmptySet(newName.trim());
                setBuilderInstance.assignCardToSet(item, created.id);
                popover.remove();
                activeSetAssignPopover = null;
                renderResults(bulkScannerInstance.scanItems);
                showToast(`Neues Set '${created.name}' erstellt und Karte #${origIdx} hinzugefügt!`);
              }
            });
          }

          const optRemove = popover.querySelector('#popover-remove-from-set');
          if (optRemove) {
            optRemove.addEventListener('click', (ev) => {
              ev.stopPropagation();
              setBuilderInstance.removeCardFromSet(item);
              popover.remove();
              activeSetAssignPopover = null;
              renderResults(bulkScannerInstance.scanItems);
              showToast(`Karte #${origIdx} aus Set entfernt.`);
            });
          }
        });
      }

      const btnFindCard = tr.querySelector('.btn-find-card-analytics');
      if (btnFindCard) {
        btnFindCard.addEventListener('click', async (e) => {
          e.stopPropagation();
          let rawCode = (item.detectedCode || item.rawCode || '').trim();
          let rawName = item.nameDe || item.detectedName || item.rawName || '';
          if (rawName.toLowerCase() === 'karte') rawName = '';

          const parsed = parseCardCodeComponents(rawCode, rawName, item.setNameDe || item.rawSet);
          let searchTerm = '';
          if (parsed?.setCardCode) {
            searchTerm = parsed.setCardCode;
          } else if (rawName && rawCode) {
            searchTerm = `${rawName} ${rawCode}`.trim();
          } else {
            searchTerm = rawCode || rawName || '';
          }

          activeSearchQuery = searchTerm;
          const inpSearch = document.querySelector('#inp-search');
          if (inpSearch) inpSearch.value = searchTerm;
          await navigate('/analytics');
        });
      }

      const cmCheckLink = tr.querySelector('.cm-check-link');
      if (cmCheckLink) {
        cmCheckLink.addEventListener('click', async (e) => {
          const cardCode = (item.detectedCode || item.rawCode || '').trim();
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            e.preventDefault();
            const targetUrl = cmCheckLink.getAttribute('href');
            try {
              if (cardCode) {
                await chrome.storage.local.set({ last_clicked_card_code: cardCode });
              }
              if (item.cardDetails?.cardmarket_url) {
                const session = await chrome.storage.local.get('session');
                const userId = session?.session?.user?.id;
                if (userId) {
                  const cardPrefsKey = 'card_preferences_' + userId;
                  const { [cardPrefsKey]: existingPrefs = {} } = await chrome.storage.local.get(cardPrefsKey);
                  existingPrefs[item.cardDetails.cardmarket_url] = {
                    condition: item.rawCondition || 'NM',
                    location: item.rawLocation || 'DE',
                    language: item.rawLanguage || 'EN'
                  };
                  await chrome.storage.local.set({ [cardPrefsKey]: existingPrefs });
                }
              }
            } catch (err) {}
            window.open(targetUrl, '_blank');
          }
        });
      }

      const thumbImg = tr.querySelector('.scan-card-thumb');
      if (thumbImg) {
        thumbImg.addEventListener('click', (e) => {
          e.stopPropagation();
          showLightbox(item.imageUrl);
        });
      }

      const codeInput = tr.querySelector('.code-input');
      if (codeInput) {
        codeInput.addEventListener('change', async (e) => {
          item.detectedCode = e.target.value;
          await bulkScannerInstance.enrichItemWithMarketData(item);
          renderResults(bulkScannerInstance.scanItems);
        });
      }

      const manualPriceInput = tr.querySelector('.manual-price-input');
      if (manualPriceInput) {
        manualPriceInput.addEventListener('input', (e) => {
          const raw = e.target.value.trim().replace(',', '.');
          const codeKey = (item.detectedCode || item.rawCode || '').trim();
          if (raw === '') {
            item.lastPrice = null;
            item.isManualPrice = false;
            item.lastCheckRelative = null;
            item.filterInfo = null;
            manualPriceInput.style.borderColor = 'rgba(255,255,255,0.18)';
            if (codeKey) removeManualPrice(codeKey);
          } else {
            const parsedPrice = parseFloat(raw);
            if (!isNaN(parsedPrice) && parsedPrice >= 0) {
              item.lastPrice = parsedPrice;
              item.isManualPrice = true;
              item.status = 'matched';
              item.lastCheckRelative = 'Manuell';
              item.filterInfo = 'Manuell hinterlegt';
              manualPriceInput.style.borderColor = 'rgba(34, 197, 94, 0.6)';
              if (codeKey) {
                saveManualPrice(codeKey, parsedPrice, {
                  name: item.detectedName || item.rawName,
                  set: item.setNameDe || item.rawSet,
                  cardmarket_url: item.cardDetails?.cardmarket_url
                });
              }
            }
          }
        });

        manualPriceInput.addEventListener('change', (e) => {
          const raw = e.target.value.trim().replace(',', '.');
          const codeKey = (item.detectedCode || item.rawCode || '').trim();
          if (raw !== '') {
            const parsedPrice = parseFloat(raw);
            if (!isNaN(parsedPrice) && parsedPrice >= 0) {
              item.lastPrice = parsedPrice;
              item.isManualPrice = true;
              item.status = 'matched';
              item.lastCheckRelative = 'Manuell';
              item.filterInfo = 'Manuell hinterlegt';
              manualPriceInput.value = parsedPrice.toFixed(2);
              if (codeKey) {
                saveManualPrice(codeKey, parsedPrice, {
                  name: item.detectedName || item.rawName,
                  set: item.setNameDe || item.rawSet,
                  cardmarket_url: item.cardDetails?.cardmarket_url
                });
              }
            }
          }
        });
      }

      tbody.appendChild(tr);
    });
  }

  // Restore state if scanned items already exist in memory
  if (bulkScannerInstance.scanItems && bulkScannerInstance.scanItems.length > 0) {
    dropzone.style.display = 'none';
    resultsArea.style.display = 'block';
    btnNewUpload.style.display = 'inline-block';
    renderResults(bulkScannerInstance.scanItems);
  }

  btnSendOverlay.addEventListener('click', async () => {
    if (!bulkScannerInstance.scanItems || bulkScannerInstance.scanItems.length === 0) {
      alert('Keine gescannten Karten zum Senden vorhanden.');
      return;
    }
    activeStreamQueue = [...bulkScannerInstance.scanItems];
    try {
      localStorage.setItem('cache_stream_queue', JSON.stringify(activeStreamQueue));
    } catch(e) {}
    saveCachedUserData(currentUser?.id);
    await syncStreamQueueToSupabase(activeStreamQueue, 0);
    navigate('/stream-overlay');
  });

  btnSaveColl.addEventListener('click', async () => {
    if (bulkScannerInstance.scanItems.length === 0) return;
    if (!currentUser?.id) {
      alert('Bitte logge dich ein, um Karten in deiner Sammlung zu speichern!');
      return;
    }

    btnSaveColl.disabled = true;
    const origText = btnSaveColl.textContent;
    btnSaveColl.textContent = '💾 Wird gespeichert...';

    try {
      const inserts = bulkScannerInstance.scanItems.map(item => {
        const cardId = item.cardDetails?.cardmarket_url || item.detectedCode || item.rawCode || `SCAN_${Date.now()}`;
        return {
          user_id: currentUser.id,
          card_id: cardId,
          tcg: 'OnePiece',
          image_url: item.imageUrl || null,
          condition: item.rawCondition || 'NM',
          language: item.rawLanguage || 'EN',
          seller_country: item.rawLocation || 'DE'
        };
      });

      // Upsert / Insert ignore duplicates into Supabase
      const { error } = await supabase
        .from('collection_cards')
        .upsert(inserts, { onConflict: 'user_id,card_id', ignoreDuplicates: true });

      if (error) {
        // Fallback insert if upsert fails
        const { error: insertErr } = await supabase
          .from('collection_cards')
          .insert(inserts);
        if (insertErr && insertErr.code !== '23505') throw insertErr;
      }

      await fetchCollectionCards();
      saveCachedUserData(currentUser.id);
      showToast(`${inserts.length} Karten erfolgreich in deiner Sammlung gespeichert!`);
    } catch (err) {
      console.error('Error saving bulk scans to collection:', err);
      alert('Fehler beim Speichern in der Sammlung: ' + (err.message || 'Unbekannter Fehler'));
    } finally {
      btnSaveColl.disabled = false;
      btnSaveColl.textContent = origText;
    }
  });

  btnExportCsv.addEventListener('click', () => {
    const hasWhatnot = bulkScannerInstance.scanItems.some(item => item.whatnot && (item.whatnot.titel || item.whatnot.unterkategorie));
    const csvContent = hasWhatnot ? bulkScannerInstance.exportWhatnotCSV() : bulkScannerInstance.exportEnrichedCSV();
    if (!csvContent) return;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', hasWhatnot ? `whatnot_upload_${Date.now()}.csv` : `card_tracker_scans_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  /**
   * Set Builder Modal Controller (Generator, Sets Overview, Drag & Drop Detail)
   */
  function openSetBuilderModal(initialTab = 'generate', initialSetId = null) {
    const existingModal = document.querySelector('.set-builder-modal-backdrop');
    if (existingModal) existingModal.remove();

    let currentModalTab = initialTab; // 'generate', 'overview', 'detail'
    let currentDetailSetId = initialSetId;

    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'set-builder-modal-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'set-builder-modal-dialog';
    modalBackdrop.appendChild(dialog);
    document.body.appendChild(modalBackdrop);

    function closeModal() {
      modalBackdrop.remove();
      renderResults(bulkScannerInstance.scanItems);
    }

    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    function renderModalContent() {
      const allCards = bulkScannerInstance.scanItems || [];
      const sets = setBuilderInstance.getSets();
      const assignedCount = allCards.filter(c => c.setId).length;

      dialog.innerHTML = `
        <div class="set-builder-header">
          <div>
            <h3 style="color: #fff; font-size: 1.15rem; font-weight: 700; margin: 0 0 4px 0; display: flex; align-items: center; gap: 8px;">
              <span style="color: #c084fc;">📦</span> Pipeline Builder
            </h3>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: #a1a1aa;">
              <span>Pool: <strong style="color: #38bdf8;">${allCards.length} Karten</strong></span>
              <span>•</span>
              <span>In Sets: <strong style="color: #4ade80;">${assignedCount} Karten</strong></span>
              <span>•</span>
              <span>Sets: <strong style="color: #c084fc;">${sets.length}</strong></span>
            </div>
          </div>
          <button class="shadcn-btn shadcn-btn-secondary btn-close-modal" type="button" style="padding: 6px 10px; border-radius: 8px; font-size: 1.1rem; line-height: 1;">✕</button>
        </div>

        <div class="set-builder-nav-tabs">
          <button class="set-builder-nav-tab ${currentModalTab === 'generate' ? 'active' : ''}" data-tab="generate">
            ⚙️ Pipeline Generator
          </button>
          <button class="set-builder-nav-tab ${currentModalTab === 'overview' ? 'active' : ''}" data-tab="overview">
            📦 Pipeline Sets (${sets.length})
          </button>
          ${currentDetailSetId ? `
            <button class="set-builder-nav-tab ${currentModalTab === 'detail' ? 'active' : ''}" data-tab="detail">
              👁️ Set sortieren (Drag & Drop)
            </button>
          ` : ''}
        </div>

        <div class="set-builder-body" id="set-builder-body-container"></div>
      `;

      dialog.querySelector('.btn-close-modal').addEventListener('click', closeModal);

      dialog.querySelectorAll('.set-builder-nav-tab').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
          currentModalTab = tabBtn.getAttribute('data-tab');
          renderModalContent();
        });
      });

      const bodyContainer = dialog.querySelector('#set-builder-body-container');

      if (currentModalTab === 'generate') {
        renderGeneratorTab(bodyContainer);
      } else if (currentModalTab === 'overview') {
        renderOverviewTab(bodyContainer);
      } else if (currentModalTab === 'detail') {
        renderDetailTab(bodyContainer, currentDetailSetId);
      }
    }

    // --- Tab 1: Generator ---
    function renderGeneratorTab(container) {
      const allCards = bulkScannerInstance.scanItems || [];
      const currentSets = setBuilderInstance.getSets();
      let selectedPackSize = 10;
      let useHitRule = true;
      let hitsPerSet = 1;
      let minHitPrice = 5.00;
      let useBaseRange = false;
      let minBasePrice = 0.00;
      let maxBasePrice = 4.99;
      let strategy = 'balanced';
      let namePrefix = 'Set #';

      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px;">
          <!-- 1. Set Size -->
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 18px;">
            <label style="display: block; font-weight: 700; font-size: 0.95rem; color: #fff; margin-bottom: 8px;">
              1. Kartengröße pro Set (Pack Size)
            </label>
            <p style="color: #94a3b8; font-size: 0.82rem; margin: 0 0 12px 0;">
              Wähle eine Standardgröße für deine Mystery Packs oder gib eine eigene Zahl ein:
            </p>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="set-preset-chip active" data-size="10">10 Karten</button>
              <button type="button" class="set-preset-chip" data-size="20">20 Karten</button>
              <button type="button" class="set-preset-chip" data-size="50">50 Karten</button>
              <button type="button" class="set-preset-chip" data-size="100">100 Karten</button>
              <button type="button" class="set-preset-chip" data-size="200">200 Karten</button>
              <div style="display: inline-flex; align-items: center; gap: 6px; margin-left: 8px;">
                <span style="font-size: 0.82rem; color: #a1a1aa;">Custom:</span>
                <input type="number" id="inp-custom-pack-size" min="1" max="1000" value="10" class="form-input" style="width: 70px; padding: 5px 8px; font-size: 0.85rem; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff;" />
              </div>
            </div>
          </div>

          <!-- 2. Hit Rules -->
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 18px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <label style="font-weight: 700; font-size: 0.95rem; color: #fff; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="chk-use-hit-rule" checked style="width: 16px; height: 16px; accent-color: #a855f7; cursor: pointer;" />
                2. Garantierte Hit-Karten pro Set festlegen
              </label>
              <span class="hit-slot-badge">✨ Hit Feature</span>
            </div>
            <p style="color: #94a3b8; font-size: 0.82rem; margin: 0 0 14px 0;">
              Definiere, wie viele wertvolle Karten (anhand der Cardmarket Live/Manual Preise) garantiert in jedem Set enthalten sein sollen.
            </p>
            <div id="hit-rule-fields" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
              <div>
                <label style="display: block; font-size: 0.8rem; color: #cbd5e1; margin-bottom: 4px; font-weight: 600;">Hits pro Set:</label>
                <input type="number" id="inp-hits-per-set" min="1" max="50" value="1" class="form-input" style="width: 100%; padding: 6px 10px; font-size: 0.875rem; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #facc15; font-weight: 700;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.8rem; color: #cbd5e1; margin-bottom: 4px; font-weight: 600;">Mindestwert für Hits (CM Preis in €):</label>
                <div style="position: relative;">
                  <input type="number" id="inp-min-hit-price" step="0.5" min="0.1" value="5.00" class="form-input" style="width: 100%; padding: 6px 28px 6px 10px; font-size: 0.875rem; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #4ade80; font-weight: 700;" />
                  <span style="position: absolute; right: 10px; top: 7px; color: #94a3b8; font-size: 0.85rem;">€</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Base Card Price Filter -->
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 18px;">
            <label style="font-weight: 700; font-size: 0.95rem; color: #fff; display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px;">
              <input type="checkbox" id="chk-use-base-range" style="width: 16px; height: 16px; accent-color: #3b82f6; cursor: pointer;" />
              3. Preisbereich für Basis-Karten (Filler Slots) begrenzen
            </label>
            <div id="base-range-fields" style="display: none; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 10px;">
              <div>
                <label style="display: block; font-size: 0.8rem; color: #cbd5e1; margin-bottom: 4px;">Min. Preis (€):</label>
                <input type="number" id="inp-min-base-price" step="0.1" min="0" value="0.00" class="form-input" style="width: 100%; padding: 6px 10px; font-size: 0.85rem; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.8rem; color: #cbd5e1; margin-bottom: 4px;">Max. Preis (€):</label>
                <input type="number" id="inp-max-base-price" step="0.1" min="0.1" value="4.99" class="form-input" style="width: 100%; padding: 6px 10px; font-size: 0.85rem; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff;" />
              </div>
            </div>
          </div>

          <!-- 4. Distribution Strategy & Prefix -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 18px;">
            <div>
              <label style="display: block; font-weight: 700; font-size: 0.85rem; color: #fff; margin-bottom: 6px;">
                4. Verteilungslogik:
              </label>
              <select id="sel-strategy" class="form-input" style="width: 100%; padding: 6px 10px; font-size: 0.85rem; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff;">
                <option value="balanced">Ausbalanciert (Gleichmäßige Wertverteilung)</option>
                <option value="sequential">Original-Reihenfolge (Sequentiell aus CSV)</option>
                <option value="random">Zufällig durchmischen (Mystery Pack)</option>
              </select>
            </div>
            <div>
              <label style="display: block; font-weight: 700; font-size: 0.85rem; color: #fff; margin-bottom: 6px;">
                Set-Name Präfix:
              </label>
              <input type="text" id="inp-set-prefix" value="Set #" class="form-input" style="width: 100%; padding: 6px 10px; font-size: 0.85rem; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff;" />
            </div>
          </div>

          <!-- Simulation Preview Bar -->
          <div id="simulation-summary-box" style="background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 12px; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 0.8rem; font-weight: 700; color: #d8b4fe; text-transform: uppercase; letter-spacing: 0.04em;">
              📊 Live-Simulation für den aktuellen Kartenpool:
            </div>
            <div id="sim-stats-container" style="display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.875rem; color: #f1f5f9;">
              <!-- Dynamic stats -->
            </div>
          </div>

          ${currentSets.length > 0 ? `
            <div style="display: flex; align-items: center; gap: 8px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 8px; padding: 10px 14px;">
              <input type="checkbox" id="chk-append-sets" checked style="width: 16px; height: 16px; accent-color: #3b82f6; cursor: pointer;" />
              <label for="chk-append-sets" style="font-size: 0.85rem; color: #93c5fd; cursor: pointer; user-select: none;">
                An bestehende Sets anhängen (${currentSets.length} Sets bereits vorhanden)
              </label>
            </div>
          ` : ''}

          <!-- Action Buttons -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 4px;">
            <button type="button" id="btn-run-generate-single-set" class="shadcn-btn shadcn-btn-secondary" style="padding: 12px 16px; font-size: 0.9375rem; justify-content: center; font-weight: 700; border-color: rgba(168, 85, 247, 0.5); color: #d8b4fe; background: rgba(168, 85, 247, 0.12);">
              📦 Nur 1 Set generieren
            </button>
            <button type="button" id="btn-run-generate-all-sets" class="shadcn-btn shadcn-btn-primary" style="padding: 12px 16px; font-size: 0.9375rem; justify-content: center; font-weight: 700; background: linear-gradient(135deg, #a855f7, #6366f1) !important; color: #fff !important; border: none !important;">
              🚀 Alle möglichen Sets generieren
            </button>
          </div>
        </div>
      `;

      const chipButtons = container.querySelectorAll('.set-preset-chip');
      const customSizeInput = container.querySelector('#inp-custom-pack-size');
      const chkUseHit = container.querySelector('#chk-use-hit-rule');
      const inpHitsPerSet = container.querySelector('#inp-hits-per-set');
      const inpMinHitPrice = container.querySelector('#inp-min-hit-price');
      const chkUseBase = container.querySelector('#chk-use-base-range');
      const baseFields = container.querySelector('#base-range-fields');
      const inpMinBasePrice = container.querySelector('#inp-min-base-price');
      const inpMaxBasePrice = container.querySelector('#inp-max-base-price');
      const selStrategy = container.querySelector('#sel-strategy');
      const inpPrefix = container.querySelector('#inp-set-prefix');
      const simContainer = container.querySelector('#sim-stats-container');
      const btnRunSingle = container.querySelector('#btn-run-generate-single-set');
      const btnRunAll = container.querySelector('#btn-run-generate-all-sets');
      const chkAppend = container.querySelector('#chk-append-sets');

      function updateSimulation() {
        useHitRule = chkUseHit.checked;
        hitsPerSet = parseInt(inpHitsPerSet.value, 10) || 1;
        minHitPrice = parseFloat(inpMinHitPrice.value) || 5.00;
        useBaseRange = chkUseBase.checked;
        minBasePrice = parseFloat(inpMinBasePrice.value) || 0;
        maxBasePrice = parseFloat(inpMaxBasePrice.value) || Infinity;
        strategy = selStrategy.value;
        namePrefix = inpPrefix.value || 'Set #';

        const isAppend = chkAppend ? chkAppend.checked : false;
        const availablePool = isAppend ? allCards.filter(c => !c.setId) : allCards;

        const hitCount = availablePool.filter(c => (c.lastPrice || 0) >= minHitPrice).length;
        const baseCardsCount = availablePool.filter(c => {
          const p = c.lastPrice || 0;
          if (useHitRule && p >= minHitPrice) return false;
          if (useBaseRange) return p >= minBasePrice && p <= maxBasePrice;
          return true;
        }).length;

        let maxSets = 0;
        if (useHitRule && hitsPerSet > 0) {
          const maxByHits = Math.floor(hitCount / hitsPerSet);
          const neededBase = selectedPackSize - hitsPerSet;
          const maxByBase = neededBase > 0 ? Math.floor(baseCardsCount / neededBase) : maxByHits;
          maxSets = Math.min(maxByHits, maxByBase);
        } else {
          maxSets = Math.floor(availablePool.length / selectedPackSize);
        }

        const totalUsed = maxSets * selectedPackSize;
        const remaining = Math.max(0, availablePool.length - totalUsed);

        simContainer.innerHTML = `
          <div>✨ Gefundene Hits (≥ ${minHitPrice.toFixed(2)} €): <strong style="color: #facc15;">${hitCount}</strong></div>
          <div>🃏 Basis-Karten: <strong style="color: #38bdf8;">${baseCardsCount}</strong></div>
          <div>📦 Mögliche Sets: <strong style="color: #4ade80;">${maxSets} Sets à ${selectedPackSize} Karten</strong></div>
          <div>⚠️ Nicht zugeordnete Restkarten: <strong style="color: #cbd5e1;">${remaining}</strong></div>
        `;

        if (maxSets <= 0) {
          btnRunSingle.disabled = true;
          btnRunSingle.style.opacity = '0.5';
          btnRunAll.disabled = true;
          btnRunAll.style.opacity = '0.5';
          btnRunAll.textContent = '⚠️ Keine vollständigen Sets möglich';
        } else {
          btnRunSingle.disabled = false;
          btnRunSingle.style.opacity = '1';
          btnRunSingle.textContent = `📦 Nur 1 Set (${selectedPackSize} Karten)`;
          btnRunAll.disabled = false;
          btnRunAll.style.opacity = '1';
          btnRunAll.textContent = `🚀 Alle ${maxSets} Sets generieren`;
        }
      }

      chipButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          chipButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          selectedPackSize = parseInt(btn.getAttribute('data-size'), 10);
          customSizeInput.value = selectedPackSize;
          updateSimulation();
        });
      });

      customSizeInput.addEventListener('input', () => {
        const val = parseInt(customSizeInput.value, 10);
        if (!isNaN(val) && val > 0) {
          selectedPackSize = val;
          chipButtons.forEach(b => {
            if (parseInt(b.getAttribute('data-size'), 10) === val) b.classList.add('active');
            else b.classList.remove('active');
          });
          updateSimulation();
        }
      });

      chkUseHit.addEventListener('change', () => {
        container.querySelector('#hit-rule-fields').style.opacity = chkUseHit.checked ? '1' : '0.4';
        updateSimulation();
      });

      chkUseBase.addEventListener('change', () => {
        baseFields.style.display = chkUseBase.checked ? 'grid' : 'none';
        updateSimulation();
      });

      if (chkAppend) {
        chkAppend.addEventListener('change', updateSimulation);
      }

      inpHitsPerSet.addEventListener('input', updateSimulation);
      inpMinHitPrice.addEventListener('input', updateSimulation);
      inpMinBasePrice.addEventListener('input', updateSimulation);
      inpMaxBasePrice.addEventListener('input', updateSimulation);
      selStrategy.addEventListener('change', updateSimulation);
      inpPrefix.addEventListener('input', updateSimulation);

      updateSimulation();

      function executeGeneration(maxSets = null) {
        const isAppend = chkAppend ? chkAppend.checked : false;
        const config = {
          packSize: selectedPackSize,
          useHitRule: chkUseHit.checked,
          hitsPerSet: parseInt(inpHitsPerSet.value, 10) || 1,
          minHitPrice: parseFloat(inpMinHitPrice.value) || 5.00,
          useBaseRange: chkUseBase.checked,
          minBasePrice: parseFloat(inpMinBasePrice.value) || 0,
          maxBasePrice: parseFloat(inpMaxBasePrice.value) || Infinity,
          strategy: selStrategy.value,
          namePrefix: inpPrefix.value || 'Set #',
          maxSets: maxSets,
          append: isAppend,
        };

        const result = setBuilderInstance.generateSets(allCards, config);
        if (result.totalSets > 0) {
          currentModalTab = 'overview';
          renderModalContent();
          if (maxSets === 1) {
            showToast(`🎉 1 Set mit ${selectedPackSize} Karten erfolgreich erstellt!`);
          } else {
            showToast(`🎉 ${result.totalSets} Sets mit je ${selectedPackSize} Karten erfolgreich erstellt!`);
          }
        } else {
          alert(result.error || 'Fehler beim Generieren der Sets.');
        }
      }

      btnRunSingle.addEventListener('click', () => executeGeneration(1));
      btnRunAll.addEventListener('click', () => executeGeneration(null));
    }

    // --- Tab 2: Sets Übersicht ---
    function renderOverviewTab(container) {
      const sets = setBuilderInstance.getSets();
      const allCards = bulkScannerInstance.scanItems || [];
      const assignedCount = allCards.filter(c => c.setId).length;

      container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h4 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0 0 2px 0;">
              Pipeline Sets (${sets.length})
            </h4>
            <p style="color: #94a3b8; font-size: 0.82rem; margin: 0;">
              ${assignedCount} von ${allCards.length} Karten in ${sets.length} Sets zugeordnet.
            </p>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-overview-create-set" style="padding: 6px 12px; font-size: 0.8125rem;">
              ➕ Neues Set
            </button>
            <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-overview-export-whatnot" style="padding: 6px 12px; font-size: 0.8125rem;" ${sets.length === 0 ? 'disabled' : ''}>
              📥 Whatnot CSV Export
            </button>
            <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-overview-export-enriched" style="padding: 6px 12px; font-size: 0.8125rem;" ${sets.length === 0 ? 'disabled' : ''}>
              📥 Standard CSV Export
            </button>
            <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-overview-clear-all" style="padding: 6px 12px; font-size: 0.8125rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" ${sets.length === 0 ? 'disabled' : ''}>
              🗑️ Alle leeren
            </button>
          </div>
        </div>

        <div id="overview-sets-grid-container"></div>
      `;

      const gridContainer = container.querySelector('#overview-sets-grid-container');

      if (sets.length === 0) {
        gridContainer.innerHTML = `
          <div style="text-align: center; padding: 48px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.12); border-radius: 12px;">
            <p style="font-size: 1.1rem; color: #e2e8f0; font-weight: 600; margin: 0 0 8px 0;">Noch keine Sets angelegt</p>
            <p style="color: #94a3b8; font-size: 0.875rem; margin: 0 0 16px 0;">Wechsle zum Tab "Automatisch generieren", um deine ${allCards.length} Karten in gleichmäßige Sets aufzuteilen.</p>
            <button type="button" class="shadcn-btn shadcn-btn-primary" id="btn-empty-switch-generate">
              ⚙️ Jetzt Sets generieren
            </button>
          </div>
        `;
        gridContainer.querySelector('#btn-empty-switch-generate')?.addEventListener('click', () => {
          currentModalTab = 'generate';
          renderModalContent();
        });
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'set-card-grid';

      sets.forEach((set, setIndex) => {
        const stats = setBuilderInstance.calculateSetStats(set);
        const cardEl = document.createElement('div');
        cardEl.className = 'set-card-item';

        const topCardsPreviewHtml = set.cards.slice(0, 4).map(c => `
          <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #cbd5e1; background: rgba(0,0,0,0.3); padding: 3px 6px; border-radius: 4px;" title="${c.detectedName || c.rawName}">
            <span class="csv-index-badge" style="font-size: 0.68rem; padding: 1px 4px;">CSV #${c.originalIndex || c.index}</span>
            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px;">${c.nameDe || c.detectedName || c.rawName}</span>
            <span style="color: #4ade80; font-weight: 700; margin-left: auto;">${c.lastPrice !== null && c.lastPrice !== undefined ? c.lastPrice.toFixed(2) + '€' : '-'}</span>
          </div>
        `).join('');

        cardEl.innerHTML = `
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
              <div>
                <h5 style="color: #fff; font-size: 1rem; font-weight: 700; margin: 0 0 2px 0;">📦 ${set.name}</h5>
                <span class="set-card-badge">${set.cards.length} / ${set.targetSize} Karten</span>
              </div>
              <button type="button" class="btn-delete-set" data-set-id="${set.id}" title="Set löschen" style="background: transparent; border: none; color: #71717a; cursor: pointer; padding: 4px; font-size: 0.9rem; transition: color 0.15s ease;">
                🗑️
              </button>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; background: rgba(0,0,0,0.25); border-radius: 8px; padding: 8px 10px;">
              <div>
                <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">Gesamtwert:</div>
                <div style="font-size: 0.95rem; font-weight: 700; color: #4ade80;">${stats.totalValue.toFixed(2)} €</div>
              </div>
              <div>
                <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase;">Ø pro Karte:</div>
                <div style="font-size: 0.95rem; font-weight: 700; color: #38bdf8;">${stats.avgPrice.toFixed(2)} €</div>
              </div>
            </div>

            ${set.cards.length > 0 ? `
              <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px;">
                <div style="font-size: 0.7rem; color: #a1a1aa; font-weight: 600;">Karten-Vorschau (CSV-Originalnummern):</div>
                ${topCardsPreviewHtml}
                ${set.cards.length > 4 ? `<div style="font-size: 0.72rem; color: #71717a; text-align: center;">+ ${set.cards.length - 4} weitere Karten</div>` : ''}
              </div>
            ` : `
              <div style="padding: 16px; text-align: center; color: #71717a; font-size: 0.8rem;">Dieses Set ist noch leer.</div>
            `}
          </div>

          <div style="display: flex; gap: 6px; flex-wrap: wrap; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px; margin-top: auto;">
            <button type="button" class="shadcn-btn shadcn-btn-primary btn-inspect-set" data-set-id="${set.id}" style="flex: 1; padding: 6px 10px; font-size: 0.8rem; justify-content: center;">
              👁️ Sortieren & Drag & Drop
            </button>
            <button type="button" class="shadcn-btn shadcn-btn-secondary btn-export-single-set" data-set-id="${set.id}" title="Als Whatnot CSV exportieren" style="padding: 6px 8px; font-size: 0.8rem;">
              📥 CSV
            </button>
            <button type="button" class="shadcn-btn shadcn-btn-secondary btn-stream-single-set" data-set-id="${set.id}" title="Dieses Set in Stream Overlay laden" style="padding: 6px 8px; font-size: 0.8rem; color: #60a5fa;">
              📺 Overlay
            </button>
          </div>
        `;

        // Action Handlers
        cardEl.querySelector('.btn-inspect-set').addEventListener('click', () => {
          currentDetailSetId = set.id;
          currentModalTab = 'detail';
          renderModalContent();
        });

        cardEl.querySelector('.btn-delete-set').addEventListener('click', () => {
          if (confirm(`Set '${set.name}' wirklich löschen? Die Karten werden wieder freigegeben.`)) {
            setBuilderInstance.deleteSet(set.id, allCards);
            renderModalContent();
          }
        });

        cardEl.querySelector('.btn-export-single-set').addEventListener('click', () => {
          const csvContent = setBuilderInstance.exportSetToWhatnotCSV(set);
          if (!csvContent) return;
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.setAttribute('href', url);
          link.setAttribute('download', `${set.name.replace(/[^A-Za-z0-9]/g, '_')}_whatnot.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        });

        cardEl.querySelector('.btn-stream-single-set').addEventListener('click', async () => {
          if (set.cards.length === 0) {
            alert('Dieses Set hat keine Karten.');
            return;
          }
          activeStreamQueue = [...set.cards];
          try { localStorage.setItem('cache_stream_queue', JSON.stringify(activeStreamQueue)); } catch(e) {}
          saveCachedUserData(currentUser?.id);
          await syncStreamQueueToSupabase(activeStreamQueue, 0);
          closeModal();
          navigate('/stream-overlay');
        });

        grid.appendChild(cardEl);
      });

      gridContainer.appendChild(grid);

      // Top action bar handlers
      container.querySelector('#btn-overview-create-set')?.addEventListener('click', () => {
        const name = prompt('Name für das neue Set:', `Set #${sets.length + 1}`);
        if (name && name.trim()) {
          setBuilderInstance.createEmptySet(name.trim());
          renderModalContent();
        }
      });

      container.querySelector('#btn-overview-export-whatnot')?.addEventListener('click', () => {
        const csvContent = setBuilderInstance.exportAllSetsToWhatnotCSV();
        if (!csvContent) return;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `all_sets_whatnot_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });

      container.querySelector('#btn-overview-export-enriched')?.addEventListener('click', () => {
        const csvContent = setBuilderInstance.exportAllSetsToEnrichedCSV();
        if (!csvContent) return;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `all_sets_overview_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });

      container.querySelector('#btn-overview-clear-all')?.addEventListener('click', () => {
        if (confirm('Wirklich ALLE Sets löschen und alle Karten wieder in den Pool freigeben?')) {
          setBuilderInstance.clearAllSets(allCards);
          renderModalContent();
        }
      });
    }

    // --- Tab 3: Set Detail & Drag & Drop Reordering ---
    function renderDetailTab(container, setId) {
      const set = setBuilderInstance.getSet(setId);
      if (!set) {
        container.innerHTML = `<div style="padding: 24px; color: #ef4444;">Set nicht gefunden.</div>`;
        return;
      }

      const stats = setBuilderInstance.calculateSetStats(set);

      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- Top Bar -->
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-detail-back-overview" style="padding: 6px 12px; font-size: 0.8125rem;">
                ← Zurück zur Übersicht
              </button>
              <h4 style="font-size: 1.15rem; font-weight: 700; color: #fff; margin: 0;">
                📦 ${set.name}
              </h4>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <div style="background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 4px 10px; font-size: 0.8rem; display: flex; gap: 10px;">
                <span>Karten: <strong style="color: #38bdf8;">${set.cards.length} / ${set.targetSize}</strong></span>
                <span>Gesamtwert: <strong style="color: #4ade80;">${stats.totalValue.toFixed(2)} €</strong></span>
                <span>Ø: <strong style="color: #facc15;">${stats.avgPrice.toFixed(2)} €</strong></span>
              </div>
            </div>
          </div>

          <!-- Quick Reorder Chips -->
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="font-size: 0.8rem; font-weight: 600; color: #a1a1aa; display: flex; align-items: center; gap: 6px;">
              <span>Schnell-Sortierung:</span>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-reorder-hits-end" style="padding: 4px 10px; font-size: 0.78rem; border-color: rgba(234, 179, 8, 0.4); color: #facc15;">
                🔀 Hits ans Ende (Pack Hype)
              </button>
              <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-reorder-interleave" style="padding: 4px 10px; font-size: 0.78rem;">
                🔀 Hits gleichmäßig verteilen
              </button>
              <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-reorder-csv-order" style="padding: 4px 10px; font-size: 0.78rem; color: #38bdf8;">
                🔄 Original CSV-Reihenfolge
              </button>
              <button type="button" class="shadcn-btn shadcn-btn-secondary" id="btn-detail-export-csv" style="padding: 4px 10px; font-size: 0.78rem;">
                📥 CSV Export
              </button>
              <button type="button" class="shadcn-btn shadcn-btn-primary" id="btn-detail-stream-overlay" style="padding: 4px 10px; font-size: 0.78rem;">
                📺 Streamen
              </button>
            </div>
          </div>

          <div style="font-size: 0.8rem; color: #94a3b8; display: flex; justify-content: space-between; align-items: center;">
            <span>Ziehe Karten per <strong>Drag & Drop</strong> oder nutze die Pfeiltasten, um die genaue Auspack-Reihenfolge einzustellen.</span>
            <span style="color: #38bdf8; font-weight: 600;">Jede Karte behält ihre originale CSV-Nummer (#)</span>
          </div>

          <!-- Drag and Drop List Container -->
          <div class="set-dnd-list" id="set-dnd-list-container"></div>
        </div>
      `;

      container.querySelector('#btn-detail-back-overview').addEventListener('click', () => {
        currentModalTab = 'overview';
        renderModalContent();
      });

      container.querySelector('#btn-reorder-hits-end').addEventListener('click', () => {
        setBuilderInstance.moveHitsToEnd(set.id, 5.0);
        renderDndCardsList();
        showToast('Hits wurden an das Ende des Sets verschoben!');
      });

      container.querySelector('#btn-reorder-interleave').addEventListener('click', () => {
        setBuilderInstance.interleaveHits(set.id, 5.0);
        renderDndCardsList();
        showToast('Hits wurden gleichmäßig über das Set verteilt!');
      });

      container.querySelector('#btn-reorder-csv-order').addEventListener('click', () => {
        setBuilderInstance.resetSetToOriginalOrder(set.id);
        renderDndCardsList();
        showToast('Set zurück auf originale CSV-Reihenfolge sortiert!');
      });

      container.querySelector('#btn-detail-export-csv').addEventListener('click', () => {
        const csvContent = setBuilderInstance.exportSetToWhatnotCSV(set);
        if (!csvContent) return;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${set.name.replace(/[^A-Za-z0-9]/g, '_')}_whatnot.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });

      container.querySelector('#btn-detail-stream-overlay').addEventListener('click', async () => {
        if (set.cards.length === 0) return;
        activeStreamQueue = [...set.cards];
        try { localStorage.setItem('cache_stream_queue', JSON.stringify(activeStreamQueue)); } catch(e) {}
        saveCachedUserData(currentUser?.id);
        await syncStreamQueueToSupabase(activeStreamQueue, 0);
        closeModal();
        navigate('/stream-overlay');
      });

      const dndListContainer = container.querySelector('#set-dnd-list-container');

      function renderDndCardsList() {
        dndListContainer.innerHTML = '';

        if (set.cards.length === 0) {
          dndListContainer.innerHTML = `
            <div style="padding: 32px; text-align: center; color: #71717a; border: 1px dashed rgba(255,255,255,0.1); border-radius: 8px;">
              Dieses Set ist leer. Füge Karten in der Haupttabelle über den Button "+ Set" hinzu.
            </div>
          `;
          return;
        }

        let draggedIndex = null;

        set.cards.forEach((card, index) => {
          const itemEl = document.createElement('div');
          itemEl.className = 'set-dnd-item';
          itemEl.setAttribute('draggable', 'true');
          itemEl.setAttribute('data-index', index);

          const origIdx = card.originalIndex !== undefined ? card.originalIndex : card.index || index + 1;
          const isHit = (card.lastPrice || 0) >= 5.0;
          const imgMarkup = card.imageUrl ? `<img src="${getProxiedImageUrl(card.imageUrl)}" style="width: 32px; height: 44px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer;" alt="Card" />` : '';

          itemEl.innerHTML = `
            <div class="set-drag-handle" title="Ziehen zum Neuanordnen">
              <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 8h16M4 16h16" />
              </svg>
            </div>

            <div style="font-size: 0.8125rem; font-weight: 700; color: #71717a; width: 28px; text-align: center;">
              #${index + 1}
            </div>

            <span class="csv-index-badge" title="Ursprüngliche Nummer in der importierten CSV-Datei">
              CSV #${origIdx}
            </span>

            ${imgMarkup}

            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-weight: 700; color: #fff; font-size: 0.875rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${card.nameDe || card.detectedName || card.rawName}
                </span>
                ${card.detectedCode ? `<span style="font-size: 0.75rem; color: #a1a1aa; font-family: monospace;">(${card.detectedCode})</span>` : ''}
                ${isHit ? `<span class="hit-slot-badge">✨ Hit</span>` : ''}
              </div>
              <div style="font-size: 0.75rem; color: #71717a; display: flex; gap: 8px;">
                <span>${card.setNameDe || card.rawSet || 'TCG'}</span>
                <span>•</span>
                <span>${card.rawCondition || 'NM'}</span>
                <span>•</span>
                <span>${card.rawLanguage || 'EN'}</span>
              </div>
            </div>

            <div style="text-align: right; margin-right: 8px;">
              <div style="font-size: 0.9375rem; font-weight: 700; color: #4ade80;">
                ${card.lastPrice !== null && card.lastPrice !== undefined ? card.lastPrice.toFixed(2) + ' €' : '-'}
              </div>
              ${card.tcgplayerPrice ? `<div style="font-size: 0.72rem; color: #60a5fa;">$${Number(card.tcgplayerPrice).toFixed(2)}</div>` : ''}
            </div>

            <div style="display: flex; align-items: center; gap: 4px;">
              <button type="button" class="btn-dnd-move-up" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; border-radius: 4px; padding: 3px 6px; cursor: pointer; font-size: 0.75rem;" title="Nach oben">▲</button>
              <button type="button" class="btn-dnd-move-down" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; border-radius: 4px; padding: 3px 6px; cursor: pointer; font-size: 0.75rem;" title="Nach unten">▼</button>
              <button type="button" class="btn-dnd-remove" style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #f87171; border-radius: 4px; padding: 3px 6px; cursor: pointer; font-size: 0.75rem; margin-left: 4px;" title="Aus Set entfernen">✕</button>
            </div>
          `;

          if (imgMarkup) {
            itemEl.querySelector('img')?.addEventListener('click', (e) => {
              e.stopPropagation();
              showLightbox(card.imageUrl);
            });
          }

          itemEl.querySelector('.btn-dnd-move-up').addEventListener('click', (e) => {
            e.stopPropagation();
            if (index > 0) {
              setBuilderInstance.reorderCard(set.id, index, index - 1);
              renderDndCardsList();
            }
          });

          itemEl.querySelector('.btn-dnd-move-down').addEventListener('click', (e) => {
            e.stopPropagation();
            if (index < set.cards.length - 1) {
              setBuilderInstance.reorderCard(set.id, index, index + 1);
              renderDndCardsList();
            }
          });

          itemEl.querySelector('.btn-dnd-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            setBuilderInstance.removeCardFromSet(card);
            renderDndCardsList();
            showToast(`Karte #${origIdx} aus Set '${set.name}' entfernt.`);
          });

          // Drag & Drop event bindings
          itemEl.addEventListener('dragstart', (e) => {
            draggedIndex = index;
            itemEl.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
          });

          itemEl.addEventListener('dragend', () => {
            itemEl.classList.remove('is-dragging');
            dndListContainer.querySelectorAll('.set-dnd-item').forEach(el => {
              el.classList.remove('drag-target-top', 'drag-target-bottom');
            });
          });

          itemEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = itemEl.getBoundingClientRect();
            const offset = e.clientY - rect.top;
            if (offset < rect.height / 2) {
              itemEl.classList.add('drag-target-top');
              itemEl.classList.remove('drag-target-bottom');
            } else {
              itemEl.classList.add('drag-target-bottom');
              itemEl.classList.remove('drag-target-top');
            }
          });

          itemEl.addEventListener('dragleave', () => {
            itemEl.classList.remove('drag-target-top', 'drag-target-bottom');
          });

          itemEl.addEventListener('drop', (e) => {
            e.preventDefault();
            itemEl.classList.remove('drag-target-top', 'drag-target-bottom');
            if (draggedIndex === null || draggedIndex === index) return;

            const rect = itemEl.getBoundingClientRect();
            const offset = e.clientY - rect.top;
            let targetIdx = index;
            if (offset > rect.height / 2 && draggedIndex < index) {
              targetIdx = index;
            } else if (offset > rect.height / 2 && draggedIndex > index) {
              targetIdx = index + 1;
            }

            setBuilderInstance.reorderCard(set.id, draggedIndex, targetIdx);
            draggedIndex = null;
            renderDndCardsList();
          });

          dndListContainer.appendChild(itemEl);
        });
      }

      renderDndCardsList();
    }

    renderModalContent();
  }
}

// Realtime WebSocket broadcast & DB fallback for Cross-Device Stream Overlay (Mac <-> iPad)
let streamChannel = null;

function initStreamRealtimeSync() {
  if (!currentUser?.id) return;
  
  if (streamChannel) {
    try { supabase.removeChannel(streamChannel); } catch (e) {}
  }

  streamChannel = supabase.channel(`stream_overlay_${currentUser.id}`);

  streamChannel
    .on('broadcast', { event: 'queue_update' }, (payload) => {
      console.log('[Stream Realtime] Received queue_update broadcast:', payload);
      if (payload && payload.payload) {
        const { queue, index } = payload.payload;
        if (queue && Array.isArray(queue)) {
          activeStreamQueue = queue;
          if (streamOverlayInstance) {
            streamOverlayInstance.queue = queue;
            streamOverlayInstance.currentIndex = index || 0;
            streamOverlayInstance.render();
          }
        }
      }
    })
    .on('broadcast', { event: 'request_queue' }, () => {
      console.log('[Stream Realtime] Received request_queue broadcast');
      if (activeStreamQueue && activeStreamQueue.length > 0) {
        broadcastStreamQueue(activeStreamQueue, streamOverlayInstance?.currentIndex || 0);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Stream Realtime] Subscribed to stream_overlay channel');
        streamChannel.send({
          type: 'broadcast',
          event: 'request_queue',
          payload: {}
        });
      }
    });
}

function broadcastStreamQueue(queue, currentIndex = 0) {
  if (!streamChannel || !currentUser?.id) return;
  streamChannel.send({
    type: 'broadcast',
    event: 'queue_update',
    payload: { queue, index: currentIndex, timestamp: Date.now() }
  });
}

async function syncStreamQueueToSupabase(queue, currentIndex = 0) {
  if (!currentUser?.id) return;

  // 1. Broadcast update to all connected devices in realtime via WebSockets
  broadcastStreamQueue(queue, currentIndex);

  // 2. Persist to marked_cards table for fallback if another device connects later
  try {
    const payload = JSON.stringify({ queue, index: currentIndex, timestamp: Date.now() });

    await supabase
      .from('marked_cards')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('card_id', '__STREAM_QUEUE__');

    if (queue && queue.length > 0) {
      await supabase
        .from('marked_cards')
        .insert([{
          user_id: currentUser.id,
          card_id: '__STREAM_QUEUE__',
          tcg: 'StreamQueue',
          comment: payload,
          created_at: new Date().toISOString()
        }]);
    }
  } catch (e) {
    console.warn('Cross-device stream sync warning:', e);
  }
}

async function fetchStreamQueueFromSupabase() {
  if (!currentUser?.id) return null;
  try {
    const encQueueId = encodeURIComponent('__STREAM_QUEUE__');
    const url = `${SUPABASE_URL}/rest/v1/marked_cards?select=comment&user_id=eq.${encodeURIComponent(currentUser.id)}&card_id=eq.${encQueueId}&order=created_at.desc&limit=1`;
    const resp = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      credentials: 'omit'
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.length > 0 && data[0].comment) {
        try {
          const parsed = JSON.parse(data[0].comment);
          if (parsed && parsed.queue && parsed.queue.length > 0) {
            return { queue: parsed.queue, index: parsed.index || 0 };
          }
        } catch (err) {}
      }
    }
  } catch (e) {
    console.warn('Error fetching cross-device stream queue:', e);
  }
  return null;
}

// Stream Overlay Tab Renderer with Realtime Sync
async function renderStreamOverlayTab(container) {
  if (streamOverlayInstance) {
    streamOverlayInstance.destroy();
    streamOverlayInstance = null;
  }
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'dashboard-content stream-overlay-view';
  wrapper.id = 'stream-overlay-view-wrapper';
  container.appendChild(wrapper);

  streamOverlayInstance = new StreamOverlay(wrapper, {
    onChange: (queue, index) => {
      syncStreamQueueToSupabase(queue, index);
    }
  });

  // 1. Restore from cache if memory queue is empty
  if (!activeStreamQueue || activeStreamQueue.length === 0) {
    try {
      const cached = localStorage.getItem('cache_stream_queue');
      if (cached) {
        activeStreamQueue = JSON.parse(cached) || [];
      }
    } catch(e) {}
  }

  // 2. Immediately render queue if available
  if (activeStreamQueue && activeStreamQueue.length > 0) {
    streamOverlayInstance.loadQueue(activeStreamQueue);
  } else {
    streamOverlayInstance.render();
  }

  // 3. Initialize WebSockets Realtime Channel
  initStreamRealtimeSync();

  // 4. If logged in and queue is still empty, query cloud backup
  if (currentUser?.id && (!activeStreamQueue || activeStreamQueue.length === 0)) {
    const synced = await fetchStreamQueueFromSupabase();
    if (synced && synced.queue && synced.queue.length > 0) {
      activeStreamQueue = synced.queue;
      streamOverlayInstance.loadQueue(activeStreamQueue);
      streamOverlayInstance.currentIndex = synced.index || 0;
      streamOverlayInstance.render();
    }
  }
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
async function loadCardDetails(cardId, tcg, pushState = true, initialImageUrl = null) {
  cleanupDetailKeydownListener();

  const safeId = (cardId || '').trim();
  const safeTcg = (tcg || 'OnePiece').trim();

  if (!safeId) {
    navigate('/watchlist', false);
    return;
  }

  setView('loading');

  if (pushState) {
    const targetHash = `#/detail?card_id=${encodeURIComponent(safeId)}&tcg=${encodeURIComponent(safeTcg)}`;
    try {
      if (window.location.hash !== targetHash) {
        window.history.pushState(null, '', targetHash);
      }
    } catch(e) {
      window.location.hash = targetHash;
    }
  }
  try {
    const rawId = safeId;
    const cleanPattern = rawId.split('/').pop().replace(/[\/\\%_]/g, '').trim();
    const extractedCode = extractCardCode(rawId);

    // Parallel fetch for sub-50ms performance
    const historyPromise = (async () => {
      // 1. Try exact card_id match
      try {
        const { data, error } = await supabase
          .from('price_history')
          .select('price, condition, seller_country, language, comment, scanned_at')
          .eq('card_id', rawId)
          .order('scanned_at', { ascending: true });
        if (!error && data && data.length > 0) return data;
      } catch (e) {}

      // 2. Try ilike with extractedCode (e.g. 94/123 or P-033 or MEW173)
      if (extractedCode) {
        try {
          const { data, error } = await supabase
            .from('price_history')
            .select('price, condition, seller_country, language, comment, scanned_at')
            .ilike('card_id', `%${extractedCode}%`)
            .order('scanned_at', { ascending: true });
          if (!error && data && data.length > 0) return data;
        } catch (e) {}
      }

      // 2b. Try compound variant match (e.g. CBB4C 1301/07 -> V1-CBB4C13 or CBB4C13)
      const parsedComp = parseCardCodeComponents(extractedCode || rawId, rawId);
      if (parsedComp && parsedComp.isCompound) {
        if (parsedComp.variantTag && parsedComp.setCardCode) {
          try {
            const { data, error } = await supabase
              .from('price_history')
              .select('price, condition, seller_country, language, comment, scanned_at')
              .ilike('card_id', `%${parsedComp.variantTag}%${parsedComp.setCardCode}%`)
              .order('scanned_at', { ascending: true });
            if (!error && data && data.length > 0) return data;
          } catch (e) {}
        }
        if (parsedComp.setCardCode) {
          try {
            const { data, error } = await supabase
              .from('price_history')
              .select('price, condition, seller_country, language, comment, scanned_at')
              .ilike('card_id', `%${parsedComp.setCardCode}%`)
              .order('scanned_at', { ascending: true });
            if (!error && data && data.length > 0) return data;
          } catch (e) {}
        }
      }

      // 3. Try ilike with cleanPattern (last path segment)
      if (cleanPattern && cleanPattern.length >= 3) {
        try {
          const { data, error } = await supabase
            .from('price_history')
            .select('price, condition, seller_country, language, comment, scanned_at')
            .ilike('card_id', `%${cleanPattern}%`)
            .order('scanned_at', { ascending: true });
          if (!error && data && data.length > 0) return data;
        } catch (e) {}
      }

      return [];
    })();

    const imagePromise = (async () => {
      if (initialImageUrl && !isPlaceholderImage(initialImageUrl)) return initialImageUrl;
      try {
        // 1. Try exact card_id match in card_images
        const { data: d1 } = await supabase
          .from('card_images')
          .select('image_url')
          .in('card_id', [rawId, rawId.startsWith('/') ? rawId.slice(1) : '/' + rawId])
          .limit(2);
        const validD1 = d1?.find(d => d.image_url && !isPlaceholderImage(d.image_url));
        if (validD1) return validD1.image_url;

        // 2. Try ilike with extractedCode / pattern
        const pattern = extractedCode || cleanPattern;
        if (pattern && pattern.length >= 3) {
          const { data: d2 } = await supabase
            .from('card_images')
            .select('image_url')
            .ilike('card_id', `%${pattern}%`)
            .limit(5);
          const validD2 = d2?.find(d => d.image_url && !isPlaceholderImage(d.image_url));
          if (validD2) return validD2.image_url;
        }

        // 3. Try set name + number matching in card_images
        const meta = formatCardMeta(rawId, '', '', '', tcg);
        const parsed = parseCardCodeComponents(meta.cardCode, meta.nameEn, meta.setNameDe);
        const num = parsed?.cardNum || meta.cardCode.replace(/^[A-Za-z]+[-_\s]*/, '').split('/')[0].replace(/\D/g, '');
        const setSlug = (meta.setNameDe || parsed?.setCode || '').replace(/[-_\s]+/g, '-').trim();
        if (setSlug && num && num.length >= 1 && num.length <= 4) {
          const { data: d3 } = await supabase
            .from('card_images')
            .select('image_url')
            .ilike('card_id', `%${setSlug}%`)
            .ilike('card_id', `%${num}%`)
            .limit(5);
          const validD3 = d3?.find(d => d.image_url && !isPlaceholderImage(d.image_url));
          if (validD3) return validD3.image_url;
        }
      } catch (e) {}
      return null;
    })();

    const fetchTimeoutPromise = new Promise((resolve) => setTimeout(() => resolve([[], null]), 4500));
    const [rawHistoryData, globalImageUrl] = await Promise.race([
      Promise.all([historyPromise, imagePromise]),
      fetchTimeoutPromise
    ]);
    const parsedHistory = (rawHistoryData || []).map(parseHistoryItem);

    // Extract unique filter combinations
    const rawConditions = parsedHistory.map(h => h.condition).filter(Boolean);
    const rawLocations = parsedHistory.map(h => h.seller_country).filter(Boolean);
    const rawLanguages = parsedHistory.map(h => h.language).filter(Boolean);

    const conditions = Array.from(new Set(rawConditions)).sort();
    const locations = Array.from(new Set(rawLocations)).sort();
    const languages = Array.from(new Set(rawLanguages)).sort();

    // Ensure 'ALL' option is at the top
    if (!conditions.includes('ALL')) conditions.unshift('ALL');
    if (!locations.includes('ALL')) locations.unshift('ALL');
    if (!languages.includes('ALL')) languages.unshift('ALL');

    // Read initial bookmarked & collection states
    const bookmarkRecord = (markedCards || []).find(m => m.card_id === cardId || (cleanPattern && m.card_id?.includes(cleanPattern)));
    const isCurrentlyMarked = !!bookmarkRecord;
    const bookmarkImageUrl = bookmarkRecord ? bookmarkRecord.image_url : null;

    const collectionRecord = (collectionCards || []).find(m => m.card_id === cardId || (cleanPattern && m.card_id?.includes(cleanPattern)));
    const isCurrentlyCollected = !!collectionRecord;
    const collectionImageUrl = collectionRecord ? collectionRecord.image_url : null;

    // Read initial saved filters from bookmark, collection record, or latest scan history
    let prefCond = bookmarkRecord?.condition || collectionRecord?.condition || null;
    let prefLoc = bookmarkRecord?.seller_country || collectionRecord?.seller_country || null;
    let prefLang = bookmarkRecord?.language || collectionRecord?.language || null;

    if ((!prefCond || !prefLoc || !prefLang) && parsedHistory.length > 0) {
      const latestHist = parsedHistory[parsedHistory.length - 1];
      if (!prefCond) prefCond = latestHist.condition;
      if (!prefLoc) prefLoc = latestHist.seller_country;
      if (!prefLang) prefLang = latestHist.language;
    }

    const initCondition = (prefCond && prefCond !== 'ALL') ? prefCond : 'ALL';
    const initLocation = (prefLoc && prefLoc !== 'ALL') ? prefLoc : 'ALL';
    const initLanguage = (prefLang && prefLang !== 'ALL') ? prefLang : 'ALL';

    if (initCondition !== 'ALL' && !conditions.includes(initCondition)) conditions.push(initCondition);
    if (initLocation !== 'ALL' && !locations.includes(initLocation)) locations.push(initLocation);
    if (initLanguage !== 'ALL' && !languages.includes(initLanguage)) languages.push(initLanguage);

    const historyImg = parsedHistory.find(h => h.imageUrl && !isPlaceholderImage(h.imageUrl))?.imageUrl;
    const finalImageUrl = (!isPlaceholderImage(initialImageUrl) ? initialImageUrl : null) ||
                          (!isPlaceholderImage(globalImageUrl) ? globalImageUrl : null) ||
                          (!isPlaceholderImage(bookmarkImageUrl) ? bookmarkImageUrl : null) ||
                          (!isPlaceholderImage(collectionImageUrl) ? collectionImageUrl : null) ||
                          historyImg ||
                          getCachedCardImage(cardId) ||
                          null;
    if (finalImageUrl) {
      try {
        localStorage.setItem(`img_cache_${cardId}`, finalImageUrl);
      } catch (e) {}
    }

    activeCardDetails = {
      cardId,
      tcg,
      rawHistory: parsedHistory,
      conditions: conditions.length > 0 ? conditions : ['ALL', 'NM'],
      locations: locations.length > 0 ? locations : ['ALL', 'DE'],
      languages: languages.length > 0 ? languages : ['ALL', 'EN'],
      isMarked: isCurrentlyMarked,
      isCollected: isCurrentlyCollected,
      imageUrl: finalImageUrl,
      
      selectedCondition: initCondition,
      selectedLocation: initLocation,
      selectedLanguage: initLanguage
    };

    setView('detail');

  } catch (err) {
    console.error('Error loading card details view:', err);
    activeCardDetails = {
      cardId,
      tcg,
      rawHistory: [],
      conditions: ['ALL', 'NM'],
      locations: ['ALL', 'DE'],
      languages: ['ALL', 'EN'],
      isMarked: (markedCards || []).some(m => m.card_id === cardId),
      isCollected: (collectionCards || []).some(m => m.card_id === cardId),
      imageUrl: initialImageUrl || getCachedCardImage(cardId) || null,
      selectedCondition: 'ALL',
      selectedLocation: 'ALL',
      selectedLanguage: 'ALL'
    };
    setView('detail');
  }
}

// RENDER: Detail View Panel
function renderDetail(container) {
  const details = activeCardDetails;
  if (!details) return null;

  // Determine dynamic back button label & destination path based on origin screen
  let backLabel = 'Watchlist';
  let backPath = '/watchlist';

  if (lastOriginScreen === 'collection') {
    backLabel = 'Collection';
    backPath = '/collection';
  } else if (lastOriginScreen === 'analytics' || lastOriginScreen === 'search') {
    backLabel = 'Analytics';
    backPath = '/analytics';
  } else if (lastOriginScreen === 'watchlist' || lastOriginScreen === 'marked') {
    backLabel = 'Watchlist';
    backPath = '/watchlist';
  } else {
    if ((collectionCards || []).some(c => c && c.card_id === details.cardId)) {
      backLabel = 'Collection';
      backPath = '/collection';
    } else if ((markedCards || []).some(m => m && m.card_id === details.cardId)) {
      backLabel = 'Watchlist';
      backPath = '/watchlist';
    } else {
      backLabel = 'Analytics';
      backPath = '/analytics';
    }
  }

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
      ${backLabel}
    </button>
    <div style="display: flex; align-items: center; gap: 12px;">
      <button id="btn-detail-collection" class="btn-detail-collection" title="Sammlung umschalten">
        <svg class="collection-icon" viewBox="0 0 24 24" stroke-width="2">
          <rect x="3" y="3" width="12" height="12" rx="2" />
          <path d="M9 15v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
        </svg>
      </button>
      <button id="btn-detail-star" class="btn-detail-star" title="Merkzettel umschalten">
        <svg class="star-icon" viewBox="0 0 24 24" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>
    </div>
  `;
  wrapper.appendChild(header);

  const starBtn = header.querySelector('#btn-detail-star');
  const starIcon = starBtn.querySelector('svg');
  const collectBtn = header.querySelector('#btn-detail-collection');
  const collectIcon = collectBtn.querySelector('svg');
  
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

  const updateCollectIconStyle = () => {
    if (details.isCollected) {
      collectBtn.innerHTML = `
        <svg class="collection-icon" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px;">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      `;
    } else {
      collectBtn.innerHTML = `
        <svg class="collection-icon" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.6)" stroke-width="2" style="width: 24px; height: 24px;">
          <rect x="3" y="3" width="12" height="12" rx="2" />
          <path d="M9 15v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
        </svg>
      `;
    }
  };
  updateCollectIconStyle();

  header.querySelector('#btn-back').addEventListener('click', () => {
    navigate(backPath);
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
          image_url: details.imageUrl,
          condition: details.selectedCondition !== 'ALL' ? details.selectedCondition : null,
          language: details.selectedLanguage !== 'ALL' ? details.selectedLanguage : null,
          seller_country: details.selectedLocation !== 'ALL' ? details.selectedLocation : null
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

  // Toggle collection in DB
  collectBtn.addEventListener('click', async () => {
    collectBtn.style.pointerEvents = 'none';
    const originalCollectedState = details.isCollected;
    try {
      if (originalCollectedState) {
        // Delete collection card
        const { error } = await supabase
          .from('collection_cards')
          .delete()
          .eq('user_id', currentUser.id)
          .eq('card_id', details.cardId);

        if (error) throw error;
        details.isCollected = false;
        showToast('Karte aus Collection entfernt!');
      } else {
        // Create collection card
        const collectData = {
          user_id: currentUser.id,
          tcg: details.tcg,
          card_id: details.cardId,
          image_url: details.imageUrl,
          condition: details.selectedCondition !== 'ALL' ? details.selectedCondition : null,
          language: details.selectedLanguage !== 'ALL' ? details.selectedLanguage : null,
          seller_country: details.selectedLocation !== 'ALL' ? details.selectedLocation : null
        };
        const { error } = await supabase
          .from('collection_cards')
          .insert(collectData);

        if (error) throw error;
        details.isCollected = true;
        showToast('Karte zur Collection hinzugefügt!');
      }
      await fetchCollectionCards(); // Refresh collectionCards local copy from database!
      updateCollectIconStyle();
    } catch (err) {
      console.error('Collection toggle failed:', err.message);
    } finally {
      collectBtn.style.pointerEvents = 'auto';
    }
  });
  const detailBody = document.createElement('div');
  detailBody.className = 'detail-view';
  wrapper.appendChild(detailBody);

  // 1. Meta Header Area
  const meta = formatCardMeta(details.cardId, '', '', '', details.tcg);
  const cmSearchUrl = buildCardmarketSearchUrl({ cardId: details.cardId, name: meta.nameDe });
  const tcgplayerSearchUrl = getTCGPlayerSearchUrl(meta, { tcg: details.tcg });
  const metaHeader = document.createElement('div');
  metaHeader.className = 'detail-meta-header';
  metaHeader.innerHTML = `
    <span class="hero-tcg">${details.tcg}</span>
    <h1 class="hero-title">${meta.nameDe}</h1>
    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0 8px 0;">
      ${meta.setNameDe ? `<span style="font-size: 0.8rem; color: #cbd5e1; background: rgba(255,255,255,0.06); padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); font-weight: 500;">📁 ${meta.setNameDe}</span>` : ''}
      ${meta.cardCode ? `<span style="font-size: 0.8rem; font-weight: 600; color: #fff; background: rgba(255,255,255,0.06); padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">${meta.cardCode}</span>` : ''}
      ${meta.variant ? `<span style="font-size: 0.78rem; font-weight: 700; color: #d8b4fe; background: rgba(168, 85, 247, 0.15); padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(168, 85, 247, 0.35);">✨ ${meta.variantLabel || `Variante ${meta.variant}`}</span>` : ''}
    </div>
    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px;">
      <a href="${cmSearchUrl}" target="_blank" rel="noopener noreferrer" class="cardmarket-link" style="font-size: 0.78rem; color: #60a5fa; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; transition: color 0.2s;">
        🇪🇺 Auf Cardmarket ansehen ↗
      </a>
      <span style="color: #52525b;">•</span>
      <a href="${tcgplayerSearchUrl}" target="_blank" rel="noopener noreferrer" class="tcgplayer-link" style="font-size: 0.78rem; color: #93c5fd; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; transition: color 0.2s;">
        🇺🇸 Auf TCGPlayer ansehen ↗
      </a>
    </div>
  `;
  detailBody.appendChild(metaHeader);

  // 2. Image Area
  const imageBox = document.createElement('div');
  imageBox.className = 'detail-image-box';
  imageBox.innerHTML = `
    <div class="hero-img-wrapper" style="position: relative; display: block;">
      <img class="hero-img" src="${getProxiedImageUrl(details.imageUrl)}" referrerpolicy="no-referrer" onerror="handleCardImageError(this)">
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

        // Upload to Storage or compress base64 fallback
        const uploadedUrl = await uploadImageToStorage(details.cardId, base64Raw);

        // 1. Save globally in card_images table (replaces the previous one if it exists)
        const { error: globalErr } = await supabase
          .from('card_images')
          .upsert({
            card_id: details.cardId,
            tcg: details.tcg,
            image_url: uploadedUrl,
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
            image_url: uploadedUrl
          });

        if (error) throw error;

        setCachedCardImage(details.cardId, uploadedUrl);
        await fetchMarkedCards(); // Refresh local watchlist copy in memory!

        details.imageUrl = uploadedUrl;
        const heroImg = imageBox.querySelector('.hero-img');
        if (heroImg) {
          heroImg.src = uploadedUrl;
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
          <span>Aktuell (CM)</span>
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
      <div class="detail-tile glass-panel" id="detail-tcgplayer-tile" style="border-color: rgba(59, 130, 246, 0.3); background: rgba(30, 58, 138, 0.15);">
        <div class="tile-tag" style="background: rgba(59, 130, 246, 0.2); color: #93c5fd; display: flex; align-items: center; justify-content: space-between;">
          <span>🇺🇸 TCGPlayer</span>
          <span style="font-size: 0.7rem; font-weight: 700;">USD</span>
        </div>
        <div class="tile-price" id="detail-tcgplayer-price" style="color: #60a5fa;">Lädt...</div>
        <div class="tile-meta" id="detail-tcgplayer-meta">
          <a href="${tcgplayerSearchUrl}" target="_blank" rel="noopener noreferrer" style="color: #93c5fd; text-decoration: underline; font-weight: 600;">TCGPlayer Angebot ↗</a>
        </div>
      </div>
    `;

    fetchTCGPlayerPrice(meta, { tcg: details.tcg }).then(tcgp => {
      const priceEl = statsSection.querySelector('#detail-tcgplayer-price');
      const metaEl = statsSection.querySelector('#detail-tcgplayer-meta');
      if (priceEl && tcgp?.priceUsd) {
        priceEl.textContent = `$ ${Number(tcgp.priceUsd).toFixed(2)}`;
        if (metaEl) {
          const parts = [];
          if (tcgp.lowPrice) parts.push(`<span>Low: $ ${Number(tcgp.lowPrice).toFixed(2)}</span>`);
          if (tcgp.midPrice) parts.push(`<span>Mid: $ ${Number(tcgp.midPrice).toFixed(2)}</span>`);
          parts.push(`<a href="${tcgp.url}" target="_blank" rel="noopener noreferrer" style="color: #93c5fd; text-decoration: underline; font-weight: 600;">TCGPlayer Angebot ↗</a>`);
          metaEl.innerHTML = parts.join('');
        }
      } else if (priceEl) {
        priceEl.textContent = 'Auf Anfrage';
        priceEl.style.fontSize = '1.1rem';
      }
    }).catch(() => {});

    // 2. Render SVG Chart
    if (filteredHistory.length < 2) {
      chartSection.innerHTML = `
        <div class="chart-header"><span class="chart-title">Preisentwicklung</span></div>
        <p style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 16px 0;">Sammle mehr Preisdaten durch zukünftige Scans, um die Kurve anzuzeigen.</p>
      `;
      return;
    }

    // Chart.js rendering for details view price history
    const sortedHistory = [...filteredHistory].sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at));
    const labels = sortedHistory.map(h => new Date(h.scanned_at).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
    }));
    const prices = sortedHistory.map(h => h.price);
    const comments = sortedHistory.map(h => h.comment || '');

    chartSection.innerHTML = `
      <div class="chart-header" style="margin-bottom: 8px;">
        <span class="chart-title">Preisentwicklung</span>
      </div>
      <div class="chart-canvas-container">
        <canvas id="detailsValueChart"></canvas>
      </div>
    `;

    const canvas = chartSection.querySelector('#detailsValueChart');
    const ctx = canvas.getContext('2d');

    // Create minimalist shadcn monochrome gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

    new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Preis',
          data: prices,
          borderColor: '#ffffff',
          borderWidth: 2,
          backgroundColor: gradient,
          fill: true,
          tension: 0.3,
          pointRadius: prices.length < 15 ? 3 : 0,
          pointHoverRadius: 5,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#09090b',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: '#18181b',
            titleColor: '#a1a1aa',
            bodyColor: '#ffffff',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: 8,
            bodyFont: {
              family: '-apple-system, BlinkMacSystemFont, sans-serif',
              size: 11,
              weight: '600'
            },
            titleFont: {
              family: '-apple-system, BlinkMacSystemFont, sans-serif',
              size: 9
            },
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (context.parsed.y !== null) {
                  label += context.parsed.y.toFixed(2) + ' €';
                }
                const comment = comments[context.dataIndex];
                if (comment) {
                  return [label, `"${comment}"`];
                }
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.4)',
              font: {
                size: 9,
                family: '-apple-system, BlinkMacSystemFont, sans-serif'
              },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 6
            }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
              drawTicks: false
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.4)',
              font: {
                size: 9,
                family: '-apple-system, BlinkMacSystemFont, sans-serif'
              },
              padding: 8,
              callback: function(value) {
                return value.toFixed(2) + ' €';
              }
            }
          }
        }
      }
    });
  };

  // Bind dropdown filters selectors change event
  const selCond = filterSection.querySelector('#sel-cond');
  const selLang = filterSection.querySelector('#sel-lang');
  const selLoc = filterSection.querySelector('#sel-loc');

  const saveCardFiltersToDb = async () => {
    if (!currentUser || !details || !details.cardId) return;

    const condVal = details.selectedCondition !== 'ALL' ? details.selectedCondition : null;
    const langVal = details.selectedLanguage !== 'ALL' ? details.selectedLanguage : null;
    const locVal = details.selectedLocation !== 'ALL' ? details.selectedLocation : null;

    try {
      if (details.isMarked) {
        await supabase
          .from('marked_cards')
          .update({
            condition: condVal,
            language: langVal,
            seller_country: locVal
          })
          .eq('user_id', currentUser.id)
          .eq('card_id', details.cardId);

        const localMarked = markedCards.find(m => m.card_id === details.cardId);
        if (localMarked) {
          localMarked.condition = condVal;
          localMarked.language = langVal;
          localMarked.seller_country = locVal;
        }
      }

      if (details.isCollected) {
        await supabase
          .from('collection_cards')
          .update({
            condition: condVal,
            language: langVal,
            seller_country: locVal
          })
          .eq('user_id', currentUser.id)
          .eq('card_id', details.cardId);

        const localColl = collectionCards.find(c => c.card_id === details.cardId);
        if (localColl) {
          localColl.condition = condVal;
          localColl.language = langVal;
          localColl.seller_country = locVal;
        }
      }
    } catch (e) {
      console.warn('Failed to auto-save filter preference:', e?.message || e);
    }
  };

  const onFilterChange = () => {
    details.selectedCondition = selCond.value;
    details.selectedLanguage = selLang.value;
    details.selectedLocation = selLoc.value;
    updatePricesAndChart();
    saveCardFiltersToDb();
  };

  selCond.addEventListener('change', onFilterChange);
  selLang.addEventListener('change', onFilterChange);
  selLoc.addEventListener('change', onFilterChange);

  // Navigation logic (Watchlist, Collection, or Search Grid) following ACTIVE sort & filter order
  cleanupDetailKeydownListener();

  let activeList = [];
  if (lastOriginScreen === 'collection') {
    activeList = getSortedCollectionCards();
  } else if (lastOriginScreen === 'watchlist') {
    activeList = getSortedWatchlistCards();
  } else if (lastOriginScreen === 'analytics' || lastOriginScreen === 'search') {
    if (typeof gridCards !== 'undefined' && gridCards && gridCards.length > 0) {
      activeList = gridCards;
    } else {
      activeList = getSortedWatchlistCards();
    }
  } else {
    const sortedColl = getSortedCollectionCards();
    const sortedWatch = getSortedWatchlistCards();
    if ((sortedColl || []).some(c => c && c.card_id === details.cardId)) {
      activeList = sortedColl;
    } else if ((sortedWatch || []).some(m => m && m.card_id === details.cardId)) {
      activeList = sortedWatch;
    } else if (typeof gridCards !== 'undefined' && gridCards && gridCards.length > 0) {
      activeList = gridCards;
    }
  }

  const currentIndex = activeList.findIndex(c => c.card_id === details.cardId);
  if (currentIndex !== -1) {
    const prevCard = currentIndex > 0 ? activeList[currentIndex - 1] : null;
    const nextCard = currentIndex < activeList.length - 1 ? activeList[currentIndex + 1] : null;

    // 1. Keyboard Arrow Key Navigation (Desktop & Mobile Keyboard)
    detailKeydownListener = (e) => {
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
      );
      if (isInputFocused) return;

      if (e.key === 'ArrowLeft' && prevCard) {
        e.preventDefault();
        loadCardDetails(prevCard.card_id, prevCard.tcg);
      } else if (e.key === 'ArrowRight' && nextCard) {
        e.preventDefault();
        loadCardDetails(nextCard.card_id, nextCard.tcg);
      }
    };
    document.addEventListener('keydown', detailKeydownListener);

    // 2. Desktop Arrow UI Buttons
    if (!checkIsMobile()) {
      if (prevCard) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'detail-nav-btn prev-btn';
        prevBtn.title = `Vorherige Karte (Pfeil Links): ${cleanCardName(prevCard.card_id)}`;
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
        nextBtn.title = `Nächste Karte (Pfeil Rechts): ${cleanCardName(nextCard.card_id)}`;
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
    }

    // 3. Mobile Touch Swipe Gestures
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

      // Verify horizontal swipe (> 50px)
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        if (deltaX > 0 && prevCard) {
          loadCardDetails(prevCard.card_id, prevCard.tcg);
        } else if (deltaX < 0 && nextCard) {
          loadCardDetails(nextCard.card_id, nextCard.tcg);
        }
      }
    }, { passive: true });
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
            const uploadedUrl = await uploadImageToStorage(details.cardId, imgRecord.image);

            // 1. Save globally in card_images table
            const { error: globalErr } = await supabase
              .from('card_images')
              .upsert({
                card_id: details.cardId,
                tcg: details.tcg,
                image_url: uploadedUrl,
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
                image_url: uploadedUrl
              });

            if (error) throw error;

            setCachedCardImage(details.cardId, uploadedUrl);
            await fetchMarkedCards(); // Refresh local watchlist copy
            details.imageUrl = uploadedUrl;
            const heroImg = detailBody.querySelector('.hero-img');
            if (heroImg) {
              heroImg.src = uploadedUrl;
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
