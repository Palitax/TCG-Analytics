// TCG Card Tracker - Content Script
let activeOverlay = null;
let currentUserId = null;
let currentMatchedElement = null; // Store reference to scroll to the matched seller row
let activeOverlayDetails = null;

function formatRemainingTime(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) {
    return `${hours} Std. ${minutes} Min.`;
  }
  return `${minutes} Min.`;
}

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

const LANGUAGE_NAMES_GERMAN = {
  "DE": "Deutsch",
  "EN": "Englisch",
  "ES": "Spanisch",
  "FR": "Französisch",
  "IT": "Italienisch",
  "JP": "Japanisch",
  "ZH": "Chinesisch",
  "KO": "Koreanisch"
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

// Scrape available languages from the Cardmarket filter sidebar checkboxes
function getAvailableLanguages() {
  const checkboxes = document.querySelectorAll('aside input[name="language"], aside input[name="language[]"], #searchFilterForm input[name="language"], #searchFilterForm input[name="language[]"], .filter-sidebar input[name="language"], .filter-sidebar input[name="language[]"]');
  
  if (checkboxes.length === 0) {
    // Fallback if sidebar is not loaded or classes changed: return all standard languages
    return ['DE', 'EN', 'ES', 'FR', 'IT', 'JP', 'ZH', 'KO'];
  }
  
  const languageMap = {
    "1": "EN",
    "2": "FR",
    "3": "DE",
    "4": "ES",
    "5": "IT",
    "7": "JP",
    "8": "ZH",
    "10": "KO"
  };
  
  const available = [];
  checkboxes.forEach(cb => {
    const langCode = languageMap[cb.value];
    if (langCode && !available.includes(langCode)) {
      available.push(langCode);
    }
  });
  
  return available.length > 0 ? available : ['DE', 'EN', 'ES', 'FR', 'IT', 'JP', 'ZH', 'KO'];
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
    // Only parse clean "language" parameters. Bracket keys are treated as not set/invalid
    // so they trigger an auto-migration to the clean "language" parameter in runScan.
    if (key === 'language') {
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
    "7": "JP",
    "8": "ZH",
    "10": "KO"
  };

  const URL_CONDITION_MAP = {
    "1": "MT",
    "2": "NM",
    "3": "EX",
    "4": "GD",
    "5": "LP",
    "6": "PL",
    "7": "PO"
  };

  const activeLangs = langParams.map(id => languageMap[id]).filter(Boolean);
  const activeLocation = isDeFiltered ? 'DE' : 'ALL';
  const activeCondition = URL_CONDITION_MAP[minConditionParam] || null;

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

  // 2. Sync languages (MKM database ID mapping)
  const languageMap = {
    "EN": "1",
    "FR": "2",
    "DE": "3",
    "ES": "4",
    "IT": "5",
    "JP": "7",
    "ZH": "8",
    "KO": "10"
  };

  // Get current language parameters and track if we have outdated bracket keys in the URL
  const currentLangs = [];
  let hasBracketsKey = false;
  params.forEach((val, key) => {
    if (key === 'language') {
      currentLangs.push(val);
    }
    if (key === 'language[]' || key === 'language%5B%5D') {
      hasBracketsKey = true;
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

  if (!langsMatch || hasBracketsKey) {
    params.delete('language');
    params.delete('language[]');
    params.delete('language%5B%5D');
    for (const id of targetLangs) {
      params.append('language', id);
    }
    changed = true;
  }

  // 3. Sync minCondition
  const CONDITION_URL_MAP = {
    "MT": "1",
    "NM": "2",
    "EX": "3",
    "GD": "4",
    "LP": "5",
    "PL": "6",
    "PO": "7"
  };
  const currentMinConditionParam = params.get('minCondition');
  const targetMinConditionParam = CONDITION_URL_MAP[newPrefs.condition] || null;
  if (currentMinConditionParam !== targetMinConditionParam) {
    if (targetMinConditionParam) {
      params.set('minCondition', targetMinConditionParam);
    } else {
      params.delete('minCondition');
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

function extractCondition(conditionElements) {
  let foundConditionCode = null;
  for (const el of conditionElements) {
    const text = el.textContent.trim().toUpperCase();
    const codes = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
    for (const code of codes) {
      if (
        text === code ||
        text.startsWith(code + ' ') ||
        text.startsWith(code + '(') ||
        text.split(/[^A-Z]/)[0] === code
      ) {
        foundConditionCode = code;
        break;
      }
    }
    if (foundConditionCode) break;
  }
  return foundConditionCode;
}

function extractLanguage(productInfoCell) {
  if (!productInfoCell) return 'EN';
  const langCodes = ['DE', 'EN', 'ES', 'FR', 'IT', 'JP', 'ZH', 'KO'];
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
        return lang;
      }
    }
  }
  return 'EN';
}

function extractPrice(priceElements) {
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
        return parsed;
      }
    }
  }
  return null;
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

    // 2. Verify card condition matches target (minimum condition logic: target or better)
    const CONDITION_RANK = {
      "MT": 1,
      "NM": 2,
      "EX": 3,
      "GD": 4,
      "LP": 5,
      "PL": 6,
      "PO": 7
    };
    const conditionElements = row.querySelectorAll('.article-condition, .condition, .badge, span, a');
    let conditionMatches = false;
    const foundConditionCode = extractCondition(conditionElements);

    if (foundConditionCode) {
      const targetVal = CONDITION_RANK[targetCondition] || 7;
      const foundVal = CONDITION_RANK[foundConditionCode] || 7;
      if (foundVal <= targetVal) {
        conditionMatches = true;
      }
    }

    if (!conditionMatches) continue;

    // 3. Verify card language matches target
    const productInfoCell = row.querySelector('.col-product, .product-info') || 
                            row.querySelector('.col-sellerProductInfo .col-product') ||
                            row.querySelector('.col-sellerProductInfo div.row > div:nth-child(2)') ||
                            row.querySelector('td:nth-child(2)');
                            
    const matchedLanguage = extractLanguage(productInfoCell);

    if (targetLanguages && !targetLanguages.includes('ALL') && !targetLanguages.includes(matchedLanguage)) {
      continue;
    }

    // 4. Extract product comment/description from Produktinfo cell
    let comment = '';
    if (productInfoCell) {
      const commentElement = productInfoCell.querySelector('.article-comment, .comment, [class*="comment"], .description, .product-comments span');
      if (commentElement) {
        comment = commentElement.innerText.trim();
      } else {
        let cellText = productInfoCell.innerText.trim();
        const condBadge = productInfoCell.querySelector('.condition, .article-condition, .badge');
        if (condBadge) {
          const condText = condBadge.innerText.trim();
          cellText = cellText.replace(condText, '');
        }
        comment = cellText.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    // 5. Extract price
    const priceElements = row.querySelectorAll('[class*="price"], .color-primary, span');
    const parsedPrice = extractPrice(priceElements);
    if (parsedPrice !== null) {
      return {
        price: parsedPrice,
        language: matchedLanguage,
        sellerCountry: sellerCountry,
        comment: comment,
        element: row,
        condition: foundConditionCode
      };
    }
  }
  return null;
}

// Inject interactive dropdowns and status results in the page overlay
function updateOverlay(status, details = {}) {
  activeOverlayDetails = details;
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
        <span class="cm-tracker-title">TCG Card Tracker</span>
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
    selectedLanguage = 'ALL',
    availableLanguages = [],
    currentPrice = null,
    history = [],
    firstPrice = null,
    firstScannedAt = null,
    firstUserId = null,
    firstComment = null,
    firstCondition = null,
    firstLanguage = null,
    firstCountry = null,
    matchedLanguage = null,
    matchedCountry = null,
    matchedCondition = null,
    comment = null,
    noMatch = false,
    errorText = null,
    blocked = false,
    remainingTime = 0,
    forceSyncRemaining = 0,
    forceSyncKey = null,
    isMarked = false,
    isAdmin = false
  } = details;

  const dotClass = blocked ? 'blocked' : 'active';
  const dotTitle = blocked ? 'Automatische Scans blockiert (1 Scan pro Tag)' : 'Automatische Scans aktiv';
  
  let blockIndicatorHtml = '';
  if (blocked && remainingTime > 0) {
    const timeFormatted = formatRemainingTime(remainingTime);
    blockIndicatorHtml = `<span class="cm-tracker-block-badge" title="Scans sind auf einmal pro Tag begrenzt. Nächster automatischer Scan erst nach Ablauf der Sperre.">Sperre aktiv (noch ${timeFormatted})</span>`;
  }

  const adminBadgeHtml = isAdmin 
    ? `<span class="cm-tracker-admin-badge" style="background:#fb8500;color:#000000;font-size:0.6rem;padding:2px 5px;border-radius:3px;font-weight:bold;margin-left:6px;box-shadow:0 1px 3px rgba(0,0,0,0.3);">Admin</span>` 
    : `<span class="cm-tracker-admin-badge" style="background:#444444;color:#aaaaaa;font-size:0.6rem;padding:2px 5px;border-radius:3px;margin-left:6px;">User</span>`;

  const starTitle = isMarked ? 'Karte von Merkliste entfernen' : 'Karte auf Merkliste speichern';
  const starClass = isMarked ? 'cm-btn-bookmark marked' : 'cm-btn-bookmark';
  const starSvg = isMarked 
    ? `<svg class="cm-star-icon" viewBox="0 0 24 24" fill="#facc15" stroke="#facc15" stroke-width="2">
         <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
       </svg>`
    : `<svg class="cm-star-icon" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2">
         <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
       </svg>`;

  const headerHtml = `
    <div class="cm-tracker-header" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="cm-tracker-dot ${dotClass}" title="${dotTitle}"></span>
        <span class="cm-tracker-title">TCG Card Tracker</span>
        ${adminBadgeHtml}
        ${blockIndicatorHtml}
      </div>
      <button id="cm-btn-bookmark" class="${starClass}" title="${starTitle}">
        ${starSvg}
      </button>
    </div>
  `;

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

    // Baseline calculation: compare current price to first scan ever in history
    if (history.length <= 1) {
      diffBadge = `<span class="cm-tracker-diff-badge first">Erster Scan</span>`;
      statusText = `<span class="cm-tracker-status-desc">Dieser Preis wurde als Startwert in der Datenbank gesichert.</span>`;
    } else {
      const firstRecord = history[0];
      const initialPrice = parseFloat(firstRecord.price);
      const firstDateStr = new Date(firstRecord.scanned_at).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
      const firstAuthorText = firstRecord.user_id === currentUserId ? 'dir selbst' : 'einem anderen Nutzer';

      const diffPercent = ((currentPrice - initialPrice) / initialPrice) * 100;
      const formattedDiff = diffPercent.toFixed(2);

      // User tracks value, so UP is GREEN (gain) and DOWN is RED (loss)
      const diffClass = diffPercent > 0 ? 'gain' : diffPercent < 0 ? 'loss' : 'stable';
      const diffSign = diffPercent > 0 ? '+' : '';

      diffBadge = `<span class="cm-tracker-diff-badge ${diffClass}">${diffSign}${formattedDiff}%</span>`;
      statusText = `<span class="cm-tracker-status-desc">${diffPercent > 0 ? 'Gestiegen' : diffPercent < 0 ? 'Günstiger' : 'Unverändert'} seit erstem Scan am ${firstDateStr} von ${firstAuthorText} (${initialPrice.toFixed(2)} €)</span>`;
    }

    // Render current offer as a card/tile
    let currentCommentHtml = '';
    if (comment) {
      currentCommentHtml = `
        <div class="cm-current-comment-row">
          <span class="cm-comment-quote">"${comment}"</span>
        </div>
      `;
    }

    const sellerFlag = getFlagHtml('seller', matchedCountry);
    const langFlag = getFlagHtml('language', matchedLanguage);
    const displayMatchedCondition = matchedCondition || 'Unbekannt';

    const currentTileHtml = `
      <div class="cm-tracker-tile cm-current-tile" title="Klicke hier, um zum Verkäufer in der Liste zu springen">
        <div class="cm-tile-header">
          <div class="cm-tile-header-left">
            <span class="cm-tile-tag cm-tag-current">Aktuelles Angebot</span>
            ${diffBadge}
          </div>
        </div>
        <div class="cm-tile-body">
          <div class="cm-tile-price-section">
            <span class="cm-tile-price">${currentPrice.toFixed(2)} €</span>
          </div>
          <div class="cm-tile-meta-section">
            <div class="cm-tile-meta-item cm-clickable-seller" title="Klicke hier, um zum Verkäufer in der Liste zu springen">
              <span class="cm-tile-meta-label">Verkäufer:</span>
              <span class="cm-tile-meta-value">${sellerFlag} (${matchedCountry})</span>
            </div>
            <div class="cm-tile-meta-item" title="Sprache und Zustand der Karte">
              <span class="cm-tile-meta-label">Karte:</span>
              <span class="cm-tile-meta-value">${langFlag} (${matchedLanguage})</span>
              <span class="cm-tile-meta-cond cm-tracker-badge cm-cond-${displayMatchedCondition}">${displayMatchedCondition}</span>
            </div>
          </div>
        </div>
        ${currentCommentHtml}
        ${statusText}
      </div>
    `;

    // Render first scan row if there was a previous scan, also as a card/tile
    let firstTileHtml = '';
    if (history.length >= 2 && firstPrice !== null) {
      const firstSellerFlag = getFlagHtml('seller', firstCountry);
      const firstLangFlag = getFlagHtml('language', firstLanguage);
      const displayFirstCondition = firstCondition || 'Unbekannt';
      const firstDateStr = firstScannedAt ? new Date(firstScannedAt).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '';

      firstTileHtml = `
        <div class="cm-tracker-tile cm-first-tile">
          <div class="cm-tile-header">
            <span class="cm-tile-tag cm-tag-last">Erster Scan</span>
            <span class="cm-tile-date" style="font-size: 0.72rem; color: rgba(255, 255, 255, 0.45); font-weight: 500;">${firstDateStr}</span>
          </div>
          <div class="cm-tile-body">
            <div class="cm-tile-price-section">
              <span class="cm-tile-price">${firstPrice.toFixed(2)} €</span>
            </div>
            <div class="cm-tile-meta-section">
              <div class="cm-tile-meta-item" title="Verkäufer beim ersten Scan">
                <span class="cm-tile-meta-label">Verkäufer:</span>
                <span class="cm-tile-meta-value">${firstSellerFlag} (${firstCountry})</span>
              </div>
              <div class="cm-tile-meta-item" title="Kartensprache und Zustand beim ersten Scan">
                <span class="cm-tile-meta-label">Karte:</span>
                <span class="cm-tile-meta-value">${firstLangFlag} (${firstLanguage})</span>
                <span class="cm-tile-meta-cond cm-tracker-badge cm-cond-${displayFirstCondition}">${displayFirstCondition}</span>
              </div>
            </div>
          </div>
          ${firstComment ? `
            <div class="cm-last-comment-row">
              <span class="cm-comment-quote">"${firstComment}"</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Render the interactive line chart
    let chartHtml = '';

    const points = history.map(item => ({
      price: item.price,
      time: new Date(item.scanned_at).getTime(),
      dateText: new Date(item.scanned_at).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
      }),
      comment: item.comment || ''
    }));

    if (points.length >= 2) {
      // Find min/max values to scale the axes
      const prices = points.map(p => p.price);
      const times = points.map(p => p.time);

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);

      const priceRange = maxPrice - minPrice;
      const timeRange = maxTime - minTime || 1.0;

      // Enforce a minimum price delta of 1.0 € or 10% of the price to prevent flat prices or tiny shifts from scaling vertically
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

      // Map SVG points (viewBox 0 0 100 100)
      // Height spans 10 to 90 (giving 10% margin top/bottom)
      const svgPoints = points.map(pt => {
        const x = ((pt.time - minTime) / timeRange) * 100;
        const y = 90 - ((pt.price - yMin) / yRange) * 80;
        return { x, y, price: pt.price, dateText: pt.dateText, comment: pt.comment };
      });

      // Generate polyline path
      const pathData = svgPoints.map((p, i) => (i === 0 ? 'M' : 'L') + ' ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
      // Generate gradient area path (extend to bottom grid y=90)
      const areaData = pathData + ' L ' + svgPoints[svgPoints.length - 1].x.toFixed(1) + ' 90 L ' + svgPoints[0].x.toFixed(1) + ' 90 Z';

      // Format boundary dates for X axis
      const firstDateStr = new Date(minTime).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      const lastDateStr = new Date(maxTime).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

      // Determine flag next to Preisentwicklung instead of text
      const flagHtml = selectedLanguage !== 'ALL' ? getFlagHtml('language', selectedLanguage) : '';
      const condBadgeHtml = `<span class="cm-tile-meta-cond cm-tracker-badge cm-cond-${selectedCondition}" style="margin-left: 8px; vertical-align: middle;">${selectedCondition}</span>`;

      chartHtml = `
        <div class="cm-tracker-chart-container">
          <div class="cm-chart-title" style="display: flex; align-items: center; gap: 6px;">
            <span>Preisentwicklung</span>
            ${flagHtml}
            ${condBadgeHtml}
          </div>
          
          <div class="cm-chart-layout-wrapper">
            <!-- Left Y-Axis (HTML) -->
            <div class="cm-chart-y-axis">
              <span class="cm-chart-axis-label">${yMax.toFixed(2)} €</span>
              <span class="cm-chart-axis-label">${avgPrice.toFixed(2)} €</span>
              <span class="cm-chart-axis-label">${yMin.toFixed(2)} €</span>
            </div>

            <!-- Right Area (Canvas + X-Axis) -->
            <div class="cm-chart-main-area">
              <div class="cm-chart-canvas-wrapper" id="cm-chart-wrapper">
                <svg class="cm-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="cm-chart-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
                      <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0"/>
                    </linearGradient>
                  </defs>
                  
                  <!-- Grid lines -->
                  <line x1="0" y1="10" x2="100" y2="10" class="cm-chart-grid-line" vector-effect="non-scaling-stroke" />
                  <line x1="0" y1="50" x2="100" y2="50" class="cm-chart-grid-line" vector-effect="non-scaling-stroke" />
                  <line x1="0" y1="90" x2="100" y2="90" class="cm-chart-grid-line" vector-effect="non-scaling-stroke" />
                  
                  <!-- Gradient Area -->
                  <path d="${areaData}" fill="url(#cm-chart-grad)" />
                  
                  <!-- Line Path -->
                  <path d="${pathData}" class="cm-chart-line-path" vector-effect="non-scaling-stroke" />
                </svg>
                
                <!-- Interactive Hover Vertical line (HTML) -->
                <div id="cm-chart-hover-line" class="cm-chart-hover-line" style="display: none;"></div>
                
                <!-- Interactive Hover Point (HTML) -->
                <div id="cm-chart-hover-dot" class="cm-chart-hover-dot" style="display: none;"></div>
                
                <!-- Float HTML Tooltip -->
                <div id="cm-chart-tooltip" class="cm-chart-tooltip" style="display: none;"></div>
              </div>

              <!-- Bottom X-Axis (HTML) -->
              <div class="cm-chart-x-axis">
                <span class="cm-chart-axis-label">${firstDateStr}</span>
                <span class="cm-chart-axis-label">${lastDateStr}</span>
              </div>
            </div>
          </div>
          
          <!-- Data points reference hidden JSON for JS hover handler -->
          <script type="application/json" id="cm-chart-points-data">
            ${JSON.stringify(svgPoints)}
          </script>
        </div>
      `;
    } else {
      const flagHtml = selectedLanguage !== 'ALL' ? getFlagHtml('language', selectedLanguage) : '';
      const condBadgeHtml = `<span class="cm-tile-meta-cond cm-tracker-badge cm-cond-${selectedCondition}" style="margin-left: 8px; vertical-align: middle;">${selectedCondition}</span>`;
      
      chartHtml = `
        <div class="cm-tracker-chart-container empty-chart">
          <div class="cm-chart-title" style="display: flex; align-items: center; gap: 6px;">
            <span>Preisentwicklung</span>
            ${flagHtml}
            ${condBadgeHtml}
          </div>
          <div class="cm-chart-empty-message">Sammle mehr Preisdaten durch zukünftige Scans, um die Kurve anzuzeigen.</div>
        </div>
      `;
    }

    resultHtml = `
      <div class="cm-tracker-results">
        ${currentTileHtml}
        ${firstTileHtml}
        ${chartHtml}
      </div>
    `;
  }

  let forceSyncBtnHtml = '';
  if (currentPrice !== null && !noMatch) {
    forceSyncBtnHtml = `
      <div class="cm-control-item">
        <label>&nbsp;</label>
        <button id="cm-btn-force-sync" class="cm-btn-force-sync" title="Erzwinge einen sofortigen Preis-Sync mit der Datenbank (umgeht die 24 Std. Sperre).">
          Force Sync
        </button>
      </div>
    `;
  }

  activeOverlay.innerHTML = `
    ${headerHtml}
    <div class="cm-tracker-body">
      <!-- Injected Dropdown Controls -->
      <div class="cm-tracker-controls">
        <div class="cm-control-item">
          <label>Min. Zustand:</label>
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
          <label>Sprache:</label>
          <select id="cm-select-language" class="cm-dropdown">
            <option value="ALL" ${selectedLanguage === 'ALL' ? 'selected' : ''}>Alle Sprachen</option>
            ${availableLanguages.map(lang => {
              const label = LANGUAGE_NAMES_GERMAN[lang] || lang;
              return `<option value="${lang}" ${selectedLanguage === lang ? 'selected' : ''}>${label}</option>`;
            }).join('')}
          </select>
        </div>

        <div class="cm-control-item">
          <label>&nbsp;</label>
          <button id="cm-btn-apply-filters" class="cm-btn-apply">Anwenden</button>
        </div>
        ${forceSyncBtnHtml}
      </div>
      
      <!-- Scan Result Output -->
      ${resultHtml}
    </div>
  `;

  // Bind chart hover listeners if the chart element is present
  const wrapper = document.getElementById('cm-chart-wrapper');
  const pointsDataEl = document.getElementById('cm-chart-points-data');
  if (wrapper && pointsDataEl) {
    const svgPoints = JSON.parse(pointsDataEl.textContent);
    const hoverLine = document.getElementById('cm-chart-hover-line');
    const hoverDot = document.getElementById('cm-chart-hover-dot');
    const tooltip = document.getElementById('cm-chart-tooltip');

    wrapper.addEventListener('mousemove', (e) => {
      const rect = wrapper.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 100;
      
      let closestPt = null;
      let minDiff = Infinity;
      for (const pt of svgPoints) {
        const diff = Math.abs(pt.x - mouseX);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = pt;
        }
      }

      if (closestPt) {
        hoverLine.style.left = closestPt.x.toFixed(1) + '%';
        hoverLine.style.display = 'block';

        hoverDot.style.left = closestPt.x.toFixed(1) + '%';
        hoverDot.style.top = closestPt.y.toFixed(1) + '%';
        hoverDot.style.display = 'block';

        const tooltipX = e.clientX - rect.left + 12;
        const tooltipY = e.clientY - rect.top - 40;
        tooltip.style.left = tooltipX + 'px';
        tooltip.style.top = tooltipY + 'px';
        tooltip.style.display = 'block';
        const commentHtml = closestPt.comment
          ? `<div class="cm-tooltip-comment" style="margin-top: 4px; font-size: 0.7rem; color: rgba(255, 255, 255, 0.6); font-style: italic; max-width: 180px; white-space: normal; word-break: break-word;">"${closestPt.comment}"</div>`
          : '';

        tooltip.innerHTML = `
          <div class="cm-tooltip-price">${closestPt.price.toFixed(2)} €</div>
          <div class="cm-tooltip-date">${closestPt.dateText}</div>
          ${commentHtml}
        `;
      }
    });

    wrapper.addEventListener('mouseleave', () => {
      hoverLine.style.display = 'none';
      hoverDot.style.display = 'none';
      tooltip.style.display = 'none';
    });
  }

  attachListeners();
}

// Bind DOM event listeners to dropdown changes in the overlay
function attachListeners() {
  const selectCondition = document.getElementById('cm-select-condition');
  const selectLocation = document.getElementById('cm-select-location');
  const selectLanguage = document.getElementById('cm-select-language');
 
  if (!selectCondition || !selectLocation || !selectLanguage) return;

  const saveAndRefresh = async () => {
    const newPrefs = {
      condition: selectCondition.value,
      location: selectLocation.value,
      language: selectLanguage.value
    };

    const storageKey = 'preferences_' + currentUserId;
    await chrome.storage.local.set({ [storageKey]: newPrefs });

    const isReloading = await applySidebarFilter({
      condition: newPrefs.condition,
      location: newPrefs.location,
      languages: [newPrefs.language]
    });
    if (!isReloading) {
      runScan();
    }
  };

  const btnApply = document.getElementById('cm-btn-apply-filters');
  if (btnApply) {
    btnApply.addEventListener('click', saveAndRefresh);
  }

  // Force Sync button click binding
  const btnForceSync = document.getElementById('cm-btn-force-sync');
  if (btnForceSync && !btnForceSync.disabled) {
    btnForceSync.addEventListener('click', async (e) => {
      e.stopPropagation();
      runScan(true);
    });
  }

  // Bookmark button click binding
  const btnBookmark = document.getElementById('cm-btn-bookmark');
  if (btnBookmark) {
    btnBookmark.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isMarked = btnBookmark.classList.contains('marked');
      const { tcg, cardId } = getTcgAndCardId();
      if (!tcg || !cardId) return;

      btnBookmark.style.pointerEvents = 'none';
      chrome.runtime.sendMessage({
        action: "toggleBookmark",
        tcg: tcg,
        cardId: cardId,
        shouldMark: !isMarked
      }, async (response) => {
        btnBookmark.style.pointerEvents = 'auto';
        if (response && response.success) {
          if (!isMarked) {
            // Save current filters specifically for this card
            const storageKey = 'preferences_' + currentUserId;
            const cardPrefsKey = 'card_preferences_' + currentUserId;
            const { [storageKey]: prefs, [cardPrefsKey]: cardPrefs = {} } = await chrome.storage.local.get([storageKey, cardPrefsKey]);
            
            const sidebar = getSidebarState();
            const sidebarLanguage = sidebar.languages.includes('ALL') ? 'ALL' : sidebar.languages[0];
            
            cardPrefs[cardId] = {
              condition: sidebar.condition || prefs?.condition || 'NM',
              location: sidebar.location || prefs?.location || 'DE',
              language: sidebarLanguage || prefs?.language || 'ALL'
            };
            await chrome.storage.local.set({ [cardPrefsKey]: cardPrefs });
          } else {
            // Remove card preferences on unbookmark
            const cardPrefsKey = 'card_preferences_' + currentUserId;
            const { [cardPrefsKey]: cardPrefs = {} } = await chrome.storage.local.get(cardPrefsKey);
            delete cardPrefs[cardId];
            await chrome.storage.local.set({ [cardPrefsKey]: cardPrefs });
          }
          runScan();
        }
      });
    });
  }

  // Current offer tile click to scroll to matched seller row
  const currentTile = document.querySelector('.cm-current-tile');
  if (currentTile && currentMatchedElement) {
    currentTile.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('select') || e.target.closest('a')) {
        return;
      }
      currentMatchedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      currentMatchedElement.classList.add('cm-highlight-row');
      setTimeout(() => {
        if (currentMatchedElement) {
          currentMatchedElement.classList.remove('cm-highlight-row');
        }
      }, 5000);
    });
  }
}

// Execute active scan sequence matching interactive selection criteria
async function runScan(force = false) {
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
    const cardPrefsKey = 'card_preferences_' + currentUserId;
    const { tcg, cardId } = getTcgAndCardId();

    // Load saved settings (global and card-specific)
    const { [storageKey]: prefs, [cardPrefsKey]: cardPrefs = {} } = await chrome.storage.local.get([storageKey, cardPrefsKey]);
    const cardSpecific = cardPrefs[cardId] || {};
    let savedCondition = cardSpecific.condition || prefs?.condition || 'NM';
    let savedLocation = cardSpecific.location || prefs?.location || 'DE';
    
    // Support migrating from array layout to single string layout:
    let savedLanguage = cardSpecific.language || prefs?.language || (prefs?.languages && prefs.languages[0]) || 'ALL';

    // Get available languages on the current page
    const availableLangs = getAvailableLanguages();

    // Verify if savedLanguage is available, if not reset to ALL
    if (savedLanguage !== 'ALL' && !availableLangs.includes(savedLanguage)) {
      console.log(`Saved language "${savedLanguage}" is not available for this card. Resetting language to "ALL".`);
      savedLanguage = 'ALL';
      // Save the updated preference immediately
      const newPrefs = {
        condition: savedCondition,
        location: savedLocation,
        language: savedLanguage
      };
      await chrome.storage.local.set({ [storageKey]: newPrefs });
    }

    // Read the current state from the URL query parameters
    const sidebar = getSidebarState();
    const sidebarLanguage = sidebar.languages.includes('ALL') ? 'ALL' : sidebar.languages[0];
    const urlParams = new URLSearchParams(window.location.search);
    const hasUrlLocation = urlParams.has('sellerCountry');
    const hasUrlLanguage = urlParams.has('language');
    const hasUrlCondition = urlParams.has('minCondition');

    let prefsUpdated = false;

    // Bidirectional sync: if the URL contains active filters, we save them as the active preference!
    if (hasUrlLocation && savedLocation !== sidebar.location) {
      savedLocation = sidebar.location;
      prefsUpdated = true;
    }
    if (hasUrlLanguage && savedLanguage !== sidebarLanguage) {
      savedLanguage = sidebarLanguage;
      prefsUpdated = true;
    }
    if (hasUrlCondition && sidebar.condition && savedCondition !== sidebar.condition) {
      savedCondition = sidebar.condition;
      prefsUpdated = true;
    }

    if (prefsUpdated) {
      const newPrefs = {
        condition: savedCondition,
        location: savedLocation,
        language: savedLanguage
      };
      await chrome.storage.local.set({ [storageKey]: newPrefs });
      
      const { [cardPrefsKey]: latestCardPrefs = {} } = await chrome.storage.local.get(cardPrefsKey);
      if (latestCardPrefs[cardId]) {
        latestCardPrefs[cardId] = newPrefs;
        await chrome.storage.local.set({ [cardPrefsKey]: latestCardPrefs });
      }
      console.log("Updated saved preferences from URL state:", newPrefs);
    }

    // Verify if sidebar checkboxes/conditions match our user-saved preferences.
    const matchesLocation = (sidebar.location === savedLocation);
    const matchesLanguage = (sidebarLanguage === savedLanguage);
    const matchesCondition = (sidebar.condition === savedCondition);

    // Verify if the sidebar container is present in the DOM before attempting to reload
    const filterContainer = document.querySelector('aside, .sidebar, #sidebar, #searchFilterForm, .filter-sidebar, #filter-sidebar');

    if (filterContainer && (!matchesLocation || !matchesLanguage || !matchesCondition)) {
      const sessionKey = 'cm_reload_' + cardId;
      const reloadCount = parseInt(sessionStorage.getItem(sessionKey) || '0', 10);

      if (reloadCount < 1) {
        console.log("Overlay preferences do not match page filters. Auto-syncing...");
        sessionStorage.setItem(sessionKey, (reloadCount + 1).toString());
        const isReloading = await applySidebarFilter({
          condition: savedCondition,
          location: savedLocation,
          languages: [savedLanguage]
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
      selectedLanguage: savedLanguage,
      availableLanguages: availableLangs
    });

    // Since Cardmarket filtered the page, we simply scrape the matching condition row
    const match = scrapePrice(savedCondition, savedLocation, [savedLanguage]);
    if (!match) {
      currentMatchedElement = null;
      updateOverlay('success', {
        selectedCondition: savedCondition,
        selectedLocation: savedLocation,
        selectedLanguage: savedLanguage,
        availableLanguages: availableLangs,
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
      language: savedLanguage,
      sellerCountry: savedLocation,
      currentPrice: match.price,
      comment: match.comment,
      force: force,
      matchedCondition: match.condition,
      matchedLanguage: match.language,
      matchedCountry: match.sellerCountry
    }, (dbResponse) => {
      if (chrome.runtime.lastError || !dbResponse) {
        console.error("Database connection failed:", chrome.runtime.lastError);
        updateOverlay('error', {
          selectedCondition: savedCondition,
          selectedLocation: savedLocation,
          selectedLanguage: savedLanguage,
          availableLanguages: availableLangs,
          errorText: "Verbindung zur Extension fehlgeschlagen."
        });
        return;
      }

      if (dbResponse.error) {
        console.error("Scanning process failed:", dbResponse.error);
        updateOverlay('error', {
          selectedCondition: savedCondition,
          selectedLocation: savedLocation,
          selectedLanguage: savedLanguage,
          availableLanguages: availableLangs,
          errorText: `Datenbank-Fehler: ${dbResponse.error}`
        });
        return;
      }

      let history = dbResponse.history || [];
      history = history.map(parseHistoryItem);
      const firstRecord = history.length > 0 ? history[0] : null;

      updateOverlay('success', {
        selectedCondition: savedCondition,
        selectedLocation: savedLocation,
        selectedLanguage: savedLanguage,
        availableLanguages: availableLangs,
        currentPrice: match.price,
        history: history,
        firstPrice: firstRecord ? firstRecord.price : null,
        firstScannedAt: firstRecord ? firstRecord.scanned_at : null,
        firstUserId: firstRecord ? firstRecord.user_id : null,
        firstComment: firstRecord ? firstRecord.comment : null,
        firstCondition: firstRecord ? firstRecord.matchedCondition : null,
        firstLanguage: firstRecord ? firstRecord.matchedLanguage : null,
        firstCountry: firstRecord ? firstRecord.matchedCountry : null,
        matchedLanguage: match.language,
        matchedCountry: match.sellerCountry,
        matchedCondition: match.condition,
        comment: match.comment,
        blocked: dbResponse.blocked || false,
        remainingTime: dbResponse.remainingTime || 0,
        isMarked: dbResponse.isMarked || false,
        isAdmin: dbResponse.isAdmin || false
      });

      if (dbResponse.isMarked) {
        (async () => {
          const cardPrefsKey = 'card_preferences_' + currentUserId;
          const { [cardPrefsKey]: latestCardPrefs = {} } = await chrome.storage.local.get(cardPrefsKey);
          latestCardPrefs[cardId] = {
            condition: savedCondition,
            location: savedLocation,
            language: savedLanguage
          };
          await chrome.storage.local.set({ [cardPrefsKey]: latestCardPrefs });
        })();
      }

      injectAdminActions(dbResponse.isAdmin, savedCondition, savedLocation, [savedLanguage]);
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

function findBuyCellAndForm(row) {
  // 1. Look for a form or button that looks like a shopping cart / buy action
  const buyElement = row.querySelector([
    'form[action*="Cart"]',
    'form[action*="cart"]',
    'form.buy-form',
    'button.btn-buy',
    '[class*="buy-btn"]',
    'button[title*="Warenkorb" i]',
    'button[title*="Cart" i]',
    'button[type="submit"]',
    'a[href*="Cart"]',
    'a[href*="cart"]'
  ].join(', '));

  if (buyElement) {
    const buyCell = buyElement.closest('.col-buy, [class*="buy"], .col-action, div:last-child') || buyElement.parentElement;
    return { buyCell, buyForm: buyElement };
  }

  // 2. Fallback: Find the last child div of the row
  const childDivs = [...row.querySelectorAll(':scope > div')];
  if (childDivs.length > 0) {
    const buyCell = childDivs[childDivs.length - 1];
    const buyForm = buyCell.querySelector('form, button, a');
    return { buyCell, buyForm };
  }

  return { buyCell: null, buyForm: null };
}

// Inject admin override action buttons next to matching Cardmarket list offers
function injectAdminActions(isAdmin, targetCondition, targetLocation, targetLanguages) {
  // Clear any existing admin buttons first
  document.querySelectorAll('.cm-admin-btn-first-scan').forEach(btn => btn.remove());

  console.log("[TCG Tracker] injectAdminActions call - isAdmin:", isAdmin, "Filter:", { targetCondition, targetLocation, targetLanguages });

  if (!isAdmin) {
    console.log("[TCG Tracker] User is not recognized as admin. app_metadata.role or user_metadata.role must be 'admin'.");
    return;
  }

  const rows = document.querySelectorAll('.article-row, [id^="articleRow"]');
  let injectedCount = 0;

  for (const row of rows) {
    // 1. Seller Country
    const sellerCol = row.querySelector('.col-seller, [class*="seller"], [class*="user"], .col-sellerProductInfo');
    const sellerCountry = extractSellerCountry(sellerCol);
    if (targetLocation === 'DE' && sellerCountry !== 'DE') continue;

    // 2. Condition
    const conditionElements = row.querySelectorAll('.article-condition, .condition, .badge, span, a');
    const condition = extractCondition(conditionElements);
    if (!condition) continue;

    const CONDITION_RANK = { "MT": 1, "NM": 2, "EX": 3, "GD": 4, "LP": 5, "PL": 6, "PO": 7 };
    const targetRank = CONDITION_RANK[targetCondition] || 99;
    const rowRank = CONDITION_RANK[condition] || 99;
    if (rowRank > targetRank) continue;

    // 3. Language
    const productInfoCell = row.querySelector('.col-product, .product-info') || 
                            row.querySelector('.col-sellerProductInfo .col-product') ||
                            row.querySelector('.col-sellerProductInfo div.row > div:nth-child(2)') ||
                            row.querySelector('td:nth-child(2)');
    const language = extractLanguage(productInfoCell);
    if (targetLanguages[0] !== 'ALL' && !targetLanguages.includes(language)) continue;

    // 4. Price
    const priceElements = row.querySelectorAll('[class*="price"], .color-primary, span');
    const price = extractPrice(priceElements);
    if (price === null) continue;

    // 5. Comment
    const commentEl = row.querySelector('.comment-text, .msg, .comment, [class*="comment"]');
    const comment = commentEl ? commentEl.textContent.trim() : '';

    // Inject "Als Startwert" button next to shopping cart icon
    const { buyCell, buyForm } = findBuyCellAndForm(row);
    if (buyCell) {
      const btn = document.createElement('button');
      btn.className = 'cm-admin-btn-first-scan';
      btn.innerHTML = '👑';
      btn.title = `Dieses Angebot (${price.toFixed(2)} €) als neuen Startwert (First Scan) in Datenbank eintragen`;
      btn.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: 6px;
        background: #fb8500;
        border: none;
        border-radius: 4px;
        color: #000000;
        font-size: 0.75rem;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.2s;
        vertical-align: middle;
        width: 22px;
        height: 22px;
        padding: 0;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
      `;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Möchtest du dieses Angebot für ${price.toFixed(2)} € als neuen Startwert (First Scan) in der Datenbank festlegen?\n(Der älteste Scan in der Datenbank für diese Filter wird überschrieben)`)) {
          btn.disabled = true;
          btn.innerHTML = '⏳';
          const { tcg, cardId } = getTcgAndCardId();
          chrome.runtime.sendMessage({
            action: 'setFirstScan',
            tcg,
            cardId,
            condition: targetCondition,
            language: targetLanguages[0],
            sellerCountry: targetLocation,
            price,
            comment
          }, (res) => {
            if (res && res.success) {
              alert('Startwert erfolgreich überschrieben!');
              window.location.reload();
            } else {
              alert('Fehler beim Speichern: ' + (res?.error || 'Unbekannter Fehler'));
              btn.disabled = false;
              btn.innerHTML = '👑';
            }
          });
        }
      });

      if (buyForm) {
        buyForm.after(btn);
      } else {
        buyCell.appendChild(btn);
      }
      injectedCount++;
    }
  }

  console.log("[TCG Tracker] injectAdminActions complete. Injected", injectedCount, "admin button overlays.");
}

// --- Webclipper Feature ---
let clipperButton = null;
let activeHoverImage = null;

let mainCardImageElement = null;

function findMainCardImageOnPage() {
  if (mainCardImageElement && document.body.contains(mainCardImageElement)) {
    return mainCardImageElement;
  }
  
  const images = Array.from(document.querySelectorAll('img'));
  const candidates = images.filter(img => {
    const src = img.src || '';
    if (src.includes('/avatars/') || src.includes('/logos/') || src.includes('payment') || src.includes('svg') || src.includes('/svg/')) {
      return false;
    }
    const w = img.width || img.naturalWidth || 0;
    const h = img.height || img.naturalHeight || 0;
    const isMainClass = img.className.includes('img-fluid') || img.className.includes('product-image') || img.className.includes('prod-img');
    return w > 100 || h > 100 || img.naturalWidth > 100 || img.naturalHeight > 100 || isMainClass;
  });
  
  candidates.sort((a, b) => {
    const sizeA = (a.width || a.naturalWidth || 0) * (a.height || a.naturalHeight || 0);
    const sizeB = (b.width || b.naturalWidth || 0) * (b.height || b.naturalHeight || 0);
    return sizeB - sizeA;
  });
  
  mainCardImageElement = candidates[0] || null;
  return mainCardImageElement;
}

function findImageInContext(target) {
  if (!target) return null;
  if (target.tagName === 'IMG') return target;
  
  let img = target.querySelector('img');
  if (img) return img;
  
  const wrapper = target.closest('.image-container, .prod-img, .carousel, .lightbox, .gallery, .image-wrapper, [class*="image"], [class*="img"], .col-12, [class*="col-"]');
  if (wrapper) {
    img = wrapper.querySelector('img');
    if (img) return img;
  }
  
  if (target.parentElement) {
    img = target.parentElement.querySelector('img');
    if (img) return img;
  }
  
  return null;
}

function isValidCardImage(el) {
  if (!el || el.tagName !== 'IMG') return false;
  const src = el.src || '';
  
  // Exclude icons, avatars, logo, etc.
  if (src.includes('/avatars/') || src.includes('/logos/') || src.includes('payment') || src.includes('svg') || src.includes('/svg/')) {
    return false;
  }
  
  const w = el.width || el.naturalWidth || 0;
  const h = el.height || el.naturalHeight || 0;
  return w > 60 || h > 60 || el.naturalWidth > 60 || el.naturalHeight > 60;
}

function showClipperButton(img) {
  if (!clipperButton) {
    clipperButton = document.createElement('button');
    clipperButton.className = 'cm-webclipper-btn';
    clipperButton.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle; display:inline-block;">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      <span style="vertical-align:middle;">Clip</span>
    `;
    clipperButton.style.cssText = `
      position: absolute;
      z-index: 100000;
      background: rgba(251, 133, 0, 0.9);
      color: white;
      border: none;
      border-radius: 6px;
      padding: 6px 10px;
      font-family: inherit;
      font-size: 0.72rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      transition: opacity 0.2s ease, transform 0.1s ease;
      opacity: 0;
      pointer-events: auto;
      line-height: 1;
    `;
    
    clipperButton.addEventListener('mouseenter', () => {
      if (!clipperButton.disabled) {
        clipperButton.style.background = '#ffb703';
        clipperButton.style.transform = 'scale(1.05)';
      }
    });
    clipperButton.addEventListener('mouseleave', () => {
      if (!clipperButton.disabled) {
        clipperButton.style.background = 'rgba(251, 133, 0, 0.9)';
        clipperButton.style.transform = 'scale(1)';
      }
    });
    
    clipperButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (activeHoverImage) {
        await clipImageAction(activeHoverImage);
      }
    });
    
    document.body.appendChild(clipperButton);
  }

  activeHoverImage = img;
  const rect = img.getBoundingClientRect();
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  
  // Position button inside top-right of image
  clipperButton.style.left = `${rect.right + scrollLeft - 68}px`;
  clipperButton.style.top = `${rect.top + scrollTop + 8}px`;
  clipperButton.style.opacity = '1';
}

function hideClipperButton() {
  if (clipperButton) {
    clipperButton.style.opacity = '0';
  }
  activeHoverImage = null;
}

async function clipImageAction(img) {
  if (!clipperButton || clipperButton.disabled) return;

  const originalContent = clipperButton.innerHTML;
  clipperButton.disabled = true;
  clipperButton.style.background = '#fb8500';
  clipperButton.innerHTML = `
    <svg class="cm-clip-spinner" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="animation: spin 1s linear infinite; display:inline-block; vertical-align:middle;">
      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.2)"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff"/>
    </svg>
    <span style="vertical-align:middle;">Clipping...</span>
  `;

  const { tcg, cardId } = getTcgAndCardId();
  const imageUrl = img.src;

  chrome.runtime.sendMessage({
    action: "saveClippedImage",
    cardId,
    tcg,
    imageUrl
  }, (res) => {
    if (res && res.success) {
      clipperButton.style.background = '#34d399'; // green success
      clipperButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="display:inline-block; vertical-align:middle;">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span style="vertical-align:middle;">Geclippt!</span>
      `;
      setTimeout(() => {
        if (clipperButton) {
          clipperButton.disabled = false;
          clipperButton.innerHTML = originalContent;
          clipperButton.style.background = 'rgba(251, 133, 0, 0.9)';
          hideClipperButton();
        }
      }, 1500);
    } else {
      clipperButton.style.background = '#ef4444'; // red error
      clipperButton.innerHTML = `<span style="vertical-align:middle;">Fehler!</span>`;
      console.error("Clipper failed:", res?.error);
      setTimeout(() => {
        if (clipperButton) {
          clipperButton.disabled = false;
          clipperButton.innerHTML = originalContent;
          clipperButton.style.background = 'rgba(251, 133, 0, 0.9)';
        }
      }, 2000);
    }
  });
}

// Hover Event Listeners
let hoverTimeout = null;

document.addEventListener('mouseover', (e) => {
  const mainImg = findMainCardImageOnPage();
  if (mainImg) {
    const isHoveringMainArea = e.target === mainImg || 
                               mainImg.contains(e.target) || 
                               e.target.contains(mainImg) ||
                               e.target.closest('.image-container, .prod-img, .carousel, .lightbox, .gallery, .image-wrapper, [class*="col-"]') === mainImg.closest('.image-container, .prod-img, .carousel, .lightbox, .gallery, .image-wrapper, [class*="col-"]');
                               
    if (isHoveringMainArea) {
      clearTimeout(hoverTimeout);
      showClipperButton(mainImg);
      return;
    }
  }

  const img = findImageInContext(e.target);
  if (img && isValidCardImage(img)) {
    clearTimeout(hoverTimeout);
    showClipperButton(img);
  }
});

document.addEventListener('mouseout', (e) => {
  const related = e.relatedTarget;
  if (clipperButton && (related === clipperButton || clipperButton.contains(related))) {
    return;
  }
  
  const mainImg = findMainCardImageOnPage();
  if (mainImg && activeHoverImage === mainImg) {
    const hoveredElements = document.querySelectorAll(':hover');
    const isStillHoveringMain = Array.from(hoveredElements).some(el => {
      return el === clipperButton || 
             el === mainImg || 
             mainImg.contains(el) || 
             el.contains(mainImg) ||
             el.closest('.image-container, .prod-img, .carousel, .lightbox, .gallery, .image-wrapper, [class*="col-"]') === mainImg.closest('.image-container, .prod-img, .carousel, .lightbox, .gallery, .image-wrapper, [class*="col-"]');
    });
    
    if (isStillHoveringMain) {
      return;
    }
  }

  const img = findImageInContext(e.target);
  if (img && img === activeHoverImage) {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      const hoveredElements = document.querySelectorAll(':hover');
      const isStillHovering = Array.from(hoveredElements).some(el => {
        const hoveredImg = findImageInContext(el);
        return el === clipperButton || (hoveredImg && hoveredImg === activeHoverImage);
      });
      
      if (!isStillHovering) {
        hideClipperButton();
      }
    }, 200);
  }
});

// Start
runScan();
setupObserver();
