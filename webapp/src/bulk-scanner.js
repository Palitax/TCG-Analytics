import { parseCSV, normalizeScanData, extractCardCode, parseCardCodeComponents, WHATNOT_COLUMNS } from './csv-parser.js';
import { getGermanCardDetails } from './tcg-translations.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

export function escapeCsvCell(val) {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export class BulkScanner {
  constructor(options = {}) {
    this.onQueueToStream = options.onQueueToStream || null;
    this.onSaveToCollection = options.onSaveToCollection || null;
    this.scanItems = [];
    this.isProcessing = false;
  }

  async processCSVText(csvText, onProgress = null) {
    this.isProcessing = true;
    const parsed = parseCSV(csvText);
    const items = normalizeScanData(parsed);

    const total = items.length;
    let completed = 0;
    if (onProgress) onProgress(0, total, 'Starte Verarbeitung...');

    // High performance concurrency pool (6 parallel workers)
    const CONCURRENCY = 6;
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < items.length) {
        const idx = currentIndex++;
        const item = items[idx];
        await this.enrichItemWithMarketData(item);
        completed++;
        if (onProgress) {
          onProgress(completed, total, item.detectedName || item.rawName || `Karte #${item.index}`);
        }
      }
    };

    const workerCount = Math.min(CONCURRENCY, items.length);
    const workerPromises = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workerPromises);

    this.scanItems = items;
    this.isProcessing = false;
    return this.scanItems;
  }

  async enrichItemWithMarketData(item) {
    const code = (item.detectedCode || extractCardCode(item.rawCode || item.rawName || item.rawFile) || '').trim();
    const rawFullName = item.detectedName || item.rawName || '';
    const cleanName = rawFullName.replace(/\([^)]*\)/g, '').split(/\s+LV\./i)[0].trim();

    if (!code && !cleanName) {
      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = null;
      return item;
    }

    if (code) item.detectedCode = code;

    try {
      const safeCode = code.replace(/[\/\\%_]/g, '');
      const altCode = code.replace('/', '-');

      let bestRecord = null;

      let cardNameClean = rawFullName.replace(/\([^)]*\)/g, '').split(/\s+LV\./i)[0].trim();
      if (cardNameClean.toLowerCase() === 'karte') cardNameClean = '';

      let setNameClean = item.rawSet || item.set || item.cardDetails?.set_name || '';
      if (!setNameClean && rawFullName.includes('(')) {
        const parentheticalMatch = rawFullName.match(/\(([^)]+)\)/);
        if (parentheticalMatch && parentheticalMatch[1]) {
          setNameClean = parentheticalMatch[1].trim();
        }
      }

      // Helper to execute safe PostgREST price_history queries with 1.8s timeout
      const queryPriceHistory = async (filterParam) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1800);
          const url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id&${filterParam}&order=scanned_at.desc&limit=3`;
          const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            credentials: 'omit'
          });
          clearTimeout(timeoutId);
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data) && data.length > 0) {
              return data[0];
            }
          }
        } catch (e) {}
        return null;
      };

      // Stage 0: Compound Asian/Chinese Variant Matching (e.g. Phione V1-CBB4C13 for CBB4C 1301/07)
      const parsedComp = parseCardCodeComponents(code, rawFullName, setNameClean);
      if (parsedComp && parsedComp.isCompound) {
        // 0a. Try full variant slug e.g. %V1%CBB4C13% or %V1-CBB4C13%
        if (parsedComp.variantTag && parsedComp.setCardCode) {
          const encVar = encodeURIComponent(`%${parsedComp.variantTag}%${parsedComp.setCardCode}%`);
          bestRecord = await queryPriceHistory(`card_id.ilike.${encVar}`);
        }
        // 0b. Try Name + Variant + SetCode
        if (!bestRecord && cardNameClean && parsedComp.variantTag && parsedComp.setCode) {
          const encName = encodeURIComponent(`%${cardNameClean.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-')}%`);
          const encVar = encodeURIComponent(`%${parsedComp.variantTag}%`);
          const encSet = encodeURIComponent(`%${parsedComp.setCode}%`);
          bestRecord = await queryPriceHistory(`and=(card_id.ilike.${encName},card_id.ilike.${encVar},card_id.ilike.${encSet})`);
        }
        // 0c. Try Name + SetCardCode e.g. Phione + CBB4C13
        if (!bestRecord && cardNameClean && parsedComp.setCardCode) {
          const encName = encodeURIComponent(`%${cardNameClean.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-')}%`);
          const encSetCard = encodeURIComponent(`%${parsedComp.setCardCode}%`);
          bestRecord = await queryPriceHistory(`and=(card_id.ilike.${encName},card_id.ilike.${encSetCard})`);
        }
        // 0d. Try SetCardCode alone e.g. %CBB4C13%
        if (!bestRecord && parsedComp.setCardCode && parsedComp.setCode) {
          const encSetCard = encodeURIComponent(`%${parsedComp.setCardCode}%`);
          bestRecord = await queryPriceHistory(`card_id.ilike.${encSetCard}`);
        }
        // 0e. Try Suffix variant e.g. %OP05-119-V1% or %OP05-119%V1%
        if (!bestRecord && parsedComp.variantTag && parsedComp.setCardCode) {
          const encVarSuffix = encodeURIComponent(`%${parsedComp.setCardCode}%${parsedComp.variantTag}%`);
          bestRecord = await queryPriceHistory(`card_id.ilike.${encVarSuffix}`);
        }
      }

      // Stage 1: Combined Match (Set Name + Card Name + Code)
      if (!bestRecord && setNameClean && cardNameClean) {
        const setSlug = setNameClean.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
        const nameSlug = cardNameClean.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
        const codeNum = code ? (code.split('/')[0] || code).replace(/[\/\\%_]/g, '') : '';
        
        const encSet = encodeURIComponent(`%${setSlug}%`);
        const encName = encodeURIComponent(`%${nameSlug}%`);
        
        if (codeNum) {
          const encCodeNum = encodeURIComponent(`%${codeNum}%`);
          const encCode = encodeURIComponent(`%${code}%`);
          bestRecord = await queryPriceHistory(`and=(card_id.ilike.${encSet},card_id.ilike.${encName},or(card_id.ilike.${encCodeNum},comment.ilike.${encCode}))`);
        } else {
          bestRecord = await queryPriceHistory(`and=(card_id.ilike.${encSet},card_id.ilike.${encName})`);
        }
      }

      // Stage 2: Card Name + Code Match
      if (!bestRecord && cardNameClean && code) {
        const nameSlug = cardNameClean.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
        const altCode = code.replace('/', '-');
        const encName = encodeURIComponent(`%${nameSlug}%`);
        const encAltCode = encodeURIComponent(`%${altCode}%`);
        const encCode = encodeURIComponent(`%${code}%`);
        bestRecord = await queryPriceHistory(`and=(card_id.ilike.${encName},or(card_id.ilike.${encAltCode},comment.ilike.${encCode}))`);
      }

      // Stage 3: Exact Code in Comment or card_id Match
      if (!bestRecord && code) {
        const encCodeComment = encodeURIComponent(`%Code:${code}%`);
        const encCodeExact = encodeURIComponent(`%${code}%`);
        bestRecord = await queryPriceHistory(`or=(comment.ilike.${encCodeComment},card_id.ilike.${encCodeExact})`);
      }

      // Stage 4: Search by exact full code search terms
      if (!bestRecord && code) {
        const searchTerms = [code];
        if (altCode && altCode !== code) searchTerms.push(altCode);
        if (safeCode && !searchTerms.includes(safeCode)) searchTerms.push(safeCode);

        for (const term of searchTerms.slice(0, 3)) {
          if (!term || term.length < 2) continue;
          const cleanTerm = term.replace(/[\/\\%_]/g, '');
          const encTerm = encodeURIComponent(`%${term}%`);
          bestRecord = await queryPriceHistory(`or=(card_id.ilike.${encTerm},comment.ilike.${encTerm})`);
          if (bestRecord) break;
        }
      }

      const defaultFilterInfo = `${item.rawCondition || 'NM'}, ${item.rawLocation || 'DE'}, ${item.rawLanguage || 'EN'}`;

      if (bestRecord) {
        item.status = 'matched';
        item.lastPrice = parseFloat(bestRecord.price) || null;
        item.lastCheckDate = formatTimestamp(bestRecord.scanned_at);
        item.lastCheckRelative = formatRelativeDate(bestRecord.scanned_at);
        item.filterInfo = formatFilterInfo(bestRecord.comment) || defaultFilterInfo;
        const extractedName = cleanCardName(bestRecord.card_id);
        if (!item.detectedName || item.detectedName.toLowerCase() === 'karte') {
          item.detectedName = extractedName || item.rawName || 'Karte';
        }
        item.cardDetails = { cardmarket_url: bestRecord.card_id };

        // Extract set name from card_id path (e.g. /Pokemon/Products/Singles/Gem-Pack-Vol-4/...)
        const pathSegments = bestRecord.card_id.split('/').filter(Boolean);
        if (pathSegments.length >= 2) {
          const setSegment = pathSegments[pathSegments.length - 2];
          if (setSegment && setSegment.toLowerCase() !== 'singles' && setSegment.toLowerCase() !== 'products') {
            item.rawSet = setSegment.replace(/[-_]/g, ' ').trim();
          }
        }

        const germanDetails = getGermanCardDetails(item);
        item.nameDe = germanDetails.nameDe;
        item.setNameDe = germanDetails.setNameDe;
        item.variant = germanDetails.variant || item.variant || (parsedComp?.variantTag) || null;

        // Keep existing scan image from Whatnot CSV or fetch from DB if missing
        if (!item.imageUrl) {
          const fetchedImg = await fetchCardImageFromDB(bestRecord.card_id, code, cleanName);
          item.imageUrl = fetchedImg || parseImageUrlFromComment(bestRecord.comment) || null;
        }

        return item;
      }

      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = defaultFilterInfo;
      if (!item.imageUrl) {
        const fallbackImg = await fetchCardImageFromDB(null, code, cleanName);
        if (fallbackImg) item.imageUrl = fallbackImg;
      }
      return item;
    } catch (err) {
      console.warn('Database lookup warning for code:', code, err);
      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = `${item.rawCondition || 'NM'}, ${item.rawLocation || 'DE'}, ${item.rawLanguage || 'EN'}`;
      return item;
    }
  }

  exportEnrichedCSV() {
    if (this.scanItems.length === 0) return null;

    const headers = ['Card Number', 'Name', 'File', 'Condition', 'Language', 'Last Price (€)', 'Last Check', 'Filter Info', 'Status'];
    const rows = this.scanItems.map(item => [
      `"${item.detectedCode || ''}"`,
      `"${item.detectedName || item.rawName || ''}"`,
      `"${item.rawFile || ''}"`,
      `"${item.rawCondition || 'Near Mint'}"`,
      `"${item.rawLanguage || 'EN'}"`,
      item.lastPrice !== null && item.lastPrice !== undefined ? item.lastPrice.toFixed(2) : '',
      `"${item.lastCheckRelative || item.lastCheckDate || 'Kein Check'}"`,
      `"${item.filterInfo || ''}"`,
      `"${item.status}"`
    ]);

    return [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  }

  exportWhatnotCSV() {
    if (this.scanItems.length === 0) return null;

    const headerRow = WHATNOT_COLUMNS.map(escapeCsvCell).join(',');
    const rows = this.scanItems.map((item) => {
      const w = item.whatnot || {};
      const offerValue =
        w.angeboteAnnehmen === 'Ja' ||
        w.angeboteAnnehmen === 'TRUE' ||
        w.angeboteAnnehmen === 'true' ||
        w.angeboteAnnehmen === 'WAHR'
          ? 'TRUE'
          : 'FALSE';

      const priceVal =
        item.lastPrice !== null && item.lastPrice !== undefined
          ? Math.max(1, Math.round(item.lastPrice)).toString()
          : (w.preis ?? item.rawPrice ?? '1').toString();

      const cells = [
        w.kategorie || 'Trading Card Games',
        w.unterkategorie || (item.tcg === 'OnePiece' ? 'One-Piece-Karten' : 'Pokémon-Karten'),
        w.titel || item.detectedName || item.rawName || '',
        w.beschreibung || '',
        w.menge ?? item.quantity ?? 1,
        w.verkaufsformat || 'Auktion',
        priceVal,
        w.versandprofil || 'Single (15 g)',
        offerValue,
        w.gefahrgut || 'Not Hazmat',
        w.zustand || (item.rawCondition === 'NM' ? 'Near Mint' : item.rawCondition) || 'Near Mint',
        w.stueckpreis || '',
        w.artikelnummer || `CARD-${String(item.index || 1).padStart(4, '0')}`,
        w.bildUrl1 || item.imageUrl || '',
        w.bildUrl2 || item.imageBackUrl || '',
        w.bildUrl3 || '',
        w.bildUrl4 || '',
        w.bildUrl5 || '',
        w.bildUrl6 || '',
        w.bildUrl7 || '',
        w.bildUrl8 || '',
      ];
      return cells.map(escapeCsvCell).join(',');
    });

    // UTF-8 BOM + Header + Rows
    return '\uFEFF' + [headerRow, ...rows].join('\r\n');
  }
}

function parseImageUrlFromComment(comment) {
  if (!comment || !comment.startsWith('[')) return null;
  const end = comment.indexOf(']');
  if (end > 1) {
    const meta = comment.slice(1, end).split('|');
    if (meta.length >= 4 && meta[3] && meta[3].startsWith('http')) {
      return meta[3];
    }
  }
  return null;
}

function formatFilterInfo(comment) {
  if (!comment) return 'Standard Filter';
  if (comment.startsWith('[')) {
    const end = comment.indexOf(']');
    if (end > 1) {
      const meta = comment.slice(1, end).split('|');
      const lang = meta[0] || 'EN';
      const country = meta[1] || 'DE';
      const cond = meta[2] || 'NM';
      return `${cond}, ${country}, ${lang}`;
    }
  }
  return comment;
}

function formatRelativeDate(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    const now = new Date();
    
    const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = nowStart - dStart;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return '1 day ago';
    return `${diffDays} days ago`;
  } catch (e) {
    return null;
  }
}

function formatTimestamp(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    const dateStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const timeStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} ${timeStr}`;
  } catch (e) {
    return isoString;
  }
}

function cleanCardName(cardId) {
  if (!cardId) return '';
  let clean = decodeURIComponent(cardId);
  if (clean.startsWith('tcgdex_')) {
    return clean.replace('tcgdex_', '').replace(/[-_]/g, ' ').trim();
  }
  if (clean.includes('(') && clean.includes(')')) {
    return clean.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const cleanPath = cardId.replace(/^\/+/, '');
  const parts = cleanPath.split('/').filter(p => p.length > 0);
  if (parts.length === 0) return cardId;

  const cardSlug = parts[parts.length - 1];
  let cardNameClean = cardSlug.replace(/[-_]/g, ' ').trim();
  cardNameClean = cardNameClean.replace(/(\b\d+)\s+(\d+\b)/g, '$1/$2');

  if (parts.length >= 2) {
    const setSlug = parts[parts.length - 2];
    if (setSlug && setSlug.toLowerCase() !== 'singles' && setSlug.toLowerCase() !== 'products') {
      const setNameClean = setSlug.replace(/[-_]/g, ' ').trim();
      return `${cardNameClean} (${setNameClean})`;
    }
  }

  return cardNameClean;
}

async function fetchCardImageFromDB(cardId, code, cleanName) {
  const terms = [];
  if (cardId) terms.push(cardId.replace(/^\/+/, ''));
  if (code) {
    const parsedComp = parseCardCodeComponents(code, cleanName);
    if (parsedComp?.fullVariantSlug) terms.push(parsedComp.fullVariantSlug);
    else if (parsedComp?.setCardCode) terms.push(parsedComp.setCardCode);
    else terms.push(code.replace(/[\/\\%_]/g, ''));
  }
  if (!terms.length && cleanName && cleanName.length >= 3 && cleanName.toLowerCase() !== 'karte') {
    terms.push(cleanName.replace(/[\/\\%_]/g, ''));
  }

  // Max 2 primary terms to keep lookups fast
  for (const term of terms.slice(0, 2)) {
    if (!term || term.length < 2) continue;
    const cleanTerm = term.replace(/[\/\\%_]/g, '');
    if (!cleanTerm) continue;

    // 1. Check card_images table with 1.2s timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const enc = encodeURIComponent(`%${cleanTerm}%`);
      const url = `${SUPABASE_URL}/rest/v1/card_images?select=image_url&card_id=ilike.${enc}&limit=1`;
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        credentials: 'omit'
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.length > 0 && data[0].image_url) {
          return data[0].image_url;
        }
      }
    } catch (e) {}

    // 2. Check marked_cards table with 1.2s timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const enc = encodeURIComponent(`%${cleanTerm}%`);
      const url = `${SUPABASE_URL}/rest/v1/marked_cards?select=image_url&card_id=ilike.${enc}&image_url=not.is.null&limit=1`;
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        credentials: 'omit'
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.length > 0 && data[0].image_url) {
          return data[0].image_url;
        }
      }
    } catch (e) {}
  }
  return null;
}
