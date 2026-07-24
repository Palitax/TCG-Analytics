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
      item.lastCheckRelative = null;
      item.filterInfo = null;
      item.imageUrl = null;
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

      let bestRecord = null;
      let matchedCard = null;

      if (queryCandidates.length > 0) {
        const { data: historyData, error: historyError } = await supabase
          .from('price_history')
          .select('*')
          .or(queryCandidates.join(','))
          .order('scanned_at', { ascending: false })
          .limit(30);

        if (!historyError && historyData && historyData.length > 0) {
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
        }
      }

      // Check cards table as secondary match source
      if (code || cleanName) {
        const cardQuery = code ? `card_number.ilike.%${code}%,name.ilike.%${code}%` : `name.ilike.%${cleanName}%`;
        const { data: cardsData } = await supabase
          .from('cards')
          .select('*')
          .or(cardQuery)
          .limit(1);

        if (cardsData && cardsData.length > 0) {
          matchedCard = cardsData[0];
        }
      }

      if (bestRecord || matchedCard) {
        item.status = 'matched';
        item.lastPrice = bestRecord ? (parseFloat(bestRecord.price) || null) : (matchedCard ? parseFloat(matchedCard.price) || null : null);
        item.lastCheckDate = bestRecord ? formatTimestamp(bestRecord.scanned_at) : (matchedCard ? formatTimestamp(matchedCard.updated_at) : null);
        item.lastCheckRelative = bestRecord ? formatRelativeDate(bestRecord.scanned_at) : (matchedCard ? formatRelativeDate(matchedCard.updated_at) : null);
        item.filterInfo = bestRecord ? formatFilterInfo(bestRecord.comment) : 'Standard Filter';
        item.detectedName = item.detectedName || (matchedCard ? matchedCard.name : null) || (bestRecord ? cleanCardName(bestRecord.card_id) : null) || item.rawName;
        item.cardDetails = { cardmarket_url: bestRecord ? bestRecord.card_id : (matchedCard ? matchedCard.id : null) };

        // IMAGE LOOKUP PIPELINE
        // 1. Try card_images table with exact card_id or code
        const targetCid = bestRecord ? bestRecord.card_id : (matchedCard ? matchedCard.id : '');
        if (targetCid || code) {
          const imgQueries = [];
          if (targetCid) imgQueries.push(`card_id.eq.${targetCid}`);
          if (code) imgQueries.push(`card_id.ilike.%${code}%`);
          if (altCode && altCode !== code) imgQueries.push(`card_id.ilike.%${altCode}%`);

          const { data: imgData } = await supabase
            .from('card_images')
            .select('image_url')
            .or(imgQueries.join(','))
            .limit(1);

          if (imgData && imgData.length > 0 && imgData[0].image_url) {
            item.imageUrl = imgData[0].image_url;
          }
        }

        // 2. Try cards table image_url
        if (!item.imageUrl && matchedCard) {
          item.imageUrl = matchedCard.image_url || matchedCard.imageUrl || null;
        }

        // 3. Try parsing comment from price_history
        if (!item.imageUrl && bestRecord) {
          item.imageUrl = parseImageUrlFromComment(bestRecord.comment);
        }

        return item;
      }

      // Not in DB -> NO fake prices or fake images!
      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = null;
      item.imageUrl = null;
    } catch (e) {
      console.warn('Database lookup warning for code:', code, e);
      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = null;
      item.imageUrl = null;
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
