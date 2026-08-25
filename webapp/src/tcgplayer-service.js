/**
 * TCGPlayer Service Helper
 * Fetches real-time TCGPlayer USD Market Pricing for Pokémon, One Piece, and other TCGs.
 * Supports Japanese sets (sv2a, s12a, sv4a, etc.), Asian Gem Packs (CBB4C, etc.), and Western releases.
 */

import { formatCardMeta } from './tcg-translations.js';
import { parseCardCodeComponents } from './csv-parser.js';

// Mapping of standard set codes to TCGdex set IDs
const SET_CODE_TO_TCGDEX = {
  // Scarlet & Violet (EN)
  'svi': 'sv01',
  'sve': 'sve',
  'pal': 'sv02',
  'obf': 'sv03',
  'mew': 'sv03.5',
  'par': 'sv04',
  'paf': 'sv04.5',
  'tef': 'sv05',
  'twm': 'sv06',
  'sfa': 'sv06.5',
  'scr': 'sv07',
  'ssp': 'sv08',
  'pre': 'sv08.5',
  'svp': 'svp',

  // Sword & Shield (EN)
  'ssh': 'swsh1',
  'rcl': 'swsh2',
  'daa': 'swsh3',
  'cpa': 'swsh3.5',
  'viv': 'swsh4',
  'shf': 'swsh4.5',
  'bst': 'swsh5',
  'cre': 'swsh6',
  'evs': 'swsh7',
  'cel': 'cel25',
  'fst': 'swsh8',
  'brs': 'swsh9',
  'asr': 'swsh10',
  'pgo': 'pgo',
  'lor': 'swsh11',
  'sit': 'swsh12',
  'crz': 'swsh12.5',
  'swshp': 'swshp',

  // Sun & Moon (EN)
  'sum': 'sm1',
  'gri': 'sm2',
  'bus': 'sm3',
  'slg': 'sm3.5',
  'cin': 'sm4',
  'upr': 'sm5',
  'flm': 'sm6',
  'ces': 'sm7',
  'drm': 'sm7.5',
  'lot': 'sm8',
  'teu': 'sm9',
  'unb': 'sm10',
  'unm': 'sm11',
  'hif': 'sm115',
  'cec': 'sm12',
  'smp': 'smp',

  // Japanese Sets
  'sv2a': 'sv2a',
  's12a': 's12a',
  'sv4a': 'sv4a',
  'sv5a': 'sv5a',
  'sv6a': 'sv6a',
  'sv7': 'sv7',
  'sv8': 'sv8',
  'sv8a': 'sv8a',
  's10b': 's10b',
  's11': 's11',
  's12': 's12',
  'sm12a': 'sm12a',
  'sm11b': 'sm11b',

  // Common Set Names & Slugs
  '151': 'sv03.5',
  'pokémon 151': 'sv03.5',
  'pokemon 151': 'sv03.5',
  'crown-zenith': 'swsh12.5',
  'crown zenith': 'swsh12.5',
  'paldean-fates': 'sv04.5',
  'paldean fates': 'sv04.5',
  'shining-fates': 'swsh4.5',
  'shining fates': 'swsh4.5',
  'hidden-fates': 'sm115',
  'hidden fates': 'sm115',
  'twilight-masquerade': 'sv06',
  'twilight masquerade': 'sv06',
  'stellar-crown': 'sv07',
  'stellar crown': 'sv07',
  'surging-sparks': 'sv08',
  'surging sparks': 'sv08',
  'prismatic-evolutions': 'sv08.5',
  'prismatic evolutions': 'sv08.5',
  'vstar-universe': 's12a',
  'vstar universe': 's12a',
  'shiny-treasure-ex': 'sv4a',
  'shiny treasure ex': 'sv4a',
  'crimson-haze': 'sv5a',
  'crimson haze': 'sv5a',
  'night-wanderer': 'sv6a',
  'night wanderer': 'sv6a',
  'stellar-miracle': 'sv7',
  'stellar miracle': 'sv7',
  'supercharged-breaker': 'sv8',
  'supercharged breaker': 'sv8',
  // German Set Names
  'karmesin & purpur': 'sv01',
  'karmesin und purpur': 'sv01',
  'entwicklungen in paldea': 'sv02',
  'obsidianflammen': 'sv03',
  'pokémon 151': 'sv03.5',
  'pokemon 151': 'sv03.5',
  'paradoxdrift': 'sv04',
  'paldeas schicksale': 'sv04.5',
  'gewalten der zeit': 'sv05',
  'maskeraden im zwielicht': 'sv06',
  'nebel der sagen': 'sv06.5',
  'stellarkrone': 'sv07',
  'stürmische funken': 'sv08',
  'stuermische funken': 'sv08',
  'prisma-evolutionen': 'sv08.5',
  'prisma evolutionen': 'sv08.5',
  'schwert & schild': 'swsh1',
  'fusionsangriff': 'swsh8',
  'strahlende sterne': 'swsh9',
  'astralglanz': 'swsh10',
  'verlorener ursprung': 'swsh11',
  'silberne sturmwinde': 'swsh12',
  'zenit der könige': 'swsh12.5',
  'zenit der koenige': 'swsh12.5',
  'verborgenes schicksal': 'sm115',
  'glänzendes schicksal': 'swsh4.5',
  'glaenzendes schicksal': 'swsh4.5',
};

// Japanese set code regex pattern
const JAPANESE_SET_PATTERN = /\b(sv\d+[a-z]?|s\d+[a-z]?|sm\d+[a-z]?|xy\d+[a-z]?|bw\d+[a-z]?|CBB\d{1,2}[A-Za-z]?|CS\d{1,2}[a-zA-Z]?|S-P|SV-P)\b/i;

/**
 * Derives the direct TCGPlayer search URL for any card
 * Formatted specifically for TCGPlayer's Japanese and International product catalog
 */
export function getTCGPlayerSearchUrl(cardMeta, item = null) {
  const tcg = (item?.tcg || cardMeta?.tcg || 'Pokemon').toLowerCase();
  const nameEn = (cardMeta?.nameEn || item?.nameEn || cardMeta?.nameDe || item?.detectedName || item?.rawName || '').trim();
  const cardCode = (cardMeta?.cardCode || item?.detectedCode || item?.rawCode || '').trim();
  const rawSet = (cardMeta?.setNameDe || item?.setNameDe || item?.rawSet || '').trim();

  // If productId is already resolved directly
  if (item?.tcgplayerProductId) {
    return `https://www.tcgplayer.com/product/${item.tcgplayerProductId}`;
  }

  // 1. One Piece
  if (tcg === 'onepiece' || tcg === 'one piece' || /^OP\d+/i.test(cardCode)) {
    const cleanCode = cardCode.replace(/-(V\d+)$/i, '');
    const query = `${nameEn} ${cleanCode}`.trim();
    return `https://www.tcgplayer.com/search/one-piece-card-game/product?q=${encodeURIComponent(query)}`;
  }

  // 2. Japanese & Asian Pokémon
  const isJapanese = JAPANESE_SET_PATTERN.test(cardCode) || JAPANESE_SET_PATTERN.test(rawSet) || (item?.rawLanguage === 'JA' || item?.rawLanguage === 'ZH');
  if (isJapanese) {
    const codeMatch = cardCode.match(JAPANESE_SET_PATTERN) || rawSet.match(JAPANESE_SET_PATTERN);
    const setCode = codeMatch ? codeMatch[1].toUpperCase() : '';
    const parsedComp = parseCardCodeComponents(cardCode, nameEn, rawSet);
    const codeWithoutSet = cardCode.replace(JAPANESE_SET_PATTERN, '').trim();
    const num = parsedComp?.cardNum || codeWithoutSet.match(/(\d+)/)?.[1] || '';

    let query = '';
    if (setCode && num) {
      query = `${nameEn} ${setCode} ${num}`.trim();
    } else if (setCode) {
      query = `${nameEn} ${setCode}`.trim();
    } else if (num) {
      query = `${nameEn} Japanese ${num}`.trim();
    } else {
      query = `${nameEn} Japanese ${cardCode}`.trim();
    }

    return `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(query)}&productLineName=pokemon`;
  }

  // 3. Western Pokémon & other TCGs
  const numOnly = cardCode.split('/')[0].replace(/\D/g, '');
  let query = '';
  if (nameEn && numOnly) {
    query = `${nameEn} ${numOnly}`;
  } else if (nameEn && cardCode) {
    query = `${nameEn} ${cardCode}`;
  } else {
    query = nameEn || rawSet || 'Pokemon';
  }

  return `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(query)}`;
}

/**
 * Fetches TCGPlayer pricing from TCGdex API with a 24-hour localStorage cache
 */
export async function fetchTCGPlayerPrice(cardMeta, item = null) {
  const cardCode = (cardMeta?.cardCode || item?.detectedCode || item?.rawCode || '').trim();
  const rawSet = (cardMeta?.setNameDe || item?.setNameDe || item?.rawSet || '').trim();
  const tcg = (item?.tcg || 'Pokemon').toLowerCase();

  if (tcg !== 'pokemon') {
    return {
      priceUsd: null,
      marketPrice: null,
      lowPrice: null,
      midPrice: null,
      productId: null,
      url: getTCGPlayerSearchUrl(cardMeta, item),
      source: 'search_only'
    };
  }

  // Parse set and number
  const parsed = parseCardCodeComponents(cardCode, cardMeta?.nameEn, rawSet);
  let setCode = (parsed?.setCode || '').toLowerCase();
  let cardNum = (parsed?.cardNumPad || parsed?.cardNum || '').replace(/^0+/, '');

  if (!cardNum) {
    const fractionMatch = cardCode.match(/(\d{1,4})\/\d{1,4}/);
    if (fractionMatch) {
      cardNum = fractionMatch[1].replace(/^0+/, '');
    } else {
      const numMatch = cardCode.match(/(\d+)/);
      if (numMatch) cardNum = numMatch[1].replace(/^0+/, '');
    }
  }

  if (!setCode) {
    const match = cardCode.match(/^([A-Za-z0-9]{2,6})[-\s]+(\d+)/i);
    if (match) {
      setCode = match[1].toLowerCase();
      if (!cardNum) cardNum = match[2].replace(/^0+/, '') || '1';
    } else if (rawSet) {
      const rawSetKey = rawSet.toLowerCase().replace(/[-_]/g, ' ').trim();
      if (SET_CODE_TO_TCGDEX[rawSetKey]) {
        setCode = rawSetKey;
      }
    }
  }

  const tcgdexSet = SET_CODE_TO_TCGDEX[setCode] || setCode;
  if (!tcgdexSet || !cardNum) {
    return {
      priceUsd: null,
      marketPrice: null,
      lowPrice: null,
      midPrice: null,
      productId: null,
      url: getTCGPlayerSearchUrl(cardMeta, item),
      source: 'search_only'
    };
  }

  const tcgdexId = `${tcgdexSet}-${cardNum}`;
  const cacheKey = `tcgplayer_price_${tcgdexId}`;

  // Check 24-hour cache
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if (Date.now() - parsedCache.cachedAt < 24 * 60 * 60 * 1000) {
        return parsedCache.data;
      }
    }
  } catch (e) {}

  // Fetch from TCGdex API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${tcgdexId}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const tcgplayer = data?.pricing?.tcgplayer;

      if (tcgplayer) {
        const variantData = tcgplayer.holofoil || tcgplayer.normal || tcgplayer.reverseHolofoil || tcgplayer['1stEditionHolofoil'] || Object.values(tcgplayer).find(v => typeof v === 'object' && v?.marketPrice);
        const marketPrice = variantData?.marketPrice || variantData?.midPrice || variantData?.lowPrice || null;
        const lowPrice = variantData?.lowPrice || null;
        const midPrice = variantData?.midPrice || null;
        const productId = variantData?.productId || null;

        const result = {
          priceUsd: marketPrice,
          marketPrice,
          lowPrice,
          midPrice,
          productId,
          url: productId ? `https://www.tcgplayer.com/product/${productId}` : getTCGPlayerSearchUrl(cardMeta, item),
          source: 'tcgdex_api'
        };

        try {
          localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), data: result }));
        } catch (e) {}

        return result;
      }
    }
  } catch (e) {}

  // Fallback
  const fallback = {
    priceUsd: null,
    marketPrice: null,
    lowPrice: null,
    midPrice: null,
    productId: null,
    url: getTCGPlayerSearchUrl(cardMeta, item),
    source: 'search_only'
  };

  return fallback;
}
