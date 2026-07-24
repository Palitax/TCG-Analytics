import { parseCSV, normalizeScanData, extractCardCode } from './csv-parser.js';
import { supabase } from './supabase.js';

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
      item.filterInfo = null;
      return item;
    }

    if (code) item.detectedCode = code;

    try {
      const altCode = code.replace('/', '-');
      const numberPart = code.includes('/') ? code.split('/')[0] : (code.includes('-') ? code.split('-')[1] : code);

      // Build OR query candidates for global price_history table
      const queryCandidates = [];
      if (code) queryCandidates.push(`card_id.ilike.%${code}%`);
      if (altCode && altCode !== code) queryCandidates.push(`card_id.ilike.%${altCode}%`);
      if (numberPart && numberPart.length >= 2) queryCandidates.push(`card_id.ilike.%${numberPart}%`);
      if (cleanName && cleanName.length >= 3 && cleanName.toLowerCase() !== 'karte') {
        queryCandidates.push(`card_id.ilike.%${cleanName}%`);
      }

      if (queryCandidates.length > 0) {
        const { data: historyData, error: historyError } = await supabase
          .from('price_history')
          .select('*')
          .or(queryCandidates.join(','))
          .order('scanned_at', { ascending: false })
          .limit(30);

        if (!historyError && historyData && historyData.length > 0) {
          // Filter historyData for best match
          let bestRecord = null;

          for (const rec of historyData) {
            const cid = (rec.card_id || '').toLowerCase();
            const cLower = code.toLowerCase();
            const altLower = altCode.toLowerCase();
            const numLower = (numberPart || '').toLowerCase();
            const nameLower = (cleanName || '').toLowerCase();

            const matchesCode = cLower && cid.includes(cLower);
            const matchesAlt = altLower && cid.includes(altLower);
            const matchesNum = numLower && cid.includes(numLower);
            const matchesName = nameLower && nameLower !== 'karte' && cid.includes(nameLower);

            if ((matchesCode || matchesAlt || (matchesNum && matchesName)) && (matchesName || !cleanName)) {
              bestRecord = rec;
              break;
            }
          }

          if (!bestRecord && historyData.length > 0) {
            bestRecord = historyData[0];
          }

          if (bestRecord) {
            item.status = 'matched';
            item.lastPrice = parseFloat(bestRecord.price) || null;
            item.lastCheckDate = formatTimestamp(bestRecord.scanned_at);
            item.filterInfo = formatFilterInfo(bestRecord.comment);
            item.detectedName = item.detectedName || cleanCardName(bestRecord.card_id) || item.rawName;
            item.cardDetails = { cardmarket_url: bestRecord.card_id };
            return item;
          }
        }
      }

      // 2. Query cards table as secondary DB fallback
      if (code || cleanName) {
        const cardQuery = code ? `card_number.ilike.%${code}%,name.ilike.%${code}%` : `name.ilike.%${cleanName}%`;
        const { data: cardsData, error: cardsError } = await supabase
          .from('cards')
          .select('*')
          .or(cardQuery)
          .limit(1);

        if (!cardsError && cardsData && cardsData.length > 0) {
          const card = cardsData[0];
          item.status = 'matched';
          item.cardDetails = card;
          item.detectedName = card.name || item.detectedName || item.rawName;
          item.lastPrice = card.price ? parseFloat(card.price) : null;
          item.lastCheckDate = card.updated_at ? formatTimestamp(card.updated_at) : null;
          item.filterInfo = 'Standard Filter';
          return item;
        }
      }

      // Not in DB -> NO fake prices!
      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.filterInfo = null;
    } catch (e) {
      console.warn('Database lookup warning for code:', code, e);
      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.filterInfo = null;
    }

    return item;
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
      `"${item.lastCheckDate || 'Kein Check'}"`,
      `"${item.filterInfo || ''}"`,
      `"${item.status}"`
    ]);

    return [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  }
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
