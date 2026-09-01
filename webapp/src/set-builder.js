/**
 * Pipeline Builder (Set & Mystery Pack Builder)
 * Handles custom pack/set generation, drag-and-drop card reordering,
 * per-card set assignment, and multi-format CSV exports with immutable
 * original CSV row index preservation.
 */

import { WHATNOT_COLUMNS } from './csv-parser.js';
import { escapeCsvCell } from './bulk-scanner.js';

/**
 * Returns a unique identity string for a card (by name and set code/number, e.g. Boltund 50091)
 */
export function getCardIdentityKey(card) {
  if (!card) return 'unknown';

  if (card.productId || card.cmId) {
    return `cm_${card.productId || card.cmId}`;
  }

  const name = (card.detectedName || card.nameDe || card.rawName || '').trim().toLowerCase();
  const code = (card.detectedCode || card.code || card.cardNumber || card.rawCode || '').trim().toLowerCase();
  const set = (card.setNameDe || card.rawSet || '').trim().toLowerCase();

  if (code && name) {
    return `${name}__${code}`;
  }
  if (code && set) {
    return `${set}__${code}`;
  }
  if (code) {
    return `code_${code}`;
  }
  if (name && set) {
    return `${name}__${set}`;
  }
  return name || 'unknown_card';
}

/**
 * Computes maximum complete sets considering pack size, hits rule, and duplicate constraints
 */
export function calculateMaxPossibleSets(hitCards, baseCards, packSize, hitsPerSet = 0, maxDuplicates = null) {
  const neededBase = packSize - (hitsPerSet || 0);
  const totalEligible = hitCards.length + baseCards.length;
  const theoreticalMax = Math.floor(totalEligible / packSize);

  if (theoreticalMax <= 0) return 0;

  const isPossible = (s) => {
    if (s <= 0) return true;

    // Check Hits constraint
    if (hitsPerSet > 0) {
      if (Math.floor(hitCards.length / hitsPerSet) < s) return false;
      if (maxDuplicates && maxDuplicates > 0) {
        const hitCounts = new Map();
        hitCards.forEach((c) => {
          const k = getCardIdentityKey(c);
          hitCounts.set(k, (hitCounts.get(k) || 0) + 1);
        });
        let effectiveHits = 0;
        for (const [, cnt] of hitCounts) {
          effectiveHits += Math.min(cnt, s * maxDuplicates);
        }
        if (effectiveHits < s * hitsPerSet) return false;
      }
    }

    // Check Base cards constraint
    if (neededBase > 0) {
      if (Math.floor(baseCards.length / neededBase) < s) return false;
      if (maxDuplicates && maxDuplicates > 0) {
        const baseCounts = new Map();
        baseCards.forEach((c) => {
          const k = getCardIdentityKey(c);
          baseCounts.set(k, (baseCounts.get(k) || 0) + 1);
        });
        let effectiveBase = 0;
        for (const [, cnt] of baseCounts) {
          effectiveBase += Math.min(cnt, s * maxDuplicates);
        }
        if (effectiveBase < s * neededBase) return false;
      }
    }

    return true;
  };

  let maxPossible = 0;
  for (let s = 1; s <= theoreticalMax; s++) {
    if (isPossible(s)) {
      maxPossible = s;
    } else {
      break;
    }
  }
  return maxPossible;
}

/**
 * Formats card title for CSV export with ascending sequential number (#1, #2, ... #N)
 * Replacing any previous leading number (e.g. #66, 66., # 66, [66]) with the new export pipeline number.
 */
export function formatExportTitle(rawTitle, fallbackName, exportNumber) {
  let title = (rawTitle || fallbackName || '').trim();

  // Match leading number patterns: "#66", "# 66", "66.", "#066", "[66]", "(66)", "Nr. 66", "No. 66", "CARD-0066"
  const leadingNumRegex = /^(?:#\s*\d+|\[\d+\]|\(\d+\)|\d+\.|\b(?:Nr|No|Nummer|CARD)\.?\s*[-#]?\s*\d+)\s*[-:–]?\s*/i;

  if (leadingNumRegex.test(title)) {
    title = title.replace(leadingNumRegex, `#${exportNumber} `);
  } else if (title) {
    title = `#${exportNumber} ${title}`;
  } else {
    title = `#${exportNumber} ${fallbackName || 'Karte'}`;
  }

  return title.trim();
}

export class SetBuilder {
  constructor(options = {}) {
    this.sets = [];
    this.defaultPackSize = options.defaultPackSize || 10;
  }

  /**
   * Clears all sets and unlinks cards
   */
  clearAllSets(allCards = []) {
    this.sets = [];
    if (Array.isArray(allCards)) {
      allCards.forEach((c) => {
        c.setId = null;
      });
    }
  }

  /**
   * Retrieves all current sets
   */
  getSets() {
    return this.sets;
  }

  /**
   * Finds a specific set by ID
   */
  getSet(setId) {
    return this.sets.find((s) => s.id === setId) || null;
  }

  /**
   * Creates a new empty set
   */
  createEmptySet(name = '', targetSize = null) {
    const nextNum = this.sets.length + 1;
    const setName = name.trim() || `Set #${nextNum}`;
    const newSet = {
      id: `set_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: setName,
      targetSize: targetSize || this.defaultPackSize || 10,
      cards: [],
      createdAt: Date.now(),
    };
    this.sets.push(newSet);
    return newSet;
  }

  /**
   * Deletes a set and resets card associations
   */
  deleteSet(setId, allCards = []) {
    const setIdx = this.sets.findIndex((s) => s.id === setId);
    if (setIdx === -1) return false;

    const removedSet = this.sets[setIdx];
    removedSet.cards.forEach((c) => {
      c.setId = null;
    });

    if (Array.isArray(allCards)) {
      allCards.forEach((c) => {
        if (c.setId === setId) c.setId = null;
      });
    }

    this.sets.splice(setIdx, 1);
    return true;
  }

  /**
   * Renames a set
   */
  renameSet(setId, newName) {
    const s = this.getSet(setId);
    if (s && newName && newName.trim()) {
      s.name = newName.trim();
      return true;
    }
    return false;
  }

  /**
   * Finds which set a card currently belongs to
   */
  getCardSetMembership(cardId) {
    if (!cardId) return null;
    for (const set of this.sets) {
      if (set.cards.some((c) => c.id === cardId || c.originalIndex === cardId)) {
        return set;
      }
    }
    return null;
  }

  /**
   * Assigns or moves an individual card to a target set
   */
  assignCardToSet(card, targetSetId) {
    if (!card || !targetSetId) return false;
    const targetSet = this.getSet(targetSetId);
    if (!targetSet) return false;

    // Remove from previous set if present
    this.sets.forEach((s) => {
      s.cards = s.cards.filter((c) => c.id !== card.id);
    });

    card.setId = targetSetId;
    targetSet.cards.push(card);
    return true;
  }

  /**
   * Removes an individual card from any set
   */
  removeCardFromSet(card) {
    if (!card) return false;
    const previousSetId = card.setId;
    card.setId = null;

    this.sets.forEach((s) => {
      s.cards = s.cards.filter((c) => c.id !== card.id);
    });

    return !!previousSetId;
  }

  /**
   * Reorders a card inside a set (Drag & Drop or Move)
   */
  reorderCard(setId, fromIndex, toIndex) {
    const set = this.getSet(setId);
    if (!set || !Array.isArray(set.cards)) return false;
    if (fromIndex < 0 || fromIndex >= set.cards.length) return false;
    if (toIndex < 0 || toIndex >= set.cards.length) return false;
    if (fromIndex === toIndex) return true;

    const [movedCard] = set.cards.splice(fromIndex, 1);
    set.cards.splice(toIndex, 0, movedCard);
    return true;
  }

  /**
   * Swaps two cards inside a set by their indices (0-based)
   */
  swapCards(setId, indexA, indexB) {
    const set = this.getSet(setId);
    if (!set || !Array.isArray(set.cards)) return false;
    if (indexA < 0 || indexA >= set.cards.length) return false;
    if (indexB < 0 || indexB >= set.cards.length) return false;
    if (indexA === indexB) return true;

    const temp = set.cards[indexA];
    set.cards[indexA] = set.cards[indexB];
    set.cards[indexB] = temp;
    return true;
  }

  /**
   * Moves all hit cards (value >= minHitPrice) to the end of the set's packing order
   */
  moveHitsToEnd(setId, minHitPrice = 5.0) {
    const set = this.getSet(setId);
    if (!set || !Array.isArray(set.cards)) return false;

    const nonHits = [];
    const hits = [];

    set.cards.forEach((card) => {
      const price = typeof card.lastPrice === 'number' ? card.lastPrice : 0;
      if (price >= minHitPrice) {
        hits.push(card);
      } else {
        nonHits.push(card);
      }
    });

    set.cards = [...nonHits, ...hits];
    return true;
  }

  /**
   * Evenly spaces out hit cards throughout the set
   */
  interleaveHits(setId, minHitPrice = 5.0) {
    const set = this.getSet(setId);
    if (!set || !Array.isArray(set.cards) || set.cards.length <= 1) return false;

    const nonHits = [];
    const hits = [];

    set.cards.forEach((card) => {
      const price = typeof card.lastPrice === 'number' ? card.lastPrice : 0;
      if (price >= minHitPrice) {
        hits.push(card);
      } else {
        nonHits.push(card);
      }
    });

    if (hits.length === 0 || nonHits.length === 0) return true;

    const result = [];
    const totalSlots = nonHits.length + hits.length;
    const hitInterval = Math.max(1, Math.floor(totalSlots / hits.length));

    let hitIdx = 0;
    let nonHitIdx = 0;

    for (let slot = 0; slot < totalSlots; slot++) {
      // Place hit at calculated interval or if non-hits run out
      if ((slot % hitInterval === hitInterval - 1 || nonHitIdx >= nonHits.length) && hitIdx < hits.length) {
        result.push(hits[hitIdx++]);
      } else if (nonHitIdx < nonHits.length) {
        result.push(nonHits[nonHitIdx++]);
      } else if (hitIdx < hits.length) {
        result.push(hits[hitIdx++]);
      }
    }

    set.cards = result;
    return true;
  }

  /**
   * Resets cards in set back to their original CSV index ascending order
   */
  resetSetToOriginalOrder(setId) {
    const set = this.getSet(setId);
    if (!set || !Array.isArray(set.cards)) return false;

    set.cards.sort((a, b) => {
      const idxA = a.originalIndex !== undefined ? a.originalIndex : a.index || 0;
      const idxB = b.originalIndex !== undefined ? b.originalIndex : b.index || 0;
      return idxA - idxB;
    });
    return true;
  }

  /**
   * Rearranges cards in a set so that duplicate cards (same name & card number) are not directly behind each other
   */
  separateDuplicates(setId) {
    const set = this.getSet(setId);
    if (!set || !Array.isArray(set.cards) || set.cards.length <= 1) return false;

    const cards = [...set.cards];
    const groups = new Map(); // key -> card[]
    cards.forEach((card) => {
      const k = getCardIdentityKey(card);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(card);
    });

    // Buckets sorted by remaining card count descending
    const buckets = Array.from(groups.values()).sort((a, b) => b.length - a.length);

    const result = [];
    let lastKey = null;

    while (result.length < cards.length) {
      // Find the largest available bucket whose key !== lastKey
      let bestBucketIdx = -1;
      for (let i = 0; i < buckets.length; i++) {
        if (buckets[i].length > 0) {
          const bucketKey = getCardIdentityKey(buckets[i][0]);
          if (bucketKey !== lastKey) {
            bestBucketIdx = i;
            break;
          }
        }
      }

      // If no different bucket is available, pick the first available non-empty bucket
      if (bestBucketIdx === -1) {
        bestBucketIdx = buckets.findIndex((b) => b.length > 0);
      }

      if (bestBucketIdx === -1) break;

      const card = buckets[bestBucketIdx].shift();
      result.push(card);
      lastKey = getCardIdentityKey(card);

      // Re-sort buckets by remaining size descending
      buckets.sort((a, b) => b.length - a.length);
    }

    set.cards = result;
    return true;
  }

  /**
   * Separates duplicates across all sets
   */
  separateDuplicatesInAllSets() {
    let count = 0;
    this.sets.forEach((s) => {
      if (this.separateDuplicates(s.id)) count++;
    });
    return count;
  }

  /**
   * Automatic Set Generator based on configurable criteria
   */
  generateSets(cards, config = {}) {
    if (!Array.isArray(cards) || cards.length === 0) {
      return { sets: [], unallocatedCards: [], totalSets: 0, totalAssigned: 0 };
    }

    const packSize = Math.max(1, parseInt(config.packSize, 10) || 10);
    const useHitRule = !!config.useHitRule;
    const minHitPrice = typeof config.minHitPrice === 'number' ? config.minHitPrice : 5.0;
    const hitsPerSet = useHitRule ? Math.max(1, parseInt(config.hitsPerSet, 10) || 1) : 0;
    const useBaseRange = !!config.useBaseRange;
    const minBasePrice = typeof config.minBasePrice === 'number' ? config.minBasePrice : 0;
    const maxBasePrice = typeof config.maxBasePrice === 'number' ? config.maxBasePrice : Infinity;
    const strategy = config.strategy || 'balanced'; // 'balanced' | 'sequential' | 'random'
    const namePrefix = config.namePrefix || 'Set #';

    const append = !!config.append;
    const existingSets = append ? [...this.sets] : [];
    const baseOffset = existingSets.length;

    // Filter available cards: if append, only pick unassigned cards
    const sourceCards = append ? cards.filter((c) => !c.setId) : cards;

    // Clone available cards and preserve originalIndex
    const pool = sourceCards.map((c, i) => {
      if (c.originalIndex === undefined || c.originalIndex === null) {
        c.originalIndex = c.index !== undefined ? c.index : i + 1;
      }
      if (!append) c.setId = null;
      return c;
    });

    // Partition pool into Hits and Base Cards
    const hitCandidates = [];
    const baseCandidates = [];
    const outOfRange = [];

    pool.forEach((card) => {
      const price = typeof card.lastPrice === 'number' ? card.lastPrice : 0;
      if (useHitRule && price >= minHitPrice) {
        hitCandidates.push(card);
      } else if (useBaseRange) {
        if (price >= minBasePrice && price <= maxBasePrice) {
          baseCandidates.push(card);
        } else {
          outOfRange.push(card);
        }
      } else {
        baseCandidates.push(card);
      }
    });

    const useMaxDuplicates = config.useMaxDuplicates !== false && config.useMaxDuplicates !== undefined ? !!config.useMaxDuplicates : (typeof config.maxDuplicates === 'number' && config.maxDuplicates > 0);
    const maxDuplicates = (useMaxDuplicates && config.maxDuplicates > 0) ? parseInt(config.maxDuplicates, 10) : null;

    // Determine total number of possible complete sets
    let totalPossibleSets = 0;
    if (useHitRule && hitsPerSet > 0) {
      totalPossibleSets = calculateMaxPossibleSets(hitCandidates, baseCandidates, packSize, hitsPerSet, maxDuplicates);
    } else {
      totalPossibleSets = calculateMaxPossibleSets([], hitCandidates.concat(baseCandidates), packSize, 0, maxDuplicates);
    }

    if (config.maxSets && typeof config.maxSets === 'number' && config.maxSets > 0) {
      totalPossibleSets = Math.min(totalPossibleSets, config.maxSets);
    }

    if (totalPossibleSets <= 0) {
      return {
        sets: this.sets,
        unallocatedCards: pool,
        totalSets: this.sets.length,
        totalAssigned: cards.filter((c) => c.setId).length,
        error: 'Nicht genügend passende Karten im Pool für die gewählten Kriterien (Hits / Preisbereich / Duplikate).',
      };
    }

    // Initialize set buckets
    const createdSets = [];
    for (let i = 0; i < totalPossibleSets; i++) {
      const setNum = baseOffset + i + 1;
      createdSets.push({
        id: `set_${Date.now()}_${setNum}_${Math.random().toString(36).slice(2, 6)}`,
        name: `${namePrefix}${setNum}`,
        targetSize: packSize,
        cards: [],
        createdAt: Date.now(),
      });
    }

    // Track card duplicate counts per set
    const setCardCounts = new Map();
    createdSets.forEach((s) => {
      setCardCounts.set(s.id, new Map());
    });

    const canAddCardToSet = (set, card) => {
      if (!maxDuplicates || maxDuplicates <= 0) return true;
      const key = getCardIdentityKey(card);
      const curr = setCardCounts.get(set.id)?.get(key) || 0;
      return curr < maxDuplicates;
    };

    const recordCardInSet = (set, card) => {
      const key = getCardIdentityKey(card);
      const curr = setCardCounts.get(set.id)?.get(key) || 0;
      setCardCounts.get(set.id).set(key, curr + 1);
    };

    // Order pools according to strategy
    if (strategy === 'balanced') {
      // Sort hits descending by price to balance value
      hitCandidates.sort((a, b) => (b.lastPrice || 0) - (a.lastPrice || 0));
      // Sort base cards descending by price
      baseCandidates.sort((a, b) => (b.lastPrice || 0) - (a.lastPrice || 0));
    } else if (strategy === 'random') {
      hitCandidates.sort(() => Math.random() - 0.5);
      baseCandidates.sort(() => Math.random() - 0.5);
    } else {
      // sequential: preserve original CSV index
      hitCandidates.sort((a, b) => (a.originalIndex || 0) - (b.originalIndex || 0));
      baseCandidates.sort((a, b) => (a.originalIndex || 0) - (b.originalIndex || 0));
    }

    const assignedCardIds = new Set();

    // 1. Distribute EXACTLY hitsPerSet Guaranteed Hits per set
    if (useHitRule && hitsPerSet > 0) {
      for (let h = 0; h < hitsPerSet; h++) {
        for (let s = 0; s < createdSets.length; s++) {
          // Serpentine / snake distribution in balanced mode
          const setIndex = strategy === 'balanced' && h % 2 === 1 ? createdSets.length - 1 - s : s;
          const targetSet = createdSets[setIndex];

          let candidateIdx = -1;
          for (let i = 0; i < hitCandidates.length; i++) {
            if (canAddCardToSet(targetSet, hitCandidates[i])) {
              candidateIdx = i;
              break;
            }
          }

          if (candidateIdx !== -1) {
            const [card] = hitCandidates.splice(candidateIdx, 1);
            recordCardInSet(targetSet, card);
            card.setId = targetSet.id;
            targetSet.cards.push(card);
            assignedCardIds.add(card.id);
          }
        }
      }
    }

    // 2. Fill remaining regular slots strictly from baseCandidates (so hits count is EXACT and duplicates are limited)
    const generalFillPool = [...baseCandidates];
    if (strategy === 'balanced') {
      generalFillPool.sort((a, b) => (b.lastPrice || 0) - (a.lastPrice || 0));
    } else if (strategy === 'sequential') {
      generalFillPool.sort((a, b) => (a.originalIndex || 0) - (b.originalIndex || 0));
    } else if (strategy === 'random') {
      generalFillPool.sort(() => Math.random() - 0.5);
    }

    for (let slot = 0; slot < packSize; slot++) {
      for (let s = 0; s < createdSets.length; s++) {
        const targetSet = createdSets[s];
        if (targetSet.cards.length < packSize && generalFillPool.length > 0) {
          let candidateIdx = -1;
          for (let i = 0; i < generalFillPool.length; i++) {
            if (canAddCardToSet(targetSet, generalFillPool[i])) {
              candidateIdx = i;
              break;
            }
          }

          if (candidateIdx !== -1) {
            const [card] = generalFillPool.splice(candidateIdx, 1);
            recordCardInSet(targetSet, card);
            card.setId = targetSet.id;
            targetSet.cards.push(card);
            assignedCardIds.add(card.id);
          }
        }
      }
    }

    if (append) {
      this.sets = [...existingSets, ...createdSets];
    } else {
      this.sets = createdSets;
    }

    // Identify unallocated cards from the total pool
    const unallocatedCards = cards.filter((c) => !c.setId);

    return {
      sets: this.sets,
      newSets: createdSets,
      unallocatedCards,
      totalSets: this.sets.length,
      totalAssigned: cards.filter((c) => c.setId).length,
    };
  }

  /**
   * Calculates comprehensive metrics for a set
   */
  calculateSetStats(set, minHitThreshold = 5.0) {
    if (!set || !Array.isArray(set.cards)) {
      return {
        cardCount: 0,
        targetSize: 10,
        totalValue: 0,
        avgPrice: 0,
        hitCount: 0,
        topCard: null,
        isFull: false,
      };
    }

    let total = 0;
    let hits = 0;
    let topCard = null;
    let maxVal = -1;

    set.cards.forEach((card) => {
      const p = typeof card.lastPrice === 'number' ? card.lastPrice : 0;
      total += p;
      if (p >= minHitThreshold) hits++;
      if (p > maxVal) {
        maxVal = p;
        topCard = card;
      }
    });

    const count = set.cards.length;
    const targetSize = set.targetSize || this.defaultPackSize || 10;

    return {
      cardCount: count,
      targetSize,
      totalValue: total,
      avgPrice: count > 0 ? total / count : 0,
      hitCount: hits,
      topCard,
      isFull: count >= targetSize,
    };
  }

  /**
   * Exports a single set to standard Enriched CSV with original CSV index and slot sequence
   */
  exportSetToEnrichedCSV(set) {
    if (!set || !Array.isArray(set.cards) || set.cards.length === 0) return null;

    const headers = [
      'Set Name',
      'Pipeline #',
      'Original CSV #',
      'Card Code',
      'Name',
      'File',
      'Condition',
      'Language',
      'Last Price (€)',
      'Last Check',
      'Filter Info',
      'Status',
    ];

    const rows = set.cards.map((item, pos) => {
      const exportNum = pos + 1;
      const formattedTitle = formatExportTitle(item.nameDe || item.detectedName || item.rawName, '', exportNum);
      const origIdx = item.originalIndex !== undefined ? item.originalIndex : item.index || exportNum;
      return [
        `"${set.name}"`,
        exportNum,
        origIdx,
        `"${item.detectedCode || ''}"`,
        `"${formattedTitle}"`,
        `"${item.rawFile || ''}"`,
        `"${item.rawCondition || 'Near Mint'}"`,
        `"${item.rawLanguage || 'EN'}"`,
        item.lastPrice !== null && item.lastPrice !== undefined ? item.lastPrice.toFixed(2) : '',
        `"${item.lastCheckRelative || item.lastCheckDate || 'Kein Check'}"`,
        `"${item.filterInfo || ''}"`,
        `"${item.status}"`,
      ];
    });

    return [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
  }

  /**
   * Exports all sets into one combined standard Enriched CSV with sequential pipeline numbering
   */
  exportAllSetsToEnrichedCSV() {
    if (this.sets.length === 0) return null;

    const headers = [
      'Set Name',
      'Pipeline #',
      'Set Position',
      'Original CSV #',
      'Card Code',
      'Name',
      'File',
      'Condition',
      'Language',
      'Last Price (€)',
      'Last Check',
      'Filter Info',
      'Status',
    ];

    const rows = [];
    let globalExportIndex = 1;

    this.sets.forEach((set) => {
      set.cards.forEach((item, pos) => {
        const exportNum = globalExportIndex++;
        const formattedTitle = formatExportTitle(item.nameDe || item.detectedName || item.rawName, '', exportNum);
        const origIdx = item.originalIndex !== undefined ? item.originalIndex : item.index || pos + 1;
        rows.push([
          `"${set.name}"`,
          exportNum,
          pos + 1,
          origIdx,
          `"${item.detectedCode || ''}"`,
          `"${formattedTitle}"`,
          `"${item.rawFile || ''}"`,
          `"${item.rawCondition || 'Near Mint'}"`,
          `"${item.rawLanguage || 'EN'}"`,
          item.lastPrice !== null && item.lastPrice !== undefined ? item.lastPrice.toFixed(2) : '',
          `"${item.lastCheckRelative || item.lastCheckDate || 'Kein Check'}"`,
          `"${item.filterInfo || ''}"`,
          `"${item.status}"`,
        ]);
      });
    });

    return [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
  }

  /**
   * Exports a single set to Whatnot 21-column CSV format with ascending numbers in titles (#1, #2, ...)
   */
  exportSetToWhatnotCSV(set) {
    if (!set || !Array.isArray(set.cards) || set.cards.length === 0) return null;

    const headerRow = WHATNOT_COLUMNS.map(escapeCsvCell).join(',');
    const rows = set.cards.map((item, pos) => {
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

      const origIdx = item.originalIndex !== undefined ? item.originalIndex : item.index || pos + 1;
      const exportNum = pos + 1;
      const title = formatExportTitle(w.titel, item.detectedName || item.rawName, exportNum);
      const sku = `SET-${set.name.replace(/[^A-Za-z0-9]/g, '')}-P${String(exportNum).padStart(3, '0')}-CSV#${origIdx}`;

      const cells = [
        w.kategorie || 'Trading Card Games',
        w.unterkategorie || (item.tcg === 'OnePiece' ? 'One-Piece-Karten' : 'Pokémon-Karten'),
        title,
        w.beschreibung || `Set: ${set.name} | Position: ${exportNum}/${set.cards.length} | Ursprüngliche CSV #${origIdx}`,
        w.menge ?? item.quantity ?? 1,
        w.verkaufsformat || 'Auktion',
        priceVal,
        w.versandprofil || 'Single (15 g)',
        offerValue,
        w.gefahrgut || 'Not Hazmat',
        w.zustand || (item.rawCondition === 'NM' ? 'Near Mint' : item.rawCondition) || 'Near Mint',
        w.stueckpreis || '',
        sku,
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

    return '\uFEFF' + [headerRow, ...rows].join('\r\n');
  }

  /**
   * Exports all sets to Whatnot 21-column CSV format with sequential pipeline numbers across all sets (#1 to #200)
   */
  exportAllSetsToWhatnotCSV() {
    if (this.sets.length === 0) return null;

    const headerRow = WHATNOT_COLUMNS.map(escapeCsvCell).join(',');
    const rows = [];
    let globalExportIndex = 1;

    this.sets.forEach((set) => {
      set.cards.forEach((item, pos) => {
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

        const origIdx = item.originalIndex !== undefined ? item.originalIndex : item.index || pos + 1;
        const exportNum = globalExportIndex++;
        const title = formatExportTitle(w.titel, item.detectedName || item.rawName, exportNum);
        const sku = `SET-${set.name.replace(/[^A-Za-z0-9]/g, '')}-P${String(pos + 1).padStart(3, '0')}-ALL#${String(exportNum).padStart(3, '0')}-CSV#${origIdx}`;

        const cells = [
          w.kategorie || 'Trading Card Games',
          w.unterkategorie || (item.tcg === 'OnePiece' ? 'One-Piece-Karten' : 'Pokémon-Karten'),
          title,
          w.beschreibung || `Set: ${set.name} | Position: ${pos + 1}/${set.cards.length} | Pipeline #${exportNum} | Ursprüngliche CSV #${origIdx}`,
          w.menge ?? item.quantity ?? 1,
          w.verkaufsformat || 'Auktion',
          priceVal,
          w.versandprofil || 'Single (15 g)',
          offerValue,
          w.gefahrgut || 'Not Hazmat',
          w.zustand || (item.rawCondition === 'NM' ? 'Near Mint' : item.rawCondition) || 'Near Mint',
          w.stueckpreis || '',
          sku,
          w.bildUrl1 || item.imageUrl || '',
          w.bildUrl2 || item.imageBackUrl || '',
          w.bildUrl3 || '',
          w.bildUrl4 || '',
          w.bildUrl5 || '',
          w.bildUrl6 || '',
          w.bildUrl7 || '',
          w.bildUrl8 || '',
        ];
        rows.push(cells.map(escapeCsvCell).join(','));
      });
    });

    return '\uFEFF' + [headerRow, ...rows].join('\r\n');
  }
}
