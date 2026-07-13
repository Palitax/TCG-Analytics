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
  const parts = path.split('/').filter(p => p.length > 0);
  if (parts.length > 0) {
    if (parts[0].length === 2 && /^[a-z]{2}$/i.test(parts[0])) {
      parts.shift();
    }
  }
  const tcg = parts.length > 0 ? parts[0] : 'Magic';
  const cardId = '/' + parts.join('/');
  return { tcg, cardId };
}

// Helper to look up and clone flag elements from Cardmarket's table for high-fidelity styling
function getFlagHtml(type, code) {
  if (!code) return '';
  const cleanCode = code.trim().toUpperCase();
  
  // Try to find a matching flag element in the current DOM to clone it
  const rows = document.querySelectorAll('.article-row, [id^="articleRow"], div.table-body > div.row');
  for (const row of rows) {
    const flagElements = row.querySelectorAll('.flag, .icon, img, [class*="flag"], [class*="icon"]');
    for (const el of flagElements) {
      const isSellerCol = el.closest('.seller-link, .seller, [class*="seller"], [class*="user"], .merchant');
      if (type === 'seller' && !isSellerCol) continue;
      if (type === 'language' && isSellerCol) continue;

      const classText = (typeof el.className === 'string') ? el.className : (el.className?.baseVal || '');
      const titleText = el.getAttribute('title') || '';
      const srcText = el.getAttribute('src') || '';

      let match = false;
      if (type === 'seller') {
        if (
          classText.toUpperCase().includes('FLAG-' + cleanCode) ||
          srcText.toUpperCase().includes('/' + cleanCode + '.') ||
          srcText.toUpperCase().includes('/' + cleanCode + '/') ||
          titleText.toUpperCase().includes(cleanCode) ||
          (cleanCode === 'DE' && (titleText.toUpperCase().includes('DEUTSCHLAND') || titleText.toUpperCase().includes('GERMANY')))
        ) {
          match = true;
        }
      } else {
        const keywords = LANGUAGE_LABELS[cleanCode];
        if (keywords) {
          match = keywords.some(keyword =>
            titleText.toLowerCase().includes(keyword.toLowerCase()) ||
            srcText.toLowerCase().includes(cleanCode.toLowerCase()) ||
            classText.toLowerCase().includes('flag-' + cleanCode.toLowerCase())
          );
        }
      }

      if (match) {
        const cloned = el.cloneNode(true);
        cloned.style.margin = '0';
        cloned.style.display = 'inline-block';
        cloned.style.verticalAlign = 'middle';
        return cloned.outerHTML;
      }
    }
  }

  // Fallback: Reconstruct standard CSS flags used by Cardmarket
  let flagClass = cleanCode.toLowerCase();
  if (flagClass === 'en') flagClass = 'us'; // Map EN to US flag class for English
  return `<span class="flag flag-${flagClass}" title="${cleanCode}" style="vertical-align: middle; display: inline-block;"></span>`;
}

// Scrape the DOM for the first offer matching target conditions
function scrapePrice(targetCondition, targetLocation, targetLanguages) {
  const rows = document.querySelectorAll(
    '.article-row, [id^="articleRow"], div.table-body > div.row, .table-body div.row, tr.article-row'
  );

  for (const row of rows) {
    // 1. Verify seller matches location criteria
    const flagElements = row.querySelectorAll('.flag, .icon, [class*="flag"], [class*="icon"], img');
    let isGerman = false;
    let sellerCountry = 'OTHER';

    for (const el of flagElements) {
      if (el.closest('.product-info, .condition, .badge')) continue;
      
      const classText = (typeof el.className === 'string') ? el.className : (el.className?.baseVal || '');
      const titleText = el.getAttribute('title') || el.getAttribute('data-original-title') || el.getAttribute('data-bs-original-title') || '';
      const srcText = el.getAttribute('src') || '';
      
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

    // 3. Verify card language matches target
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

    if (!matchedLanguage) matchedLanguage = 'EN';

    if (targetLanguages && !targetLanguages.includes('ALL') && !targetLanguages.includes(matchedLanguage)) {
      continue;
    }

    // 4. Extract product comment/description from Produktinfo cell
    let comment = '';
    const productInfoCell = row.querySelector('.product-info, [class*="product-info"], td:nth-child(2), div:nth-child(2)');
    if (productInfoCell) {
      const commentElement = productInfoCell.querySelector('.article-comment, .comment, [class*="comment"], .description');
      if (commentElement) {
        comment = commentElement.textContent.trim();
      } else {
        // Fallback: subtract condition text and clean spacing
        let cellText = productInfoCell.textContent.trim();
        const condBadge = productInfoCell.querySelector('.condition, .article-condition, .badge');
        if (condBadge) {
          const condText = condBadge.textContent.trim();
          cellText = cellText.replace(condText, '');
        }
        // Remove photo icons text representation (e.g. camera symbol text if any)
        comment = cellText.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    // 5. Extract price
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
            comment: comment,
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

  const {
    selectedCondition = 'NM',
    selectedLocation = 'DE',
    selectedLanguages = ['ALL'],
    currentPrice = null,
    lastPrice = null,
    lastScannedAt = null,
    lastUserId = null,
    lastComment = null,
    matchedLanguage = null,
    matchedCountry = null,
    comment = null,
    noMatch = false,
    errorText = null
  } = details;

  const summaryText = selectedLanguages.includes('ALL') ? 'Alle' : selectedLanguages.join(', ');

  let resultHtml = '';
  if (status === 'error') {
    resultHtml = `
      <div class="cm-tracker-results error-state">
        <span class="cm-tracker-text error">${errorText || "Fehler bei der Analyse."}</span>
      </div>
    `;
  } else if (status === 'loading') {
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

    // Retrieve high-fidelity flags to replace "DE | DE" text representation
    const sellerFlag = getFlagHtml('seller', matchedCountry);
    const langFlag = getFlagHtml('language', matchedLanguage);

    const lastSellerFlag = record => getFlagHtml('seller', record.seller_country);
    const lastLangFlag = record => getFlagHtml('language', record.language);

    if (lastPrice === null || lastPrice === undefined) {
      diffBadge = `<span class="cm-tracker-diff-badge first">Erster Scan</span>`;
      statusText = `<span class="cm-tracker-status-desc">Dieser Preis wurde als Startwert in der Datenbank gesichert.</span>`;
    } else {
      const diffPercent = ((currentPrice - lastPrice) / lastPrice) * 100;
      const formattedDiff = diffPercent.toFixed(2);

      const changeStr = diffPercent > 0 ? `Gestiegen seit Scan am ${dateStr} von ${authorText} (${lastPrice.toFixed(2)} €)` :
                        diffPercent < 0 ? `Günstiger seit Scan am ${dateStr} von ${authorText} (${lastPrice.toFixed(2)} €)` :
                        `Unverändert seit Scan am ${dateStr} von ${authorText}`;

      const diffClass = diffPercent > 0 ? 'loss' : diffPercent < 0 ? 'gain' : 'stable';
      const diffSign = diffPercent > 0 ? '+' : '';

      diffBadge = `<span class="cm-tracker-diff-badge ${diffClass}">${diffSign}${formattedDiff}%</span>`;
      statusText = `<span class="cm-tracker-status-desc">${changeStr}</span>`;
    }

    // Comment field block layout inside the overlay
    let commentBlockHtml = '';
    if (comment || lastComment) {
      commentBlockHtml = `
        <div class="cm-tracker-comments-container">
          <span class="cm-comments-title">Kommentare:</span>
          ${comment ? `
            <div class="cm-comment-row">
              <span class="cm-comment-label">Dieses Angebot:</span>
              <span class="cm-comment-val">"${comment}"</span>
            </div>
          ` : ''}
          ${lastComment ? `
            <div class="cm-comment-row">
              <span class="cm-comment-label">Letzter Scan-Wert:</span>
              <span class="cm-comment-val">"${lastComment}"</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    resultHtml = `
      <div class="cm-tracker-results">
        <div class="cm-tracker-row">
          <div class="cm-tracker-price-box">
            <span class="cm-tracker-price-value">${currentPrice.toFixed(2)} €</span>
            ${diffBadge}
          </div>
          <div class="cm-tracker-meta-flags">
            <div class="cm-flag-group" title="Herkunftsland des Verkäufers">
              <span class="cm-flag-group-label">Verkäufer:</span>
              ${sellerFlag}
            </div>
            <div class="cm-flag-group" title="Sprache der Karte">
              <span class="cm-flag-group-label">Karte:</span>
              ${langFlag}
            </div>
          </div>
        </div>
        ${statusText}
        ${commentBlockHtml}
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

  document.addEventListener('click', (e) => {
    if (selectLanguagesDetails && !selectLanguagesDetails.contains(e.target)) {
      selectLanguagesDetails.removeAttribute('open');
    }
  });
}

// Execute active scan sequence matching interactive selection criteria
async function runScan() {
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

    chrome.runtime.sendMessage({
      action: "scanCard",
      tcg: tcg,
      cardId: cardId,
      condition: targetCondition,
      language: match.language,
      sellerCountry: match.sellerCountry,
      currentPrice: match.price,
      comment: match.comment
    }, (dbResponse) => {
      if (chrome.runtime.lastError || !dbResponse) {
        console.error("Database connection failed:", chrome.runtime.lastError);
        updateOverlay('error', {
          selectedCondition: targetCondition,
          selectedLocation: targetLocation,
          selectedLanguages: targetLanguages,
          errorText: "Verbindung zur Extension fehlgeschlagen."
        });
        return;
      }

      if (dbResponse.error) {
        console.error("Scanning process failed:", dbResponse.error);
        updateOverlay('error', {
          selectedCondition: targetCondition,
          selectedLocation: targetLocation,
          selectedLanguages: targetLanguages,
          errorText: `Datenbank-Fehler: ${dbResponse.error}`
        });
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
        lastComment: record ? record.comment : null,
        matchedLanguage: match.language,
        matchedCountry: match.sellerCountry,
        comment: match.comment
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
