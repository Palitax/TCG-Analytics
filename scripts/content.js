// Cardmarket Price Tracker Pro - Content Script
let activeOverlay = null;
let currentUserId = null;

// Standardize condition mapping
const CONDITION_NAMES = {
  "MT": "Mint",
  "NM": "Near Mint",
  "EX": "Excellent",
  "GD": "Good",
  "LP": "Light Played",
  "PL": "Played",
  "PO": "Poor"
};

// Map language codes to labels in Cardmarket
const LANGUAGE_LABELS = {
  "DE": ["Deutsch", "German"],
  "EN": ["Englisch", "English"],
  "ES": ["Spanisch", "Spanish"],
  "FR": ["Französisch", "French"],
  "IT": ["Italienisch", "Italian"]
};

// Extract TCG name and normalized card ID from pathname
function getTcgAndCardId() {
  const path = window.location.pathname;
  // Cardmarket URLs usually look like: /de/OnePiece/Products/Singles/...
  const parts = path.split('/').filter(p => p.length > 0);
  if (parts.length > 0) {
    // If the first part is a 2-letter language code, remove it
    if (parts[0].length === 2 && /^[a-z]{2}$/i.test(parts[0])) {
      parts.shift();
    }
  }
  const tcg = parts.length > 0 ? parts[0] : 'Magic';
  const cardId = '/' + parts.join('/');
  return { tcg, cardId };
}

// Scrape the DOM for the first offer matching target conditions
function scrapePrice(targetCondition, targetLocation, targetLanguages) {
  // Query rows representing listings on Cardmarket (include grid divs as fallback)
  const rows = document.querySelectorAll(
    '.article-row, [id^="articleRow"], div.table-body > div.row, .table-body div.row, tr.article-row'
  );

  for (const row of rows) {
    // 1. Verify seller matches location criteria
    const flagElements = row.querySelectorAll('.flag, .icon, [class*="flag"], [class*="icon"], img');
    let isGerman = false;
    let sellerCountry = 'OTHER';

    for (const el of flagElements) {
      // Seller flags are located inside the seller column (skip product info flags)
      if (el.closest('.product-info, .condition, .badge')) continue;
      
      const classText = (typeof el.className === 'string') ? el.className : (el.className?.baseVal || '');
      const titleText = el.getAttribute('title') || el.getAttribute('data-original-title') || el.getAttribute('data-bs-original-title') || '';
      const srcText = el.getAttribute('src') || '';
      
      // Check common European country codes
      const codes = ['DE', 'ES', 'FR', 'IT', 'GB', 'PT', 'NL', 'BE', 'AT', 'CH', 'DK', 'SE', 'PL'];
      for (const code of codes) {
        if (
          classText.toUpperCase().includes('FLAG-' + code) ||
          srcText.toUpperCase().includes('/' + code + '.') ||
          srcText.toUpperCase().includes('/' + code + '/') ||
          srcText.toUpperCase().includes(code + '.PNG') ||
          srcText.toUpperCase().includes(code + '.SVG') ||
          titleText.toUpperCase().includes(code) ||
          (code === 'DE' && (titleText.toUpperCase().includes('DEUTSCHLAND') || titleText.toUpperCase().includes('GERMANY')))
        ) {
          sellerCountry = code;
          if (code === 'DE') isGerman = true;
          break;
        }
      }
      if (sellerCountry !== 'OTHER') break;
    }

    // If target location is DE (Germany) and seller is not German, skip row
    if (targetLocation === 'DE' && !isGerman) continue;

    // 2. Verify card condition matches target
    const conditionElements = row.querySelectorAll('.article-condition, .condition, .badge, span, a');
    let conditionMatches = false;
    for (const el of conditionElements) {
      const text = el.textContent.trim().toUpperCase();
      if (
        text === targetCondition ||
        text.startsWith(targetCondition + ' ') ||
        text.startsWith(targetCondition + '(') ||
        text.split(/[^A-Z]/)[0] === targetCondition
      ) {
        conditionMatches = true;
        break;
      }
    }

    if (!conditionMatches) continue;

    // 3. Verify card language matches any target language (if not 'ALL')
    let matchedLanguage = null;
    const langCodes = ['DE', 'EN', 'ES', 'FR', 'IT'];
    const flags = row.querySelectorAll('.flag, .icon, img, [class*="flag"], [class*="icon"]');
    
    for (const el of flags) {
      if (el.closest('.seller-link, .seller, [class*="seller"], [class*="user"], .merchant')) {
        continue; // Skip seller flags
      }
      
      const classText = (typeof el.className === 'string') ? el.className : (el.className?.baseVal || '');
      const titleText = el.getAttribute('title') || el.getAttribute('data-original-title') || el.getAttribute('data-bs-original-title') || '';
      const srcText = el.getAttribute('src') || '';
      
      for (const lang of langCodes) {
        const keywords = LANGUAGE_LABELS[lang];
        const matches = keywords.some(keyword =>
          titleText.toLowerCase().includes(keyword.toLowerCase()) ||
          srcText.toLowerCase().includes(lang.toLowerCase()) ||
          classText.toLowerCase().includes('flag-' + lang.toLowerCase())
        );
        if (matches) {
          matchedLanguage = lang;
          break;
        }
      }
      if (matchedLanguage) break;
    }

    // Default to EN if no specific language tag found
    if (!matchedLanguage) matchedLanguage = 'EN';

    // If card language doesn't match selected filters, skip row
    if (targetLanguages && !targetLanguages.includes('ALL') && !targetLanguages.includes(matchedLanguage)) {
      continue;
    }

    // 4. Extract price
    const priceElements = row.querySelectorAll('[class*="price"], .color-primary, span');
    for (const el of priceElements) {
      const text = el.textContent.trim();
      if (text.includes('€')) {
        const cleaned = text
          .replace('€', '')
          .replace(/\s/g, '')
          .replace(/\./g, '')
          .replace(',', '.');

        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed) && parsed > 0) {
          return {
            price: parsed,
            language: matchedLanguage,
            sellerCountry: sellerCountry,
            element: row
          };
        }
      }
    }
  }
  return null;
}

// Inject interactive dropdowns and status results in the page overlay
function updateOverlay(status, details = {}) {
  const header = document.querySelector('.page-title-container, .d-flex.align-items-center.page-title, h1');
  if (!header) return;

  if (!activeOverlay) {
    const container = document.createElement('div');
    container.className = 'cm-price-tracker-overlay';
    
    if (header.nextSibling) {
      header.parentNode.insertBefore(container, header.nextSibling);
    } else {
      header.parentNode.appendChild(container);
    }
    activeOverlay = container;
  }

  if (status === 'unauthenticated') {
    activeOverlay.innerHTML = `
      <div class="cm-tracker-header">
        <span class="cm-tracker-dot inactive"></span>
        <span class="cm-tracker-title">Cardmarket Price Tracker Pro</span>
      </div>
      <div class="cm-tracker-body">
        <span class="cm-tracker-text warning">Bitte im Popup der Erweiterung einloggen!</span>
      </div>
    `;
    return;
  }

  // Load active dropdown values from details
  const {
    selectedCondition = 'NM',
    selectedLocation = 'DE',
    selectedLanguages = ['ALL'],
    currentPrice = null,
    lastPrice = null,
    lastScannedAt = null,
    lastUserId = null,
    matchedLanguage = null,
    matchedCountry = null,
    noMatch = false
  } = details;

  const summaryText = selectedLanguages.includes('ALL') ? 'Alle' : selectedLanguages.join(', ');

  let resultHtml = '';
  if (status === 'loading') {
    resultHtml = `
      <div class="cm-tracker-results loading-state">
        <span class="cm-tracker-dot pulsing"></span>
        <span class="cm-tracker-text">Preise werden analysiert...</span>
      </div>
    `;
  } else if (noMatch) {
    resultHtml = `
      <div class="cm-tracker-results error-state">
        <span class="cm-tracker-text error">Kein passendes Angebot auf dieser Seite gefunden.</span>
      </div>
    `;
  } else if (currentPrice !== null) {
    let diffBadge = '';
    let statusText = '';

    const dateStr = lastScannedAt ? new Date(lastScannedAt).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '';

    const authorText = lastUserId === currentUserId ? 'dir selbst' : 'einem anderen Nutzer';

    if (lastPrice === null || lastPrice === undefined) {
      diffBadge = `<span class="cm-tracker-diff-badge first">Erster Scan</span>`;
      statusText = `<span class="cm-tracker-status-desc">Dieser Preis wurde als Startwert in der Datenbank gesichert.</span>`;
    } else {
      const diffPercent = ((currentPrice - lastPrice) / lastPrice) * 100;
      const formattedDiff = diffPercent.toFixed(2);

      if (diffPercent > 0) {
        diffBadge = `<span class="cm-tracker-diff-badge loss">+${formattedDiff}%</span>`;
        statusText = `<span class="cm-tracker-status-desc">Gestiegen seit Scan am ${dateStr} von ${authorText} (${lastPrice.toFixed(2)} €)</span>`;
      } else if (diffPercent < 0) {
        diffBadge = `<span class="cm-tracker-diff-badge gain">${formattedDiff}%</span>`;
        statusText = `<span class="cm-tracker-status-desc">Günstiger seit Scan am ${dateStr} von ${authorText} (${lastPrice.toFixed(2)} €)</span>`;
      } else {
        diffBadge = `<span class="cm-tracker-diff-badge stable">±0.00%</span>`;
        statusText = `<span class="cm-tracker-status-desc">Unverändert seit Scan am ${dateStr} von ${authorText}</span>`;
      }
    }

    resultHtml = `
      <div class="cm-tracker-results">
        <div class="cm-tracker-row">
          <div class="cm-tracker-price-box">
            <span class="cm-tracker-price-value">${currentPrice.toFixed(2)} €</span>
            ${diffBadge}
          </div>
          <div class="cm-tracker-meta">
            <span class="cm-tracker-match-badge" title="Tatsächlicher Treffer">${matchedLanguage} | ${matchedCountry}</span>
          </div>
        </div>
        ${statusText}
      </div>
    `;
  }

  activeOverlay.innerHTML = `
    <div class="cm-tracker-header">
      <span class="cm-tracker-dot active"></span>
      <span class="cm-tracker-title">Cardmarket Price Tracker Pro</span>
    </div>
    <div class="cm-tracker-body">
      <!-- Injected Dropdown Controls -->
      <div class="cm-tracker-controls">
        <div class="cm-control-item">
          <label>Zustand:</label>
          <select id="cm-select-condition" class="cm-dropdown">
            <option value="MT" ${selectedCondition === 'MT' ? 'selected' : ''}>MT (Mint)</option>
            <option value="NM" ${selectedCondition === 'NM' ? 'selected' : ''}>NM (Near Mint)</option>
            <option value="EX" ${selectedCondition === 'EX' ? 'selected' : ''}>EX (Excellent)</option>
            <option value="GD" ${selectedCondition === 'GD' ? 'selected' : ''}>GD (Good)</option>
            <option value="LP" ${selectedCondition === 'LP' ? 'selected' : ''}>LP (Light Played)</option>
            <option value="PL" ${selectedCondition === 'PL' ? 'selected' : ''}>PL (Played)</option>
            <option value="PO" ${selectedCondition === 'PO' ? 'selected' : ''}>PO (Poor)</option>
          </select>
        </div>

        <div class="cm-control-item">
          <label>Verkäufer:</label>
          <select id="cm-select-location" class="cm-dropdown">
            <option value="ALL" ${selectedLocation === 'ALL' ? 'selected' : ''}>Alle Länder</option>
            <option value="DE" ${selectedLocation === 'DE' ? 'selected' : ''}>Deutschland</option>
          </select>
        </div>

        <div class="cm-control-item">
          <label>Sprachen:</label>
          <details class="cm-multiselect-details" id="cm-select-languages-details">
            <summary id="cm-languages-summary">${summaryText}</summary>
            <div class="cm-multiselect-options">
              <label><input type="checkbox" value="ALL" id="cm-lang-all" ${selectedLanguages.includes('ALL') ? 'checked' : ''}> Alle</label>
              <label><input type="checkbox" value="DE" class="cm-lang-check" ${selectedLanguages.includes('DE') ? 'checked' : ''}> Deutsch</label>
              <label><input type="checkbox" value="EN" class="cm-lang-check" ${selectedLanguages.includes('EN') ? 'checked' : ''}> Englisch</label>
              <label><input type="checkbox" value="ES" class="cm-lang-check" ${selectedLanguages.includes('ES') ? 'checked' : ''}> Spanisch</label>
              <label><input type="checkbox" value="FR" class="cm-lang-check" ${selectedLanguages.includes('FR') ? 'checked' : ''}> Französisch</label>
              <label><input type="checkbox" value="IT" class="cm-lang-check" ${selectedLanguages.includes('IT') ? 'checked' : ''}> Italienisch</label>
            </div>
          </details>
        </div>
      </div>
      
      <!-- Scan Result Output -->
      ${resultHtml}
    </div>
  `;

  // Attach interactive UI listeners
  attachListeners();
}

// Bind DOM event listeners to dropdown changes in the overlay
function attachListeners() {
  const selectCondition = document.getElementById('cm-select-condition');
  const selectLocation = document.getElementById('cm-select-location');
  const langAll = document.getElementById('cm-lang-all');
  const langChecks = document.querySelectorAll('.cm-lang-check');
  const selectLanguagesDetails = document.getElementById('cm-select-languages-details');

  if (!selectCondition || !selectLocation) return;

  const saveAndRefresh = async () => {
    // Gather languages
    let checkedLangs = [];
    if (langAll.checked) {
      checkedLangs = ['ALL'];
    } else {
      langChecks.forEach(cb => {
        if (cb.checked) checkedLangs.push(cb.value);
      });
      if (checkedLangs.length === 0) {
        checkedLangs = ['ALL'];
        langAll.checked = true;
      }
    }

    const newPrefs = {
      condition: selectCondition.value,
      location: selectLocation.value,
      languages: checkedLangs
    };

    const storageKey = 'preferences_' + currentUserId;
    await chrome.storage.local.set({ [storageKey]: newPrefs });
    runScan();
  };

  selectCondition.addEventListener('change', saveAndRefresh);
  selectLocation.addEventListener('change', saveAndRefresh);

  langAll.addEventListener('change', (e) => {
    if (e.target.checked) {
      langChecks.forEach(cb => cb.checked = false);
    }
    saveAndRefresh();
  });

  langChecks.forEach(cb => {
    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        langAll.checked = false;
      }
      saveAndRefresh();
    });
  });

  // Close the custom language selector when clicking outside
  document.addEventListener('click', (e) => {
    if (selectLanguagesDetails && !selectLanguagesDetails.contains(e.target)) {
      selectLanguagesDetails.removeAttribute('open');
    }
  });
}

// Execute active scan sequence matching interactive selection criteria
async function runScan() {
  // 1. Verify user authentication status first
  chrome.runtime.sendMessage({ action: "getSession" }, async (response) => {
    if (chrome.runtime.lastError) {
      console.error("Message passing error:", chrome.runtime.lastError);
      return;
    }

    if (!response || !response.authenticated) {
      updateOverlay('unauthenticated');
      return;
    }

    currentUserId = response.user.id;
    const storageKey = 'preferences_' + currentUserId;

    // 2. Load settings profile (saved per logged in user id)
    const { [storageKey]: prefs } = await chrome.storage.local.get(storageKey);
    const targetCondition = prefs?.condition || 'NM';
    const targetLocation = prefs?.location || 'DE';
    const targetLanguages = prefs?.languages || ['ALL'];

    updateOverlay('loading', {
      selectedCondition: targetCondition,
      selectedLocation: targetLocation,
      selectedLanguages: targetLanguages
    });

    const { tcg, cardId } = getTcgAndCardId();

    // 3. Scan DOM for first offer match
    const match = scrapePrice(targetCondition, targetLocation, targetLanguages);
    if (!match) {
      updateOverlay('success', {
        selectedCondition: targetCondition,
        selectedLocation: targetLocation,
        selectedLanguages: targetLanguages,
        noMatch: true
      });
      return;
    }

    // 4. Send scan parameters to service-worker for DB processing
    chrome.runtime.sendMessage({
      action: "scanCard",
      tcg: tcg,
      cardId: cardId,
      condition: targetCondition,
      language: match.language,
      sellerCountry: match.sellerCountry,
      currentPrice: match.price
    }, (dbResponse) => {
      if (chrome.runtime.lastError || !dbResponse) {
        console.error("Database connection failed:", chrome.runtime.lastError);
        return;
      }

      if (dbResponse.error) {
        console.error("Scanning process failed:", dbResponse.error);
        return;
      }

      const record = dbResponse.latestRecord;

      updateOverlay('success', {
        selectedCondition: targetCondition,
        selectedLocation: targetLocation,
        selectedLanguages: targetLanguages,
        currentPrice: match.price,
        lastPrice: record ? parseFloat(record.price) : null,
        lastScannedAt: record ? record.scanned_at : null,
        lastUserId: record ? record.user_id : null,
        matchedLanguage: match.language,
        matchedCountry: match.sellerCountry
      });
    });
  });
}

// Watch table container DOM changes for dynamic pagination/filter updates
let scanTimeout = null;
function setupObserver() {
  const targetNode = document.querySelector('.table-body, #table-container, #articlesTable') || document.body;
  if (!targetNode) return;

  const observer = new MutationObserver(() => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      runScan();
    }, 300);
  });

  observer.observe(targetNode, {
    childList: true,
    subtree: targetNode === document.body
  });
}

// Global scan refresh message receiver
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "refreshScan") {
    runScan();
    sendResponse({ success: true });
  }
  return true;
});

// Start
runScan();
setupObserver();
