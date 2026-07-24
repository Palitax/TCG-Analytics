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

      const searchTerms = [];
      if (altCode) searchTerms.push(altCode);
      if (safeCode && safeCode !== altCode) searchTerms.push(safeCode);

      for (const term of searchTerms) {
        if (!term || term.length < 2) continue;
        try {
          const encTerm = encodeURIComponent(`%${term}%`);
          const url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id&card_id=ilike.${encTerm}&order=scanned_at.desc&limit=5`;
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

      if (!bestRecord && cleanName && cleanName.length >= 3 && cleanName.toLowerCase() !== 'karte') {
        try {
          const encName = encodeURIComponent(`%${cleanName.replace(/[\/\\%_]/g, '')}%`);
          const url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id&card_id=ilike.${encName}&order=scanned_at.desc&limit=5`;
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

      if (bestRecord) {
        item.status = 'matched';
        item.lastPrice = parseFloat(bestRecord.price) || null;
        item.lastCheckDate = formatTimestamp(bestRecord.scanned_at);
        item.lastCheckRelative = formatRelativeDate(bestRecord.scanned_at);
        item.filterInfo = formatFilterInfo(bestRecord.comment);
        item.detectedName = item.detectedName || cleanCardName(bestRecord.card_id) || item.rawName;
        item.cardDetails = { cardmarket_url: bestRecord.card_id };

        const term = safeCode || altCode || cleanName;
        if (term) {
          try {
            const encImgTerm = encodeURIComponent(`%${term.replace(/[\/\\%_]/g, '')}%`);
            const url = `${SUPABASE_URL}/rest/v1/card_images?select=image_url&card_id=ilike.${encImgTerm}&limit=1`;
            const resp = await fetch(url, {
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
              },
              credentials: 'omit'
            });

            if (resp.ok) {
              const imgData = await resp.json();
              if (imgData && imgData.length > 0 && imgData[0].image_url) {
                item.imageUrl = imgData[0].image_url;
              }
            }
          } catch (e) {}
        }

        if (!item.imageUrl) {
          item.imageUrl = parseImageUrlFromComment(bestRecord.comment);
        }

        return item;
      }

      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = null;
      item.imageUrl = null;
      return item;
    } catch (e) {
      console.warn('Database lookup warning for code:', code, e);
      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = null;
      item.imageUrl = null;
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
  const parts = cardId.split('/');
  const lastPart = parts[parts.length - 1] || cardId;
  return lastPart.replace(/[-_]/g, ' ').trim();
}
