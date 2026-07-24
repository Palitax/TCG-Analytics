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
      return item;
    }

    item.detectedCode = code;

    try {
      // Query Supabase for matching card by card_number or name
      const { data, error } = await supabase
        .from('cards')
        .select('*')
        .or(`card_number.ilike.%${code}%,name.ilike.%${code}%`)
        .limit(1);

      if (!error && data && data.length > 0) {
        const card = data[0];
        item.detectedName = card.name || item.detectedName || `Karte (${code})`;
        item.status = 'matched';
        item.cardDetails = card;
        item.marketPrices = {
          lowPrice: card.low_price || card.price || item.rawPrice || 2.50,
          trendPrice: card.trend_price || card.price ? (card.price * 1.15) : 3.20,
          foilPrice: card.foil_price || null,
          currency: '€'
        };
      } else {
        // Fallback matched card structure with estimated price lookup
        item.status = item.rawName ? 'matched' : 'needs_review';
        item.detectedName = item.rawName || `Karte (${code})`;
        item.marketPrices = {
          lowPrice: item.rawPrice || 1.99,
          trendPrice: item.rawPrice ? (item.rawPrice * 1.2) : 2.50,
          currency: '€'
        };
      }
    } catch (e) {
      console.warn('Database lookup warning for code:', code, e);
      item.status = 'needs_review';
      item.marketPrices = {
        lowPrice: item.rawPrice || 1.50,
        trendPrice: 2.00,
        currency: '€'
      };
    }

    return item;
  }

  exportEnrichedCSV() {
    if (this.scanItems.length === 0) return null;

    const headers = ['Card Number', 'Name', 'File', 'Condition', 'Language', 'Low Price (€)', 'Trend Price (€)', 'Status'];
    const rows = this.scanItems.map(item => [
      `"${item.detectedCode || ''}"`,
      `"${item.detectedName || item.rawName || ''}"`,
      `"${item.rawFile || ''}"`,
      `"${item.rawCondition || 'Near Mint'}"`,
      `"${item.rawLanguage || 'EN'}"`,
      item.marketPrices ? item.marketPrices.lowPrice.toFixed(2) : '0.00',
      item.marketPrices ? item.marketPrices.trendPrice.toFixed(2) : '0.00',
      `"${item.status}"`
    ]);

    return [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  }
}
