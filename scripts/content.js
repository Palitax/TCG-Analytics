// Cardmarket Price Tracker Pro - Content Script
let activeOverlay = null;

// Standardize condition mapping just in case
const CONDITION_NAMES = {
  "MT": "Mint",
  "NM": "Near Mint",
  "EX": "Excellent",
  "GD": "Good",
  "LP": "Light Played",
  "PL": "Played",
  "PO": "Poor"
};

// Normalize Cardmarket product URL to get a stable card ID
function getCardId() {
  const path = window.location.pathname;
  // Cardmarket URLs usually look like: /de/Magic/Products/Singles/Theros/Thoughtseize
  // We want to strip the language prefix (e.g. /de/, /en/, /es/)
  const parts = path.split('/').filter(p => p.length > 0);
  if (parts.length > 0) {
    // If the first part is a 2-letter language code, remove it
    if (parts[0].length === 2 && /^[a-z]{2}$/i.test(parts[0])) {
      parts.shift();
    }
  }
  return '/' + parts.join('/');
}

// Scrape the DOM for the first German seller offer matching the target condition
function scrapePrice(targetCondition) {
  // Query rows representing listings on Cardmarket
  const rows = document.querySelectorAll(
    '.article-row, [id^="articleRow"], div.row.g-0.align-items-center, tr.article-row'
  );

  for (const row of rows) {
    // 1. Verify seller is in Germany (DE flag icon/title attribute)
    const hasDeFlag = row.querySelector('.flag-DE, .flag-de, [class*="flag-DE"], [class*="flag-de"]') ||
                      row.querySelector('[title="Deutschland"], [data-original-title="Deutschland"], [data-bs-original-title="Deutschland"], [title="Germany"], [data-original-title="Germany"], [data-bs-original-title="Germany"]') ||
                      row.innerHTML.includes('title="Deutschland"') ||
                      row.innerHTML.includes('title="Germany"') ||
                      row.innerHTML.includes('flag-DE');

    if (!hasDeFlag) continue;

    // 2. Verify card condition matches target
    const conditionElements = row.querySelectorAll('.article-condition, .condition, .badge, span, a');
    let conditionMatches = false;
    for (const el of conditionElements) {
      const text = el.textContent.trim().toUpperCase();
      if (text === targetCondition) {
        conditionMatches = true;
        break;
      }
    }

    if (!conditionMatches) continue;

    // 3. Extract the listing price
    const priceElements = row.querySelectorAll('[class*="price"], .color-primary, span');
    for (const el of priceElements) {
      const text = el.textContent.trim();
      if (text.includes('€')) {
        // Clean currency formatting (e.g. "12,99 €" -> 12.99)
        const cleaned = text
          .replace('€', '')
          .replace(/\s/g, '')       // remove whitespaces
          .replace(/\./g, '')       // remove thousand separators
          .replace(',', '.');       // convert decimal comma to dot

        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed) && parsed > 0) {
          return { price: parsed, element: row };
        }
      }
    }
  }
  return null;
}

// Inject or update the modern glassmorphic overlay UI
function updateOverlay(status, details = {}) {
  // Remove existing overlay if present
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }

  // Find placement container (below card name header)
  const header = document.querySelector('.page-title-container, .d-flex.align-items-center.page-title, h1');
  if (!header) return;

  const container = document.createElement('div');
  container.className = 'cm-price-tracker-overlay';

  let htmlContent = '';

  if (status === 'loading') {
    htmlContent = `
      <div class="cm-tracker-header">
        <span class="cm-tracker-dot pulsing"></span>
        <span class="cm-tracker-title">Cardmarket Price Tracker Pro</span>
      </div>
      <div class="cm-tracker-body">
        <span class="cm-tracker-text">Preise werden analysiert...</span>
      </div>
    `;
  } else if (status === 'unauthenticated') {
    htmlContent = `
      <div class="cm-tracker-header">
        <span class="cm-tracker-dot inactive"></span>
        <span class="cm-tracker-title">Cardmarket Price Tracker Pro</span>
      </div>
      <div class="cm-tracker-body">
        <span class="cm-tracker-text warning">Bitte im Popup der Erweiterung einloggen!</span>
      </div>
    `;
  } else if (status === 'no_offer') {
    htmlContent = `
      <div class="cm-tracker-header">
        <span class="cm-tracker-dot active"></span>
        <span class="cm-tracker-title">Cardmarket Price Tracker Pro</span>
      </div>
      <div class="cm-tracker-body">
        <div class="cm-tracker-info">
          <span class="cm-tracker-label">Ziel-Zustand:</span>
          <span class="cm-tracker-badge">${CONDITION_NAMES[details.condition] || details.condition} (DE)</span>
        </div>
        <span class="cm-tracker-text error">Kein passendes Angebot gefunden.</span>
      </div>
    `;
  } else if (status === 'success') {
    const { currentPrice, lastPrice, lastScannedAt, condition } = details;
    
    let diffBadge = '';
    let statusText = '';

    if (lastPrice === undefined || lastPrice === null) {
      // First scan
      diffBadge = `<span class="cm-tracker-diff-badge first">Erster Scan</span>`;
      statusText = `<span class="cm-tracker-status-desc">Dieser Preis wurde als Startwert in der Datenbank gesichert.</span>`;
    } else {
      const diffPercent = ((currentPrice - lastPrice) / lastPrice) * 100;
      const formattedDiff = diffPercent.toFixed(2);
      
      const dateStr = new Date(lastScannedAt).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      if (diffPercent > 0) {
        // Price increased
        diffBadge = `<span class="cm-tracker-diff-badge loss">+${formattedDiff}%</span>`;
        statusText = `<span class="cm-tracker-status-desc">Gestiegen seit dem letzten Scan am ${dateStr} (${lastPrice.toFixed(2)} €)</span>`;
      } else if (diffPercent < 0) {
        // Price decreased
        diffBadge = `<span class="cm-tracker-diff-badge gain">${formattedDiff}%</span>`;
        statusText = `<span class="cm-tracker-status-desc">Günstiger seit dem letzten Scan am ${dateStr} (${lastPrice.toFixed(2)} €)</span>`;
      } else {
        // Price stable
        diffBadge = `<span class="cm-tracker-diff-badge stable">±0.00%</span>`;
        statusText = `<span class="cm-tracker-status-desc">Unverändert seit dem letzten Scan am ${dateStr}</span>`;
      }
    }

    htmlContent = `
      <div class="cm-tracker-header">
        <span class="cm-tracker-dot active"></span>
        <span class="cm-tracker-title">Cardmarket Price Tracker Pro</span>
      </div>
      <div class="cm-tracker-body">
        <div class="cm-tracker-row">
          <div class="cm-tracker-info">
            <span class="cm-tracker-label">Ziel-Zustand:</span>
            <span class="cm-tracker-badge">${CONDITION_NAMES[condition] || condition} (DE)</span>
          </div>
          <div class="cm-tracker-price-box">
            <span class="cm-tracker-price-value">${currentPrice.toFixed(2)} €</span>
            ${diffBadge}
          </div>
        </div>
        ${statusText}
      </div>
    `;
  }

  container.innerHTML = htmlContent;

  // Insert overlay under the header
  if (header.nextSibling) {
    header.parentNode.insertBefore(container, header.nextSibling);
  } else {
    header.parentNode.appendChild(container);
  }

  activeOverlay = container;
}

// Perform active scan sequence
async function runScan() {
  updateOverlay('loading');

  // Load selected target condition from storage
  const { targetCondition = 'NM' } = await chrome.storage.local.get('targetCondition');
  const cardId = getCardId();

  // Scrape price matching criteria
  const match = scrapePrice(targetCondition);
  if (!match) {
    // Send check message to service worker to verify auth even if no offers found
    chrome.runtime.sendMessage({ action: "getSession" }, (response) => {
      if (response && response.authenticated) {
        updateOverlay('no_offer', { condition: targetCondition });
      } else {
        updateOverlay('unauthenticated');
      }
    });
    return;
  }

  const currentPrice = match.price;

  // Send scan data to background worker for DB processing
  chrome.runtime.sendMessage({
    action: "scanCard",
    cardId: cardId,
    condition: targetCondition,
    currentPrice: currentPrice
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Message passing error:", chrome.runtime.lastError);
      return;
    }

    if (response.error === "UNAUTHENTICATED") {
      updateOverlay('unauthenticated');
    } else if (response.success) {
      const record = response.latestRecord;
      updateOverlay('success', {
        currentPrice: currentPrice,
        lastPrice: record ? parseFloat(record.price) : null,
        lastScannedAt: record ? record.scanned_at : null,
        condition: targetCondition
      });
    } else {
      console.error("Scanning failed:", response.error);
    }
  });
}

// Watch table mutations for dynamically loaded filters / tab switching
let scanTimeout = null;
function setupObserver() {
  // Find tables or containers that load articles dynamically
  const targetNode = document.querySelector('.table-body, #table-container, #articlesTable') || document.body;
  
  if (!targetNode) return;

  const observer = new MutationObserver(() => {
    // Debounce scans to avoid rapid re-triggering during animations/DOM updates
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      runScan();
    }, 300);
  });

  observer.observe(targetNode, {
    childList: true,
    subtree: targetNode === document.body // only use subtree if falling back to document.body
  });
}

// Listen for updates from popup (e.g. when condition changes or user logs in)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "refreshScan") {
    runScan();
    sendResponse({ success: true });
  }
  return true;
});

// Initialization
runScan();
setupObserver();
