/**
 * TCG Set & Mystery Pack Builder
 * Handles custom pack/set generation, drag-and-drop card reordering,
 * per-card set assignment, and multi-format CSV exports with immutable
 * original CSV row index preservation.
 */

import { WHATNOT_COLUMNS } from './csv-parser.js';
import { escapeCsvCell } from './bulk-scanner.js';

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

    // Clone available cards and preserve originalIndex
    const pool = cards.map((c, i) => {
      if (c.originalIndex === undefined || c.originalIndex === null) {
        c.originalIndex = c.index !== undefined ? c.index : i + 1;
      }
      c.setId = null;
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

    // Determine total number of possible complete sets
    let totalPossibleSets = 0;
    if (useHitRule && hitsPerSet > 0) {
      const maxSetsByHits = Math.floor(hitCandidates.length / hitsPerSet);
      if (useBaseRange) {
        const remainingNeededPerSet = packSize - hitsPerSet;
        const maxSetsByBase = remainingNeededPerSet > 0 ? Math.floor(baseCandidates.length / remainingNeededPerSet) : maxSetsByHits;
        totalPossibleSets = Math.min(maxSetsByHits, maxSetsByBase);
      } else {
        // Excess hits can also fill remaining regular slots
        const totalEligibleCards = hitCandidates.length + baseCandidates.length;
        const maxSetsByTotal = Math.floor(totalEligibleCards / packSize);
        totalPossibleSets = Math.min(maxSetsByHits, maxSetsByTotal);
      }
    } else {
      totalPossibleSets = Math.floor((hitCandidates.length + baseCandidates.length) / packSize);
    }

    if (config.maxSets && typeof config.maxSets === 'number' && config.maxSets > 0) {
      totalPossibleSets = Math.min(totalPossibleSets, config.maxSets);
    }

    if (totalPossibleSets <= 0) {
      return {
        sets: [],
        unallocatedCards: pool,
        totalSets: 0,
        totalAssigned: 0,
        error: 'Nicht genügend passende Karten im Pool für die gewählten Kriterien.',
      };
    }

    // Initialize set buckets
    const createdSets = [];
    for (let i = 0; i < totalPossibleSets; i++) {
      createdSets.push({
        id: `set_${Date.now()}_${i + 1}_${Math.random().toString(36).slice(2, 6)}`,
        name: `${namePrefix}${i + 1}`,
        targetSize: packSize,
        cards: [],
        createdAt: Date.now(),
      });
    }

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

    // 1. Distribute Guaranteed Hits
    if (useHitRule && hitsPerSet > 0) {
      for (let h = 0; h < hitsPerSet; h++) {
        for (let s = 0; s < createdSets.length; s++) {
          // Serpentine / snake distribution in balanced mode
          const setIndex = strategy === 'balanced' && h % 2 === 1 ? createdSets.length - 1 - s : s;
          if (hitCandidates.length > 0) {
            const card = hitCandidates.shift();
            card.setId = createdSets[setIndex].id;
            createdSets[setIndex].cards.push(card);
            assignedCardIds.add(card.id);
          }
        }
      }
    }

    // Combine remaining hit candidates into base pool if any were left over
    const generalFillPool = [...hitCandidates, ...baseCandidates];
    if (strategy === 'balanced') {
      generalFillPool.sort((a, b) => (b.lastPrice || 0) - (a.lastPrice || 0));
    } else if (strategy === 'sequential') {
      generalFillPool.sort((a, b) => (a.originalIndex || 0) - (b.originalIndex || 0));
    }

    // 2. Fill remaining slots per set up to packSize
    for (let slot = 0; slot < packSize; slot++) {
      for (let s = 0; s < createdSets.length; s++) {
        const set = createdSets[s];
        if (set.cards.length < packSize && generalFillPool.length > 0) {
          const card = generalFillPool.shift();
          card.setId = set.id;
          set.cards.push(card);
          assignedCardIds.add(card.id);
        }
      }
    }

    // Identify unallocated cards
    const unallocatedCards = pool.filter((c) => !assignedCardIds.has(c.id));

    this.sets = createdSets;

    return {
      sets: createdSets,
      unallocatedCards,
      totalSets: createdSets.length,
      totalAssigned: assignedCardIds.size,
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

    const rows = set.cards.map((item, pos) => [
      `"${set.name}"`,
      pos + 1,
      item.originalIndex !== undefined ? item.originalIndex : item.index || pos + 1,
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

  /**
   * Exports all sets into one combined standard Enriched CSV
   */
  exportAllSetsToEnrichedCSV() {
    if (this.sets.length === 0) return null;

    const headers = [
      'Set Name',
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
    this.sets.forEach((set) => {
      set.cards.forEach((item, pos) => {
        rows.push([
          `"${set.name}"`,
          pos + 1,
          item.originalIndex !== undefined ? item.originalIndex : item.index || pos + 1,
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
      });
    });

    return [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
  }

  /**
   * Exports a single set to Whatnot 21-column CSV format
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
      const sku = `SET-${set.name.replace(/[^A-Za-z0-9]/g, '')}-P${String(pos + 1).padStart(3, '0')}-CSV#${origIdx}`;

      const cells = [
        w.kategorie || 'Trading Card Games',
        w.unterkategorie || (item.tcg === 'OnePiece' ? 'One-Piece-Karten' : 'Pokémon-Karten'),
        w.titel || item.detectedName || item.rawName || '',
        w.beschreibung || `Set: ${set.name} | Position: ${pos + 1}/${set.cards.length} | Ursprüngliche CSV #${origIdx}`,
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
   * Exports all sets to Whatnot 21-column CSV format
   */
  exportAllSetsToWhatnotCSV() {
    if (this.sets.length === 0) return null;

    const headerRow = WHATNOT_COLUMNS.map(escapeCsvCell).join(',');
    const rows = [];

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
        const sku = `SET-${set.name.replace(/[^A-Za-z0-9]/g, '')}-P${String(pos + 1).padStart(3, '0')}-CSV#${origIdx}`;

        const cells = [
          w.kategorie || 'Trading Card Games',
          w.unterkategorie || (item.tcg === 'OnePiece' ? 'One-Piece-Karten' : 'Pokémon-Karten'),
          w.titel || item.detectedName || item.rawName || '',
          w.beschreibung || `Set: ${set.name} | Position: ${pos + 1}/${set.cards.length} | Ursprüngliche CSV #${origIdx}`,
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
