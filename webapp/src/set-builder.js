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
 * Returns a normalized character / Pokemon species identity string (e.g. 'pikachu', 'glurak', 'monkey d. luffy')
 */
export function getCardSpeciesKey(card) {
  if (!card) return 'unknown';

  let name = (card.nameDe || card.detectedName || card.nameEn || card.rawName || '').trim();
  if (!name) return 'unknown';

  // Strip set code, card number prefix/postfix, bracketed/parenthesized info
  let clean = name
    .replace(/^#\d+\s+/, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .trim();

  // Strip trailing card rarity/variant suffixes e.g. "ex", "GX", "VMAX", "VSTAR", "V", "Prime", "Break"
  clean = clean.replace(/\s+\b(ex|gx|vmax|vstar|v-union|v|break|lv\.x|prime|legend|radiant|shining|strahlendes|prisma|tera|star|δ)\b/gi, '').trim();

  return clean.toLowerCase() || name.toLowerCase();
}

/**
 * Evenly disperses duplicate cards and duplicate species across the entire array
 * to maximize the minimum distance between any identical cards and prevent ABAB alternation.
 */
export function disperseAndSeparateDuplicates(cards) {
  if (!Array.isArray(cards) || cards.length <= 2) return cards || [];
  const N = cards.length;

  // 1. Group cards by identity key
  const groupsMap = new Map();
  cards.forEach((card) => {
    const k = getCardIdentityKey(card);
    if (!groupsMap.has(k)) groupsMap.set(k, []);
    groupsMap.get(k).push(card);
  });

  // Sort groups by size descending (largest duplicate buckets first)
  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => b.length - a.length);

  // Stride-based initial placement
  const slots = Array(N).fill(null);
  let globalOffset = 0;

  for (const group of sortedGroups) {
    const count = group.length;
    const stride = N / count;

    let bestStartOffset = 0;
    let minCollisions = Infinity;
    const stepCandidates = Math.min(24, Math.ceil(stride * 2));
    for (let o = 0; o < stepCandidates; o++) {
      const testOffset = (globalOffset + o * (stride / stepCandidates)) % stride;
      let collisions = 0;
      for (let j = 0; j < count; j++) {
        const idealPos = Math.floor(testOffset + j * stride) % N;
        if (slots[idealPos] !== null) collisions++;
      }
      if (collisions < minCollisions) {
        minCollisions = collisions;
        bestStartOffset = testOffset;
      }
    }

    for (let j = 0; j < count; j++) {
      const idealPos = Math.floor(bestStartOffset + j * stride) % N;
      for (let offset = 0; offset < N; offset++) {
        const idx1 = (idealPos + offset) % N;
        const idx2 = (idealPos - offset + N) % N;
        if (slots[idx1] === null) {
          slots[idx1] = group[j];
          break;
        }
        if (slots[idx2] === null) {
          slots[idx2] = group[j];
          break;
        }
      }
    }

    globalOffset = (globalOffset + stride / (sortedGroups.length || 1) + 1.61803398875) % N;
  }

  const initial = slots.filter((c) => c !== null);

  // 2. Fast score evaluation for distance penalty
  function scoreSequence(arr) {
    let penalty = 0;
    const lastIdent = new Map();
    const lastSpec = new Map();

    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      const kIdent = getCardIdentityKey(c);
      const kSpec = getCardSpeciesKey(c);

      if (lastIdent.has(kIdent)) {
        const d = i - lastIdent.get(kIdent);
        if (d === 1) penalty += 100000;
        else if (d === 2) penalty += 20000;
        else if (d === 3) penalty += 5000;
      }
      if (lastSpec.has(kSpec)) {
        const d = i - lastSpec.get(kSpec);
        if (d === 1) penalty += 50000;
        else if (d === 2) penalty += 10000;
        else if (d === 3) penalty += 2000;
      }

      lastIdent.set(kIdent, i);
      lastSpec.set(kSpec, i);
    }
    return penalty;
  }

  // 3. Targeted collision-swap refinement pass
  let best = [...initial];
  let bestScore = scoreSequence(best);
  if (bestScore === 0) return best;

  let improved = true;
  let iterations = 0;
  const maxIterations = 20;

  while (improved && iterations < maxIterations && bestScore > 0) {
    improved = false;
    iterations++;

    // Find indices with collisions
    const collisionIndices = [];
    const lastIdent = new Map();
    const lastSpec = new Map();

    for (let i = 0; i < N; i++) {
      const c = best[i];
      const kIdent = getCardIdentityKey(c);
      const kSpec = getCardSpeciesKey(c);

      if (lastIdent.has(kIdent) && i - lastIdent.get(kIdent) <= 3) {
        collisionIndices.push(i);
      } else if (lastSpec.has(kSpec) && i - lastSpec.get(kSpec) <= 3) {
        collisionIndices.push(i);
      }

      lastIdent.set(kIdent, i);
      lastSpec.set(kSpec, i);
    }

    if (collisionIndices.length === 0) break;

    for (const i of collisionIndices) {
      // Test swapping with candidates across the array
      const step = Math.max(1, Math.floor(N / 25));
      for (let j = 0; j < N; j += step) {
        if (i === j) continue;

        const temp = best[i];
        best[i] = best[j];
        best[j] = temp;

        const newScore = scoreSequence(best);
        if (newScore < bestScore) {
          bestScore = newScore;
          improved = true;
          if (bestScore === 0) break;
        } else {
          best[j] = best[i];
          best[i] = temp;
        }
      }
      if (bestScore === 0) break;
    }
  }

  return best;
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
   * Rearranges cards in a set so that duplicates are evenly spaced at maximum possible distance
   * without adjacent repetitions or ABAB alternation.
   */
  separateDuplicates(setId) {
    const set = this.getSet(setId);
    if (!set || !Array.isArray(set.cards) || set.cards.length <= 1) return false;

    set.cards = disperseAndSeparateDuplicates(set.cards);
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
   * Balances the average card price across all given sets using multi-way 2-opt swaps.
   * Ensures that sets with different or equal capacities achieve a nearly identical average card price (€/card)
   * while respecting maximum duplicate constraints.
   */
  balanceSetsAverageValue(setsToBalance = null, maxDuplicates = null) {
    const targetSets = setsToBalance || this.sets;
    if (!Array.isArray(targetSets) || targetSets.length <= 1) return targetSets;

    // Filter sets that have cards
    const activeSets = targetSets.filter((s) => Array.isArray(s.cards) && s.cards.length > 0);
    if (activeSets.length <= 1) return targetSets;

    // Helper to calculate total value and average price for a set
    const getSetStats = (set) => {
      const total = set.cards.reduce((sum, c) => sum + (typeof c.lastPrice === 'number' ? c.lastPrice : 0), 0);
      const count = set.cards.length;
      return { total, count, avg: count > 0 ? total / count : 0 };
    };

    // Calculate global target average across all active sets
    let totalCardsAll = 0;
    let totalValueAll = 0;
    activeSets.forEach((s) => {
      const stats = getSetStats(s);
      totalCardsAll += stats.count;
      totalValueAll += stats.total;
    });

    if (totalCardsAll === 0) return targetSets;
    const globalTargetAvg = totalValueAll / totalCardsAll;

    // Helper to check if swapping cardA from setA with cardB from setB violates maxDuplicates
    const isSwapDuplicateSafe = (setA, cardA, setB, cardB) => {
      if (!maxDuplicates || maxDuplicates <= 0) return true;
      const keyA = getCardIdentityKey(cardA);
      const keyB = getCardIdentityKey(cardB);

      // If both cards have the same identity, counts don't change
      if (keyA === keyB) return true;

      // Check setA when receiving cardB
      const countBInA = setA.cards.filter((c) => c !== cardA && getCardIdentityKey(c) === keyB).length;
      if (countBInA + 1 > maxDuplicates) return false;

      // Check setB when receiving cardA
      const countAInB = setB.cards.filter((c) => c !== cardB && getCardIdentityKey(c) === keyA).length;
      if (countAInB + 1 > maxDuplicates) return false;

      return true;
    };

    // Total variance helper: sum of squared error from target average
    const calculateTotalVariance = () => {
      let variance = 0;
      activeSets.forEach((s) => {
        const stats = getSetStats(s);
        variance += Math.pow(stats.avg - globalTargetAvg, 2) * stats.count;
      });
      return variance;
    };

    let currentVariance = calculateTotalVariance();
    let improved = true;
    let iterations = 0;
    const maxIterations = 200;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      // Sort sets by average price descending
      const setStatsList = activeSets.map((s) => ({ set: s, ...getSetStats(s) }));
      setStatsList.sort((a, b) => b.avg - a.avg);

      const highestSet = setStatsList[0];
      const lowestSet = setStatsList[setStatsList.length - 1];

      // If difference between highest and lowest is negligible (< 1 Cent), stop
      if (highestSet.avg - lowestSet.avg < 0.01) {
        break;
      }

      let bestSwap = null;
      let bestVarianceGain = 0;

      // Try pairs of sets: prioritize highest avg set with lowest avg set
      for (let i = 0; i < setStatsList.length - 1; i++) {
        for (let j = setStatsList.length - 1; j > i; j--) {
          const setHigh = setStatsList[i].set;
          const setLow = setStatsList[j].set;
          const avgHigh = setStatsList[i].avg;
          const avgLow = setStatsList[j].avg;

          if (avgHigh - avgLow < 0.01) continue;

          for (let idxH = 0; idxH < setHigh.cards.length; idxH++) {
            const cardH = setHigh.cards[idxH];
            const priceH = typeof cardH.lastPrice === 'number' ? cardH.lastPrice : 0;

            for (let idxL = 0; idxL < setLow.cards.length; idxL++) {
              const cardL = setLow.cards[idxL];
              const priceL = typeof cardL.lastPrice === 'number' ? cardL.lastPrice : 0;

              const priceDiff = priceH - priceL;
              if (priceDiff <= 0.01) continue; // High set must give a more expensive card to low set

              if (!isSwapDuplicateSafe(setHigh, cardH, setLow, cardL)) continue;

              // Simulate swap
              const newTotalHigh = setStatsList[i].total - priceDiff;
              const newAvgHigh = newTotalHigh / setStatsList[i].count;
              const newTotalLow = setStatsList[j].total + priceDiff;
              const newAvgLow = newTotalLow / setStatsList[j].count;

              // Old pairwise error vs new pairwise error
              const oldPairError =
                Math.pow(avgHigh - globalTargetAvg, 2) * setStatsList[i].count +
                Math.pow(avgLow - globalTargetAvg, 2) * setStatsList[j].count;
              const newPairError =
                Math.pow(newAvgHigh - globalTargetAvg, 2) * setStatsList[i].count +
                Math.pow(newAvgLow - globalTargetAvg, 2) * setStatsList[j].count;

              const varianceGain = oldPairError - newPairError;
              if (varianceGain > 0.0001 && varianceGain > bestVarianceGain) {
                bestVarianceGain = varianceGain;
                bestSwap = { setHigh, idxH, cardH, setLow, idxL, cardL };
              }
            }
          }

          if (bestSwap) break; // Found a good swap for this step
        }
        if (bestSwap) break;
      }

      if (bestSwap) {
        // Execute the swap
        const { setHigh, idxH, cardH, setLow, idxL, cardL } = bestSwap;
        setHigh.cards[idxH] = cardL;
        cardL.setId = setHigh.id;

        setLow.cards[idxL] = cardH;
        cardH.setId = setLow.id;

        currentVariance = calculateTotalVariance();
        improved = true;
      }
    }

    return targetSets;
  }

  /**
   * Rebalances average card values across all existing sets and separates duplicates
   */
  balanceExistingSets(allCards = [], maxDuplicates = null) {
    if (this.sets.length <= 1) return { sets: this.sets, iterations: 0 };

    this.balanceSetsAverageValue(this.sets, maxDuplicates);

    // Re-run intra-set duplicate separation on each set
    this.sets.forEach((set) => {
      set.cards = disperseAndSeparateDuplicates(set.cards);
    });

    return { sets: this.sets };
  }

  /**
   * Automatic Set Generator based on configurable criteria
   * Supports uniform pack sizes as well as custom multi-pipeline definitions (e.g. 2x 100 + 1x 200).
   */
  generateSets(cards, config = {}) {
    if (!Array.isArray(cards) || cards.length === 0) {
      return { sets: [], unallocatedCards: [], totalSets: 0, totalAssigned: 0 };
    }

    const useHitRule = !!config.useHitRule;
    const minHitPrice = typeof config.minHitPrice === 'number' ? config.minHitPrice : 5.0;
    const hitsPerSet = useHitRule ? Math.max(1, parseInt(config.hitsPerSet, 10) || 1) : 0;
    const proportionalHits = config.proportionalHits !== false; // true by default
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

    const useMaxDuplicates =
      config.useMaxDuplicates !== false && config.useMaxDuplicates !== undefined
        ? !!config.useMaxDuplicates
        : typeof config.maxDuplicates === 'number' && config.maxDuplicates > 0;
    const maxDuplicates = useMaxDuplicates && config.maxDuplicates > 0 ? parseInt(config.maxDuplicates, 10) : null;

    // 1. Build set definitions (either from config.customSets or uniform packSize)
    const customSetsConfig = Array.isArray(config.customSets) && config.customSets.length > 0 ? config.customSets : null;
    const createdSets = [];

    if (customSetsConfig) {
      customSetsConfig.forEach((cs, i) => {
        const targetSize = Math.max(1, parseInt(cs.targetSize || cs.size, 10) || 10);
        const setNum = baseOffset + i + 1;
        const setName = (cs.name && cs.name.trim()) || `${namePrefix}${setNum}`;
        createdSets.push({
          id: `set_${Date.now()}_${setNum}_${Math.random().toString(36).slice(2, 6)}`,
          name: setName,
          targetSize: targetSize,
          cards: [],
          createdAt: Date.now(),
        });
      });
    } else {
      const packSize = Math.max(1, parseInt(config.packSize, 10) || 10);
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
    }

    if (createdSets.length === 0) {
      return {
        sets: this.sets,
        unallocatedCards: pool,
        totalSets: this.sets.length,
        totalAssigned: cards.filter((c) => c.setId).length,
        error: 'Keine Sets definiert.',
      };
    }

    const totalTargetCards = createdSets.reduce((sum, s) => sum + s.targetSize, 0);
    const totalAvailableCards = hitCandidates.length + baseCandidates.length;

    if (totalAvailableCards < totalTargetCards) {
      return {
        sets: this.sets,
        unallocatedCards: pool,
        totalSets: this.sets.length,
        totalAssigned: cards.filter((c) => c.setId).length,
        error: `Nicht genügend Karten im Pool vorhanden. Benötigt: ${totalTargetCards} Karten, Verfügbar: ${totalAvailableCards} Karten.`,
      };
    }

    // Track card duplicate counts and Pokemon species counts per set
    const setCardCounts = new Map();
    const setSpeciesCounts = new Map();
    createdSets.forEach((s) => {
      setCardCounts.set(s.id, new Map());
      setSpeciesCounts.set(s.id, new Map());
    });

    const canAddCardToSet = (set, card) => {
      if (set.cards.length >= set.targetSize) return false;
      if (!maxDuplicates || maxDuplicates <= 0) return true;
      const key = getCardIdentityKey(card);
      const curr = setCardCounts.get(set.id)?.get(key) || 0;
      return curr < maxDuplicates;
    };

    const recordCardInSet = (set, card) => {
      const key = getCardIdentityKey(card);
      const specKey = getCardSpeciesKey(card);
      const curr = setCardCounts.get(set.id)?.get(key) || 0;
      const currSpec = setSpeciesCounts.get(set.id)?.get(specKey) || 0;
      setCardCounts.get(set.id).set(key, curr + 1);
      setSpeciesCounts.get(set.id).set(specKey, currSpec + 1);
    };

    // Calculate pool target average value
    const allAvailableCandidates = [...hitCandidates, ...baseCandidates];
    const totalPoolValue = allAvailableCandidates.reduce((sum, c) => sum + (c.lastPrice || 0), 0);
    const globalTargetAvg = allAvailableCandidates.length > 0 ? totalPoolValue / allAvailableCandidates.length : 0;

    // Helper to calculate current set total value
    const getSetCurrentTotal = (set) => {
      return set.cards.reduce((sum, c) => sum + (c.lastPrice || 0), 0);
    };

    // 2. Determine Hit Quotas per set
    const setHitQuotas = new Map();
    if (useHitRule && hitsPerSet > 0) {
      const baseRefSize = Math.min(...createdSets.map((s) => s.targetSize));
      createdSets.forEach((s) => {
        let quota = hitsPerSet;
        if (proportionalHits && baseRefSize > 0) {
          quota = Math.max(1, Math.round(hitsPerSet * (s.targetSize / baseRefSize)));
        }
        setHitQuotas.set(s.id, quota);
      });
    } else {
      createdSets.forEach((s) => setHitQuotas.set(s.id, 0));
    }

    // Sort candidates according to strategy
    if (strategy === 'balanced') {
      hitCandidates.sort((a, b) => (b.lastPrice || 0) - (a.lastPrice || 0));
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

    // 3. Distribute Hit Cards
    if (useHitRule && hitsPerSet > 0) {
      // Track hits assigned per set
      const hitsAssigned = new Map();
      createdSets.forEach((s) => hitsAssigned.set(s.id, 0));

      let hitsRemaining = true;
      while (hitsRemaining && hitCandidates.length > 0) {
        let assignedAny = false;

        // In balanced mode, assign from most expensive hit to set that has hit quota and lowest relative value
        for (let i = 0; i < hitCandidates.length; i++) {
          const hitCard = hitCandidates[i];
          const hitPrice = hitCard.lastPrice || 0;

          // Find eligible sets that still need hits
          const eligibleSets = createdSets.filter((s) => {
            const currentHits = hitsAssigned.get(s.id) || 0;
            const quota = setHitQuotas.get(s.id) || 0;
            return currentHits < quota && canAddCardToSet(s, hitCard);
          });

          if (eligibleSets.length === 0) continue;

          // Score eligible sets: in balanced mode, pick set with highest normalized deficit
          let chosenSet = eligibleSets[0];
          if (strategy === 'balanced') {
            let minProjNormalizedVal = Infinity;
            for (const s of eligibleSets) {
              const currentTotal = getSetCurrentTotal(s);
              const targetSetTotal = s.targetSize * globalTargetAvg;
              const normalizedVal = (currentTotal + hitPrice) / (targetSetTotal || 1);
              if (normalizedVal < minProjNormalizedVal) {
                minProjNormalizedVal = normalizedVal;
                chosenSet = s;
              }
            }
          }

          // Assign hit card
          hitCandidates.splice(i, 1);
          i--;
          recordCardInSet(chosenSet, hitCard);
          hitCard.setId = chosenSet.id;
          chosenSet.cards.push(hitCard);
          assignedCardIds.add(hitCard.id);
          hitsAssigned.set(chosenSet.id, (hitsAssigned.get(chosenSet.id) || 0) + 1);
          assignedAny = true;
        }

        if (!assignedAny) {
          hitsRemaining = false;
        }
      }
    }

    // 4. Distribute Remaining Cards (Hits overflow + Base Cards)
    const remainingCardsPool = [...hitCandidates, ...baseCandidates];
    if (strategy === 'balanced') {
      remainingCardsPool.sort((a, b) => (b.lastPrice || 0) - (a.lastPrice || 0));
    } else if (strategy === 'random') {
      remainingCardsPool.sort(() => Math.random() - 0.5);
    } else {
      remainingCardsPool.sort((a, b) => (a.originalIndex || 0) - (b.originalIndex || 0));
    }

    // Helper to find best candidate set for a card in balanced mode
    const findBestSetForCard = (card) => {
      const cardPrice = card.lastPrice || 0;
      const specKey = getCardSpeciesKey(card);

      const eligibleSets = createdSets.filter((s) => canAddCardToSet(s, card));
      if (eligibleSets.length === 0) return null;

      if (strategy === 'sequential' || strategy === 'random') {
        // Find first set with remaining capacity
        return eligibleSets[0];
      }

      // Balanced mode: score by proximity to target set average and species diversity
      let bestSet = null;
      let bestScore = Infinity;

      for (const s of eligibleSets) {
        const currentCount = s.cards.length;
        const currentTotal = getSetCurrentTotal(s);
        const projectedAvg = (currentTotal + cardPrice) / (currentCount + 1);

        // Value deviation penalty
        const valueDeviation = Math.pow(projectedAvg - globalTargetAvg, 2);

        // Species diversity factor
        const specCount = setSpeciesCounts.get(s.id)?.get(specKey) || 0;
        const diversityPenalty = specCount * 0.05;

        const score = valueDeviation + diversityPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestSet = s;
        }
      }

      return bestSet || eligibleSets[0];
    };

    while (remainingCardsPool.length > 0) {
      // Check if all sets are full
      const openSets = createdSets.filter((s) => s.cards.length < s.targetSize);
      if (openSets.length === 0) break;

      const card = remainingCardsPool.shift();
      const targetSet = findBestSetForCard(card);

      if (targetSet) {
        recordCardInSet(targetSet, card);
        card.setId = targetSet.id;
        targetSet.cards.push(card);
        assignedCardIds.add(card.id);
      }
    }

    // 5. Post-Allocation Value Balancing & Swap Optimization (in balanced mode)
    if (strategy === 'balanced') {
      this.balanceSetsAverageValue(createdSets, maxDuplicates);
    }

    // 6. Evenly disperse duplicates across each created set for optimal spacing
    createdSets.forEach((s) => {
      s.cards = disperseAndSeparateDuplicates(s.cards);
    });

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
