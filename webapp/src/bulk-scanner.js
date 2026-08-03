import { parseCSV, normalizeScanData, extractCardCode } from './csv-parser.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

export class BulkScanner {
  constructor(options = {}) {
    this.onQueueToStream = options.onQueueToStream || null;
    this.onSaveToCollection = options.onSaveToCollection || null;
    this.scanItems = [];
    this.isProcessing = false;
  }

  async processCSVText(csvText) {
    this.isProcessing = true;
    const parsed = parseCSV(csvText);
    const items = normalizeScanData(parsed);

    // Fetch prices & details for recognized items
    for (let item of items) {
      await this.enrichItemWithMarketData(item);
    }

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
      item.imageUrl = null;
      return item;
    }

    if (code) item.detectedCode = code;

    try {
      const safeCode = code.replace(/[\/\\%_]/g, '');
      const altCode = code.replace('/', '-');

      let bestRecord = null;

      const rawFullName = item.detectedName || item.rawName || '';
      let cardNameClean = rawFullName.replace(/\([^)]*\)/g, '').split(/\s+LV\./i)[0].trim();
      if (cardNameClean.toLowerCase() === 'karte') cardNameClean = '';

      let setNameClean = item.rawSet || item.set || item.cardDetails?.set_name || '';
      if (!setNameClean && rawFullName.includes('(')) {
        const parentheticalMatch = rawFullName.match(/\(([^)]+)\)/);
        if (parentheticalMatch && parentheticalMatch[1]) {
          setNameClean = parentheticalMatch[1].trim();
        }
      }

      // Stage 1: Combined Match (Set Name + Card Name + Code)
      if (!bestRecord && setNameClean && (cardNameClean || code)) {
        try {
          const setSlug = setNameClean.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
          const nameSlug = cardNameClean ? cardNameClean.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-') : '';
          const codeNum = code ? (code.split('/')[0] || code).replace(/[\/\\%_]/g, '') : '';

          let url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id&card_id=ilike.%25${encodeURIComponent(setSlug)}%25`;
          if (nameSlug) {
            url += `&card_id=ilike.%25${encodeURIComponent(nameSlug)}%25`;
          }
          if (codeNum) {
            url += `&or=(card_id.ilike.%25${encodeURIComponent(codeNum)}%25,comment.ilike.%25${encodeURIComponent(code)}%25)`;
          }
          url += `&order=scanned_at.desc&limit=5`;

          const resp = await fetch(url, {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            credentials: 'omit'
          });

          if (resp.ok) {
            const data = await resp.json();
            if (data && data.length > 0) {
              bestRecord = data[0];
            }
          }
        } catch (e) {}
      }

      // Stage 2: Card Name + Code Match
      if (!bestRecord && cardNameClean && code) {
        try {
          const nameSlug = cardNameClean.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
          const altCode = code.replace('/', '-');
          const url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id&card_id=ilike.%25${encodeURIComponent(nameSlug)}%25&or=(card_id.ilike.%25${encodeURIComponent(altCode)}%25,comment.ilike.%25${encodeURIComponent(code)}%25)&order=scanned_at.desc&limit=5`;
          const resp = await fetch(url, {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            credentials: 'omit'
          });

          if (resp.ok) {
            const data = await resp.json();
            if (data && data.length > 0) {
              bestRecord = data[0];
            }
          }
        } catch (e) {}
      }

      // Stage 3: Exact Code in Comment Match (Code:code)
      if (!bestRecord && code) {
        try {
          const encCode = encodeURIComponent(`%Code:${code}%`);
          const url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id&comment=ilike.${encCode}&order=scanned_at.desc&limit=5`;
          const resp = await fetch(url, {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            credentials: 'omit'
          });

          if (resp.ok) {
            const data = await resp.json();
            if (data && data.length > 0) {
              bestRecord = data[0];
            }
          }
        } catch (e) {}
      }

      // Stage 4: Search by exact full code search terms
      if (!bestRecord) {
        const safeCode = code.replace(/[\/\\%_]/g, '');
        const altCode = code.replace('/', '-');
        const searchTerms = [];
        if (code) searchTerms.push(code);
        if (altCode && !searchTerms.includes(altCode)) searchTerms.push(altCode);
        if (safeCode && !searchTerms.includes(safeCode)) searchTerms.push(safeCode);

        if (code && code.includes('/')) {
          const parts = code.split('/');
          if (parts[0] && parts[0].trim()) {
            const num = parts[0].trim();
            const total = parts[1] ? parts[1].trim() : '';
            if (total) {
              searchTerms.push(`${num}-${total}`);
              searchTerms.push(`${num}%${total}`);
            }
          }
        }

        for (const term of searchTerms) {
          if (!term || term.length < 2) continue;
          try {
            const cleanTerm = term.replace(/[\/\\%_]/g, '');
            const encTerm = encodeURIComponent(`%${term}%`);
            const encClean = encodeURIComponent(`%${cleanTerm}%`);
            const url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id&or=(card_id.ilike.${encTerm},comment.ilike.${encTerm},card_id.ilike.${encClean},comment.ilike.${encClean})&order=scanned_at.desc&limit=5`;
            const resp = await fetch(url, {
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
              },
              credentials: 'omit'
            });

            if (resp.ok) {
              const data = await resp.json();
              if (data && data.length > 0) {
                bestRecord = data[0];
                break;
              }
            }
          } catch (e) {}
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

        const fetchedImg = await fetchCardImageFromDB(bestRecord.card_id, code, cleanName);
        item.imageUrl = fetchedImg || parseImageUrlFromComment(bestRecord.comment) || item.imageUrl || null;

        return item;
      }

      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = defaultFilterInfo;
      const fallbackImg = await fetchCardImageFromDB(null, code, cleanName);
      if (fallbackImg) item.imageUrl = fallbackImg;

      return item;
    } catch (e) {
      console.warn('Database lookup warning for code:', code, e);
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
    const safeCode = code.replace(/[\/\\%_]/g, '');
    const altCode = code.replace('/', '-');
    if (altCode) terms.push(altCode);
    if (safeCode && safeCode !== altCode) terms.push(safeCode);
  }
  if (cleanName && cleanName.length >= 3 && cleanName.toLowerCase() !== 'karte') {
    terms.push(cleanName.replace(/[\/\\%_]/g, ''));
  }

  for (const term of terms) {
    if (!term || term.length < 2) continue;
    const cleanTerm = term.replace(/[\/\\%_]/g, '');
    if (!cleanTerm) continue;

    // 1. Check card_images table
    try {
      const enc = encodeURIComponent(`%${cleanTerm}%`);
      const url = `${SUPABASE_URL}/rest/v1/card_images?select=image_url&card_id=ilike.${enc}&limit=1`;
      const resp = await fetch(url, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        credentials: 'omit'
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.length > 0 && data[0].image_url) {
          return data[0].image_url;
        }
      }
    } catch (e) {}

    // 2. Check marked_cards table
    try {
      const enc = encodeURIComponent(`%${cleanTerm}%`);
      const url = `${SUPABASE_URL}/rest/v1/marked_cards?select=image_url&card_id=ilike.${enc}&image_url=not.is.null&limit=1`;
      const resp = await fetch(url, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        credentials: 'omit'
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.length > 0 && data[0].image_url) {
          return data[0].image_url;
        }
      }
    } catch (e) {}

    // 3. Check collection_cards table
    try {
      const enc = encodeURIComponent(`%${cleanTerm}%`);
      const url = `${SUPABASE_URL}/rest/v1/collection_cards?select=image_url&card_id=ilike.${enc}&image_url=not.is.null&limit=1`;
      const resp = await fetch(url, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        credentials: 'omit'
      });
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
