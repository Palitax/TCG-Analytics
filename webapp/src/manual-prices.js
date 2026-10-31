import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { parseCardCodeComponents } from './csv-parser.js';
import { translateCardName, getEnglishPokemonName } from './tcg-translations.js';

const STORAGE_KEY = 'tcg_manual_card_prices';

const SUPABASE_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

let remoteManualCache = {
  timestamp: 0,
  index: null,
  inflight: null,
};

const REMOTE_CACHE_TTL_MS = 4000;

export function invalidateRemoteManualPricesCache() {
  remoteManualCache.timestamp = 0;
  remoteManualCache.index = null;
}

function normalizeNameSlug(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .replace(/[!?.]+$/g, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function compactCode(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Builds canonical `/Manual/...` cardId, primaryCode, and all lookup aliases for a code or card name,
 * matching ScanConverter3000's `normalizeRecordForSupabase` convention 1:1.
 */
export function buildManualPriceIdentity(codeOrName, cardMeta = {}) {
  const rawInput = (codeOrName || '').trim();
  const rawName = (cardMeta.name || '').trim();

  // Check if input is a card code (contains digits or known promo/gallery pattern)
  const hasDigits = /\d/.test(rawInput);
  if (hasDigits) {
    const parsed = parseCardCodeComponents(rawInput, rawName, cardMeta.set || '');
    if (parsed && parsed.setCode && (parsed.cardNumPad || parsed.cardNum)) {
      const sCode = parsed.setCode.toUpperCase() === '30THC' ? '30C' : parsed.setCode.toUpperCase();
      const padNum = parsed.cardNumPad || parsed.cardNum;
      const unpadNum = parsed.cardNum || padNum;
      const primaryCode = `${sCode}${padNum}`;
      const aliases = new Set([
        primaryCode,
        `${sCode}${unpadNum}`,
        `${sCode}-${padNum}`,
        `${sCode}-${unpadNum}`,
        rawInput.toUpperCase().replace(/\s+/g, ''),
      ]);
      if (sCode === '30C') {
        aliases.add(`30THC${padNum}`);
        aliases.add(`30THC${unpadNum}`);
      }
      if (/[^A-Z0-9]/.test(sCode)) {
        const compSet = sCode.replace(/[^A-Z0-9]/g, '');
        if (compSet) {
          aliases.add(`${compSet}${padNum}`);
          aliases.add(`${compSet}${unpadNum}`);
        }
      }
      if (sCode.endsWith('-P')) {
        aliases.add(`${padNum}/${sCode}`);
        aliases.add(`${unpadNum}/${sCode}`);
      }
      return {
        isNameOnly: false,
        cardId: `/Manual/${primaryCode}`,
        primaryCode,
        aliases: Array.from(aliases).filter(Boolean),
        cleanName: rawName,
      };
    }

    const cleanCode = rawInput.toUpperCase().replace(/\s+/g, '').replace(/\//g, '-');
    return {
      isNameOnly: false,
      cardId: `/Manual/${cleanCode}`,
      primaryCode: cleanCode,
      aliases: [cleanCode, compactCode(cleanCode)].filter(Boolean),
      cleanName: rawName,
    };
  }

  // Name-only manual price (e.g. "Ditto!", "Pidgey", "Raichu", "Meowth Meow!")
  const effectiveName = rawName || rawInput;
  const slug = normalizeNameSlug(effectiveName);
  if (!slug) return null;

  const baseName = effectiveName.replace(/[!?.]+$/g, '').trim();
  const nameAliases = Array.from(new Set([effectiveName, baseName].filter(Boolean)));
  return {
    isNameOnly: true,
    cardId: `/Manual/Name/${slug}`,
    primaryCode: `NAME_${slug.toUpperCase()}`,
    aliases: nameAliases,
    cleanName: baseName,
  };
}

/**
 * Returns all saved manual card prices from localStorage
 * @returns {Record<string, { price: number, name?: string, set?: string, cardmarket_url?: string, updatedAt?: string }>}
 */
export function getSavedManualPrices() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Looks up a manual price in localStorage by code variants or (when code is absent) candidate names
 */
export function getManualPriceForCard(code, candidateNames = []) {
  if (!code && (!candidateNames || candidateNames.length === 0)) return null;
  const prices = getSavedManualPrices();
  if (!prices || Object.keys(prices).length === 0) return null;

  if (code) {
    const identity = buildManualPriceIdentity(code);
    const spaced = code.toUpperCase().replace(/^([A-Za-z0-9.-]{2,8})\s*(\d{1,4})/i, '$1 $2');
    const lookupKeys = new Set([
      code.toUpperCase().replace(/\s+/g, ''),
      spaced,
      code.toUpperCase(),
      code.toLowerCase(),
      ...(identity?.aliases || []),
    ]);

    for (const k of lookupKeys) {
      if (k && prices[k] && typeof prices[k].price === 'number') {
        return prices[k];
      }
    }
    return null;
  }

  // Name-only lookup when card has no collector code
  for (const name of candidateNames) {
    const slug = normalizeNameSlug(name);
    const keyUpper = `NAME_${slug.toUpperCase()}`;
    if (slug && prices[keyUpper] && typeof prices[keyUpper].price === 'number') {
      return prices[keyUpper];
    }
    if (prices[name] && typeof prices[name].price === 'number') {
      return prices[name];
    }
  }

  return null;
}

/**
 * Persists a manual price locally and syncs it idempotently to Supabase `price_history`
 */
export async function saveManualPrice(codeOrName, price, cardMeta = {}) {
  if (!codeOrName || typeof price !== 'number' || isNaN(price) || price < 0) return;

  const identity = buildManualPriceIdentity(codeOrName, cardMeta);
  if (!identity) return;

  const roundedPrice = Math.max(0, parseFloat(Number(price).toFixed(2)));
  const prices = getSavedManualPrices();

  const record = {
    price: roundedPrice,
    name: cardMeta.name || identity.cleanName || '',
    set: cardMeta.set || '',
    cardmarket_url:
      cardMeta.cardmarket_url && !cardMeta.cardmarket_url.startsWith('/Manual/')
        ? cardMeta.cardmarket_url
        : '',
    updatedAt: new Date().toISOString(),
  };

  prices[identity.primaryCode] = record;
  for (const alias of identity.aliases) {
    if (!identity.isNameOnly && alias) {
      prices[alias] = record;
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
  } catch (e) {}

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: prices });
    } catch (e) {}
  }

  invalidateRemoteManualPricesCache();

  // Sync to Supabase price_history under canonical `/Manual/...` card_id
  try {
    const tcg = cardMeta.tcg || 'Pokemon';
    const lang = cardMeta.language || 'JP';
    const cond = cardMeta.condition || 'NM';
    const comment = identity.isNameOnly
      ? `[Manual|DE|${cond}] Name:${identity.cleanName}${
          identity.aliases.length ? ` | Aliases:${identity.aliases.join(',')}` : ''
        }`
      : `[Manual|DE|${cond}] Code:${identity.primaryCode} | Codes:${identity.aliases.join(',')}${
          record.name ? ` | Name:${record.name}` : ''
        }`;

    const checkUrl = `${SUPABASE_URL}/rest/v1/price_history?select=id&card_id=eq.${encodeURIComponent(
      identity.cardId
    )}&order=scanned_at.desc&limit=5`;
    const checkResp = await fetch(checkUrl, { headers: SUPABASE_HEADERS });
    const existing = checkResp.ok ? await checkResp.json() : [];

    const payload = {
      price: roundedPrice,
      condition: cond,
      seller_country: 'DE',
      language: lang,
      tcg,
      comment,
      scanned_at: new Date().toISOString(),
    };

    if (Array.isArray(existing) && existing.length > 0 && existing[0]?.id) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/price_history?id=eq.${encodeURIComponent(existing[0].id)}`,
        {
          method: 'PATCH',
          headers: SUPABASE_HEADERS,
          body: JSON.stringify(payload),
        }
      );
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/price_history`, {
        method: 'POST',
        headers: SUPABASE_HEADERS,
        body: JSON.stringify({
          card_id: identity.cardId,
          ...payload,
        }),
      });
    }
    invalidateRemoteManualPricesCache();
  } catch (e) {}
}

/**
 * Removes a manual price locally and deletes its `/Manual/...` entry from Supabase `price_history`
 */
export async function removeManualPrice(codeOrName) {
  if (!codeOrName) return;
  const identity = buildManualPriceIdentity(codeOrName);
  const cleanCode = codeOrName.toUpperCase().replace(/\s+/g, '');
  const prices = getSavedManualPrices();

  delete prices[cleanCode];
  delete prices[codeOrName.toUpperCase()];
  delete prices[codeOrName.toLowerCase()];
  if (identity) {
    delete prices[identity.primaryCode];
    for (const alias of identity.aliases) {
      delete prices[alias];
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
  } catch (e) {}

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: prices });
    } catch (e) {}
  }

  invalidateRemoteManualPricesCache();

  if (identity?.cardId) {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/price_history?card_id=eq.${encodeURIComponent(identity.cardId)}`,
        {
          method: 'DELETE',
          headers: SUPABASE_HEADERS,
        }
      );
      invalidateRemoteManualPricesCache();
    } catch (e) {}
  }
}

/**
 * Parses a Supabase `/Manual/...` row and indexes all its canonical & alias keys.
 */
function buildManualIndexFromRows(rows) {
  const byCardId = new Map();
  const byCode = new Map();
  const byCompactCode = new Map();
  const byNumAndName = new Map();
  const byNameOnly = new Map();

  if (!Array.isArray(rows)) {
    return { byCardId, byCode, byCompactCode, byNumAndName, byNameOnly };
  }

  // Rows are already ordered by scanned_at.desc -> first seen wins (newest)
  for (const row of rows) {
    if (!row || row.price === null || row.price === undefined) continue;
    const priceNum = parseFloat(row.price);
    if (isNaN(priceNum)) continue;

    const cardId = String(row.card_id || '').trim();
    const comment = String(row.comment || '').trim();
    const cardIdUpper = cardId.toUpperCase();

    if (cardIdUpper && !byCardId.has(cardIdUpper)) {
      byCardId.set(cardIdUpper, row);
    }

    const codeMatch = comment.match(/\bCode:([^\s|]+)/i);
    const codesMatch = comment.match(/\bCodes:([^|]+)/i);
    const nameMatch = comment.match(/\bName:([^|]+)/i);
    const aliasesMatch = comment.match(/\bAliases:([^|]+)/i);

    const parsedName = nameMatch ? nameMatch[1].trim() : '';
    const parsedAliases = aliasesMatch
      ? aliasesMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    // 1. Name-only manual price (/Manual/Name/<slug>)
    if (cardId.startsWith('/Manual/Name/')) {
      const slugFromId = cardId.slice('/Manual/Name/'.length).trim().toLowerCase();
      const allNames = new Set([slugFromId, parsedName, ...parsedAliases].filter(Boolean));
      for (const n of Array.from(allNames)) {
        const de = translateCardName(n, row.tcg || 'Pokemon');
        const en = getEnglishPokemonName(n);
        if (de) allNames.add(de);
        if (en) allNames.add(en);
      }
      for (const n of allNames) {
        const s = normalizeNameSlug(n);
        if (s && !byNameOnly.has(s)) {
          byNameOnly.set(s, row);
        }
      }
      continue;
    }

    // 2. Number + Name manual price (/Manual/Num/<paddedNum>_<slug>)
    if (cardId.startsWith('/Manual/Num/')) {
      const tail = cardId.slice('/Manual/Num/'.length);
      const [numPart] = tail.split('_');
      const codeAliases = codesMatch
        ? codesMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
        : [numPart];
      const nameVariants = new Set([parsedName].filter(Boolean));
      if (parsedName) {
        const de = translateCardName(parsedName, row.tcg || 'Pokemon');
        const en = getEnglishPokemonName(parsedName);
        if (de) nameVariants.add(de);
        if (en) nameVariants.add(en);
      }
      for (const nv of codeAliases) {
        for (const nm of nameVariants) {
          const ns = normalizeNameSlug(nm);
          if (nv && ns) {
            const key = `${nv.toUpperCase()}__${ns}`;
            if (!byNumAndName.has(key)) byNumAndName.set(key, row);
          }
        }
      }
      continue;
    }

    // 3. Code-based manual price (/Manual/<Code> or [Manual|...] Code:...)
    const rawCodes = new Set();
    if (cardId.startsWith('/Manual/')) {
      const suffix = cardId.slice('/Manual/'.length).trim();
      if (suffix) rawCodes.add(suffix);
    }
    if (codeMatch?.[1]) rawCodes.add(codeMatch[1].trim());
    if (codesMatch?.[1]) {
      for (const token of codesMatch[1].split(',')) {
        const t = token.trim();
        if (t) rawCodes.add(t);
      }
    }

    // Also expand parsed variants for legacy rows that only stored `[Manual|DE|NM] Code:M5082`
    for (const rc of Array.from(rawCodes)) {
      const parsed = parseCardCodeComponents(rc);
      if (parsed?.setCode && (parsed.cardNumPad || parsed.cardNum)) {
        const sc = parsed.setCode.toUpperCase();
        if (parsed.cardNumPad) {
          rawCodes.add(`${sc}${parsed.cardNumPad}`);
          rawCodes.add(`${sc}-${parsed.cardNumPad}`);
        }
        if (parsed.cardNum) {
          rawCodes.add(`${sc}${parsed.cardNum}`);
          rawCodes.add(`${sc}-${parsed.cardNum}`);
        }
      }
    }

    for (const rc of rawCodes) {
      const upper = rc.toUpperCase();
      if (upper && !byCode.has(upper)) {
        byCode.set(upper, row);
      }
      const comp = compactCode(upper);
      if (comp && comp.length >= 3 && !byCompactCode.has(comp)) {
        byCompactCode.set(comp, row);
      }
    }
  }

  return { byCardId, byCode, byCompactCode, byNumAndName, byNameOnly };
}

/**
 * Fetches and indexes all `/Manual/*` custom prices from Supabase `price_history` in one fast batch request.
 */
export async function fetchRemoteManualPricesIndex(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && remoteManualCache.index && now - remoteManualCache.timestamp < REMOTE_CACHE_TTL_MS) {
    return remoteManualCache.index;
  }

  if (!forceRefresh && remoteManualCache.inflight) {
    return remoteManualCache.inflight;
  }

  remoteManualCache.inflight = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const url = `${SUPABASE_URL}/rest/v1/price_history?select=price,scanned_at,comment,card_id,tcg&or=(card_id.ilike.${encodeURIComponent(
        '/Manual/*'
      )},comment.ilike.${encodeURIComponent('[Manual*')})&order=scanned_at.desc&limit=5000`;
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
        const rows = await resp.json();
        const index = buildManualIndexFromRows(rows);
        remoteManualCache.index = index;
        remoteManualCache.timestamp = Date.now();
        return index;
      }
    } catch (e) {
      console.warn('[manual-prices] Remote manual price fetch warning:', e);
    } finally {
      remoteManualCache.inflight = null;
    }

    return remoteManualCache.index || buildManualIndexFromRows([]);
  })();

  return remoteManualCache.inflight;
}

function isCompatibleTcg(rowTcg, itemTcg) {
  if (!rowTcg || !itemTcg) return true;
  const r = rowTcg.toLowerCase();
  const i = itemTcg.toLowerCase();
  if ((r === 'onepiece' && i === 'pokemon') || (r === 'pokemon' && i === 'onepiece')) {
    return false;
  }
  return true;
}

/**
 * Matches a scanned CSV card item against the Supabase remote manual prices index.
 */
export function matchRemoteManualPrice(
  index,
  { code = '', parsedComp = null, fullCodeVariants = [], numVariants = [], candidateNames = [], tcg = 'Pokemon' }
) {
  if (!index) return null;

  // 1. Exact & alias SetCode+Number matching
  const codeCandidates = new Set();
  if (code) {
    codeCandidates.add(code.toUpperCase().replace(/\s+/g, ''));
  }
  if (parsedComp?.setCardCode) {
    codeCandidates.add(parsedComp.setCardCode.toUpperCase());
  }
  if (parsedComp?.setCode && parsedComp?.cardNumPad) {
    codeCandidates.add(`${parsedComp.setCode.toUpperCase()}${parsedComp.cardNumPad.toUpperCase()}`);
    codeCandidates.add(`${parsedComp.setCode.toUpperCase()}-${parsedComp.cardNumPad.toUpperCase()}`);
  }
  if (parsedComp?.setCode && parsedComp?.cardNum) {
    codeCandidates.add(`${parsedComp.setCode.toUpperCase()}${parsedComp.cardNum.toUpperCase()}`);
    codeCandidates.add(`${parsedComp.setCode.toUpperCase()}-${parsedComp.cardNum.toUpperCase()}`);
  }
  for (const fv of fullCodeVariants) {
    if (fv) codeCandidates.add(String(fv).toUpperCase().replace(/\s+/g, ''));
  }

  for (const cand of codeCandidates) {
    const directByCardId = index.byCardId.get(`/MANUAL/${cand}`);
    if (directByCardId && isCompatibleTcg(directByCardId.tcg, tcg)) return directByCardId;

    const directByCode = index.byCode.get(cand);
    if (directByCode && isCompatibleTcg(directByCode.tcg, tcg)) return directByCode;
  }

  for (const cand of codeCandidates) {
    const comp = compactCode(cand);
    if (comp && comp.length >= 3) {
      const byComp = index.byCompactCode.get(comp);
      if (byComp && isCompatibleTcg(byComp.tcg, tcg)) return byComp;
    }
  }

  // 2. Number + Name manual price matching (for cards with collector number + name)
  if (numVariants.length > 0 && candidateNames.length > 0 && index.byNumAndName.size > 0) {
    for (const num of numVariants) {
      const nClean = String(num).toUpperCase();
      const nPadded = /^\d+$/.test(nClean) && nClean.length < 3 ? nClean.padStart(3, '0') : nClean;
      for (const name of candidateNames) {
        const ns = normalizeNameSlug(name);
        if (!ns) continue;
        const hit =
          index.byNumAndName.get(`${nPadded}__${ns}`) || index.byNumAndName.get(`${nClean}__${ns}`);
        if (hit && isCompatibleTcg(hit.tcg, tcg)) return hit;
      }
    }
  }

  // 3. Name-only manual price matching (ONLY when card has no collector code, e.g. "Ditto!", "Pidgey", "Raichu", "Meowth Meow!")
  if (!code && candidateNames.length > 0 && index.byNameOnly.size > 0) {
    for (const name of candidateNames) {
      const ns = normalizeNameSlug(name);
      if (!ns || ns === 'karte' || ns === 'sammelkarte' || ns === 'trading-card') continue;
      const hit = index.byNameOnly.get(ns);
      if (hit && isCompatibleTcg(hit.tcg, tcg)) return hit;
    }
  }

  return null;
}
