import { parseCSV, normalizeScanData, extractCardCode, parseCardCodeComponents, WHATNOT_COLUMNS } from './csv-parser.js';
import { getGermanCardDetails, formatCardMeta, translateCardName, getEnglishPokemonName, translateSetName, detectSetFromFraction } from './tcg-translations.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { fetchTCGPlayerPrice, getTCGPlayerSearchUrl } from './tcgplayer-service.js';
import {
  getManualPriceForCard,
  fetchRemoteManualPricesIndex,
  matchRemoteManualPrice,
} from './manual-prices.js';

export function escapeCsvCell(val) {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Verifies that a Cardmarket `price_history` row genuinely matches one of the card's collector numbers
 * on exact digit/token boundaries (so e.g. card #8 or #008 NEVER falsely matches #086 or #180).
 */
export function doesRecordMatchCardNumber(record, numVariants = []) {
  if (!record || !Array.isArray(numVariants) || numVariants.length === 0) return true;
  const haystack = `${record.card_id || ''} ${record.comment || ''}`;

  for (const rawVariant of numVariants) {
    if (!rawVariant) continue;
    const v = String(rawVariant).trim();
    if (!v) continue;

    if (/^\d+$/.test(v)) {
      const nInt = parseInt(v, 10);
      if (isNaN(nInt)) continue;
      // Match optional leading zeros + exact integer, bounded by non-digits on both sides
      const numBoundaryRe = new RegExp(`(?:^|[^0-9])0*${nInt}(?:$|[^0-9])`);
      if (numBoundaryRe.test(haystack)) {
        return true;
      }
    } else {
      const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tokenRe = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^0-9])`, 'i');
      if (tokenRe.test(haystack)) {
        return true;
      }
    }
  }

  return false;
}

function doesRecordMatchFullCode(record, fullCode) {
  if (!record || !fullCode) return false;
  const haystack = `${record.card_id || ''} ${record.comment || ''}`;
  const escaped = String(fullCode).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Must not be preceded by alphanumeric or followed by another digit (prevents M508 matching M5082)
  const re = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^0-9])`, 'i');
  return re.test(haystack);
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
    if (onProgress) onProgress(0, total, 'Synchronisiere manuelle Preise & DB...');

    // Pre-fetch fresh Supabase `/Manual/*` index once for the entire batch
    await fetchRemoteManualPricesIndex(true);

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
          onProgress(completed, total, item.nameDe || item.detectedName || item.rawName || `Karte #${item.index}`);
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
    const code = (
      item.detectedCode ||
      extractCardCode(item.whatnot?.beschreibung) ||
      extractCardCode(item.rawCode || item.rawName || item.rawFile) ||
      ''
    ).trim();
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
      if (cardNameClean.toLowerCase() === 'karte' || cardNameClean.toLowerCase() === 'sammelkarte') {
        cardNameClean = '';
      }

      const nameDe = translateCardName(cardNameClean, item.tcg) || cardNameClean;
      const nameEn = getEnglishPokemonName(cardNameClean) || cardNameClean;

      let setNameClean = item.rawSet || item.set || item.cardDetails?.set_name || '';
      if (!setNameClean && rawFullName.includes('(')) {
        const parentheticalMatch = rawFullName.match(/\(([^)]+)\)/);
        if (parentheticalMatch && parentheticalMatch[1]) {
          setNameClean = parentheticalMatch[1].trim();
        }
      }
      if (!setNameClean && code) {
        const fractionMatch = code.match(/(\d{1,4})\/(\d{2,4})/);
        if (fractionMatch) {
          const fracSet = detectSetFromFraction(fractionMatch[1], fractionMatch[2], cardNameClean);
          if (fracSet) {
            setNameClean = fracSet.de;
          }
        }
        if (!setNameClean) {
          const transSet = translateSetName('', code, item.tcg, cardNameClean);
          if (transSet && transSet !== 'Pokémon TCG' && transSet !== 'Sammelkartenspiel' && transSet !== 'One Piece Card Game') {
            setNameClean = transSet;
          }
        }
      }

      const parsedComp = parseCardCodeComponents(code, rawFullName, setNameClean);

      // Candidate names for bilingual searching (EN + DE)
      const candidateNames = Array.from(new Set([cardNameClean, nameDe, nameEn].filter(Boolean)));

      // Build rich code variants (padded, unpadded, hyphenated, compact)
      const rawCodeList = [
        code,
        parsedComp?.setCardCode || null,
        parsedComp?.setCode && parsedComp?.cardNum ? `${parsedComp.setCode}${parsedComp.cardNum}` : null,
        parsedComp?.setCode && parsedComp?.cardNum ? `${parsedComp.setCode}-${parsedComp.cardNum}` : null,
        parsedComp?.setCode && parsedComp?.cardNumPad ? `${parsedComp.setCode}${parsedComp.cardNumPad}` : null,
        parsedComp?.setCode && parsedComp?.cardNumPad ? `${parsedComp.setCode}-${parsedComp.cardNumPad}` : null,
        parsedComp?.setCode === '30C' && parsedComp?.cardNumPad ? `30THC${parsedComp.cardNumPad}` : null,
        parsedComp?.setCode?.endsWith('-P') && parsedComp?.cardNumPad ? `${parsedComp.cardNumPad}/${parsedComp.setCode}` : null,
        altCode,
        safeCode,
      ];
      const fullCodeVariants = Array.from(
        new Set(rawCodeList.filter((c) => c && /[A-Za-z]/.test(c) && /\d/.test(c)))
      );

      // Collector number variants ONLY from parsed collector number or pure fraction numerator (never strip digits from set codes like S5A -> 5)
      const pureFractionNum = !parsedComp && code.includes('/') ? code.split('/')[0].replace(/\D/g, '') : '';
      const numVariants = Array.from(
        new Set([parsedComp?.cardNumPad, parsedComp?.cardNum, pureFractionNum].filter(Boolean))
      );

      // =========================================================================
      // STAGE M: Synced Supabase `/Manual/*` & Local Manual Price Lookup (TOP PRIORITY)
      // Guarantees 100% of manual prices entered in ScanConverter3000 or WebApp appear!
      // =========================================================================
      const localManual = getManualPriceForCard(code, candidateNames);
      const manualIndex = await fetchRemoteManualPricesIndex(false);
      const remoteManual = matchRemoteManualPrice(manualIndex, {
        code,
        parsedComp,
        fullCodeVariants,
        numVariants,
        candidateNames,
        tcg: item.tcg,
      });

      let chosenManualPrice = null;
      let chosenManualSource = null;

      if (remoteManual && localManual && typeof localManual.price === 'number') {
        const remoteTime = remoteManual.scanned_at ? new Date(remoteManual.scanned_at).getTime() : 0;
        const localTime = localManual.updatedAt ? new Date(localManual.updatedAt).getTime() : 0;
        if (localTime > remoteTime) {
          chosenManualPrice = localManual.price;
          chosenManualSource = 'local';
        } else {
          chosenManualPrice = parseFloat(remoteManual.price);
          chosenManualSource = 'remote';
        }
      } else if (remoteManual && !isNaN(parseFloat(remoteManual.price))) {
        chosenManualPrice = parseFloat(remoteManual.price);
        chosenManualSource = 'remote';
      } else if (localManual && typeof localManual.price === 'number') {
        chosenManualPrice = localManual.price;
        chosenManualSource = 'local';
      }

      if (chosenManualPrice !== null && !isNaN(chosenManualPrice)) {
        item.status = 'matched';
        item.lastPrice = chosenManualPrice;
        item.isManualPrice = true;
        item.lastCheckDate = remoteManual?.scanned_at ? formatTimestamp(remoteManual.scanned_at) : null;
        item.lastCheckRelative = remoteManual?.scanned_at
          ? formatRelativeDate(remoteManual.scanned_at)
          : 'Manuell';
        item.filterInfo = chosenManualSource === 'remote' ? 'Manuell Sync' : 'Manuell hinterlegt';

        if (localManual?.cardmarket_url && !localManual.cardmarket_url.startsWith('/Manual/')) {
          item.cardDetails = { cardmarket_url: localManual.cardmarket_url };
        }

        const germanDetails = getGermanCardDetails(item);
        item.nameDe = germanDetails.nameDe || nameDe || cleanName;
        item.setNameDe = germanDetails.setNameDe || setNameClean || item.rawSet || '';
        item.variant = germanDetails.variant || item.variant || parsedComp?.variantTag || null;

        if (!item.imageUrl) {
          const fetchedImg = await fetchCardImageFromDB(
            item.cardDetails?.cardmarket_url || null,
            code,
            cleanName,
            item.rawSet || item.setNameDe
          );
          if (fetchedImg) item.imageUrl = fetchedImg;
        }

        try {
          const meta = formatCardMeta(
            item.cardDetails?.cardmarket_url || null,
            item.nameDe || cleanName,
            item.setNameDe || item.rawSet,
            code,
            item.tcg
          );
          const tcgplayerData = await fetchTCGPlayerPrice(meta, item);
          item.tcgplayerPrice = tcgplayerData?.priceUsd || null;
          item.tcgplayerMarketPrice = tcgplayerData?.marketPrice || null;
          item.tcgplayerLowPrice = tcgplayerData?.lowPrice || null;
          item.tcgplayerUrl = tcgplayerData?.url || getTCGPlayerSearchUrl(meta, item);
        } catch (e) {
          item.tcgplayerPrice = null;
          item.tcgplayerUrl = getTCGPlayerSearchUrl(null, item);
        }

        return item;
      }

      // Helper to execute safe PostgREST Cardmarket `price_history` queries (excluding `/Manual/` pseudo-rows)
      const queryPriceHistory = async (filterParam, validator = null) => {
        if (!filterParam || typeof filterParam !== 'string') return null;
        const safeFilter = filterParam.includes('=') ? filterParam : `card_id=ilike.${filterParam}`;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1800);
          const url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id&${safeFilter}&card_id=not.ilike.${encodeURIComponent(
            '/Manual/*'
          )}&order=scanned_at.desc&limit=10`;
          const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            credentials: 'omit',
          });
          clearTimeout(timeoutId);
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data) && data.length > 0) {
              if (!validator) return data[0];
              for (const row of data) {
                if (validator(row)) return row;
              }
            }
          }
        } catch (e) {}
        return null;
      };

      // Stage 0: Compound Asian/Chinese & Variant Matching (e.g. Phione V1-CBB4C13 for CBB4C 1301/07)
      if (parsedComp && parsedComp.isCompound) {
        if (parsedComp.variantTag && parsedComp.setCardCode) {
          const encVar = encodeURIComponent(`%${parsedComp.variantTag}%${parsedComp.setCardCode}%`);
          bestRecord = await queryPriceHistory(`card_id=ilike.${encVar}`);
          if (!bestRecord) {
            const encVarRev = encodeURIComponent(`%${parsedComp.setCardCode}%${parsedComp.variantTag}%`);
            bestRecord = await queryPriceHistory(`card_id=ilike.${encVarRev}`);
          }
        }
        if (!bestRecord && parsedComp.variantTag && parsedComp.setCode) {
          for (const cand of candidateNames) {
            const encName = encodeURIComponent(`%${cand.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-')}%`);
            const encVar = encodeURIComponent(`%${parsedComp.variantTag}%`);
            const encSet = encodeURIComponent(`%${parsedComp.setCode}%`);
            bestRecord = await queryPriceHistory(
              `and=(card_id.ilike.${encName},card_id.ilike.${encVar},card_id.ilike.${encSet})`,
              (row) => doesRecordMatchCardNumber(row, numVariants)
            );
            if (bestRecord) break;
          }
        }
        if (!bestRecord && !parsedComp.variantTag && parsedComp.setCardCode) {
          for (const cand of candidateNames) {
            const encName = encodeURIComponent(`%${cand.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-')}%`);
            const encSetCard = encodeURIComponent(`%${parsedComp.setCardCode}%`);
            bestRecord = await queryPriceHistory(
              `and=(card_id.ilike.${encName},card_id.ilike.${encSetCard})`,
              (row) => doesRecordMatchFullCode(row, parsedComp.setCardCode)
            );
            if (bestRecord) break;
          }
        }
        if (!bestRecord && !parsedComp.variantTag && parsedComp.setCardCode && parsedComp.setCode) {
          const encSetCard = encodeURIComponent(`%${parsedComp.setCardCode}%`);
          bestRecord = await queryPriceHistory(`card_id=ilike.${encSetCard}`, (row) =>
            doesRecordMatchFullCode(row, parsedComp.setCardCode)
          );
        }
      }

      const hasStrictVariant = Boolean(parsedComp && parsedComp.variantTag);

      // Stage 1: Combined Match (Set Name + Card Name + Code/Collector Number Variants)
      if (!bestRecord && !hasStrictVariant && setNameClean) {
        const cleanSetForSlug = setNameClean.replace(/\s*\([A-Z]{2}\)\s*$/i, '').trim();
        const setSlug = cleanSetForSlug.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
        const encSet = encodeURIComponent(`%${setSlug}%`);

        for (const cand of candidateNames) {
          const nameSlug = cand.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
          const encName = encodeURIComponent(`%${nameSlug}%`);

          for (const cv of fullCodeVariants) {
            const encCv = encodeURIComponent(`%${cv}%`);
            bestRecord = await queryPriceHistory(
              `and=(card_id.ilike.${encSet},card_id.ilike.${encName},or(card_id.ilike.${encCv},comment.ilike.${encCv}))`,
              (row) => doesRecordMatchCardNumber(row, numVariants)
            );
            if (bestRecord) break;
          }
          if (bestRecord) break;

          if (!bestRecord && setSlug && !['Pokemon', 'OnePiece', 'Sammelkartenspiel', 'Pokemon-TCG'].includes(setSlug)) {
            bestRecord = await queryPriceHistory(
              `and=(card_id.ilike.${encSet},card_id.ilike.${encName})`,
              (row) => doesRecordMatchCardNumber(row, numVariants)
            );
            if (bestRecord) break;
          }
        }
      }

      // Stage 2: Card Name + Full Code Match (requires card name + exact code boundary)
      if (!bestRecord && !hasStrictVariant && fullCodeVariants.length > 0) {
        for (const cand of candidateNames) {
          const nameSlug = cand.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
          const encName = encodeURIComponent(`%${nameSlug}%`);
          for (const cv of fullCodeVariants) {
            const encCv = encodeURIComponent(`%${cv}%`);
            bestRecord = await queryPriceHistory(
              `and=(card_id.ilike.${encName},or(card_id.ilike.${encCv},comment.ilike.${encCv}))`,
              (row) => doesRecordMatchFullCode(row, cv) || doesRecordMatchCardNumber(row, numVariants)
            );
            if (bestRecord) break;
          }
          if (bestRecord) break;
        }
      }

      // Stage 3: Card Name + Collector Number Match (ONLY when no conflicting setCode is missing from row, and with strict number boundary)
      if (!bestRecord && !hasStrictVariant && numVariants.length > 0 && !parsedComp?.setCode) {
        for (const cand of candidateNames) {
          const nameSlug = cand.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-');
          const encName = encodeURIComponent(`%${nameSlug}%`);
          for (const num of numVariants) {
            const encNum = encodeURIComponent(`%${num}%`);
            bestRecord = await queryPriceHistory(
              `and=(card_id.ilike.${encName},or(card_id.ilike.${encNum},comment.ilike.${encNum}))`,
              (row) => doesRecordMatchCardNumber(row, numVariants)
            );
            if (bestRecord) break;
          }
          if (bestRecord) break;
        }
      }

      // Stage 4: Unique Full Alphanumeric Code ONLY (must have letters + digits, length >= 4, and pass strict code boundary check)
      if (!bestRecord && !hasStrictVariant) {
        const strictFullCodes = fullCodeVariants.filter((c) => /[A-Za-z]/.test(c) && /\d/.test(c) && c.length >= 4);
        for (const fullCode of strictFullCodes) {
          const encCode = encodeURIComponent(`%${fullCode}%`);
          bestRecord = await queryPriceHistory(
            `or=(comment.ilike.%Code:${fullCode}%,card_id.ilike.${encCode})`,
            (row) => doesRecordMatchFullCode(row, fullCode)
          );
          if (bestRecord) break;
        }
      }

      const defaultFilterInfo = `${item.rawCondition || 'NM'}, ${item.rawLocation || 'DE'}, ${item.rawLanguage || 'EN'}`;

      if (bestRecord) {
        item.status = 'matched';
        if (!item.isManualPrice) {
          const parsedP = parseFloat(bestRecord.price);
          item.lastPrice = !isNaN(parsedP) ? parsedP : null;
          item.lastCheckDate = formatTimestamp(bestRecord.scanned_at);
          item.lastCheckRelative = formatRelativeDate(bestRecord.scanned_at);
          item.filterInfo = formatFilterInfo(bestRecord.comment) || defaultFilterInfo;
        }
        const extractedName = cleanCardName(bestRecord.card_id);
        if (!item.detectedName || item.detectedName.toLowerCase() === 'karte') {
          item.detectedName = extractedName || item.rawName || 'Karte';
        }
        if (bestRecord.card_id && !bestRecord.card_id.startsWith('/Manual/')) {
          item.cardDetails = { cardmarket_url: bestRecord.card_id };
        }

        // Extract set name from card_id path ONLY if not already known and not a /Manual/ path
        if (!item.rawSet && bestRecord.card_id && !bestRecord.card_id.startsWith('/Manual/')) {
          const pathSegments = bestRecord.card_id.split('/').filter(Boolean);
          if (pathSegments.length >= 2) {
            const setSegment = pathSegments[pathSegments.length - 2];
            if (setSegment && setSegment.toLowerCase() !== 'singles' && setSegment.toLowerCase() !== 'products') {
              item.rawSet = setSegment.replace(/[-_]/g, ' ').trim();
            }
          }
        }

        const germanDetails = getGermanCardDetails(item);
        item.nameDe = germanDetails.nameDe;
        item.setNameDe = germanDetails.setNameDe;
        item.variant = germanDetails.variant || item.variant || parsedComp?.variantTag || null;

        if (!item.imageUrl) {
          const fetchedImg = await fetchCardImageFromDB(
            bestRecord.card_id,
            code,
            cleanName,
            item.rawSet || item.setNameDe
          );
          item.imageUrl = fetchedImg || parseImageUrlFromComment(bestRecord.comment) || null;
        }

        try {
          const meta = formatCardMeta(
            bestRecord.card_id,
            item.nameDe || cleanName,
            item.setNameDe || item.rawSet,
            code,
            item.tcg
          );
          const tcgplayerData = await fetchTCGPlayerPrice(meta, item);
          item.tcgplayerPrice = tcgplayerData?.priceUsd || null;
          item.tcgplayerMarketPrice = tcgplayerData?.marketPrice || null;
          item.tcgplayerLowPrice = tcgplayerData?.lowPrice || null;
          item.tcgplayerUrl = tcgplayerData?.url || getTCGPlayerSearchUrl(meta, item);
        } catch (e) {
          item.tcgplayerPrice = null;
          item.tcgplayerUrl = getTCGPlayerSearchUrl(null, item);
        }

        return item;
      }

      const germanDetails = getGermanCardDetails(item);
      item.nameDe = germanDetails.nameDe || cleanName;
      item.setNameDe = germanDetails.setNameDe || item.rawSet || '';
      item.variant = germanDetails.variant || item.variant || parsedComp?.variantTag || null;

      item.status = 'needs_review';
      item.lastPrice = null;
      item.lastCheckDate = null;
      item.lastCheckRelative = null;
      item.filterInfo = defaultFilterInfo;
      if (!item.imageUrl) {
        const fallbackImg = await fetchCardImageFromDB(null, code, cleanName, item.rawSet || item.setNameDe);
        if (fallbackImg) item.imageUrl = fallbackImg;
      }

      try {
        const meta = formatCardMeta(null, item.nameDe || cleanName, item.setNameDe || item.rawSet, code, item.tcg);
        const tcgplayerData = await fetchTCGPlayerPrice(meta, item);
        item.tcgplayerPrice = tcgplayerData?.priceUsd || null;
        item.tcgplayerMarketPrice = tcgplayerData?.marketPrice || null;
        item.tcgplayerLowPrice = tcgplayerData?.lowPrice || null;
        item.tcgplayerUrl = tcgplayerData?.url || getTCGPlayerSearchUrl(meta, item);
      } catch (e) {
        item.tcgplayerPrice = null;
        item.tcgplayerUrl = getTCGPlayerSearchUrl(null, item);
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
    const rows = this.scanItems.map((item) => [
      `"${item.detectedCode || ''}"`,
      `"${item.detectedName || item.rawName || ''}"`,
      `"${item.rawFile || ''}"`,
      `"${item.rawCondition || 'Near Mint'}"`,
      `"${item.rawLanguage || 'EN'}"`,
      item.lastPrice !== null && item.lastPrice !== undefined ? item.lastPrice.toFixed(2) : '',
      `"${item.lastCheckRelative || item.lastCheckDate || 'Kein Check'}"`,
      `"${item.filterInfo || ''}"`,
      `"${item.status}"`,
    ]);

    return [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
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
  if (comment.startsWith('[Manual')) return 'Manuell Sync';
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
  if (!cardId || cardId.startsWith('/Manual/')) return '';
  let clean = decodeURIComponent(cardId);
  if (clean.startsWith('tcgdex_')) {
    return clean.replace('tcgdex_', '').replace(/[-_]/g, ' ').trim();
  }
  if (clean.includes('(') && clean.includes(')')) {
    return clean.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const cleanPath = cardId.replace(/^\/+/, '');
  const parts = cleanPath.split('/').filter((p) => p.length > 0);
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

async function fetchCardImageFromDB(cardId, code = '', cleanName = '', rawSet = '') {
  if (cardId && !cardId.startsWith('/Manual/')) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const enc = encodeURIComponent(cardId);
      const url = `${SUPABASE_URL}/rest/v1/card_images?select=image_url&card_id=eq.${enc}&limit=1`;
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        credentials: 'omit',
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.[0]?.image_url) return data[0].image_url;
      }
    } catch (e) {}
  }

  const parsed = parseCardCodeComponents(code, cleanName, rawSet);
  const pureFractionNum = !parsed && code.includes('/') ? code.split('/')[0].replace(/\D/g, '') : '';
  const cardNum = parsed?.cardNum || pureFractionNum;
  const cardNumPad = parsed?.cardNumPad || '';
  const numList = Array.from(new Set([cardNum, cardNumPad].filter(Boolean)));
  const cleanSet = (rawSet || parsed?.setCode || '').replace(/\s*\([A-Z]{2}\)\s*$/i, '').replace(/[-_\s]+/g, '-').trim();

  if (cleanSet && numList.length > 0) {
    for (const num of numList) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const encSet = encodeURIComponent(`%${cleanSet}%`);
        const encNum = encodeURIComponent(`%${num}%`);
        const url = `${SUPABASE_URL}/rest/v1/card_images?select=image_url&and=(card_id.ilike.${encSet},card_id.ilike.${encNum})&limit=5`;
        const resp = await fetch(url, {
          signal: controller.signal,
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
          credentials: 'omit',
        });
        clearTimeout(timeoutId);
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) {
            const match = data.find((d) => doesRecordMatchCardNumber(d, numList));
            if (match?.image_url) return match.image_url;
          }
        }
      } catch (e) {}
    }
  }

  if (cleanName && numList.length > 0 && !parsed?.setCode) {
    const deName = translateCardName(cleanName) || cleanName;
    const enName = getEnglishPokemonName(cleanName) || cleanName;
    const nameList = Array.from(new Set([cleanName, deName, enName].filter(Boolean)));

    for (const n of nameList) {
      for (const num of numList) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1200);
          const encName = encodeURIComponent(`%${n.replace(/[-_]/g, ' ').trim().replace(/\s+/g, '-')}%`);
          const encNum = encodeURIComponent(`%${num}%`);
          const url = `${SUPABASE_URL}/rest/v1/card_images?select=image_url&and=(card_id.ilike.${encName},card_id.ilike.${encNum})&limit=5`;
          const resp = await fetch(url, {
            signal: controller.signal,
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            credentials: 'omit',
          });
          clearTimeout(timeoutId);
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data)) {
              const match = data.find((d) => doesRecordMatchCardNumber(d, numList));
              if (match?.image_url) return match.image_url;
            }
          }
        } catch (e) {}
      }
    }
  }

  return null;
}
