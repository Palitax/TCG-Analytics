// Cardmarket Price Tracker Pro - Content Script
let activeOverlay = null;
let currentUserId = null;
let currentMatchedElement = null; // Store reference to scroll to the matched seller row

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

// Map language codes to labels in Cardmarket (Expanded with JP, ZH, KO)
const LANGUAGE_LABELS = {
  "DE": ["Deutsch", "German"],
  "EN": ["Englisch", "English"],
  "ES": ["Spanisch", "Spanish"],
  "FR": ["Französisch", "French"],
  "IT": ["Italienisch", "Italian"],
  "JP": ["Japanisch", "Japanese"],
  "ZH": ["Chinesisch", "Chinese"],
  "KO": ["Koreanisch", "Korean"]
};

const COUNTRY_NAMES = {
  "DE": ["Deutschland", "Germany", "Allemagne", "Alemania", "Germania"],
  "ES": ["Spanien", "Spain", "Espagne", "España", "Spagna"],
  "FR": ["Frankreich", "France", "Francia"],
  "IT": ["Italien", "Italy", "Italie", "Italia"],
  "GB": ["Großbritannien", "United Kingdom", "UK", "Royaume-Uni", "Reino Unido", "Regno Unito"],
  "PT": ["Portugal"],
  "NL": ["Niederlande", "Netherlands", "Pays-Bas", "Países Bajos", "Paesi Bassi"],
  "BE": ["Belgien", "Belgium", "Belgique", "Bélgica", "Belgio"],
  "AT": ["Österreich", "Austria", "Autriche"],
  "CH": ["Schweiz", "Switzerland", "Suisse", "Suiza", "Svizzera"],
  "DK": ["Dänemark", "Denmark", "Danemark", "Dinamarca", "Danimarca"],
  "SE": ["Schweden", "Sweden", "Suède", "Suecia", "Svezia"],
  "PL": ["Polen", "Poland", "Pologne", "Polonia"],
  "IE": ["Irland", "Ireland", "Irlande", "Irlanda"],
  "GR": ["Griechenland", "Greece", "Grèce", "Grecia"],
  "FI": ["Finnland", "Finland", "Finlande", "Finlandia"],
  "NO": ["Norwegen", "Norway", "Norvège", "Noruega", "Norvegia"]
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

// Helper to find a checkbox input by its label keywords globally
function findCheckboxByLabel(keywords) {
  let container = document.querySelector('aside, .sidebar, #sidebar, #searchFilterForm, .filter-sidebar, #filter-sidebar, [class*="sidebar"], [id*="sidebar"], [class*="filter"], [id*="filter"]');
  console.log(`findCheckboxByLabel: Searching keywords [${keywords.join(', ')}] in container:`, container ? container.tagName + (container.id ? '#' + container.id : '') : 'BODY');
  
  if (!container) container = document.body;

  const candidates = container.querySelectorAll('label, span, div, a');
  for (const el of candidates) {
    if (el.closest('.article-row, [id^="articleRow"], div.table-body > div.row, .table-body div.row, tr.article-row, .table-body, #articlesTable')) {
      continue;
    }
    if (el.children.length > 3) continue;

    const text = el.textContent.trim().toLowerCase();
    if (!text) continue;

    const matchesKeyword = keywords.some(keyword => text === keyword.toLowerCase() || text.includes(keyword.toLowerCase()));
    if (matchesKeyword) {
      let parent = el;
      for (let i = 0; i < 4; i++) {
        if (!parent) break;
        const checkbox = parent.querySelector('input[type="checkbox"]');
        if (checkbox) {
          console.log(`findCheckboxByLabel: MATCH found for [${keywords.join(', ')}] -> checkbox ID: ${checkbox.id || 'NO_ID'}, Checked: ${checkbox.checked}`);
          return checkbox;
        }
        parent = parent.parentElement;
      }
    }
  }
  console.log(`findCheckboxByLabel: NO MATCH found for [${keywords.join(', ')}]`);
  return null;
}

// Return custom inline SVGs for EU countries and card languages (zero external assets, 100% CSP compliant)
function getCustomFlagSvg(code) {
  if (!code) return '';
  const cleanCode = code.trim().toUpperCase();
  
  const SVG_MAP = {
    "DE": `<svg viewBox="0 0 5 3" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="5" height="3" fill="#FFCE00"/><rect width="5" height="2" fill="#DD0000"/><rect width="5" height="1" fill="#000000"/></svg>`,
    "FR": `<svg viewBox="0 0 3 2" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#ffffff"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg>`,
    "IT": `<svg viewBox="0 0 3 2" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="1" height="2" fill="#009246"/><rect x="1" width="1" height="2" fill="#ffffff"/><rect x="2" width="1" height="2" fill="#ce2b37"/></svg>`,
    "AT": `<svg viewBox="0 0 3 3" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="3" height="3" fill="#C8102E"/><rect y="1" width="3" height="1" fill="#ffffff"/></svg>`,
    "BE": `<svg viewBox="0 0 3 3" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="1" height="3" fill="#000000"/><rect x="1" width="1" height="3" fill="#FDDA24"/><rect x="2" width="1" height="3" fill="#EF3340"/></svg>`,
    "ES": `<svg viewBox="0 0 3 4" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="3" height="4" fill="#C8102E"/><rect y="1" width="3" height="2" fill="#FFD100"/></svg>`,
    "NL": `<svg viewBox="0 0 3 3" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="3" height="1" fill="#AE1C28"/><rect y="1" width="3" height="1" fill="#ffffff"/><rect y="2" width="3" height="1" fill="#21468B"/></svg>`,
    "JP": `<svg viewBox="0 0 3 2" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="3" height="2" fill="#ffffff"/><circle cx="1.5" cy="1" r="0.6" fill="#BC002D"/></svg>`,
    "ZH": `<svg viewBox="0 0 30 20" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="30" height="20" fill="#DE2910"/><path d="M6 2l1.18 3.61h3.8L7.9 7.85l1.18 3.61-3.08-2.24-3.08 2.24 1.18-3.61L1 5.61h3.8z" fill="#FFDE00"/></svg>`,
    "CN": `<svg viewBox="0 0 30 20" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="30" height="20" fill="#DE2910"/><path d="M6 2l1.18 3.61h3.8L7.9 7.85l1.18 3.61-3.08-2.24-3.08 2.24 1.18-3.61L1 5.61h3.8z" fill="#FFDE00"/></svg>`,
    "KO": `<svg viewBox="0 0 3 2" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="3" height="2" fill="#ffffff"/><circle cx="1.5" cy="1" r="0.5" fill="#CD2E3A"/><path d="M1.5 1.5a.5.5 0 0 1 0-1 .25.25 0 0 1 0 .5.25.25 0 0 0 0 .5" fill="#0047A0"/><circle cx="1.5" cy="1" r="0.45" fill="none" stroke="#000000" stroke-width="0.05" stroke-dasharray="0.1 0.1"/></svg>`,
    "KR": `<svg viewBox="0 0 3 2" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="3" height="2" fill="#ffffff"/><circle cx="1.5" cy="1" r="0.5" fill="#CD2E3A"/><path d="M1.5 1.5a.5.5 0 0 1 0-1 .25.25 0 0 1 0 .5.25.25 0 0 0 0 .5" fill="#0047A0"/><circle cx="1.5" cy="1" r="0.45" fill="none" stroke="#000000" stroke-width="0.05" stroke-dasharray="0.1 0.1"/></svg>`,
    "GB": `<svg viewBox="0 0 50 30" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="50" height="30" fill="#012169"/><path d="M0 0l50 30M0 30l50 -30" stroke="#ffffff" stroke-width="6"/><path d="M0 0l50 30M0 30l50 -30" stroke="#C8102E" stroke-width="2"/><path d="M25 0v30M0 15h50" stroke="#ffffff" stroke-width="10"/><path d="M25 0v30M0 15h50" stroke="#C8102E" stroke-width="6"/></svg>`,
    "EN": `<svg viewBox="0 0 50 30" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="50" height="30" fill="#012169"/><path d="M0 0l50 30M0 30l50 -30" stroke="#ffffff" stroke-width="6"/><path d="M0 0l50 30M0 30l50 -30" stroke="#C8102E" stroke-width="2"/><path d="M25 0v30M0 15h50" stroke="#ffffff" stroke-width="10"/><path d="M25 0v30M0 15h50" stroke="#C8102E" stroke-width="6"/></svg>`,
    "PT": `<svg viewBox="0 0 5 3" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="5" height="3" fill="#FF0000"/><rect width="2" height="3" fill="#006600"/></svg>`,
    "CH": `<svg viewBox="0 0 1 1" class="flag-svg" style="display:inline-block;vertical-align:middle;width:11px;height:11px;margin:0;"><rect width="1" height="1" fill="#D52B1E"/><rect x="0.4" y="0.25" width="0.2" height="0.5" fill="#ffffff"/><rect x="0.25" y="0.4" width="0.5" height="0.2" fill="#ffffff"/></svg>`,
    "DK": `<svg viewBox="0 0 37 28" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="37" height="28" fill="#C8102E"/><rect x="12" width="4" height="28" fill="#ffffff"/><rect y="12" width="37" height="4" fill="#ffffff"/></svg>`,
    "SE": `<svg viewBox="0 0 16 10" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="16" height="10" fill="#006AA7"/><rect x="5" width="2" height="10" fill="#FECC00"/><rect y="4" width="16" height="2" fill="#FECC00"/></svg>`,
    "PL": `<svg viewBox="0 0 3 2" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="3" height="2" fill="#D52B1E"/><rect width="3" height="1" fill="#ffffff"/></svg>`,
    "IE": `<svg viewBox="0 0 3 2" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="1" height="2" fill="#169B62"/><rect x="1" width="1" height="2" fill="#ffffff"/><rect x="2" width="1" height="2" fill="#FF883E"/></svg>`,
    "GR": `<svg viewBox="0 0 9 6" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="9" height="6" fill="#005A9C"/><rect y="1" width="9" height="1" fill="#ffffff"/><rect y="3" width="9" height="1" fill="#ffffff"/><rect y="5" width="9" height="1" fill="#ffffff"/><rect width="3" height="3" fill="#005A9C"/><rect x="1" width="1" height="3" fill="#ffffff"/><rect y="1" width="3" height="1" fill="#ffffff"/></svg>`,
    "FI": `<svg viewBox="0 0 18 11" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="18" height="11" fill="#ffffff"/><rect x="5" width="3" height="11" fill="#003580"/><rect y="4" width="18" height="3" fill="#003580"/></svg>`,
    "NO": `<svg viewBox="0 0 22 16" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="22" height="16" fill="#BA0C2F"/><rect x="6" width="4" height="16" fill="#ffffff"/><rect y="6" width="22" height="4" fill="#ffffff"/><rect x="7" width="2" height="16" fill="#00205B"/><rect y="7" width="22" height="2" fill="#00205B"/></svg>`
  };
  
  if (SVG_MAP[cleanCode]) {
    return SVG_MAP[cleanCode];
  }
  
  // General EU Flag Fallback (blue background with yellow stars circle approximation)
  return `<svg viewBox="0 0 3 2" class="flag-svg" style="display:inline-block;vertical-align:middle;width:16px;height:11px;margin:0;"><rect width="3" height="2" fill="#003399"/><circle cx="1.5" cy="1" r="0.5" fill="none" stroke="#FFCC00" stroke-width="0.08" stroke-dasharray="0.05 0.2"/></svg>`;
}

function getFlagHtml(type, code) {
  if (!code) return '';
  return getCustomFlagSvg(code);
}

// Read the active filters from Cardmarket's URL query parameters (highly robust)
function getSidebarState() {
  const urlParams = new URLSearchParams(window.location.search);
  const sellerCountryParam = urlParams.get('sellerCountry');
  const minConditionParam = urlParams.get('minCondition');
  
  const langParams = [];
  urlParams.forEach((value, key) => {
    if (key === 'language' || key === 'language[]') {
      langParams.push(value);
    }
  });

  const isDeFiltered = (sellerCountryParam === '7'); // Germany = 7

  const languageMap = {
    "1": "EN",
    "2": "FR",
    "3": "DE",
    "4": "ES",
    "5": "IT",
    "6": "ZH",
    "7": "JP",
    "8": "KO"
  };

  const activeLangs = langParams.map(id => languageMap[id]).filter(Boolean);
  const activeLocation = isDeFiltered ? 'DE' : 'ALL';

  const conditionMap = {
    "1": "MT",
    "2": "NM",
    "3": "EX",
    "4": "GD",
    "5": "LP",
    "6": "PL",
    "7": "PO"
  };
  const activeCondition = conditionMap[minConditionParam] || 'NM';

  console.log(`getSidebarState (URL): Location = ${activeLocation}, Languages = [${activeLangs.join(', ')}], Condition = ${activeCondition}`);

  return {
    location: activeLocation,
    languages: activeLangs.length === 0 ? ['ALL'] : activeLangs,
    condition: activeCondition
  };
}

// Synchronize selected overlay preferences to Cardmarket's native sidebar checkboxes and submit
async function applySidebarFilter(newPrefs) {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  let changed = false;

  console.log("applySidebarFilter: Applying overlay preferences via URL query parameters:", newPrefs);

  // 1. Sync location (Germany ID = 7)
  const currentLocationParam = params.get('sellerCountry');
  const targetLocationParam = newPrefs.location === 'DE' ? '7' : null;
  if (currentLocationParam !== targetLocationParam) {
    if (targetLocationParam) {
      params.set('sellerCountry', targetLocationParam);
    } else {
      params.delete('sellerCountry');
    }
    changed = true;
  }

  // 2. Sync condition (minCondition)
  const currentConditionParam = params.get('minCondition');
  const conditionMap = {
    "MT": "1",
    "NM": "2",
    "EX": "3",
    "GD": "4",
    "LP": "5",
    "PL": "6",
    "PO": "7"
  };
  const targetConditionParam = conditionMap[newPrefs.condition] || null;
  if (currentConditionParam !== targetConditionParam) {
    if (targetConditionParam) {
      params.set('minCondition', targetConditionParam);
    } else {
      params.delete('minCondition');
    }
    changed = true;
  }

  // 3. Sync languages
  const languageMap = {
    "EN": "1",
    "FR": "2",
    "DE": "3",
    "ES": "4",
    "IT": "5",
    "ZH": "6",
    "JP": "7",
    "KO": "8"
  };

  // Get current language parameters
  const currentLangs = [];
  params.forEach((val, key) => {
    if (key === 'language' || key === 'language[]') {
      currentLangs.push(val);
    }
  });

  // Calculate target language parameters
  const targetLangs = [];
  if (!newPrefs.languages.includes('ALL')) {
    for (const lang of newPrefs.languages) {
      const id = languageMap[lang];
      if (id) targetLangs.push(id);
    }
  }

  // Compare current and target languages
  currentLangs.sort();
  targetLangs.sort();
  const langsMatch = (currentLangs.length === targetLangs.length && 
                      currentLangs.every((val, index) => val === targetLangs[index]));

  if (!langsMatch) {
    params.delete('language');
    params.delete('language[]');
    if (targetLangs.length === 1) {
      params.set('language', targetLangs[0]);
    } else {
      for (const id of targetLangs) {
        params.append('language[]', id);
      }
    }
    changed = true;
  }

  if (changed) {
    console.log("applySidebarFilter: Navigating to new filtered URL:", url.toString());
    window.location.href = url.toString();
    return true; // Reload triggered
  }
  return false;
}

// Extract seller country in a rock solid, language-independent way
function extractSellerCountry(sellerCol) {
  if (!sellerCol) return 'OTHER';
  
  // 1. Look inside the .seller-name container (most specific for the country flag icon)
  const sellerNameEl = sellerCol.querySelector('.seller-name');
  const searchArea = sellerNameEl || sellerCol;
  
  // Find all elements with title/label attributes
  const candidates = searchArea.querySelectorAll('[title], [data-original-title], [data-bs-original-title], [aria-label]');
  for (const el of candidates) {
    const titleText = (el.getAttribute('aria-label') || 
                       el.getAttribute('data-bs-original-title') || 
                       el.getAttribute('data-original-title') || 
                       el.getAttribute('title') || '').trim();
                       
    // Check if the title indicates a seller location
    // e.g. "Artikelstandort: Deutschland" or "Seller's location: Germany"
    if (titleText.includes(':')) {
      const parts = titleText.split(':');
      const possibleCountry = parts[1].trim().toLowerCase();
      
      for (const code of Object.keys(COUNTRY_NAMES)) {
        const names = COUNTRY_NAMES[code];
        if (names.some(name => possibleCountry.includes(name.toLowerCase()))) {
          return code;
        }
      }
    }
    
    // Direct matches if the text itself matches a country name (excluding calendar info)
    for (const code of Object.keys(COUNTRY_NAMES)) {
      const names = COUNTRY_NAMES[code];
      if (names.some(name => titleText.toLowerCase().includes(name.toLowerCase()))) {
        // Double-check to avoid shipping calendar collision
        if (!titleText.toLowerCase().includes('versand') && !titleText.toLowerCase().includes('shipping') && !titleText.toLowerCase().includes('livraison')) {
          return code;
        }
      }
    }
  }
  
  // 2. Fallback: Search in filenames
  const images = searchArea.querySelectorAll('img');
  for (const img of images) {
    const srcText = img.getAttribute('src') || '';
    const filename = srcText.split('/').pop().toUpperCase();
    for (const code of Object.keys(COUNTRY_NAMES)) {
      if (filename.startsWith(code + '.') || filename === code) {
        return code;
      }
    }
  }
  
  // 3. Fallback: Check class names
  const elementsWithClasses = searchArea.querySelectorAll('[class*="flag"], [class*="FLAG"]');
  for (const el of elementsWithClasses) {
    const classText = el.className || '';
    for (const code of Object.keys(COUNTRY_NAMES)) {
      if (classText.toUpperCase().includes('FLAG-' + code)) {
        return code;
      }
    }
  }

  return 'OTHER';
}

// Scrape the DOM for the first offer matching target conditions
function scrapePrice(targetCondition, targetLocation, targetLanguages) {
  // ONLY match top-level article rows to avoid scanning sub-rows!
  const rows = document.querySelectorAll('.article-row, [id^="articleRow"]');

  console.log(`scrapePrice: Starting scan on ${rows.length} rows. Target: Cond=${targetCondition}, Loc=${targetLocation}, Langs=[${targetLanguages.join(', ')}]`);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    
    // 1. Find Seller Country
    const sellerCol = row.querySelector('.col-seller, [class*="seller"], [class*="user"], .col-sellerProductInfo');
    const sellerCountry = extractSellerCountry(sellerCol);
    const isGerman = (sellerCountry === 'DE');

    if (targetLocation === 'DE' && !isGerman) {
      continue;
    }

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
    const langCodes = ['DE', 'EN', 'ES', 'FR', 'IT', 'JP', 'ZH', 'KO'];
    
    // Find the product info cell specifically (excluding the parent .col-sellerProductInfo)
    const productInfoCell = row.querySelector('.col-product, .product-info') || 
                            row.querySelector('.col-sellerProductInfo .col-product') ||
                            row.querySelector('.col-sellerProductInfo div.row > div:nth-child(2)') ||
                            row.querySelector('td:nth-child(2)');
                            
    if (productInfoCell) {
      // Find candidate elements representing the language flag (excluding plain text spans/comments)
      const flagCandidates = productInfoCell.querySelectorAll('.icon, .flag, [class*="flag"], [style*="background-image"], img');
      for (const el of flagCandidates) {
        const titleText = el.getAttribute('title') || el.getAttribute('data-original-title') || el.getAttribute('data-bs-original-title') || el.getAttribute('aria-label') || '';
        const srcText = el.getAttribute('src') || '';
        const filename = srcText.split('/').pop().toLowerCase();

        for (const lang of langCodes) {
          const keywords = LANGUAGE_LABELS[lang];
          const matchesTitle = keywords && keywords.some(keyword =>
            titleText.toLowerCase().includes(keyword.toLowerCase())
          );

          // Fallback checks (mapping JP to ja, EN to gb/us, ZH to cn, KO to kr)
          const matchesFile = filename.startsWith(lang.toLowerCase() + '.') || 
                              filename === lang.toLowerCase() ||
                              (lang === 'JP' && filename.startsWith('ja.')) ||
                              (lang === 'EN' && (filename.startsWith('us.') || filename.startsWith('gb.'))) ||
                              (lang === 'ZH' && filename.startsWith('cn.')) ||
                              (lang === 'KO' && filename.startsWith('kr.'));

          const matchesClass = el.className.toLowerCase().includes('flag-' + lang.toLowerCase()) ||
                               (lang === 'JP' && el.className.toLowerCase().includes('flag-ja')) ||
                               (lang === 'EN' && (el.className.toLowerCase().includes('flag-us') || el.className.toLowerCase().includes('flag-gb'))) ||
                               (lang === 'ZH' && el.className.toLowerCase().includes('flag-cn')) ||
                               (lang === 'KO' && el.className.toLowerCase().includes('flag-kr'));

          if (matchesTitle || matchesFile || matchesClass) {
            matchedLanguage = lang;
            break;
          }
        }
        if (matchedLanguage) break;
      }
    }

    if (!matchedLanguage) matchedLanguage = 'EN';

    if (targetLanguages && !targetLanguages.includes('ALL') && !targetLanguages.includes(matchedLanguage)) {
      continue;
    }

    // 4. Extract product comment/description from Produktinfo cell
    let comment = '';
    // Reuse the productInfoCell resolved in step 3
    if (productInfoCell) {
      const commentElement = productInfoCell.querySelector('.article-comment, .comment, [class*="comment"], .description, .product-comments span');
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
            <div class="cm-flag-group cm-clickable-seller" title="Klicke hier, um zum Verkäufer in der Liste zu springen">
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
              <label><input type="checkbox" value="JP" class="cm-lang-check" ${selectedLanguages.includes('JP') ? 'checked' : ''}> Japanisch</label>
              <label><input type="checkbox" value="ZH" class="cm-lang-check" ${selectedLanguages.includes('ZH') ? 'checked' : ''}> Chinesisch</label>
              <label><input type="checkbox" value="KO" class="cm-lang-check" ${selectedLanguages.includes('KO') ? 'checked' : ''}> Koreanisch</label>
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

    const isReloading = await applySidebarFilter(newPrefs);
    if (!isReloading) {
      runScan(); // If no page reload is needed, run scanner locally instantly
    }
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

  // Seller click and highlight event binding (Duration set to 5000ms / 5s)
  const clickableSeller = document.querySelector('.cm-clickable-seller');
  if (clickableSeller && currentMatchedElement) {
    clickableSeller.addEventListener('click', () => {
      currentMatchedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      currentMatchedElement.classList.add('cm-highlight-row');
      setTimeout(() => {
        if (currentMatchedElement) {
          currentMatchedElement.classList.remove('cm-highlight-row');
        }
      }, 5000);
    });
  }

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

        // Load saved settings
    const { [storageKey]: prefs } = await chrome.storage.local.get(storageKey);
    let savedCondition = prefs?.condition || 'NM';
    let savedLocation = prefs?.location || 'DE';
    let savedLanguages = prefs?.languages || ['ALL'];

    // Read the current state from the URL query parameters
    const sidebar = getSidebarState();
    const { tcg, cardId } = getTcgAndCardId();

    const urlParams = new URLSearchParams(window.location.search);
    const hasUrlLocation = urlParams.has('sellerCountry');
    const hasUrlLanguages = urlParams.has('language') || urlParams.has('language[]');
    const hasUrlCondition = urlParams.has('minCondition');

    let prefsUpdated = false;

    // Bidirectional sync: if the URL contains active filters, we save them as the active preference!
    if (hasUrlLocation && savedLocation !== sidebar.location) {
      savedLocation = sidebar.location;
      prefsUpdated = true;
    }
    if (hasUrlCondition && savedCondition !== sidebar.condition) {
      savedCondition = sidebar.condition;
      prefsUpdated = true;
    }
    if (hasUrlLanguages) {
      const sortedSaved = [...savedLanguages].sort();
      const sortedSidebar = [...sidebar.languages].sort();
      const match = (sortedSaved.length === sortedSidebar.length && 
                     sortedSaved.every((val, index) => val === sortedSidebar[index]));
      if (!match) {
        savedLanguages = sidebar.languages;
        prefsUpdated = true;
      }
    }

    if (prefsUpdated) {
      const newPrefs = {
        condition: savedCondition,
        location: savedLocation,
        languages: savedLanguages
      };
      await chrome.storage.local.set({ [storageKey]: newPrefs });
      console.log("Updated saved preferences from URL state:", newPrefs);
    }

    // Verify if sidebar checkboxes match our user-saved preferences.
    const matchesLocation = (sidebar.location === savedLocation);
    const matchesLanguages = (sidebar.languages.length === savedLanguages.length && 
                              sidebar.languages.every(lang => savedLanguages.includes(lang)));
    const matchesCondition = (sidebar.condition === savedCondition);

    // Verify if the sidebar container is present in the DOM before attempting to reload
    const filterContainer = document.querySelector('aside, .sidebar, #sidebar, #searchFilterForm, .filter-sidebar, #filter-sidebar');

    if (filterContainer && (!matchesLocation || !matchesLanguages || !matchesCondition)) {
      const sessionKey = 'cm_reload_' + cardId;
      const reloadCount = parseInt(sessionStorage.getItem(sessionKey) || '0', 10);

      if (reloadCount < 1) {
        console.log("Overlay preferences do not match page filters. Auto-syncing...");
        sessionStorage.setItem(sessionKey, (reloadCount + 1).toString());
        const isReloading = await applySidebarFilter({
          condition: savedCondition,
          location: savedLocation,
          languages: savedLanguages
        });
        if (isReloading) return; // Wait for the page to reload
      } else {
        console.warn("Auto-sync reload loop prevented. Showing page results with currently active filters.");
      }
    } else {
      // Clear reload count if we are in sync or if sidebar is missing
      sessionStorage.removeItem('cm_reload_' + cardId);
    }

    // Render loading screen with correct filter states
    updateOverlay('loading', {
      selectedCondition: savedCondition,
      selectedLocation: savedLocation,
      selectedLanguages: savedLanguages
    });

    // Since Cardmarket filtered the page, we simply scrape the matching condition row
    const match = scrapePrice(savedCondition, savedLocation, savedLanguages);
    if (!match) {
      currentMatchedElement = null;
      updateOverlay('success', {
        selectedCondition: savedCondition,
        selectedLocation: savedLocation,
        selectedLanguages: savedLanguages,
        noMatch: true
      });
      return;
    }

    currentMatchedElement = match.element; // Save matched row reference

    chrome.runtime.sendMessage({
      action: "scanCard",
      tcg: tcg,
      cardId: cardId,
      condition: savedCondition,
      language: match.language,
      sellerCountry: match.sellerCountry,
      currentPrice: match.price,
      comment: match.comment
    }, (dbResponse) => {
      if (chrome.runtime.lastError || !dbResponse) {
        console.error("Database connection failed:", chrome.runtime.lastError);
        updateOverlay('error', {
          selectedCondition: savedCondition,
          selectedLocation: savedLocation,
          selectedLanguages: savedLanguages,
          errorText: "Verbindung zur Extension fehlgeschlagen."
        });
        return;
      }

      if (dbResponse.error) {
        console.error("Scanning process failed:", dbResponse.error);
        updateOverlay('error', {
          selectedCondition: savedCondition,
          selectedLocation: savedLocation,
          selectedLanguages: savedLanguages,
          errorText: `Datenbank-Fehler: ${dbResponse.error}`
        });
        return;
      }

      const record = dbResponse.latestRecord;

      updateOverlay('success', {
        selectedCondition: savedCondition,
        selectedLocation: savedLocation,
        selectedLanguages: savedLanguages,
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
