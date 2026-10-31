/**
 * CSV Parser Utility for TCG Card Tracker & Stream Overlay
 * Fully compliant with Whatnot Bulk-Upload CSV criteria (ScanConverter3000 Standard)
 * and backwards-compatible with PaperStream / OCR scan exports.
 */

import { getGermanCardDetails } from './tcg-translations.js';

export const WHATNOT_COLUMNS = [
  'Kategorie',
  'Unterkategorie',
  'Titel',
  'Beschreibung',
  'Menge',
  'Verkaufsformat',
  'Preis',
  'Versandprofil',
  'Angebote annehmen',
  'Gefahrgut',
  'Zustand',
  'Stückpreis',
  'Artikelnummer',
  'Bild-URL 1',
  'Bild-URL 2',
  'Bild-URL 3',
  'Bild-URL 4',
  'Bild-URL 5',
  'Bild-URL 6',
  'Bild-URL 7',
  'Bild-URL 8',
];

/**
 * Robust RFC-4180 compliant CSV parser that handles:
 * - UTF-8 BOM removal (\uFEFF)
 * - Quoted fields containing commas, semicolons, tabs, and multiline newlines
 * - Escaped double quotes ("")
 * - Auto-detection of delimiter (comma, semicolon, tab)
 */
export function parseCSV(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return { headers: [], rows: [], data: [], delimiter: ',' };
  }

  // Remove UTF-8 BOM if present
  let cleanText = csvText;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  if (!cleanText.trim()) {
    return { headers: [], rows: [], data: [], delimiter: ',' };
  }

  // Normalize standalone \r to \n, but preserve \r\n
  cleanText = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Auto-detect delimiter by analyzing outside-of-quotes character frequency
  const delimiter = detectDelimiter(cleanText);

  // Parse RFC-4180 tokens across entire text
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (char === '\n' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      // Only push non-empty rows
      if (currentRow.some((c) => c !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentCell += char;
    }
  }

  // Flush remaining cell and row
  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [], data: [], delimiter };
  }

  const rawHeaders = rows[0].map((h) => h.replace(/^["']|["']$/g, '').trim());
  const normalizedHeaders = rawHeaders.map((h) => normalizeHeaderKey(h));

  const data = [];
  for (let i = 1; i < rows.length; i++) {
    const rowValues = rows[i];
    const rowObj = {};

    normalizedHeaders.forEach((headerKey, idx) => {
      rowObj[headerKey] = rowValues[idx] !== undefined ? rowValues[idx] : '';
    });

    // Also attach original raw header keys for maximum compatibility
    rawHeaders.forEach((rawKey, idx) => {
      rowObj[rawKey] = rowValues[idx] !== undefined ? rowValues[idx] : '';
    });

    data.push(rowObj);
  }

  return { headers: rawHeaders, rows: rows.slice(1), data, delimiter };
}

/**
 * Detects delimiter by counting occurrences in the header/first lines outside quotes
 */
function detectDelimiter(text) {
  const firstChunk = text.slice(0, 4096);
  let commaCount = 0;
  let semiCount = 0;
  let tabCount = 0;
  let inQuotes = false;

  for (let i = 0; i < firstChunk.length; i++) {
    const char = firstChunk[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === ',') commaCount++;
      else if (char === ';') semiCount++;
      else if (char === '\t') tabCount++;
      else if (char === '\n') break; // Prioritize header line
    }
  }

  if (semiCount > commaCount && semiCount > tabCount) return ';';
  if (tabCount > commaCount && tabCount > semiCount) return '\t';
  return ',';
}

/**
 * Normalizes header keys to lowercase ASCII-friendly strings
 */
function normalizeHeaderKey(key) {
  if (!key) return '';
  return key
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Normalizes language strings from Whatnot, ScanConverter3000, or OCR to 2-letter standard codes
 */
export function normalizeLanguage(langStr) {
  if (!langStr || typeof langStr !== 'string') return 'EN';
  const clean = langStr.trim().toUpperCase();

  if (
    clean === 'JP' ||
    clean === 'JA' ||
    clean.includes('JAPAN') ||
    clean.includes('JAP') ||
    clean.includes('NIHON')
  ) {
    return 'JP';
  }

  if (
    clean === 'ZH' ||
    clean === 'CN' ||
    clean === 'CS' ||
    clean === 'CT' ||
    clean.includes('CHIN') ||
    clean.includes('ZHONG') ||
    clean.includes('MANDARIN')
  ) {
    return 'ZH';
  }

  if (clean === 'KO' || clean === 'KR' || clean.includes('KOR') || clean.includes('HANGUL')) {
    return 'KO';
  }

  if (clean === 'DE' || clean.includes('GER') || clean.includes('DEUT')) {
    return 'DE';
  }

  if (clean === 'FR' || clean.includes('FREN') || clean.includes('FRANZ')) {
    return 'FR';
  }

  if (clean === 'IT' || clean.includes('ITAL')) {
    return 'IT';
  }

  if (clean === 'ES' || clean.includes('SPAN')) {
    return 'ES';
  }

  if (clean === 'RU' || clean.includes('RUSS')) {
    return 'RU';
  }

  return 'EN';
}

/**
 * Normalizes condition strings from Whatnot, Cardmarket, or PaperStream to standardized codes
 */
export function normalizeCondition(condStr) {
  if (!condStr || typeof condStr !== 'string') return 'NM';
  const clean = condStr.trim().toUpperCase();

  if (clean.includes('GEM') || clean.includes('PRISTINE') || clean === 'MINT' || clean === 'MT' || clean === 'GM') {
    return 'MT';
  }
  if (clean.includes('NEAR') || clean === 'NM' || clean.includes('RAW - NEAR MINT')) {
    return 'NM';
  }
  if (clean.includes('EXCELLENT') || clean === 'EX' || clean.includes('RAW - EXCELLENT')) {
    return 'EX';
  }
  if (clean.includes('VERY GOOD') || clean === 'GD' || clean === 'VG' || clean.includes('RAW - VERY GOOD')) {
    return 'GD';
  }
  if (clean.includes('LIGHT') || clean === 'LP') {
    return 'LP';
  }
  if (clean.includes('MODERATE') || clean.includes('PLAYED') || clean === 'PL' || clean === 'MP') {
    return 'PL';
  }
  if (clean.includes('HEAVY') || clean === 'HP') {
    return 'PL';
  }
  if (clean.includes('DAMAGE') || clean.includes('POOR') || clean === 'PO' || clean === 'DM' || clean === 'DMG') {
    return 'PO';
  }
  if (clean === 'NEW' || clean === 'GRADED') {
    return 'MT';
  }

  return 'NM';
}

/**
 * Extracts language from text (including regional flag emojis e.g. 🇯🇵, 🇩🇪, 🇨🇳, 🇺🇸 and text labels)
 */
export function extractLanguageFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Regional indicator flag emojis (ScanConverter3000 Whatnot titles)
  if (text.includes('🇯🇵')) return 'JP';
  if (text.includes('🇩🇪') || text.includes('🇦🇹') || text.includes('🇨🇭')) return 'DE';
  if (text.includes('🇨🇳') || text.includes('🇹🇼') || text.includes('🇭🇰')) return 'ZH';
  if (text.includes('🇰🇷')) return 'KO';
  if (text.includes('🇫🇷')) return 'FR';
  if (text.includes('🇮🇹')) return 'IT';
  if (text.includes('🇪🇸')) return 'ES';
  if (text.includes('🇷🇺')) return 'RU';
  if (text.includes('🇺🇸') || text.includes('🇬🇧')) return 'EN';

  // 2. Textual language tags
  const t = text.toLowerCase();
  if (t.includes('japanese') || t.includes('japanisch') || t.includes('(ja)') || t.includes('(jp)')) return 'JP';
  if (t.includes('chinese') || t.includes('chinesisch') || t.includes('(zh)') || t.includes('(cn)')) return 'ZH';
  if (t.includes('korean') || t.includes('koreanisch') || t.includes('(ko)') || t.includes('(kr)')) return 'KO';
  if (t.includes('german') || t.includes('deutsch') || t.includes('(de)')) return 'DE';
  if (t.includes('french') || t.includes('französisch') || t.includes('franzoesisch') || t.includes('(fr)')) return 'FR';
  if (t.includes('italian') || t.includes('italienisch') || t.includes('(it)')) return 'IT';
  if (t.includes('spanish') || t.includes('spanisch') || t.includes('(es)')) return 'ES';
  if (t.includes('english') || t.includes('englisch') || t.includes('(en)')) return 'EN';

  return null;
}

function padCardNumber(numStr) {
  if (!numStr || !/^\d+$/.test(numStr)) return numStr;
  const n = parseInt(numStr, 10);
  if (isNaN(n)) return numStr;
  return n < 1000 ? String(n).padStart(3, '0') : String(n);
}

const NON_SET_TOKENS_RE =
  /^(CARD|SKU|ITEM|SCAN|PROD|PAGE|HTTP|HTML|JPEG|PNG|FILE|TEST|PROMO|KARTE|SAMMELKARTE|POKEMON|AR|CHR|CSR|SAR|SIR|SR|UR|SSR|HR|RRR|RR|MA|IR|TR|PR|SEC|SP|C|U|R)$/i;

/**
 * Intelligent pattern matcher for TCG Card Codes across all major TCGs
 * (One Piece, Pokémon, Yu-Gi-Oh, Lorcana, Dragon Ball, Union Arena, Weiss Schwarz, etc.)
 */
export function extractCardCode(text) {
  if (!text || typeof text !== 'string') return null;
  let cleanText = text.trim();

  // Exclude internal inventory SKUs like CARD-0008, SKU-123, ITEM-999 or bare Sammelkarte #167
  if (/^(CARD|SKU|ITEM|SCAN|PROD)[-_]\d+/i.test(cleanText)) return null;
  if (/^(?:Sammelkarte|Karte|Trading Card)\s*#\d+\s*$/i.test(cleanText)) return null;

  // Strip leading Whatnot auction hit index e.g. "#1⚡️" or "#12 " so "#1" is never mistaken for a code
  cleanText = cleanText.replace(/^#\s*\d+\s*(?:⚡️|⚡)\s*/i, '');
  if (/^#\d+\s+[A-Za-z]/.test(cleanText)) {
    cleanText = cleanText.replace(/^#\d+\s+/, '');
  }

  // 0a. Promo denominator slash format (highest priority so "PROMO #127/M-P" -> "M-P127", "#271/SV-P" -> "SV-P271", "#293/S-P" -> "S-P293")
  const promoSlashMatch = cleanText.match(/#?\b(\d{1,4})\/([A-Za-z0-9]{1,5}-P)\b/i);
  if (promoSlashMatch) {
    return `${promoSlashMatch[2].toUpperCase()}${padCardNumber(promoSlashMatch[1])}`;
  }

  // 0b. Dotted / Spaced Chinese & Anniversary sets: "#CSV9.5 C 195/208", "CSv9.5 C #072/208", "#30th C 033/103", "30C #046/128"
  const csvSetMatch = cleanText.match(/#?\b(CSV\d+(?:\.\d+)?\s*C?)\s*#?(\d{1,4})(?:\/(\d{1,4}))?\b/i);
  if (csvSetMatch) {
    const normSet = csvSetMatch[1].replace(/\s+/g, '').toUpperCase();
    return `${normSet}${padCardNumber(csvSetMatch[2])}`;
  }

  const annivSetMatch = cleanText.match(/#?\b(30(?:th)?\s*C)\s*#?(\d{1,4})(?:\/(\d{1,4}))?\b/i);
  if (annivSetMatch) {
    return `30C${padCardNumber(annivSetMatch[2])}`;
  }

  // 0c. Explicit Set + Gallery number: "CRZ #GG27/GG70", "#CRZ GG27/GG70", "LOR #TG05/TG30"
  const setGalleryMatch = cleanText.match(/#?\b([A-Za-z][A-Za-z0-9]{1,5})\s+#?((?:GG|TG)\d{1,3})(?:\/(?:GG|TG)?\d{1,3})?\b/i);
  if (setGalleryMatch && !NON_SET_TOKENS_RE.test(setGalleryMatch[1])) {
    return `${setGalleryMatch[1].toUpperCase()}${setGalleryMatch[2].toUpperCase()}`;
  }

  // 0d. Description Explicit: <SetCode> #<CardNum>/<Denom> (e.g. "M2a #208/193", "SV11B #150/086", "s0 #002/030", "CBB4C #1301/07")
  const descExplicit = cleanText.match(/\b([A-Za-z0-9.]{2,8})\s*#(\d{1,4})(?:\/(\d{1,4}))?\b/i);
  if (descExplicit && /[A-Za-z]/.test(descExplicit[1]) && !NON_SET_TOKENS_RE.test(descExplicit[1])) {
    const sCode = descExplicit[1].toUpperCase();
    const rawNum = descExplicit[2];
    const denom = descExplicit[3];
    // Preserve compound Gem Pack denominator (e.g. CBB4C 1301/07)
    if (rawNum.length === 4 && denom && denom.length === 2 && parseInt(denom, 10) <= 25) {
      return `${sCode}${rawNum}/${denom}`;
    }
    return `${sCode}${padCardNumber(rawNum)}`;
  }

  // 0e. Title Explicit: #<SetCode> [optional Rarity] <CardNum>/<Denom> (e.g. "#S1a 073/070", "#MBG AR 022/021", "#MC 754/742", "#s0 002/030")
  const titleExplicit = cleanText.match(/#([A-Za-z0-9.]{2,8})\s+(?:(?:MA|SAR|SIR|AR|IR|UR|SSR|SR|RRR|RR|HR|CSR|CHR|TR|PR|SEC|SP|C|U|R)\s+)?(\d{1,4})(?:\/(\d{1,4}))?\b/i);
  if (titleExplicit && /[A-Za-z]/.test(titleExplicit[1]) && !NON_SET_TOKENS_RE.test(titleExplicit[1])) {
    const sCode = titleExplicit[1].toUpperCase();
    const rawNum = titleExplicit[2];
    const denom = titleExplicit[3];
    if (rawNum.length === 4 && denom && denom.length === 2 && parseInt(denom, 10) <= 25) {
      return `${sCode}${rawNum}/${denom}`;
    }
    return `${sCode}${padCardNumber(rawNum)}`;
  }

  // 0f. Rarity-only #SetCode without number? No — only if number follows elsewhere e.g. "Haunter #MBG AR 022/021" (already caught above)

  // 1. One Piece TCG formats: OP05-119, OP01-001, ST01-001, EB01-001, PRB01-001, P-001, OP05 119
  const opMatch = cleanText.match(/\b(OP|ST|EB|PRB)[\s-]*\d{1,2}[\s-]+[A-Z0-9]{3,4}\b/i) ||
                  cleanText.match(/\b(OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2}|P)[-\s]*\d{3}\b/i) ||
                  cleanText.match(/#(OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2}|P)[-\s]*\d{3}\b/i);
  if (opMatch) {
    const raw = opMatch[0].replace(/^#/, '');
    return raw.toUpperCase().replace(/\s+/g, '-').replace(/--+/g, '-');
  }

  // 2. Pokémon Trainer Gallery / Galarian Gallery: LORTG05, CRZGG27, TG01/TG30, GG01/GG70
  const galleryMatch = cleanText.match(/\b[A-Z]{2,4}(?:TG|GG)\d{1,3}\b/i) ||
                        cleanText.match(/\b(TG|GG)\d{1,3}[\/-](TG|GG)?\d{1,3}\b/i);
  if (galleryMatch) {
    return galleryMatch[0].toUpperCase().replace(/\s+/g, '-');
  }

  // 3. Pokémon Japanese / Asian / New Gen alphanumeric set + number:
  // Includes Mega Evolution (m1-m6a, mc, mbg, mee, mem, mez, mf, asc, pbl, pfl, sp4, sek, s0, sv0d, m-p, sv-p, s-p, csv9.5c, 30c, sv10, sv11b, sv11w)
  const KNOWN_SET_PATTERN = 'CSV\\d+(?:\\.\\d+)?C?|CBB\\d{1,2}[A-Za-z]?|CS\\d{1,2}[a-zA-Z]*|CSM|CSD|30C|AC\\d{1,2}[a-zA-Z]?|sv1[0-2][a-zA-Z]?|sv\\d[a-zA-Z]?|s1[0-2][a-zA-Z]?|s\\d[a-zA-Z]?|sm1[0-2][a-zA-Z]?|sm\\d[a-zA-Z]?|xy1[0-2][a-zA-Z]?|xy\\d[a-zA-Z]?|bw1[01][a-zA-Z]?|bw\\d[a-zA-Z]?|hgss\\d?|dp\\d?|ex\\d{1,2}|m\\d[a-zA-Z]?|me\\d{1,2}(?:\\.\\d+)?[a-zA-Z]?|M-P|SV-P|S-P|SM-P|XY-P|BW-P|SVP|SWSH|SWSHP|SMP|SM|XYP|XY|BWP|BW|DPP|DP|MEP|MBG|MEE|MEM|MEZ|MC|MF|ASC|PBL|PFL|SP\\d+|SEK|SVAL|PAF|OBF|PAR|TEF|TWM|PAL|SVI|SIT|LOR|ASR|BRS|FST|EVS|CRE|BST|SHF|VIV|CPA|DAA|RCL|SSH|DRI|JTG|PRE|SFA|SCR|SSP|MEW|CRZ|CEC|HIF|UNM|UNB|DET|TEU|LOT|DRM|CES|FLI|UPR|CRI|SLG|BUS|GRI|SUM|EVO|STS|FCO|GEN|BKP|BKT|AOR|ROS|DCR|PRC|PHF|FFI|FLF|LTR|PLB|PLF|PLS|BCR|DRV|DRX|DEX|NXD|NVI|EPO|BLW|CL|TM|UD|UL|SV|PL|SF|LA|MD|GE|SW|MT|PK|DF|CG|HP|LM|DS|UF|EM|DX|TRR|FRLG|HL|DR|SS|RS|SK|AQ|LC|N4|N3|N2|N1|GC|GH|B2|FO|JU|BS';

  const jpSetNumRegex = new RegExp(`\\b(${KNOWN_SET_PATTERN})[-\\s]*(\\d{1,4})(?:\\/(\\d{1,4}))?\\b`, 'i');
  const jpSetNumMatch = cleanText.match(jpSetNumRegex);
  if (jpSetNumMatch) {
    const setCode = jpSetNumMatch[1].toUpperCase();
    const cardNum = jpSetNumMatch[2];
    const total = jpSetNumMatch[3];
    if (cardNum.length === 4 && total && total.length === 2 && parseInt(total, 10) <= 25) {
      return `${setCode}${cardNum}/${total}`;
    }
    return `${setCode}${padCardNumber(cardNum)}`;
  }

  // 3b. Separated Set Code and Number (e.g. "Phione 1301/07 aus cBB4C" or "Haunter #MBG AR" + "022/021")
  const sepSetRegex = new RegExp(`#?\\b(${KNOWN_SET_PATTERN})\\b`, 'i');
  const sepSetMatch = cleanText.match(sepSetRegex);
  const sepNumMatch = cleanText.match(/\b(\d{1,4})(?:\/(\d{2,4}))?\b/);
  if (sepSetMatch && sepNumMatch) {
    const setCode = sepSetMatch[1].toUpperCase();
    const rawNum = sepNumMatch[1];
    const denom = sepNumMatch[2];
    if (rawNum.length === 4 && denom && denom.length === 2 && parseInt(denom, 10) <= 25) {
      return `${setCode}${rawNum}/${denom}`;
    }
    return `${setCode}${padCardNumber(rawNum)}`;
  }

  // 3c. Generic New Gen pattern: [SetCode 2-6 chars] [CardNumber 1-4 digits] e.g. CBB4C 2805
  const genericSetNumMatch = cleanText.match(/\b([A-Za-z]{2,5}\d{0,2}[A-Za-z]?)[-\s]+(\d{1,4})(?:\/(\d{1,4}))?\b/);
  if (genericSetNumMatch) {
    const prefix = genericSetNumMatch[1];
    if (!NON_SET_TOKENS_RE.test(prefix)) {
      const rawNum = genericSetNumMatch[2];
      const total = genericSetNumMatch[3];
      if (rawNum.length === 4 && total && total.length === 2 && parseInt(total, 10) <= 25) {
        return `${prefix.toUpperCase()}${rawNum}/${total}`;
      }
      return `${prefix.toUpperCase()}${padCardNumber(rawNum)}`;
    }
  }

  // 4. Standard Pokémon fraction numbers: #130/170, 002/070, 0/170, 0904/070, 2306/07, 196/165, 94/123, 1301/07
  const fractionMatch = cleanText.match(/#?(\d{1,4}\/\d{2,4})\b/) ||
                        cleanText.match(/\b\d{1,4}\/\d{2,4}\b/);
  if (fractionMatch) {
    return fractionMatch[1] || fractionMatch[0].replace(/^#/, '');
  }

  // 5. Promo codes: SVP088, SVP-088, M-P120, SV-P271, S-P325, SWSH123, SM123
  const promoMatch = cleanText.match(/\b(M-P|SV-P|S-P|SM-P|SVP|SWSH|SM|XY|BW|DP|HGSS|PROMO)[-\s]*(\d{1,4})\b/i);
  if (promoMatch) {
    return `${promoMatch[1].toUpperCase()}${padCardNumber(promoMatch[2])}`;
  }

  // 6. Yu-Gi-Oh format: LOB-001, SDK-E001, RA01-EN001, RA01-DE001, MP23-EN001
  const yugiohMatch = cleanText.match(/\b[A-Z0-9]{3,4}-(?:[A-Z]{2})?[A-Z0-9]{3,5}\b/i);
  if (yugiohMatch) {
    return yugiohMatch[0].toUpperCase();
  }

  // 7. Lorcana format: 123/204, EN-1-123
  const lorcanaMatch = cleanText.match(/\bEN-\d{1,2}-\d{1,3}\b/i) || cleanText.match(/\b\d{1,3}\/204\b/);
  if (lorcanaMatch) {
    return lorcanaMatch[0].toUpperCase();
  }

  // 8. Dragon Ball Super / Fusion World: FB01-001, FS01-001, BT1-001
  const dbMatch = cleanText.match(/\b(FB\d{2}|FS\d{2}|BT\d{1,2}|DBS)[-\s]*\d{3}\b/i);
  if (dbMatch) {
    return dbMatch[0].toUpperCase().replace(/\s+/g, '-');
  }

  // 9. Union Arena: UA01ST/KMY-1-001, EX01BT/JJK-1-001
  const uaMatch = cleanText.match(/\b(UA\d{2}|EX\d{2})[A-Z0-9\/-]+-\d{3}\b/i);
  if (uaMatch) {
    return uaMatch[0].toUpperCase();
  }

  // 10. Weiss Schwarz: BD/W54-001, RZ/S46-001
  const wsMatch = cleanText.match(/\b[A-Z]{2,4}\/[A-Z0-9]{2,4}-\d{3}\b/i);
  if (wsMatch) {
    return wsMatch[0].toUpperCase();
  }

  return null;
}

/**
 * Extracts clean card name from Whatnot title or description
 */
export function extractCardName(title, description, rawCode) {
  if (!title && !description) return '';

  let clean = (title || '').trim();

  // Format 1: "Pokémon - Phione #0/170 C (Japanese)" or "One Piece - Monkey D. Luffy #OP05-119 SEC"
  if (/^(?:Pokémon|Pokemon|One Piece|Yu-Gi-Oh!?|Lorcana|Magic|Dragon Ball|Digimon|TCG)\s+-\s+/i.test(clean)) {
    clean = clean.replace(/^(?:Pokémon|Pokemon|One Piece|Yu-Gi-Oh!?|Lorcana|Magic|Dragon Ball|Digimon|TCG)\s+-\s+/i, '');
  }

  // Format 2: Leading index with optional lightning bolt (with or without space, e.g. "#1⚡️Inteleon V" or "#12 Pincurchin")
  clean = clean.replace(/^#\s*\d+\s*(?:⚡️|⚡)?\s*/i, '');

  // Format 3: "Karte #8 (0016.png)"
  if (clean.startsWith('Karte #') || clean.startsWith('Sammelkarte #')) {
    return clean.split('(')[0].trim();
  }

  // Strip lightning bolt emojis and regional flag emojis (🇯🇵, 🇩🇪, 🇺🇸, 🇨🇳, etc.)
  clean = clean.replace(/[⚡️⚡]/g, '').replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '').trim();

  // Remove trailing language tags like "(Japanese)", "(German)", "(English)", "(Chinese)"
  clean = clean.replace(/\s*\((?:Japanese|Japanisch|German|Deutsch|English|Englisch|Chinese|Chinesisch|Korean|Koreanisch|French|Italian|Spanish|JA|JP|DE|EN|ZH|CN|KO|KR|FR|IT|ES)\)\s*\d*$/i, '').trim();

  // Remove promo fractions ("#119/M-P", "271/SV-P"), gallery fractions ("GG27/GG70"), spaced set codes ("#30th C", "#CSV9.5 C")
  clean = clean.replace(/#?\b\d{1,4}\/[A-Za-z0-9]{1,5}-P\b/gi, ' ');
  clean = clean.replace(/#?\b(?:GG|TG)\d{1,3}\/(?:GG|TG)?\d{1,3}\b/gi, ' ');
  clean = clean.replace(/#?\b(?:30th\s*C|30C|CSV\d+(?:\.\d+)?\s*C?)\b/gi, ' ');

  // Remove card number / code tags like "#S1a", "#130/170", "#OP05-119", "#PROMO", "#me02.5-220", standalone "#"
  clean = clean.replace(/#[A-Za-z0-9\/\.\-_]+/g, ' ');
  clean = clean.replace(/(?:^|\s)#(?=\s|$)/g, ' ');

  // Remove bare fractions like "1301/07", "183/165", "002/070"
  clean = clean.replace(/\b\d{1,4}\/\d{2,4}\b/g, ' ').trim();

  // Remove "aus <Set>" or "from <Set>" phrases (do NOT match "in" or "de" which appear in "Friends in Paldea" / "Don Quichotte de Flamingo")
  clean = clean.replace(/\s+(?:aus|from)\s+([A-Za-z0-9.\-_]+(?:\s+[A-Za-z0-9.\-_]+){0,3})$/i, '').trim();

  // Remove standalone set codes
  clean = clean.replace(/\b(CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]*|CSM|CSD|AC\d{1,2}[a-zA-Z]?|sv\d{1,2}[a-zA-Z]?|s\d{1,2}[a-zA-Z]?|sm\d{1,2}[a-zA-Z]?|xy\d{1,2}[a-zA-Z]?|bw\d{1,2}[a-zA-Z]?|hgss\d?|dp\d?|ex\d{1,2}|m\d[a-zA-Z]?|me\d+(?:\.\d+)?[a-zA-Z]?|OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2}|MBG|MEE|MEM|MEZ|MC|MF|ASC|PBL|PFL|SP\d+|SEK|SVAL|PAF|OBF|PAR|TEF|TWM|PAL|SVI|SIT|LOR|ASR|BRS|FST|EVS|CRE|BST|SHF|VIV|CPA|DAA|RCL|SSH|DRI|JTG|PRE|SFA|SCR|SSP|M-P|SV-P|S-P|SM-P|SVP|SWSH|SWSHP|SMP|XYP|BWP|DPP|MEW|CRZ|CEC|HIF|UNM|UNB|DET|TEU|LOT|DRM|CES|FLI|UPR|CRI|SLG|BUS|GRI|SUM|EVO|STS|FCO|GEN|BKP|BKT|AOR|ROS|DCR|PRC|PHF|FFI|FLF|LTR|PLB|PLF|PLS|BCR|DRV|DRX|DEX|NXD|NVI|EPO|BLW|TRR|FRLG)\b/gi, ' ').trim();

  // Remove code if prepended or appended e.g. "MEW173 Mew ex" -> "Mew ex"
  if (rawCode) {
    const escapedRaw = rawCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const codeClean = rawCode.replace(/[\/-]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedRaw}\\s+|^${codeClean}\\s+|\\s+${escapedRaw}$|\\s+${codeClean}$`, 'i');
    clean = clean.replace(regex, ' ').trim();
  }

  // Collapse multiple spaces before stripping trailing rarities
  clean = clean.replace(/\s+/g, ' ').trim();

  // Remove trailing rarity tags in loop (e.g. "Ultra Rare", "SIR", "RRR", "AR", "MA", "PROMO", "C", "U", "R")
  const trailingMultiRarityRe = /\s+(?:Special Illustration Rare|Illustration Rare|Ultra Rare|Double Rare|Hyper Rare|ACE SPEC|PROMO|Promo|MA|SAR|SIR|AR|IR|UR|SSR|SR|RRR|RR|HR|CSR|CHR|TR|PR|SEC|SP|[☆★⭐]+)\s*$/i;
  while (trailingMultiRarityRe.test(clean)) {
    clean = clean.replace(trailingMultiRarityRe, '').trim();
  }
  // Strip single-letter C / U / R rarity at end unless part of "Unown C" / "Unown R" / "Unown U"
  if (!/\b(?:Unown|Icognito)\s+[CUR]$/i.test(clean)) {
    clean = clean.replace(/\s+(?:C|U|R)\s*$/i, '').trim();
  }
  clean = clean.replace(/[☆★⭐]+/g, '').trim();

  // Remove trailing or leading dashes/hashes/spaces (preserve trailing '!' for e.g. "Ditto!", "Meowth Meow!")
  clean = clean.replace(/^[-#\s]+|[-#\s]+$/g, '').replace(/\s+/g, ' ').trim();

  // If title was too bare, look into description: "Pokémon Phione (フィオネ) #130/170 [C] - Japanisch."
  if (!clean || clean.length < 2) {
    if (description) {
      const descMatch = description.match(/^(?:Pokémon|Pokemon|One Piece|Yu-Gi-Oh!|Lorcana|Dragon Ball)?\s*([A-Za-z0-9\s'’.\-!&]+?)(?:\s*\([^)]+\))?\s*(?:#|OP|\d+\/|\[|-)/i);
      if (descMatch && descMatch[1] && descMatch[1].trim().length > 1) {
        return descMatch[1].trim();
      }
    }
  }
  return clean || title || 'Karte';
}

/**
 * Parses card code components
 * Handles complex variant codes across Pokémon, One Piece, Lorcana, etc.
 * Supports:
 * - Compound Asian variant codes (ONLY genuine Gem Pack 4-digit codes e.g. CBB4C 1301/07 -> Card #13, Variant V1, Set CBB4C)
 * - Suffix variants (e.g. OP05-119-V1, EB02-061-V3, ST01-012-V1, 055/066-V1, Card (V1))
 * - Prefix variants (e.g. V1-CBB4C13, V7-CBB5C01)
 * - Promo, Dotted Chinese, Gallery, and Japanese/English Set codes (e.g. M-P120, SV-P271, CSV9.5C195, 30C033, MBG022, SV10082, S8035, S0002)
 */
export function parseCardCodeComponents(codeStr, nameStr = '', setStr = '') {
  if (!codeStr && !nameStr && !setStr) return null;
  const combined = `${codeStr || ''} ${nameStr || ''} ${setStr || ''}`.trim();

  // 1. Detect genuine compound Asian/Chinese Gem Pack variant ONLY when denominator <= 25 (e.g. "CBB4C 1301/07", "1301/07") or explicit CBB set + 4 digits
  const cbbSetMatch = combined.match(/\b(CBB\d{1,2}[A-Za-z]?)\b/i);
  const compSlashMatch = combined.match(/\b(\d{2})(\d{2})\/(0[1-9]|1\d|2[0-5])\b/);
  const cbbFourDigitMatch = cbbSetMatch ? combined.match(/\b(?:CBB\d{1,2}[A-Za-z]?)[-\s]*(\d{2})(\d{2})\b/i) : null;

  if (compSlashMatch || cbbFourDigitMatch) {
    const anySetMatch = combined.match(/\b(CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]*|CSM|CSD|AC\d{1,2}[a-zA-Z]?)\b/i);
    const setCode = (cbbSetMatch?.[1] || anySetMatch?.[1] || '').toUpperCase();
    const d1 = compSlashMatch ? compSlashMatch[1] : cbbFourDigitMatch[1];
    const d2 = compSlashMatch ? compSlashMatch[2] : cbbFourDigitMatch[2];
    const totalVariants = compSlashMatch ? compSlashMatch[3] : '07';
    const cardNum = parseInt(d1, 10).toString();
    const cardNumPad = d1;
    const variantNum = parseInt(d2, 10).toString();
    const variantTag = `V${variantNum}`;
    const setCardCode = setCode ? `${setCode}${cardNumPad}` : cardNumPad;
    const fullVariantSlug = setCode ? `${variantTag}-${setCode}${cardNumPad}` : `${variantTag}-${cardNumPad}`;

    return {
      isCompound: true,
      setCode,
      cardNum,
      cardNumPad,
      variantTag,
      variantNum,
      totalVariants,
      setCardCode,
      fullVariantSlug,
      searchCode: setCode ? `${setCode} ${cardNum}` : cardNum
    };
  }

  // 2. Look for explicit V-variant prefix slug e.g. "V1-CBB4C13" or "V7-CBB5C01"
  const prefixSlugMatch = combined.match(/\b(V\d+)[-_]([A-Za-z0-9]+)\b/i);
  if (prefixSlugMatch) {
    return {
      isCompound: true,
      setCode: '',
      cardNum: '',
      cardNumPad: '',
      variantTag: prefixSlugMatch[1].toUpperCase(),
      variantNum: prefixSlugMatch[1].replace(/\D/g, ''),
      totalVariants: '',
      setCardCode: prefixSlugMatch[2].toUpperCase(),
      fullVariantSlug: `${prefixSlugMatch[1].toUpperCase()}-${prefixSlugMatch[2].toUpperCase()}`,
      searchCode: prefixSlugMatch[2].toUpperCase()
    };
  }

  // 3. Look for suffix variant (e.g. OP05-119-V1, EB02-061-V3, ST01-012-V1, 055/066-V1, (V1), (V2))
  const suffixSlugMatch = combined.match(/\b([A-Za-z0-9\-_]{2,12})[-_\s]+(V\d+)\b/i) || combined.match(/\b([A-Za-z0-9\-_]{2,12})\s*\((V\d+)\)/i);
  if (suffixSlugMatch) {
    const baseCode = suffixSlugMatch[1].toUpperCase();
    const variantTag = suffixSlugMatch[2].toUpperCase();
    const variantNum = variantTag.replace(/\D/g, '');
    return {
      isCompound: true,
      setCode: baseCode.split(/[-\s]/)[0] || '',
      cardNum: baseCode.split(/[-\s]/)[1] || '',
      cardNumPad: baseCode.split(/[-\s]/)[1] || '',
      variantTag,
      variantNum,
      totalVariants: '',
      setCardCode: baseCode,
      fullVariantSlug: `${baseCode}-${variantTag}`,
      searchCode: baseCode
    };
  }

  const cleanCode = (codeStr || '').trim();
  if (!cleanCode) return null;

  // Helper to build standard component result
  const makeStandard = (sCode, rawNum, total = null) => {
    const normSet = sCode.replace(/\s+/g, '').toUpperCase() === '30THC' ? '30C' : sCode.replace(/\s+/g, '').toUpperCase();
    const isNumeric = /^\d+$/.test(rawNum);
    const cardNum = isNumeric ? parseInt(rawNum, 10).toString() : rawNum.toUpperCase();
    const cardNumPad = isNumeric ? padCardNumber(rawNum) : rawNum.toUpperCase();
    return {
      isCompound: false,
      setCode: normSet,
      cardNum,
      cardNumPad,
      variantTag: null,
      variantNum: null,
      totalVariants: total || null,
      setCardCode: `${normSet}${cardNumPad}`,
      fullVariantSlug: null,
      searchCode: `${normSet}${cardNumPad}`
    };
  };

  // 4a. Promo codes: "120/M-P", "M-P120", "SV-P271", "S-P293", "SVP088"
  const promoDenom = cleanCode.match(/^#?(\d{1,4})\/([A-Za-z0-9]{1,5}-P)$/i);
  if (promoDenom) {
    return makeStandard(promoDenom[2], promoDenom[1]);
  }
  const promoPrefix = cleanCode.match(/^(M-P|SV-P|S-P|SM-P|XY-P|BW-P|DP-P|SVP|SWSHP|SMP)[-\s]*(\d{1,4})(?:\/[A-Za-z0-9-]+)?$/i);
  if (promoPrefix) {
    return makeStandard(promoPrefix[1], promoPrefix[2]);
  }

  // 4b. Dotted / Chinese / Special sets: CSV9.5C195, 30C033, MBG022, MC754, MEE020, MEM018, MEZ015, MF042, ASC275, PBL010, PFL109, SP4004, SEK002, SV0D015
  const specialPrefix = cleanCode.match(/^(CSV\d+(?:\.\d+)?\s*C?|30(?:th)?\s*C|CS\d+[A-Za-z]*|CBB\d+[A-Za-z]?|MBG|MEE|MEM|MEZ|MC|MF|ASC|PBL|PFL|SEK|SVAL|SV0D)[-\s]*(\d{1,4})(?:\/(\d{1,4}))?$/i);
  if (specialPrefix) {
    return makeStandard(specialPrefix[1], specialPrefix[2], specialPrefix[3]);
  }
  // SP4 + 3-digit padded e.g. SP4004 or SP4-004
  const spDeckMatch = cleanCode.match(/^(SP\d)(?:[-\s]+(\d{1,4})|(\d{3}))(?:\/(\d{1,4}))?$/i);
  if (spDeckMatch) {
    return makeStandard(spDeckMatch[1], spDeckMatch[2] || spDeckMatch[3], spDeckMatch[4]);
  }

  // 4c. Gallery codes: CRZGG27, LORTG05, CRZ-GG27
  const galleryComp = cleanCode.match(/^([A-Za-z0-9]{2,5}?)[-\s]*((?:GG|TG)\d{1,3})(?:\/(?:GG|TG)?\d{1,3})?$/i);
  if (galleryComp && /[A-Za-z]/.test(galleryComp[1])) {
    return makeStandard(galleryComp[1], galleryComp[2]);
  }

  // 4d. Letter-suffixed Japanese/Asian set codes (unambiguous boundary between trailing letter of setCode and digits of cardNum):
  // e.g. SV11B150, SV11W172, S12A127, S5A008, M2A208, SM11B036, M1S072, SV4K078
  const letterSuffixSet = cleanCode.match(/^(SV1[0-2][A-Za-z]|SV\d[A-Za-z]|S1[0-2][A-Za-z]|S\d[A-Za-z]|SM1[0-2][A-Za-z]|SM\d[A-Za-z]|XY1[0-2][A-Za-z]|XY\d[A-Za-z]|BW1[01][A-Za-z]|BW\d[A-Za-z]|M\d[A-Za-z]|ME\d+(?:\.\d+)?[A-Za-z])[-\s]*(\d{1,4})(?:[\/-](\d{1,4}))?$/i);
  if (letterSuffixSet) {
    return makeStandard(letterSuffixSet[1], letterSuffixSet[2], letterSuffixSet[3]);
  }

  // 4e. Digit-ending Japanese/Asian set codes with explicit separator (e.g. "SV10-082", "S8 035", "s0-002")
  const sepDigitSet = cleanCode.match(/^(SV1[0-2]|SV\d|S1[0-2]|S\d|SM1[0-2]|SM\d|XY1[0-2]|XY\d|BW1[01]|BW\d|M\d|OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2})[-\s]+(\d{1,4})(?:[\/-](\d{1,4}))?$/i);
  if (sepDigitSet) {
    return makeStandard(sepDigitSet[1], sepDigitSet[2], sepDigitSet[3]);
  }

  // 4f. Digit-ending Japanese/Asian set codes concatenated with 3-digit padded collector number:
  // e.g. SV10082 -> SV10 + 082, SV3129 -> SV3 + 129, S8035 -> S8 + 035, S0002 -> S0 + 002, SM12065 -> SM12 + 065, M6082 -> M6 + 082
  const concatPaddedDigitSet = cleanCode.match(/^(SV1[0-2]|SV\d|S1[0-2]|S\d|SM1[0-2]|SM\d|XY1[0-2]|XY\d|BW1[01]|BW\d|M\d)(\d{3})(?:\/(\d{1,4}))?$/i);
  if (concatPaddedDigitSet) {
    return makeStandard(concatPaddedDigitSet[1], concatPaddedDigitSet[2], concatPaddedDigitSet[3]);
  }

  // 4g. Unpadded concatenated fallback (e.g. manually typed "M582" -> M5 + 082, "S835" -> S8 + 035, "SV695" -> SV6 + 095)
  const concatShortDigitSet = cleanCode.match(/^(SV1[0-2]|SV\d|S1[0-2]|S\d|SM1[0-2]|SM\d|XY\d|BW\d|M\d)(\d{1,2})(?:\/(\d{1,4}))?$/i);
  if (concatShortDigitSet) {
    return makeStandard(concatShortDigitSet[1], concatShortDigitSet[2], concatShortDigitSet[3]);
  }

  // 4h. Pure alpha 2-4 letter Western/Classic set codes (e.g. PRE170, RCL015, DRI185, PAF091, MEW173, CRZ001)
  const alphaSetMatch = cleanCode.match(/^([A-Za-z]{2,5})[-\s]*(\d{1,4})(?:[\/-](\d{1,4}))?$/);
  if (alphaSetMatch && !NON_SET_TOKENS_RE.test(alphaSetMatch[1])) {
    return makeStandard(alphaSetMatch[1], alphaSetMatch[2], alphaSetMatch[3]);
  }

  const stdMatch = cleanCode.match(/^([A-Za-z0-9.\-_]{2,10})[-\s]+(\d{1,4})(?:[\/-](\d{1,4}))?$/);
  if (stdMatch) {
    return makeStandard(stdMatch[1], stdMatch[2], stdMatch[3]);
  }

  return null;
}

/**
 * Detects TCG game type from Subcategory, Title, Description, or Card Code
 */
export function detectTCG(subcategory, title, description, code) {
  const combined = `${subcategory || ''} ${title || ''} ${description || ''}`.toLowerCase();
  const c = (code || '').toUpperCase();

  if (
    combined.includes('one-piece') ||
    combined.includes('one piece') ||
    c.startsWith('OP') ||
    c.startsWith('ST') ||
    c.startsWith('EB') ||
    c.startsWith('PRB')
  ) {
    return 'OnePiece';
  }
  if (combined.includes('pokémon') || combined.includes('pokemon') || combined.includes('pikachu') || combined.includes('charizard')) {
    return 'Pokemon';
  }
  if (combined.includes('yu-gi-oh') || combined.includes('yugioh')) {
    return 'YuGiOh';
  }
  if (combined.includes('lorcana') || combined.includes('disney')) {
    return 'Lorcana';
  }
  if (combined.includes('dragon ball') || combined.includes('dragon-ball') || c.startsWith('FB0') || c.startsWith('FS0')) {
    return 'DragonBall';
  }
  if (combined.includes('magic') || combined.includes('mtg')) {
    return 'MTG';
  }
  if (combined.includes('union arena') || c.startsWith('UA') || c.startsWith('EX0')) {
    return 'UnionArena';
  }
  if (combined.includes('weiß schwarz') || combined.includes('weiss schwarz') || c.includes('/W') || c.includes('/S')) {
    return 'WeissSchwarz';
  }
  if (combined.includes('digimon')) {
    return 'Digimon';
  }

  return 'Pokemon';
}

/**
 * Normalizes CSV records into standardized TCG Scan Items
 * Fully supports Whatnot 21-columns and PaperStream scan structures.
 */
export function normalizeScanData(parsedCSV) {
  const { data } = parsedCSV;
  if (!data || !Array.isArray(data)) return [];

  return data.map((row, index) => {
    // 1. Whatnot Direct Columns
    const wKategorie = row['kategorie'] || row['category'] || 'Trading Card Games';
    const wUnterkategorie = row['unterkategorie'] || row['subcategory'] || 'Pokémon-Karten';
    const wTitel = row['titel'] || row['title'] || row['name'] || row['card name'] || row['card_name'] || '';
    const wBeschreibung = row['beschreibung'] || row['description'] || '';
    const wMenge = parseInt(row['menge'] || row['quantity'] || '1', 10) || 1;
    const wVerkaufsformat = row['verkaufsformat'] || row['listing_type'] || row['type'] || row['format'] || 'Auktion';
    const wPreis = row['preis'] || row['price'] || row['value'] || row['cardmarket_price'] || '1';
    const wVersandprofil = row['versandprofil'] || row['shipping_profile'] || 'Single (15 g)';
    const wAngebote = row['angebote_annehmen'] || row['angebote annehmen'] || row['accept_offers'] || 'FALSE';
    const wGefahrgut = row['gefahrgut'] || row['hazmat'] || 'Not Hazmat';
    const wZustand = row['zustand'] || row['condition'] || row['grade'] || 'Near Mint';
    const wStueckpreis = row['stueckpreis'] || row['stückpreis'] || row['cost_per_item'] || row['unit_price'] || '';
    const wArtikelnummer = row['artikelnummer'] || row['sku'] || row['id'] || '';

    // Image URLs (1 to 8)
    const wBildUrl1 = row['bild_url_1'] || row['bild-url 1'] || row['image_url_1'] || row['image_1'] || row['image'] || row['img'] || '';
    const wBildUrl2 = row['bild_url_2'] || row['bild-url 2'] || row['image_url_2'] || row['image_2'] || '';
    const wBildUrl3 = row['bild_url_3'] || row['bild-url 3'] || row['image_url_3'] || '';
    const wBildUrl4 = row['bild_url_4'] || row['bild-url 4'] || row['image_url_4'] || '';
    const wBildUrl5 = row['bild_url_5'] || row['bild-url 5'] || row['image_url_5'] || '';
    const wBildUrl6 = row['bild_url_6'] || row['bild-url 6'] || row['image_url_6'] || '';
    const wBildUrl7 = row['bild_url_7'] || row['bild-url 7'] || row['image_url_7'] || '';
    const wBildUrl8 = row['bild_url_8'] || row['bild-url 8'] || row['image_url_8'] || '';

    // Legacy Columns (PaperStream, OCR)
    const rawLegacyCode = row['card_number'] || row['card number'] || row['code'] || row['cardcode'] || row['number'] || row['zone_ocr'] || row['zone ocr'] || row['ocr'] || '';
    const rawLegacyFile = row['filename'] || row['file_name'] || row['file'] || row['filepath'] || '';
    const rawLegacyLang = row['language'] || row['lang'] || row['sprache'] || '';

    // 2. Intelligent Code Extraction
    // Priority: Description -> Title -> Legacy Code -> Image File -> Article/SKU
    const extractedCode = extractCardCode(wBeschreibung) ||
                          extractCardCode(wTitel) ||
                          extractCardCode(rawLegacyCode) ||
                          extractCardCode(wBildUrl1) ||
                          extractCardCode(rawLegacyFile) ||
                          extractCardCode(wArtikelnummer) ||
                          null;

    const detectedCode = extractedCode || (rawLegacyCode ? rawLegacyCode.trim() : null);

    // 3. Card Name Extraction
    const detectedName = extractCardName(wTitel, wBeschreibung, detectedCode) || row['name'] || row['card name'] || 'Karte';

    // 4. Language & Condition Normalization
    const langFromText = extractLanguageFromText(wTitel) || extractLanguageFromText(wBeschreibung);
    const rawLanguage = normalizeLanguage(langFromText || rawLegacyLang || 'EN');
    const rawCondition = normalizeCondition(wZustand);
    const rawLocation = 'DE'; // Default seller country to Germany

    // 5. Image & File Extraction
    const primaryImageUrl = wBildUrl1 || null;
    const secondaryImageUrl = wBildUrl2 || null;
    const rawFile = rawLegacyFile || (primaryImageUrl ? primaryImageUrl.split('/').pop() : '');

    // 6. TCG Category Detection
    const detectedTcg = detectTCG(wUnterkategorie, wTitel, wBeschreibung, detectedCode);

    // 7. Structured Whatnot Object (for storage & re-export)
    const whatnotObject = {
      kategorie: wKategorie,
      unterkategorie: wUnterkategorie,
      titel: wTitel || `${detectedName} #${detectedCode || ''}`.trim(),
      beschreibung: wBeschreibung,
      menge: wMenge,
      verkaufsformat: wVerkaufsformat,
      preis: wPreis,
      versandprofil: wVersandprofil,
      angeboteAnnehmen: wAngebote === 'Ja' || wAngebote === 'TRUE' || wAngebote === 'true' || wAngebote === 'WAHR' ? 'TRUE' : 'FALSE',
      gefahrgut: wGefahrgut,
      zustand: wZustand,
      stueckpreis: wStueckpreis,
      artikelnummer: wArtikelnummer || `CARD-${String(index + 1).padStart(4, '0')}`,
      bildUrl1: wBildUrl1,
      bildUrl2: wBildUrl2,
      bildUrl3: wBildUrl3,
      bildUrl4: wBildUrl4,
      bildUrl5: wBildUrl5,
      bildUrl6: wBildUrl6,
      bildUrl7: wBildUrl7,
      bildUrl8: wBildUrl8,
    };

    const parsedComp = parseCardCodeComponents(detectedCode, wTitel, row['set'] || row['expansion'] || '');
    const variantTag = parsedComp?.variantTag || null;
    const setCardCode = parsedComp?.setCardCode || null;
    const fullVariantSlug = parsedComp?.fullVariantSlug || null;

    const germanDetails = getGermanCardDetails({
      detectedName,
      rawName: wTitel || detectedName,
      rawSet: row['set'] || row['expansion'] || '',
      detectedCode,
      rawCode: rawLegacyCode || detectedCode || '',
      tcg: detectedTcg,
      whatnot: whatnotObject,
    });

    return {
      id: `scan_${Date.now()}_${index}`,
      index: index + 1,
      originalIndex: index + 1,
      setId: null,
      rawCode: rawLegacyCode || detectedCode || '',
      rawName: wTitel || detectedName,
      rawSet: row['set'] || row['expansion'] || '',
      nameDe: germanDetails.nameDe,
      setNameDe: germanDetails.setNameDe,
      nameEn: detectedName,
      variant: variantTag,
      setCardCode,
      fullVariantSlug,
      rawFile,
      rawCondition,
      rawLanguage,
      rawLocation,
      rawPrice: parseFloat(String(wPreis).replace(',', '.')) || null,
      quantity: wMenge,
      tcg: detectedTcg,
      detectedCode,
      detectedName,
      status: detectedCode ? 'matched' : 'needs_review',
      imageUrl: primaryImageUrl,
      imageBackUrl: secondaryImageUrl,
      imageUrls: [wBildUrl1, wBildUrl2, wBildUrl3, wBildUrl4, wBildUrl5, wBildUrl6, wBildUrl7, wBildUrl8].filter(Boolean),
      whatnot: whatnotObject,
      cardDetails: null,
      marketPrices: null,
    };
  });
}
