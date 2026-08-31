import { getGermanCardDetails, formatCardMeta } from './tcg-translations.js';
import { extractCardCode, parseCardCodeComponents } from './csv-parser.js';

function getGameSlug(item, code = '') {
  const tcg = (item.detectedTcg || item.tcg || '').toLowerCase();
  const c = code.toUpperCase();
  if (tcg === 'onepiece' || tcg === 'one piece' || c.startsWith('OP') || c.startsWith('ST') || c.startsWith('EB') || c.startsWith('PRB')) return 'OnePiece';
  if (tcg === 'yugioh' || tcg === 'yu-gi-oh') return 'YuGiOh';
  if (tcg === 'lorcana') return 'Lorcana';
  if (tcg === 'dragonball' || tcg === 'dragon ball' || c.startsWith('FB') || c.startsWith('FS') || c.startsWith('BT')) return 'DragonBall';
  if (tcg === 'magic' || tcg === 'mtg') return 'Magic';
  if (tcg === 'starwarsunlimited' || tcg === 'star wars') return 'StarWarsUnlimited';
  if (tcg === 'digimon') return 'Digimon';
  return 'Pokemon';
}

export function getCardmarketSearchUrl(item) {
  if (item.cardDetails?.cardmarket_url) {
    const path = item.cardDetails.cardmarket_url.startsWith('/') ? item.cardDetails.cardmarket_url : `/${item.cardDetails.cardmarket_url}`;
    return `https://www.cardmarket.com${path}`;
  }

  const rawFullName = item.detectedName || item.rawName || '';
  let code = (item.detectedCode || item.rawCode || '').trim();
  if (!code && rawFullName) {
    code = extractCardCode(rawFullName) || '';
  }

  let searchQuery = '';

  const parsedComp = parseCardCodeComponents(code, rawFullName, item.rawSet || item.setNameDe || item.set);
  if (parsedComp) {
    const cardNum = parsedComp.cardNumPad || parsedComp.cardNum;
    // 1. Asian Compound Codes (e.g. CBB4C 2306/07 or CBB4C 2306 -> CBB4C23)
    if (parsedComp.isCompound && parsedComp.setCardCode) {
      searchQuery = parsedComp.setCardCode; // e.g. 'CBB4C23', 'CBB1C07'
    } else if (parsedComp.setCode && cardNum) {
      if (/^(OP|ST|EB|PRB|FB|FS|BT|RA|LOB|MP)\d*/i.test(parsedComp.setCode)) {
        searchQuery = `${parsedComp.setCode}-${cardNum}`;
      } else {
        searchQuery = `${parsedComp.setCode}${cardNum}`;
      }
    }
  }

  if (!searchQuery && code) {
    // 1. If code contains set code + number (e.g. "CBB4C 2805", "CBB4C 2805/07", "sv2a 173", "PAF 091/091")
    const setNumMatch = code.match(/^([A-Za-z0-9\-_]{2,10})[-\s]+(\d{1,4})(?:[\/-]\d{1,4})?$/);
    if (setNumMatch) {
      const setPrefix = setNumMatch[1].toUpperCase();
      const cardNum = setNumMatch[2];
      if (/^(OP|ST|EB|PRB|FB|FS|BT|RA|LOB|MP)\d*/i.test(setPrefix)) {
        searchQuery = `${setPrefix}-${cardNum}`;
      } else {
        searchQuery = `${setPrefix}${cardNum}`;
      }
    } else if (/^[A-Za-z0-9]{2,6}[-\s]+[A-Za-z0-9\-]+$/.test(code)) {
      searchQuery = code.replace(/\/\d+$/, '');
    } else if (/^\d{1,4}\/\d{2,4}$/.test(code) || /^\d+$/.test(code)) {
      searchQuery = cleanName ? `${cleanName} ${code}` : code;
    } else {
      searchQuery = code.replace(/^([A-Za-z0-9]{2,6})\s+(\d{1,4})/i, '$1$2');
    }
  } else if (!searchQuery) {
    let cleanName = rawFullName.replace(/\([^)]*\)/g, '').split(/\s+LV\./i)[0].trim();
    if (!cleanName || cleanName.toLowerCase() === 'karte') cleanName = '';
    let cleanSet = (item.rawSet || item.setNameDe || item.cardDetails?.set_name || item.cardDetails?.expansion || '').trim();
    searchQuery = [cleanName, cleanSet].filter(Boolean).join(' ') || 'Karte';
  }

  const gameSlug = getGameSlug(item, code);
  const cmSearchUrl = new URL(`https://www.cardmarket.com/de/${gameSlug}/Products/Search`);
  cmSearchUrl.searchParams.set('searchString', searchQuery.trim());
  return cmSearchUrl.toString();
}

function getCountryFlag(countryCodeStr) {
  if (!countryCodeStr) return '🌐';
  const c = countryCodeStr.toUpperCase().trim();
  if (c === 'DE' || c === 'DEUTSCHLAND' || c === 'GERMANY') return '🇩🇪';
  if (c === 'EN' || c === 'UK' || c === 'GB' || c === 'GROSSBRITANNIEN') return '🇬🇧';
  if (c === 'US' || c === 'USA') return '🇺🇸';
  if (c === 'JP' || c === 'JAPAN') return '🇯🇵';
  if (c === 'FR' || c === 'FRANKREICH' || c === 'FRANCE') return '🇫🇷';
  if (c === 'IT' || c === 'ITALIEN' || c === 'ITALY') return '🇮🇹';
  if (c === 'ES' || c === 'SPANIEN' || c === 'SPAIN') return '🇪🇸';
  if (c === 'AT' || c === 'ÖSTERREICH' || c === 'AUSTRIA') return '🇦🇹';
  if (c === 'CH' || c === 'SCHWEIZ' || c === 'SWITZERLAND') return '🇨🇭';
  if (c === 'NL' || c === 'NIEDERLANDE' || c === 'NETHERLANDS') return '🇳🇱';
  if (c === 'ZH' || c === 'CHINA' || c === 'TAIWAN') return '🇨🇳';
  return '🌐';
}

function getLanguageFlag(langStr) {
  if (!langStr) return '🇬🇧';
  const l = langStr.toUpperCase().trim();
  if (l === 'DE' || l === 'DEUTSCH' || l === 'GERMAN') return '🇩🇪';
  if (l === 'EN' || l === 'ENGLISCH' || l === 'ENGLISH') return '🇬🇧';
  if (l === 'JP' || l === 'JAPANISCH' || l === 'JAPANESE') return '🇯🇵';
  if (l === 'FR' || l === 'FRANZÖSISCH' || l === 'FRENCH') return '🇫🇷';
  if (l === 'IT' || l === 'ITALIENISCH' || l === 'ITALIAN') return '🇮🇹';
  if (l === 'ES' || l === 'SPANISCH' || l === 'SPANISH') return '🇪🇸';
  if (l === 'ZH' || l === 'CHINESISCH' || l === 'CHINESE') return '🇨🇳';
  if (l === 'KO' || l === 'KOREANISCH' || l === 'KOREAN') return '🇰🇷';
  return '🌐';
}

function renderFilterBadges(filterInfo, rawCond, rawLang) {
  let cond = rawCond || 'NM';
  let sellerCountry = 'DE';
  let cardLang = rawLang || 'EN';

  if (filterInfo) {
    const parts = filterInfo.split(',').map(s => s.trim());
    if (parts.length >= 3) {
      cond = parts[0] || cond;
      sellerCountry = parts[1] || sellerCountry;
      cardLang = parts[2] || cardLang;
    } else if (filterInfo.includes('|')) {
      const partsAlt = filterInfo.replace(/[\[\]]/g, '').split('|');
      if (partsAlt.length >= 3) {
        cardLang = partsAlt[0] || cardLang;
        sellerCountry = partsAlt[1] || sellerCountry;
        cond = partsAlt[2] || cond;
      }
    }
  }

  const sellerFlag = getCountryFlag(sellerCountry);
  const langFlag = getLanguageFlag(cardLang);

  return `
    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
      <span style="background: rgba(255, 255, 255, 0.08); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.12); padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 0.75rem;" title="Zustand">
        ${cond}
      </span>
      <span style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; color: #a1a1aa; display: inline-flex; align-items: center; gap: 4px;" title="Verkäufer Standort: ${sellerCountry}">
        ${sellerFlag} ${sellerCountry}
      </span>
      <span style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; color: #a1a1aa; display: inline-flex; align-items: center; gap: 4px;" title="Kartensprache: ${cardLang}">
        ${langFlag} ${cardLang}
      </span>
    </div>
  `;
}

function getProxiedImageUrl(url) {
  if (!url) return null;
  if (typeof url === 'string') {
    if (url.includes('cardmarket.com')) {
      const isWeb = typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http');
      const origin = isWeb ? window.location.origin : '';
      return `${origin}/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
    if (url.includes('api-supabase.rohdedigital.de')) {
      const isWeb = typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http');
      const origin = isWeb ? window.location.origin : '';
      return `${origin}/supabase-proxy${url.replace('https://api-supabase.rohdedigital.de', '')}`;
    }
  }
  return url;
}

export class StreamOverlay {
  constructor(container, options = {}) {
    this.container = container;
    this.queue = options.queue || [];
    this.currentIndex = 0;
    this.isFullscreen = false;
    this.isTransitioning = false;
    this.isListOpen = false;
    this.searchTerm = '';
    this.currentInputPrice = '';
    this.onProgress = options.onProgress || null;
    this.onChange = options.onChange || null;
    this.keyListener = null;

    this.bindKeyboardShortcuts();
  }

  getStats() {
    const totalCards = this.queue.length;
    const soldCards = this.queue.filter(c => c.isSold || (c.soldPrice !== undefined && c.soldPrice !== null && !isNaN(c.soldPrice)));
    const soldCount = soldCards.length;
    const totalRevenue = soldCards.reduce((acc, c) => acc + (Number(c.soldPrice) || 0), 0);
    const avgPrice = soldCount > 0 ? (totalRevenue / soldCount) : 0;

    return {
      totalCards,
      soldCount,
      totalRevenue,
      avgPrice
    };
  }

  bindKeyboardShortcuts() {
    this.keyListener = (e) => {
      // If typing in search input, only handle Escape
      if (document.activeElement?.id === 'so-list-search-inp') {
        if (e.code === 'Escape') {
          this.closeListModal();
        }
        return;
      }

      // If typing inside the price input, allow standard typing & Enter/Escape
      if (document.activeElement?.id === 'so-price-input') {
        if (e.code === 'Escape') {
          document.activeElement.blur();
        } else if (e.code === 'Enter') {
          e.preventDefault();
          const soldBtn = this.container?.querySelector('#so-sold-btn');
          if (soldBtn) soldBtn.classList.add('sold-animated');
          this.markAsSold();
        }
        return;
      }

      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        if (e.code === 'Escape') {
          this.closeListModal();
        }
        return;
      }

      if (e.code === 'KeyL') {
        e.preventDefault();
        this.toggleListModal();
      } else if (e.code === 'Escape') {
        if (this.isListOpen) {
          e.preventDefault();
          this.closeListModal();
        } else if (this.isFullscreen) {
          e.preventDefault();
          this.toggleFullscreen();
        }
      } else if (e.code === 'Enter' || e.code === 'Space') {
        if (!this.isListOpen) {
          e.preventDefault();
          const soldBtn = this.container?.querySelector('#so-sold-btn');
          if (soldBtn) soldBtn.classList.add('sold-animated');
          this.markAsSold();
        }
      } else if (e.code === 'ArrowRight') {
        if (!this.isListOpen) {
          e.preventDefault();
          this.nextCard();
        }
      } else if (e.code === 'ArrowLeft') {
        if (!this.isListOpen) {
          e.preventDefault();
          this.prevCard();
        }
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (!this.isListOpen && this.currentIndex < this.queue.length) {
        // Direct numeric keypad entry via physical keyboard
        if ((e.key >= '0' && e.key <= '9') || e.key === ',' || e.key === '.') {
          e.preventDefault();
          this.handleKeypadInput(e.key);
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          this.handleKeypadInput('backspace');
        } else if (e.key === 'c' || e.key === 'C') {
          this.handleKeypadInput('clear');
        }
      }
    };
    window.addEventListener('keydown', this.keyListener);
  }

  destroy() {
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
  }

  loadQueue(items) {
    this.queue = items || [];
    this.currentIndex = 0;
    this.isListOpen = false;
    this.searchTerm = '';
    const firstCard = this.queue[0];
    this.currentInputPrice = (firstCard && firstCard.soldPrice != null) ? String(firstCard.soldPrice).replace('.', ',') : '';
    this.render();
    if (this.onChange) this.onChange(this.queue, this.currentIndex);
  }

  jumpToCard(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    this.isListOpen = false;
    const targetCard = this.queue[this.currentIndex];
    this.currentInputPrice = (targetCard && targetCard.soldPrice != null) ? String(targetCard.soldPrice).replace('.', ',') : '';
    this.render();
    if (this.onChange) this.onChange(this.queue, this.currentIndex);
  }

  toggleListModal() {
    this.isListOpen = !this.isListOpen;
    this.render();
  }

  closeListModal() {
    this.isListOpen = false;
    this.render();
  }

  handleKeypadInput(key) {
    if (this.currentIndex >= this.queue.length) return;
    let str = this.currentInputPrice || '';

    if (key === 'clear' || key === 'C') {
      str = '';
    } else if (key === 'backspace' || key === 'Backspace' || key === 'Delete') {
      str = str.slice(0, -1);
    } else if (key === ',' || key === '.') {
      if (!str.includes(',')) {
        str = str === '' ? '0,' : str + ',';
      }
    } else if (/^[0-9]$/.test(key)) {
      if (str.includes(',')) {
        const parts = str.split(',');
        if (parts[1].length < 2) {
          str += key;
        }
      } else {
        if (str === '0') {
          str = key;
        } else if (str.length < 6) {
          str += key;
        }
      }
    }

    this.currentInputPrice = str;
    this.updatePriceDisplay();
  }

  setPricePreset(val) {
    if (typeof val === 'number') {
      this.currentInputPrice = (Math.round(val * 100) / 100).toString().replace('.', ',');
    } else if (typeof val === 'string') {
      this.currentInputPrice = val;
    }
    this.updatePriceDisplay();
  }

  adjustPrice(delta) {
    let currentVal = 0;
    if (this.currentInputPrice && this.currentInputPrice.trim() !== '') {
      currentVal = parseFloat(this.currentInputPrice.replace(',', '.')) || 0;
    } else {
      const currentCard = this.queue[this.currentIndex];
      currentVal = (currentCard && typeof currentCard.lastPrice === 'number') ? currentCard.lastPrice : 0;
    }
    const newVal = Math.max(0, currentVal + delta);
    this.setPricePreset(newVal);
  }

  getSoldButtonLabel(card) {
    if (this.currentInputPrice && this.currentInputPrice.trim() !== '') {
      const parsed = parseFloat(this.currentInputPrice.replace(',', '.'));
      if (!isNaN(parsed)) {
        return `Verkauft für ${parsed.toFixed(2).replace('.', ',')} €`;
      }
    }
    if (card && typeof card.lastPrice === 'number') {
      return `Verkauft für ${card.lastPrice.toFixed(2).replace('.', ',')} € (CM)`;
    }
    return 'Als verkauft markieren';
  }

  updatePriceDisplay() {
    const inputEl = this.container?.querySelector('#so-price-input');
    const soldBtnText = this.container?.querySelector('#so-sold-btn-text');
    const clearBtn = this.container?.querySelector('#so-input-clear');
    const currentCard = this.queue[this.currentIndex];

    const val = this.currentInputPrice || '';
    if (inputEl && inputEl.value !== val) {
      inputEl.value = val;
    }

    if (soldBtnText) {
      soldBtnText.textContent = this.getSoldButtonLabel(currentCard);
    }

    if (clearBtn) {
      clearBtn.style.display = val ? 'flex' : 'none';
    }
  }

  nextCard() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    const grid = this.container.querySelector('.so-content-grid');
    if (grid) grid.classList.add('so-slide-out');

    setTimeout(() => {
      if (this.currentIndex < this.queue.length - 1) {
        this.currentIndex++;
      } else {
        this.currentIndex = this.queue.length; // Finished
      }
      const nextCard = this.queue[this.currentIndex];
      this.currentInputPrice = (nextCard && nextCard.soldPrice != null) ? String(nextCard.soldPrice).replace('.', ',') : '';

      this.render();
      if (this.onChange) this.onChange(this.queue, this.currentIndex);
      const newGrid = this.container.querySelector('.so-content-grid');
      if (newGrid) {
        newGrid.classList.add('so-slide-in');
        setTimeout(() => {
          newGrid.classList.remove('so-slide-in');
          this.isTransitioning = false;
        }, 250);
      } else {
        this.isTransitioning = false;
      }
    }, 200);
  }

  prevCard() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    const grid = this.container.querySelector('.so-content-grid');
    if (grid) grid.classList.add('so-slide-out');

    setTimeout(() => {
      if (this.currentIndex > 0) {
        this.currentIndex--;
      }
      const prevCard = this.queue[this.currentIndex];
      this.currentInputPrice = (prevCard && prevCard.soldPrice != null) ? String(prevCard.soldPrice).replace('.', ',') : '';

      this.render();
      if (this.onChange) this.onChange(this.queue, this.currentIndex);
      const newGrid = this.container.querySelector('.so-content-grid');
      if (newGrid) {
        newGrid.classList.add('so-slide-in');
        setTimeout(() => {
          newGrid.classList.remove('so-slide-in');
          this.isTransitioning = false;
        }, 250);
      } else {
        this.isTransitioning = false;
      }
    }, 200);
  }

  markAsSold(explicitPrice) {
    if (this.isTransitioning) return;
    if (this.currentIndex >= this.queue.length) return;

    const currentCard = this.queue[this.currentIndex];
    let finalPrice = 0;

    if (explicitPrice !== undefined && explicitPrice !== null && !isNaN(explicitPrice)) {
      finalPrice = explicitPrice;
    } else if (this.currentInputPrice && this.currentInputPrice.trim() !== '') {
      const parsed = parseFloat(this.currentInputPrice.replace(',', '.'));
      finalPrice = isNaN(parsed) ? (currentCard?.lastPrice || 0) : parsed;
    } else if (currentCard && typeof currentCard.lastPrice === 'number') {
      finalPrice = currentCard.lastPrice;
    } else {
      finalPrice = 0;
    }

    currentCard.isSold = true;
    currentCard.soldPrice = finalPrice;
    currentCard.soldAt = new Date().toISOString();

    this.isTransitioning = true;

    const grid = this.container.querySelector('.so-content-grid');
    if (grid) grid.classList.add('so-slide-out');

    setTimeout(() => {
      if (this.currentIndex < this.queue.length - 1) {
        this.currentIndex++;
      } else {
        this.currentIndex = this.queue.length;
      }
      const nextCard = this.queue[this.currentIndex];
      this.currentInputPrice = (nextCard && nextCard.soldPrice != null) ? String(nextCard.soldPrice).replace('.', ',') : '';

      this.render();
      if (this.onChange) this.onChange(this.queue, this.currentIndex);

      const newGrid = this.container.querySelector('.so-content-grid');
      if (newGrid) {
        newGrid.classList.add('so-slide-in');
        setTimeout(() => {
          newGrid.classList.remove('so-slide-in');
          this.isTransitioning = false;
        }, 250);
      } else {
        this.isTransitioning = false;
      }
    }, 200);
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    const activeView = this.container.querySelector('.stream-overlay-active');
    
    if (this.isFullscreen) {
      if (activeView) activeView.classList.add('is-fullscreen');
      try {
        if (this.container.requestFullscreen) {
          this.container.requestFullscreen();
        }
      } catch (e) {}
    } else {
      if (activeView) activeView.classList.remove('is-fullscreen');
      try {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      } catch (e) {}
    }
    this.render();
  }

  renderListDrawerHtml(totalCards, stats) {
    const q = (this.searchTerm || '').toLowerCase().trim();
    const filtered = this.queue.map((card, idx) => ({ card, originalIndex: idx })).filter(({ card, originalIndex }) => {
      if (!q) return true;
      const details = getGermanCardDetails(card);
      const nameDe = (card.nameDe || details.nameDe || '').toLowerCase();
      const nameEn = (card.nameEn || card.detectedName || card.rawName || '').toLowerCase();
      const setName = (card.setNameDe || details.setNameDe || '').toLowerCase();
      const code = (card.detectedCode || card.rawCode || '').toLowerCase();
      const indexStr = String(originalIndex + 1);
      return nameDe.includes(q) || nameEn.includes(q) || setName.includes(q) || code.includes(q) || indexStr === q;
    });

    return `
      <div class="so-list-drawer-backdrop" id="so-list-backdrop">
        <div class="so-list-drawer" id="so-list-drawer">
          <div class="so-list-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 1.25rem;">📋</span>
              <div>
                <h2 style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin: 0;">Karten-Übersicht</h2>
                <div style="font-size: 0.75rem; color: #a1a1aa;">
                  ${stats.soldCount} von ${totalCards} verkauft • Ø ${stats.soldCount > 0 ? stats.avgPrice.toFixed(2).replace('.', ',') + ' €' : '—'}
                </div>
              </div>
            </div>
            <button class="so-list-close-btn" id="so-list-close-btn" title="Schließen (Esc)">✕</button>
          </div>

          <div class="so-list-search-bar">
            <div style="position: relative;">
              <input type="text" class="so-list-search-input" id="so-list-search-inp" placeholder="Karte, Set, Nummer oder Code suchen..." value="${this.searchTerm || ''}" />
              ${this.searchTerm ? `<button id="so-list-clear-search" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #a1a1aa; cursor: pointer; font-size: 0.9rem;">✕</button>` : ''}
            </div>
          </div>

          <div class="so-list-scroll">
            ${filtered.length === 0 ? `
              <div style="text-align: center; padding: 48px 20px; color: #71717a;">
                Keine Karten für "<strong>${this.searchTerm}</strong>" gefunden.
              </div>
            ` : filtered.map(({ card, originalIndex }) => {
              const details = getGermanCardDetails(card);
              const nameDe = card.nameDe || details.nameDe;
              const nameEn = card.nameEn || card.detectedName || '';
              const setNameDe = card.setNameDe || details.setNameDe;
              const cardCode = card.detectedCode || card.rawCode || '';
              const isCurrent = originalIndex === this.currentIndex;
              const isSold = card.isSold || originalIndex < this.currentIndex;
              const hasPrice = card.lastPrice !== null && card.lastPrice !== undefined;
              const priceDisplay = hasPrice ? `${card.lastPrice.toFixed(2).replace('.', ',')} €` : '-';
              const soldPriceDisplay = (card.soldPrice !== undefined && card.soldPrice !== null) ? `${Number(card.soldPrice).toFixed(2).replace('.', ',')} €` : null;
              const rawImage = card.imageUrl || card.cardDetails?.image_url || null;
              const imageSrc = getProxiedImageUrl(rawImage);
              const langFlag = getLanguageFlag(card.rawLanguage);
              const rawVar = card.variant || details.variant || null;
              const verNum = rawVar ? rawVar.replace(/\D/g, '') : '';
              const variantTag = verNum ? `Version ${verNum}` : rawVar;

              return `
                <div class="so-list-card-item ${isCurrent ? 'is-current' : ''} ${isSold ? 'is-sold' : ''}" data-card-idx="${originalIndex}">
                  <div class="so-list-index-badge">#${originalIndex + 1}</div>
                  ${imageSrc ? `<img src="${imageSrc}" class="so-list-thumb" alt="Thumb" onerror="this.onerror=null; this.src='/logo.png';" />` : `
                    <div class="so-list-thumb-placeholder">🃏</div>
                  `}
                  <div class="so-list-info">
                    <div class="so-list-title-de">${nameDe}</div>
                    ${nameEn && nameEn !== nameDe ? `<div class="so-list-title-en">${nameEn}</div>` : ''}
                    <div class="so-list-set-code">
                      <span>${setNameDe}</span>
                      ${cardCode ? `<span>• <strong>${cardCode}</strong></span>` : ''}
                      ${variantTag ? `<span class="so-list-pill" style="background: rgba(168,85,247,0.15); color: #d8b4fe; border-color: rgba(168,85,247,0.3); font-weight: 700;">✨ ${variantTag}</span>` : ''}
                    </div>
                    <div style="display: flex; gap: 6px; margin-top: 4px; align-items: center; flex-wrap: wrap;">
                      <span class="so-list-pill">${card.rawCondition || 'NM'}</span>
                      <span class="so-list-pill">${langFlag} ${card.rawLanguage || 'EN'}</span>
                      ${isCurrent ? `<span class="so-list-status-badge current">Aktiv</span>` : ''}
                      ${isSold ? `<span class="so-list-status-badge sold">✓ Verkauft ${soldPriceDisplay ? `(${soldPriceDisplay})` : ''}</span>` : ''}
                    </div>
                  </div>
                  <div class="so-list-price">
                    <div>${soldPriceDisplay || priceDisplay}</div>
                    <div style="font-size: 0.6875rem; color: #71717a; font-weight: 500;">${soldPriceDisplay ? 'Verkaufspreis' : 'CM Preis'}</div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.container) return;

    if (this.queue.length === 0) {
      this.container.innerHTML = `
        <div class="stream-overlay-empty glass-panel">
          <div class="empty-icon" style="margin-bottom: 1rem;">
            <svg style="width: 52px; height: 52px; color: #a1a1aa; margin: 0 auto; display: block;" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <h2 style="font-size: 1.35rem; font-weight: 700; color: #ffffff; margin-bottom: 0.5rem;">Keine Karten in der Stream-Queue</h2>
          <p style="color: #a1a1aa; max-width: 440px; margin-top: 0.5rem; font-size: 0.875rem; line-height: 1.5;">
            Importiere eine CSV-Datei im Bulk Scan Tab und klicke auf <strong>"An Stream Overlay senden"</strong>, um deine Verkaufssession auf dem iPad zu starten!
          </p>
        </div>
      `;
      return;
    }

    const totalCards = this.queue.length;
    const stats = this.getStats();

    if (this.currentIndex >= totalCards) {
      this.container.innerHTML = `
        <div class="stream-overlay-finished glass-panel">
          <div class="finished-badge" style="display: inline-flex; align-items: center; gap: 8px;">
            <svg style="width: 16px; height: 16px; color: #4ade80;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Session beendet!</span>
          </div>
          <h1 style="font-size: 2.2rem; font-weight: 800; margin: 0.5rem 0; color: #ffffff;">Stream-Session abgeschlossen</h1>
          <div class="session-stats">
            <div class="stat-box">
              <span class="stat-label">Gesamtkarten</span>
              <span class="stat-val">${stats.totalCards}</span>
            </div>
            <div class="stat-box accent">
              <span class="stat-label">Verkaufte Karten</span>
              <span class="stat-val">${stats.soldCount}</span>
            </div>
            <div class="stat-box accent">
              <span class="stat-label">Ø Verkaufspreis</span>
              <span class="stat-val">${stats.soldCount > 0 ? stats.avgPrice.toFixed(2).replace('.', ',') + ' €' : '—'}</span>
            </div>
            <div class="stat-box accent">
              <span class="stat-label">Gesamtumsatz</span>
              <span class="stat-val" style="color: #4ade80;">${stats.totalRevenue.toFixed(2).replace('.', ',')} €</span>
            </div>
          </div>
          <div style="display: flex; gap: 12px; margin-top: 1rem; flex-wrap: wrap; justify-content: center;">
            <button class="btn btn-primary btn-lg" id="so-restart-btn">
              <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Session neu starten
            </button>
            <button class="btn btn-secondary btn-lg" id="so-finish-list-btn">
              📋 Karten-Liste ansehen
            </button>
          </div>
        </div>
        ${this.isListOpen ? this.renderListDrawerHtml(totalCards, stats) : ''}
      `;

      const restartBtn = this.container.querySelector('#so-restart-btn');
      if (restartBtn) {
        restartBtn.addEventListener('click', () => {
          this.currentIndex = 0;
          this.currentInputPrice = '';
          this.render();
        });
      }

      const finishListBtn = this.container.querySelector('#so-finish-list-btn');
      if (finishListBtn) {
        finishListBtn.addEventListener('click', () => {
          this.toggleListModal();
        });
      }

      this.attachListDrawerEvents();
      return;
    }

    const currentCard = this.queue[this.currentIndex];
    const details = getGermanCardDetails(currentCard);
    const cardCode = currentCard.detectedCode || currentCard.rawCode || 'Code k.A.';
    const nameDe = currentCard.nameDe || details.nameDe || 'Karte';
    const nameEn = currentCard.nameEn || currentCard.detectedName || currentCard.rawName || '';
    const setNameDe = currentCard.setNameDe || details.setNameDe || 'TCG Set';

    const hasPrice = currentCard.lastPrice !== null && currentCard.lastPrice !== undefined;
    const priceDisplay = hasPrice ? `${currentCard.lastPrice.toFixed(2).replace('.', ',')} €` : 'Keine DB-Daten';
    const checkDisplay = currentCard.lastCheckRelative || currentCard.lastCheckDate || 'Noch nicht gecheckt';
    const filterDisplay = currentCard.filterInfo || 'Standard Filter';
    const rawImage = currentCard.imageUrl || currentCard.cardDetails?.image_url || null;
    const imageSrc = getProxiedImageUrl(rawImage);
    const cmUrl = getCardmarketSearchUrl(currentCard);

    const filterBadgesHtml = renderFilterBadges(filterDisplay, currentCard.rawCondition, currentCard.rawLanguage);
    const soldButtonText = this.getSoldButtonLabel(currentCard);
    const displayVal = this.currentInputPrice || '';

    const meta = formatCardMeta(currentCard.cardDetails?.cardmarket_url || currentCard.card_id, nameDe, setNameDe, cardCode, currentCard.tcg);

    this.container.innerHTML = `
      <div class="stream-overlay-active glass-panel ${this.isFullscreen ? 'is-fullscreen' : ''}">
        ${this.isFullscreen ? `
          <button class="so-fullscreen-close" id="so-close-fs-btn" title="Vollbild beenden">
            ✕ Beenden
          </button>
        ` : ''}

        <div class="so-header">
          <div class="so-header-stats">
            <div class="so-stat-pill">
              <span class="so-live-dot"></span>
              <span>Karte <strong>${this.currentIndex + 1}</strong> von <strong>${totalCards}</strong></span>
            </div>
            <div class="so-stat-pill avg-price" title="Durchschnittlicher Verkaufspreis über ${stats.soldCount} verkaufte Karten">
              <span style="color: #4ade80; font-weight: 800;">Ø</span>
              <span>Verkaufspreis: <strong>${stats.soldCount > 0 ? stats.avgPrice.toFixed(2).replace('.', ',') + ' €' : '—'}</strong></span>
              ${stats.soldCount > 0 ? `<span class="so-stat-badge-sub">(${stats.soldCount} verkauft • ${stats.totalRevenue.toFixed(2).replace('.', ',')} €)</span>` : ''}
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <button class="so-btn-list-trigger" id="so-list-trigger-btn" title="Karten-Liste öffnen (Taste L)">
              <span>📋</span> Liste (${totalCards})
            </button>
            <button class="so-btn-fs-trigger" id="so-fs-trigger-btn" title="Vollbild Modus für iPad (Taste F)">
              ${this.isFullscreen ? '↙ Beenden' : '⛶ Vollbild'}
            </button>
          </div>
        </div>

        <div class="so-content-grid">
          <div class="so-image-container">
            ${imageSrc ? `<img src="${imageSrc}" alt="${nameDe}" class="so-card-img" onerror="this.onerror=null; this.src='/logo.png';" />` : `
              <div class="so-no-img-box">
                <svg style="width: 44px; height: 44px; color: #71717a; margin-bottom: 8px; opacity: 0.7;" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21" />
                </svg>
                <div style="color: #a1a1aa; font-weight: 500; font-size: 0.875rem;">Kein Scan-Bild</div>
              </div>
            `}
          </div>

          <div class="so-details-container">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <div class="so-card-badge">${cardCode}</div>
                ${(currentCard.variant || details.variant) ? `
                  <div class="so-card-badge" style="background: rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.35); color: #d8b4fe; font-weight: 700;">
                    ✨ ${(details.variantLabel || `Version ${(currentCard.variant || details.variant).replace(/\D/g, '')}` || currentCard.variant)}
                  </div>
                ` : ''}
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <a href="${cmUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">
                  Cardmarket ↗
                </a>
              </div>
            </div>

            <div class="so-card-header-block">
              <div class="so-card-set-banner">
                <span class="so-set-icon">📁</span>
                <span class="so-set-label">Set:</span>
                <strong class="so-set-name">${setNameDe}</strong>
              </div>
              <h1 class="so-card-title">${nameDe}</h1>
              ${nameEn && nameEn !== nameDe ? `<div class="so-card-subtitle-en">Original: ${nameEn}</div>` : ''}
            </div>

            <div class="so-price-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px;">
              <div class="so-price-card primary">
                <span class="price-label">🇪🇺 Cardmarket (EUR)</span>
                <span class="price-value" style="color: ${hasPrice ? '#10b981' : '#a1a1aa'};">${priceDisplay}</span>
              </div>
              <div class="so-price-card trend">
                <span class="price-label">Letzter Check & Filter</span>
                <span class="price-value" style="font-size: 1.15rem; color: #ffffff;">${checkDisplay}</span>
                ${filterBadgesHtml}
              </div>
            </div>

            <!-- Quick-Sell Terminal with Zahlenraster -->
            <div class="so-sell-terminal">
              <div class="so-terminal-header">
                <div class="so-terminal-label">Verkaufspreis eingeben</div>
              </div>

              <div class="so-terminal-body">
                <!-- Price Display Input -->
                <div class="so-price-input-box">
                  <div class="so-input-currency">€</div>
                  <input type="text" class="so-price-display-input" id="so-price-input" 
                         inputmode="decimal" placeholder="0,00" value="${displayVal}" autocomplete="off" />
                  <button type="button" class="so-input-clear-btn" id="so-input-clear" title="Löschen" style="display: ${displayVal ? 'flex' : 'none'};">✕</button>
                </div>

                <!-- Touch-friendly Zahlenraster (Numpad) -->
                <div class="so-numpad-grid">
                  <button type="button" class="so-numpad-btn" data-key="1">1</button>
                  <button type="button" class="so-numpad-btn" data-key="2">2</button>
                  <button type="button" class="so-numpad-btn" data-key="3">3</button>
                  <button type="button" class="so-numpad-btn" data-key="4">4</button>
                  <button type="button" class="so-numpad-btn" data-key="5">5</button>
                  <button type="button" class="so-numpad-btn" data-key="6">6</button>
                  <button type="button" class="so-numpad-btn" data-key="7">7</button>
                  <button type="button" class="so-numpad-btn" data-key="8">8</button>
                  <button type="button" class="so-numpad-btn" data-key="9">9</button>
                  <button type="button" class="so-numpad-btn" data-key=",">,</button>
                  <button type="button" class="so-numpad-btn" data-key="0">0</button>
                  <button type="button" class="so-numpad-btn action-backspace" data-key="backspace" title="Rücktaste">⌫</button>
                </div>
              </div>

              <!-- High-Contrast SOLD Button -->
              <div class="so-action-bar">
                <button class="so-btn-sold" id="so-sold-btn">
                  <span class="sold-icon">✓</span>
                  <span class="sold-text" id="so-sold-btn-text">${soldButtonText}</span>
                </button>
              </div>
            </div>

            <div class="so-nav-row">
              <button class="so-shadcn-nav-btn" id="so-prev-btn" ${this.currentIndex === 0 ? 'disabled' : ''}>
                <span>◄</span> Vorherige
              </button>
              <button class="so-shadcn-nav-btn" id="so-skip-btn">
                Überspringen <span>►</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      ${this.isListOpen ? this.renderListDrawerHtml(totalCards, stats) : ''}
    `;

    // Event Listeners
    const listBtn = this.container.querySelector('#so-list-trigger-btn');
    if (listBtn) {
      listBtn.addEventListener('click', () => this.toggleListModal());
    }

    const fsBtn = this.container.querySelector('#so-fs-trigger-btn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    const closeFsBtn = this.container.querySelector('#so-close-fs-btn');
    if (closeFsBtn) {
      closeFsBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    const soldBtn = this.container.querySelector('#so-sold-btn');
    if (soldBtn) {
      soldBtn.addEventListener('click', () => {
        soldBtn.classList.add('sold-animated');
        this.markAsSold();
      });
    }

    const prevBtn = this.container.querySelector('#so-prev-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.prevCard());
    }

    const skipBtn = this.container.querySelector('#so-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => this.nextCard());
    }

    // Numpad button click listeners
    const numpadBtns = this.container.querySelectorAll('.so-numpad-btn');
    numpadBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        if (key) {
          this.handleKeypadInput(key);
        }
      });
    });

    const inputClear = this.container.querySelector('#so-input-clear');
    if (inputClear) {
      inputClear.addEventListener('click', () => this.handleKeypadInput('clear'));
    }

    // Direct input on the display field
    const priceInput = this.container.querySelector('#so-price-input');
    if (priceInput) {
      priceInput.addEventListener('input', (e) => {
        let clean = e.target.value.replace(/[^0-9,\.]/g, '').replace('.', ',');
        const commaIndex = clean.indexOf(',');
        if (commaIndex !== -1) {
          clean = clean.slice(0, commaIndex + 1) + clean.slice(commaIndex + 1).replace(/,/g, '');
          const parts = clean.split(',');
          if (parts[1].length > 2) {
            clean = parts[0] + ',' + parts[1].slice(0, 2);
          }
        }
        this.currentInputPrice = clean;
        priceInput.value = clean;
        this.updatePriceDisplay();
      });

      priceInput.addEventListener('keydown', (e) => {
        if (e.code === 'Enter') {
          e.preventDefault();
          const btn = this.container.querySelector('#so-sold-btn');
          if (btn) btn.classList.add('sold-animated');
          this.markAsSold();
        }
      });
    }

    this.attachListDrawerEvents();
  }

  attachListDrawerEvents() {
    if (!this.isListOpen) return;

    const backdrop = this.container.querySelector('#so-list-backdrop');
    const closeBtn = this.container.querySelector('#so-list-close-btn');
    const searchInp = this.container.querySelector('#so-list-search-inp');
    const clearSearchBtn = this.container.querySelector('#so-list-clear-search');

    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          this.closeListModal();
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeListModal());
    }

    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        this.searchTerm = e.target.value;
        const scrollContainer = this.container.querySelector('.so-list-scroll');
        if (scrollContainer) {
          const q = (this.searchTerm || '').toLowerCase().trim();
          const filtered = this.queue.map((card, idx) => ({ card, originalIndex: idx })).filter(({ card, originalIndex }) => {
            if (!q) return true;
            const details = getGermanCardDetails(card);
            const nameDe = (card.nameDe || details.nameDe || '').toLowerCase();
            const nameEn = (card.nameEn || card.detectedName || card.rawName || '').toLowerCase();
            const setName = (card.setNameDe || details.setNameDe || '').toLowerCase();
            const code = (card.detectedCode || card.rawCode || '').toLowerCase();
            const indexStr = String(originalIndex + 1);
            return nameDe.includes(q) || nameEn.includes(q) || setName.includes(q) || code.includes(q) || indexStr === q;
          });

          if (filtered.length === 0) {
            scrollContainer.innerHTML = `<div style="text-align: center; padding: 48px 20px; color: #71717a;">Keine Karten für "<strong>${this.searchTerm}</strong>" gefunden.</div>`;
          } else {
            scrollContainer.innerHTML = filtered.map(({ card, originalIndex }) => {
              const details = getGermanCardDetails(card);
              const nameDe = card.nameDe || details.nameDe;
              const nameEn = card.nameEn || card.detectedName || '';
              const setNameDe = card.setNameDe || details.setNameDe;
              const cardCode = card.detectedCode || card.rawCode || '';
              const isCurrent = originalIndex === this.currentIndex;
              const isSold = card.isSold || originalIndex < this.currentIndex;
              const hasPrice = card.lastPrice !== null && card.lastPrice !== undefined;
              const priceDisplay = hasPrice ? `${card.lastPrice.toFixed(2).replace('.', ',')} €` : '-';
              const soldPriceDisplay = (card.soldPrice !== undefined && card.soldPrice !== null) ? `${Number(card.soldPrice).toFixed(2).replace('.', ',')} €` : null;
              const rawImage = card.imageUrl || card.cardDetails?.image_url || null;
              const imageSrc = getProxiedImageUrl(rawImage);
              const langFlag = getLanguageFlag(card.rawLanguage);

              return `
                <div class="so-list-card-item ${isCurrent ? 'is-current' : ''} ${isSold ? 'is-sold' : ''}" data-card-idx="${originalIndex}">
                  <div class="so-list-index-badge">#${originalIndex + 1}</div>
                  ${imageSrc ? `<img src="${imageSrc}" class="so-list-thumb" alt="Thumb" onerror="this.onerror=null; this.src='/logo.png';" />` : `
                    <div class="so-list-thumb-placeholder">🃏</div>
                  `}
                  <div class="so-list-info">
                    <div class="so-list-title-de">${nameDe}</div>
                    ${nameEn && nameEn !== nameDe ? `<div class="so-list-title-en">${nameEn}</div>` : ''}
                    <div class="so-list-set-code">
                      <span>${setNameDe}</span>
                      ${cardCode ? `<span>• <strong>${cardCode}</strong></span>` : ''}
                    </div>
                    <div style="display: flex; gap: 6px; margin-top: 4px; align-items: center; flex-wrap: wrap;">
                      <span class="so-list-pill">${card.rawCondition || 'NM'}</span>
                      <span class="so-list-pill">${langFlag} ${card.rawLanguage || 'EN'}</span>
                      ${isCurrent ? `<span class="so-list-status-badge current">Aktiv</span>` : ''}
                      ${isSold ? `<span class="so-list-status-badge sold">✓ Verkauft ${soldPriceDisplay ? `(${soldPriceDisplay})` : ''}</span>` : ''}
                    </div>
                  </div>
                  <div class="so-list-price">
                    <div>${soldPriceDisplay || priceDisplay}</div>
                    <div style="font-size: 0.6875rem; color: #71717a; font-weight: 500;">${soldPriceDisplay ? 'Verkaufspreis' : 'CM Preis'}</div>
                  </div>
                </div>
              `;
            }).join('');
          }
        }
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        this.searchTerm = '';
        this.render();
      });
    }

    // Card item click handler delegation
    const scrollEl = this.container.querySelector('.so-list-scroll');
    if (scrollEl) {
      scrollEl.addEventListener('click', (e) => {
        const itemEl = e.target.closest('.so-list-card-item');
        if (itemEl) {
          const idx = parseInt(itemEl.getAttribute('data-card-idx'), 10);
          if (!isNaN(idx)) {
            this.jumpToCard(idx);
          }
        }
      });
    }
  }
}
