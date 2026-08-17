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
    this.totalSoldValue = 0;
    this.isFullscreen = false;
    this.isTransitioning = false;
    this.onProgress = options.onProgress || null;
    this.onChange = options.onChange || null;
    this.keyListener = null;

    this.bindKeyboardShortcuts();
  }

  bindKeyboardShortcuts() {
    this.keyListener = (e) => {
      // Avoid triggering when user is typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        const soldBtn = this.container?.querySelector('#so-sold-btn');
        if (soldBtn) soldBtn.classList.add('sold-animated');
        this.markAsSold();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.nextCard();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.prevCard();
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
    this.totalSoldValue = 0;
    this.render();
    if (this.onChange) this.onChange(this.queue, this.currentIndex);
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
      const card = this.queue[this.currentIndex];
      if (card) {
        const price = card.lastPrice !== null && card.lastPrice !== undefined ? card.lastPrice : 0;
        this.totalSoldValue += price;
      }
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
              <span class="stat-label">Gesamtverkäufe</span>
              <span class="stat-val">${totalCards} Karten</span>
            </div>
            <div class="stat-box accent">
              <span class="stat-label">Erzielter Umsatz</span>
              <span class="stat-val" style="color: #22c55e;">${this.totalSoldValue.toFixed(2)} €</span>
            </div>
          </div>
          <button class="btn btn-primary btn-lg" id="so-restart-btn" style="margin-top: 1rem;">
            <svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Session neu starten
          </button>
        </div>
      `;

      const restartBtn = this.container.querySelector('#so-restart-btn');
      if (restartBtn) {
        restartBtn.addEventListener('click', () => {
          this.currentIndex = 0;
          this.totalSoldValue = 0;
          this.render();
        });
      }
      return;
    }

    const currentCard = this.queue[this.currentIndex];
    const cardCode = currentCard.detectedCode || currentCard.rawCode || 'Code k.A.';
    const cardName = currentCard.detectedName || currentCard.rawName || 'Karte';
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

          <div style="display: flex; align-items: center; gap: 1rem;">
            <div class="so-session-summary">
              <span>Umsatz: <strong style="color: #22c55e;">${this.totalSoldValue.toFixed(2)} €</strong></span>
            </div>
            <button class="so-btn-fs-trigger" id="so-fs-trigger-btn" title="Vollbild Modus für iPad">
              ${this.isFullscreen ? '↙ Beenden' : '⛶ Vollbild'}
            </button>
          </div>
        </div>

        <div class="so-content-grid">
          <div class="so-image-container">
            ${imageSrc ? `<img src="${imageSrc}" alt="${cardName}" class="so-card-img" onerror="this.onerror=null; this.src='/logo.png';" />` : `
              <div class="so-no-img-box">
                <svg style="width: 44px; height: 44px; color: #71717a; margin-bottom: 8px; opacity: 0.7;" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21" />
                </svg>
                <div style="color: #a1a1aa; font-weight: 500; font-size: 0.875rem;">Kein Bild in DB</div>
              </div>
            `}
          </div>

          <div class="so-details-container">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="so-card-badge">${cardCode}</div>
              <a href="${cmUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">
                Check price now ↗
              </a>
            </div>
            <h1 class="so-card-title">${cardName}</h1>

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
    `;

    // Event Listeners
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
  }
}
