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
    const code = item.detectedCode || extractCardCode(item.rawCode || item.rawName || item.rawFile);

    if (!code) {
      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.filterInfo = null;
      return item;
    }

    item.detectedCode = code;

    try {
      // 1. Check price_history for latest recorded Cardmarket price
      const cleanCode = code.trim();
      const altCode = cleanCode.replace('/', '-');

      const { data: historyData, error: historyError } = await supabase
        .from('price_history')
        .select('*')
        .or(`card_id.ilike.%${cleanCode}%,card_id.ilike.%${altCode}%`)
        .order('scanned_at', { ascending: false })
        .limit(1);

      if (!historyError && historyData && historyData.length > 0) {
        const record = historyData[0];
        item.status = 'matched';
        item.lastPrice = parseFloat(record.price) || null;
        item.lastCheckDate = formatTimestamp(record.scanned_at);
        item.filterInfo = formatFilterInfo(record.comment);
        item.detectedName = item.detectedName || cleanCardName(record.card_id) || item.rawName;
        return item;
      }

      // 2. Query cards table as fallback for DB match
      const { data: cardsData, error: cardsError } = await supabase
        .from('cards')
        .select('*')
        .or(`card_number.ilike.%${cleanCode}%,name.ilike.%${cleanCode}%`)
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

      // 3. Not found in DB -> NO fake prices! Set to null for user to check on CM
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
      item.lastPrice !== null ? item.lastPrice.toFixed(2) : '',
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
  return cardId.replace(/[-_]/g, ' ').trim();
}
