import { supabase } from './supabase.js';

const STORAGE_KEY = 'tcg_manual_card_prices';

/**
 * Returns all saved manual card prices
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
 * Looks up a manual price by code (case-insensitive, unspaced or spaced)
 */
export function getManualPriceForCard(code, candidateNames = []) {
  if (!code && (!candidateNames || candidateNames.length === 0)) return null;
  const prices = getSavedManualPrices();
  
  if (code) {
    const clean = code.toUpperCase().replace(/\s+/g, '');
    const spaced = code.toUpperCase().replace(/^([A-Za-z0-9]{2,6})\s*(\d{1,4})/i, '$1 $2');
    if (prices[clean]) return prices[clean];
    if (prices[spaced]) return prices[spaced];
    if (prices[code.toUpperCase()]) return prices[code.toUpperCase()];
    if (prices[code.toLowerCase()]) return prices[code.toLowerCase()];
  }

  return null;
}

/**
 * Persists a manual price for a specific card code
 */
export async function saveManualPrice(code, price, cardMeta = {}) {
  if (!code || typeof price !== 'number' || isNaN(price)) return;
  const cleanCode = code.toUpperCase().replace(/\s+/g, '');
  const prices = getSavedManualPrices();

  const record = {
    price,
    name: cardMeta.name || '',
    set: cardMeta.set || '',
    cardmarket_url: cardMeta.cardmarket_url || '',
    updatedAt: new Date().toISOString()
  };

  prices[cleanCode] = record;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
  } catch (e) {}

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: prices });
    } catch (e) {}
  }

  // Also sync to Supabase price_history in the background
  try {
    const cardId = cardMeta.cardmarket_url || `/Manual/${cleanCode}`;
    await supabase.from('price_history').insert({
      card_id: cardId,
      price: price,
      condition: 'NM',
      seller_country: 'DE',
      language: 'JP',
      comment: `[Manual|DE|NM] Code:${cleanCode}`
    });
  } catch (e) {}
}

/**
 * Removes a manual price for a card code
 */
export async function removeManualPrice(code) {
  if (!code) return;
  const cleanCode = code.toUpperCase().replace(/\s+/g, '');
  const prices = getSavedManualPrices();
  delete prices[cleanCode];
  delete prices[code.toUpperCase()];
  delete prices[code.toLowerCase()];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
  } catch (e) {}

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: prices });
    } catch (e) {}
  }
}
