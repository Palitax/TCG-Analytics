import { getGermanCardDetails } from './tcg-translations.js';

function getCardmarketSearchUrl(item) {
  if (item.cardDetails?.cardmarket_url) {
    const path = item.cardDetails.cardmarket_url.startsWith('/') ? item.cardDetails.cardmarket_url : `/${item.cardDetails.cardmarket_url}`;
    return `https://www.cardmarket.com${path}`;
  }

  const code = (item.detectedCode || item.rawCode || '').trim();
  const rawFullName = item.detectedName || item.rawName || '';

  // Extract set name from rawSet, cardDetails or parentheses e.g. "Pikachu (Mysterious Treasures)"
  let extractedSet = item.rawSet || item.cardDetails?.set_name || item.cardDetails?.expansion || '';
  if (!extractedSet) {
    const parentheticalMatch = rawFullName.match(/\(([^)]+)\)/);
    if (parentheticalMatch && parentheticalMatch[1]) {
      extractedSet = parentheticalMatch[1].trim();
    }
  }

  // Clean main name: remove parentheses and LV.XX info if any
  let cleanName = rawFullName.replace(/\([^)]*\)/g, '').split(/\s+LV\./i)[0].trim();
  if (!cleanName || cleanName.toLowerCase() === 'karte') cleanName = '';

  let cleanSet = extractedSet.trim();

  // Direct Cardmarket search URL with clean parameters
  const queryParts = [cleanName, cleanSet, code].filter(p => p && p.length > 0);
  const searchQuery = queryParts.join(' ').trim() || code || cleanName || 'Karte';

  const cmSearchUrl = new URL('https://www.cardmarket.com/de/Search');
  cmSearchUrl.searchParams.set('searchString', searchQuery);
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
    this.onProgress = options.onProgress || null;
    this.onChange = options.onChange || null;
    this.keyListener = null;

    this.bindKeyboardShortcuts();
  }

  bindKeyboardShortcuts() {
    this.keyListener = (e) => {
      // If typing in input, only handle Escape
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
      } else if (e.code === 'Space' || e.code === 'Enter') {
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
    this.render();
    if (this.onChange) this.onChange(this.queue, this.currentIndex);
  }

  jumpToCard(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    this.isListOpen = false;
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

  markAsSold() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    const grid = this.container.querySelector('.so-content-grid');
    if (grid) grid.classList.add('so-slide-out');

    setTimeout(() => {
      if (this.currentIndex < this.queue.length - 1) {
        this.currentIndex++;
      } else {
        this.currentIndex = this.queue.length;
      }
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

  renderListDrawerHtml(totalCards) {
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
                <div style="font-size: 0.75rem; color: #a1a1aa;">${totalCards} Karten in der Queue</div>
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
              const isSold = originalIndex < this.currentIndex;
              const hasPrice = card.lastPrice !== null && card.lastPrice !== undefined;
              const priceDisplay = hasPrice ? `${card.lastPrice.toFixed(2)} €` : '-';
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
                      ${isSold ? `<span class="so-list-status-badge sold">✓ Verkauft</span>` : ''}
                    </div>
                  </div>
                  <div class="so-list-price">
                    <div>${priceDisplay}</div>
                    <div style="font-size: 0.6875rem; color: #71717a; font-weight: 500;">CM Preis</div>
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

    if (this.currentIndex >= totalCards) {
      this.container.innerHTML = `
        <div class="stream-overlay-finished glass-panel">
          <div class="finished-badge" style="display: inline-flex; align-items: center; gap: 8px;">
            <svg style="width: 16px; height: 16px; color: #4ade80;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Session beendet!</span>
          </div>
          <h1 style="font-size: 2.2rem; font-weight: 800; margin: 0.5rem 0; color: #ffffff;">Alle Karten verkauft!</h1>
          <div class="session-stats">
            <div class="stat-box">
              <span class="stat-label">Gesamtkarten</span>
              <span class="stat-val">${totalCards} Karten</span>
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
        ${this.isListOpen ? this.renderListDrawerHtml(totalCards) : ''}
      `;

      const restartBtn = this.container.querySelector('#so-restart-btn');
      if (restartBtn) {
        restartBtn.addEventListener('click', () => {
          this.currentIndex = 0;
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
    const priceDisplay = hasPrice ? `${currentCard.lastPrice.toFixed(2)} €` : 'Keine DB-Daten';
    const checkDisplay = currentCard.lastCheckRelative || currentCard.lastCheckDate || 'Noch nicht gecheckt';
    const filterDisplay = currentCard.filterInfo || 'Standard Filter';
    const rawImage = currentCard.imageUrl || currentCard.cardDetails?.image_url || null;
    const imageSrc = getProxiedImageUrl(rawImage);
    const cmUrl = getCardmarketSearchUrl(currentCard);

    const filterBadgesHtml = renderFilterBadges(filterDisplay, currentCard.rawCondition, currentCard.rawLanguage);

    this.container.innerHTML = `
      <div class="stream-overlay-active glass-panel ${this.isFullscreen ? 'is-fullscreen' : ''}">
        ${this.isFullscreen ? `
          <button class="so-fullscreen-close" id="so-close-fs-btn" title="Vollbild beenden">
            ✕ Beenden
          </button>
        ` : ''}

        <div class="so-header">
          <div class="so-progress-pill">
            <span class="so-live-dot"></span>
            <span>Karte <strong>${this.currentIndex + 1}</strong> von <strong>${totalCards}</strong></span>
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
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <div class="so-card-badge">${cardCode}</div>
              <a href="${cmUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">
                Check price now ↗
              </a>
            </div>

            <div>
              <h1 class="so-card-title">${nameDe}</h1>
              ${nameEn && nameEn !== nameDe ? `<div class="so-card-subtitle-en">Original: ${nameEn}</div>` : ''}
              <div class="so-card-set-banner">
                <span>📁 Set: <strong>${setNameDe}</strong></span>
              </div>
            </div>

            <div class="so-price-cards">
              <div class="so-price-card primary">
                <span class="price-label">Letzter CM Preis</span>
                <span class="price-value" style="color: ${hasPrice ? '#10b981' : '#a1a1aa'};">${priceDisplay}</span>
              </div>
              <div class="so-price-card trend">
                <span class="price-label">Letzter Check & Filter</span>
                <span class="price-value" style="font-size: 1.15rem; color: #ffffff;">${checkDisplay}</span>
                ${filterBadgesHtml}
              </div>
            </div>

            <div class="so-action-bar">
              <button class="so-btn-sold" id="so-sold-btn">
                <span class="sold-text">VERKAUFT</span>
              </button>
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
      ${this.isListOpen ? this.renderListDrawerHtml(totalCards) : ''}
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
              const isSold = originalIndex < this.currentIndex;
              const hasPrice = card.lastPrice !== null && card.lastPrice !== undefined;
              const priceDisplay = hasPrice ? `${card.lastPrice.toFixed(2)} €` : '-';
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
                      ${isSold ? `<span class="so-list-status-badge sold">✓ Verkauft</span>` : ''}
                    </div>
                  </div>
                  <div class="so-list-price">
                    <div>${priceDisplay}</div>
                    <div style="font-size: 0.6875rem; color: #71717a; font-weight: 500;">CM Preis</div>
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
