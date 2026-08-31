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
 * Extracts language from text (e.g. "(Japanese)", "Japanisch", "(German)")
 */
export function extractLanguageFromText(text) {
  if (!text || typeof text !== 'string') return null;
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

/**
 * Intelligent pattern matcher for TCG Card Codes across all major TCGs
 * (One Piece, Pokémon, Yu-Gi-Oh, Lorcana, Dragon Ball, Union Arena, Weiss Schwarz, etc.)
 */
export function extractCardCode(text) {
  if (!text || typeof text !== 'string') return null;
  const cleanText = text.trim();

  // Exclude internal inventory SKUs like CARD-0008, SKU-123, ITEM-999
  if (/^(CARD|SKU|ITEM|SCAN|PROD)[-_]\d+/i.test(cleanText)) return null;

  // 1. One Piece TCG formats: OP05-119, OP01-001, ST01-001, EB01-001, PRB01-001, P-001, OP05 119
  const opMatch = cleanText.match(/\b(OP|ST|EB|PRB)[\s-]*\d{1,2}[\s-]+[A-Z0-9]{3,4}\b/i) ||
                  cleanText.match(/\b(OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2}|P)[-\s]*\d{3}\b/i) ||
                  cleanText.match(/#(OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2}|P)[-\s]*\d{3}\b/i);
  if (opMatch) {
    const raw = opMatch[0].replace(/^#/, '');
    return raw.toUpperCase().replace(/\s+/g, '-').replace(/--+/g, '-');
  }

  // 2. Pokémon Trainer Gallery / Galarian Gallery: LORTG05, TG01/TG30, GG01/GG70
  const galleryMatch = cleanText.match(/\b[A-Z]{3}TG\d{1,2}\b/i) ||
                        cleanText.match(/\b(TG|GG)\d{1,2}[\/-](TG|GG)?\d{1,2}\b/i);
  if (galleryMatch) {
    return galleryMatch[0].toUpperCase().replace(/\s+/g, '-');
  }

  // 3. Pokémon Japanese / Asian / New Gen alphanumeric set + number:
  // e.g. CBB4C 2805/07, CBB4C 1301/07, CBB4C 2805, sv2a 173, s12a 210/172, sv4a 009, CS1a 010/050, PAF 091/091, OBF 125/197, SVP 088, DAA 089/189, m2 088
  const jpSetNumMatch = cleanText.match(/\b(CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]?|CSM|CSD|AC\d{1,2}[a-zA-Z]?|sv\d{1,2}[a-zA-Z]?|s\d{1,2}[a-zA-Z]?|sm\d{1,2}[a-zA-Z]?|xy\d{1,2}[a-zA-Z]?|bw\d{1,2}[a-zA-Z]?|hgss\d?|dp\d?|ex\d{1,2}|m\d+|me\d+(?:\.\d+)?|S-P|SVP|SWSH|SWSHP|SMP|SM|XYP|XY|BWP|BW|DPP|DP|MEP|PFL|PAF|OBF|PAR|TEF|TWM|PAL|SVI|SIT|LOR|ASR|BRS|FST|EVS|CRE|BST|SHF|VIV|CPA|DAA|RCL|SSH|DRI|JTG|PRE|SFA|SCR|SSP|CEC|HIF|UNM|UNB|DET|TEU|LOT|DRM|CES|FLI|UPR|CRI|SLG|BUS|GRI|SUM|EVO|STS|FCO|GEN|BKP|BKT|AOR|ROS|DCR|PRC|PHF|FFI|FLF|LTR|PLB|PLF|PLS|BCR|DRV|DRX|DEX|NXD|NVI|EPO|BLW|CL|TM|UD|UL|AR|SV|RR|PL|SF|LA|MD|GE|SW|MT|PK|DF|CG|HP|LM|DS|UF|EM|DX|TRR|FRLG|HL|MA|DR|SS|RS|SK|AQ|LC|N4|N3|N2|N1|GC|GH|TR|B2|FO|JU|BS)[-\s]*(\d{1,4})(?:\/(\d{1,4}))?\b/i);
  if (jpSetNumMatch) {
    const setCode = jpSetNumMatch[1].toUpperCase();
    const cardNum = jpSetNumMatch[2];
    const total = jpSetNumMatch[3];
    return total ? `${setCode} ${cardNum}/${total}` : `${setCode} ${cardNum}`;
  }

  // 3b. Separated Set Code and Number (e.g. "Phione 1301/07 aus cBB4C" or "cBB4C Phione 1301/07")
  const sepSetMatch = cleanText.match(/\b(CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]?|CSM|CSD|AC\d{1,2}[a-zA-Z]?|sv\d{1,2}[a-zA-Z]?|s\d{1,2}[a-zA-Z]?|sm\d{1,2}[a-zA-Z]?|xy\d{1,2}[a-zA-Z]?|bw\d{1,2}[a-zA-Z]?|hgss\d?|dp\d?|ex\d{1,2}|m\d+|me\d+(?:\.\d+)?|S-P|SVP|SWSH|SWSHP|SMP|SM|XYP|XY|BWP|BW|DPP|DP|MEP|PFL|PAF|OBF|PAR|TEF|TWM|PAL|SVI|SIT|LOR|ASR|BRS|FST|EVS|CRE|BST|SHF|VIV|CPA|DAA|RCL|SSH|DRI|JTG|PRE|SFA|SCR|SSP|CEC|HIF|UNM|UNB|DET|TEU|LOT|DRM|CES|FLI|UPR|CRI|SLG|BUS|GRI|SUM|EVO|STS|FCO|GEN|BKP|BKT|AOR|ROS|DCR|PRC|PHF|FFI|FLF|LTR|PLB|PLF|PLS|BCR|DRV|DRX|DEX|NXD|NVI|EPO|BLW|CL|TM|UD|UL|AR|SV|RR|PL|SF|LA|MD|GE|SW|MT|PK|DF|CG|HP|LM|DS|UF|EM|DX|TRR|FRLG|HL|MA|DR|SS|RS|SK|AQ|LC|N4|N3|N2|N1|GC|GH|TR|B2|FO|JU|BS)\b/i);
  const sepNumMatch = cleanText.match(/\b(\d{1,4}(?:\/\d{2,4})?)\b/);
  if (sepSetMatch && sepNumMatch) {
    return `${sepSetMatch[1].toUpperCase()} ${sepNumMatch[1]}`;
  }

  // 3c. Generic New Gen pattern: [SetCode 2-6 chars] [CardNumber 1-4 digits] e.g. CBB4C 2805/07
  const genericSetNumMatch = cleanText.match(/\b([A-Za-z]{2,5}\d{0,2}[A-Za-z]?)[-\s]+(\d{1,4})(?:\/(\d{1,4}))?\b/);
  if (genericSetNumMatch) {
    const prefix = genericSetNumMatch[1];
    if (!/^(CARD|SKU|ITEM|SCAN|PROD|PAGE|HTTP|HTML|JPEG|PNG|FILE|TEST)$/i.test(prefix)) {
      const total = genericSetNumMatch[3];
      return total ? `${prefix.toUpperCase()} ${genericSetNumMatch[2]}/${total}` : `${prefix.toUpperCase()} ${genericSetNumMatch[2]}`;
    }
  }

  // 4. Standard Pokémon fraction numbers: #130/170, 002/070, 0/170, 0904/070, 2306/07, 196/165, 94/123, 1301/07
  const fractionMatch = cleanText.match(/#?(\d{1,4}\/\d{2,4})\b/) ||
                        cleanText.match(/\b\d{1,4}\/\d{2,4}\b/);
  if (fractionMatch) {
    return fractionMatch[1] || fractionMatch[0].replace(/^#/, '');
  }

  // 5. Promo codes: SVP088, SVP-088, S-P325, SWSH123, SM123
  const promoMatch = cleanText.match(/\b(SVP|S-P|SWSH|SM|XY|BW|DP|HGSS|PROMO)[-\s]*\d{1,3}\b/i);
  if (promoMatch) {
    return promoMatch[0].toUpperCase().replace(/\s+/g, '-');
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

  // Format 1: "Pokémon - Phione #0/170 C (Japanese)13" or "One Piece - Monkey D. Luffy #OP05-119 SEC (Japanese)"
  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    if (parts.length >= 2) {
      clean = parts.slice(1).join(' - ');
    }
  }

  // Format 2: "#{index} {name_en} #{number} {rarity} ({language})" e.g. "#1 Phione #130/170 C (Japanese)"
  if (clean.startsWith('#') && clean.match(/^#\d+\s+/)) {
    clean = clean.replace(/^#\d+\s+/, '');
  }

  // Format 3: "Karte #8 (0016.png)"
  if (clean.startsWith('Karte #') || clean.startsWith('Sammelkarte #')) {
    return clean.split('(')[0].trim();
  }

  // Remove "aus <Set>" or "from <Set>" phrases e.g. "aus cBB4C", "aus Obsidian-Flammen", "from Gem Pack Vol 4"
  clean = clean.replace(/\s+(?:aus|from|de|in)\s+([A-Za-z0-9\-_]+(?:\s+[A-Za-z0-9\-_]+){0,3})/i, '').trim();

  // Remove trailing language tags like "(Japanese)", "(German)", "(English)", "(Chinese)"
  clean = clean.replace(/\s*\([A-Za-z\s]+\)\s*\d*$/i, '').trim();

  // Remove card number / code tags like "#130/170", "#OP05-119", "#002/070", "#1301/07", "#me02.5-220"
  clean = clean.replace(/#[A-Za-z0-9\/\.\-_]+/g, '').trim();

  // Remove bare fractions like "1301/07", "183/165", "002/070"
  clean = clean.replace(/\b\d{1,4}\/\d{2,4}\b/g, '').trim();

  // Remove set codes like "CBB4C", "CBB1C", "sv2a", "OP05", "PAF", "DAA", "m2", etc.
  clean = clean.replace(/\b(CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]?|CSM|CSD|AC\d{1,2}[a-zA-Z]?|sv\d{1,2}[a-zA-Z]?|s\d{1,2}[a-zA-Z]?|sm\d{1,2}[a-zA-Z]?|xy\d{1,2}[a-zA-Z]?|bw\d{1,2}[a-zA-Z]?|hgss\d?|dp\d?|ex\d{1,2}|m\d+|me\d+(?:\.\d+)?|OP\d{1,2}|ST\d{1,2}|EB\d{1,2}|PRB\d{1,2}|PAF|OBF|PAR|TEF|TWM|PAL|SVI|SIT|LOR|ASR|BRS|FST|EVS|CRE|BST|SHF|VIV|CPA|DAA|RCL|SSH|DRI|JTG|PRE|SFA|SCR|SSP|SVP|S-P|SWSH|SWSHP|SMP|SM|XYP|XY|BWP|BW|DPP|DP|MEW|CRZ|CEC|HIF|UNM|UNB|DET|TEU|LOT|DRM|CES|FLI|UPR|CRI|SLG|BUS|GRI|SUM|EVO|STS|FCO|GEN|BKP|BKT|AOR|ROS|DCR|PRC|PHF|FFI|FLF|LTR|PLB|PLF|PLS|BCR|DRV|DRX|DEX|NXD|NVI|EPO|BLW|CL|TM|UD|UL|AR|SV|RR|PL|SF|LA|MD|GE|SW|MT|PK|DF|CG|HP|LM|DS|UF|EM|DX|TRR|FRLG|HL|MA|DR|SS|RS|SK|AQ|LC|N4|N3|N2|N1|GC|GH|TR|B2|FO|JU|BS)\b/gi, '').trim();

  // Remove rarity tags and stars at the end like "C", "U", "R", "RR", "AR", "SAR", "SR", "UR", "SEC", "☆☆", "⭐", "★"
  clean = clean.replace(/\s+(C|U|R|RR|AR|SAR|SR|UR|SEC|HR|CSR|CHR|TR|Promo|[☆★⭐]+)\s*$/i, '').trim();
  clean = clean.replace(/[☆★⭐]+/g, '').trim();

  // Remove code if prepended or appended e.g. "MEW173 Mew ex" -> "Mew ex"
  if (rawCode) {
    const codeClean = rawCode.replace(/[\/-]/g, '');
    const regex = new RegExp(`^${rawCode}\\s+|^${codeClean}\\s+|\\s+${rawCode}$|\\s+${codeClean}$`, 'i');
    clean = clean.replace(regex, '').trim();
  }

  // Remove trailing or leading dashes/hashes/spaces
  clean = clean.replace(/^[-#\s]+|[-#\s]+$/g, '').trim();

  // If title was too bare, look into description: "Pokémon Phione (フィオネ) #130/170 [C] - Japanisch."
  if (!clean || clean.length < 2) {
    if (description) {
      const descMatch = description.match(/^(?:Pokémon|One Piece|Yu-Gi-Oh!|Lorcana|Dragon Ball)?\s*([A-Za-z0-9\s'\.\-]+?)(?:\s*\([^)]+\))?\s*(?:#|OP|\d+\/|\[)/i);
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
 * - Compound Asian variant codes (e.g. CBB4C 1301/07 -> Card #13, Variant V1, Set CBB4C)
 * - Suffix variants (e.g. OP05-119-V1, EB02-061-V3, ST01-012-V1, 055/066-V1, Card (V1))
 * - Prefix variants (e.g. V1-CBB4C13, V7-CBB5C01)
 * - Standard Promo and Set codes (e.g. SVP-001, OP05-119, MEW 199/165)
 */
export function parseCardCodeComponents(codeStr, nameStr = '', setStr = '') {
  if (!codeStr && !nameStr && !setStr) return null;
  const combined = `${codeStr || ''} ${nameStr || ''} ${setStr || ''}`.trim();

  // 1. Detect compound Asian/Chinese set variant e.g. "CBB4C 1301/07", "1301/07 aus CBB4C", "1301/07"
  const setMatch = combined.match(/\b(CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]?|CSM|CSD|AC\d{1,2}[a-zA-Z]?|sv\d{1,2}[a-zA-Z]?|s\d{1,2}[a-zA-Z]?|sm\d{1,2}[a-zA-Z]?|xy\d{1,2}[a-zA-Z]?|bw\d{1,2}[a-zA-Z]?|m\d+|me\d+|PAF|OBF|PAR|TEF|TWM|PAL|SVI|SIT|LOR|ASR|BRS|FST|EVS|CRE|BST|SHF|VIV|CPA|DAA|RCL|SSH|DRI|JTG|PRE|SFA|SCR|SSP|SVP)\b/i);
  const setCode = setMatch ? setMatch[1].toUpperCase() : '';

  const compMatch = combined.match(/\b(\d{2})(\d{2})(?:\/(\d{2}))?\b/);
  if (compMatch) {
    const cardNum = parseInt(compMatch[1], 10).toString(); // "13" or "23"
    const cardNumPad = compMatch[1]; // "13" or "23"
    const variantNum = parseInt(compMatch[2], 10).toString(); // "1" or "6"
    const variantTag = `V${variantNum}`; // "V1" or "V6"
    const totalVariants = compMatch[3] || '07'; // "07"
    const setCardCode = setCode ? `${setCode}${cardNumPad}` : cardNumPad; // "CBB4C13"
    const fullVariantSlug = setCode ? `${variantTag}-${setCode}${cardNumPad}` : `${variantTag}-${cardNumPad}`; // "V1-CBB4C13"

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

  // 4. Standard code components (e.g. "OP05-119", "CBB4C 13", "sv2a 173", "199/165")
  const stdMatch = (codeStr || '').trim().match(/^([A-Za-z0-9\-_]{2,10})[-\s]+(\d{1,4})(?:[\/-](\d{1,4}))?$/);
  if (stdMatch) {
    const sCode = stdMatch[1].toUpperCase();
    const rawNum = stdMatch[2];
    const cardNum = parseInt(rawNum, 10).toString();
    return {
      isCompound: false,
      setCode: sCode,
      cardNum,
      cardNumPad: rawNum,
      variantTag: null,
      variantNum: null,
      totalVariants: stdMatch[3] || null,
      setCardCode: `${sCode}${rawNum}`,
      fullVariantSlug: null,
      searchCode: `${sCode} ${rawNum}`
    };
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
    // Priority: Explicit Code -> Title -> Description -> Image File/Filename -> Article/SKU
    const extractedCode = extractCardCode(rawLegacyCode) ||
                          extractCardCode(wTitel) ||
                          extractCardCode(wBeschreibung) ||
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
    });

    return {
      id: `scan_${Date.now()}_${index}`,
      index: index + 1,
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
