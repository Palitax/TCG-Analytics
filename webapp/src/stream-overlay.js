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

  // Build query: site:cardmarket.com/de Pikachu Mysterious Treasures 94/123
  const queryParts = ['site:cardmarket.com/de', cleanName, cleanSet, code].filter(p => p && p.length > 0);
  const searchQuery = queryParts.join(' ').trim();

  const encodedQuery = encodeURIComponent(searchQuery);
  return `https://www.google.com/search?q=${encodedQuery}&btnI=1`;
}

export class StreamOverlay {
  constructor(containerId) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.queue = [];
    this.currentIndex = 0;
    this.soldHistory = [];
    this.totalSoldValue = 0;
  }

  loadQueue(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    this.queue = items.map((item, idx) => ({
      ...item,
      queueId: item.id || `queue_${idx}`,
      isSold: false,
      soldPrice: null,
      soldAt: null
    }));
    this.currentIndex = 0;
    this.render();
  }

  getCurrentCard() {
    if (this.queue.length === 0 || this.currentIndex >= this.queue.length) {
      return null;
    }
    return this.queue[this.currentIndex];
  }

  markAsSold(customPrice = null) {
    const current = this.getCurrentCard();
    if (!current) return null;

    const finalPrice = customPrice !== null ? parseFloat(customPrice) : (current.marketPrices?.lowPrice || current.rawPrice || 0);

    current.isSold = true;
    current.soldPrice = finalPrice;
    current.soldAt = new Date().toISOString();

    this.soldHistory.push({ ...current });
    this.totalSoldValue += finalPrice;

    // Advance to next card
    this.nextCard();
    return current;
  }

  nextCard() {
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
      this.render();
    } else {
      this.currentIndex = this.queue.length; // Reached end of queue
      this.render();
    }
  }

  prevCard() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.render();
    }
  }

  render() {
    if (!this.container) return;

    const currentCard = this.getCurrentCard();
    const isFinished = this.queue.length > 0 && this.currentIndex >= this.queue.length;
    const totalCards = this.queue.length;
    const soldCount = this.soldHistory.length;

    if (totalCards === 0) {
      this.container.innerHTML = `
        <div class="stream-overlay-empty glass-panel">
          <div class="empty-icon">📱</div>
          <h2>Stream Overlay bereit</h2>
          <p>Importiere eine CSV-Datei im <strong>Bulk Scan / CSV</strong> Tab und klicke auf <em>"An Stream Overlay senden"</em>, um die Karten hier auf dem Tablet nacheinander anzuzeigen.</p>
        </div>
      `;
      return;
    }

    if (isFinished) {
      this.container.innerHTML = `
        <div class="stream-overlay-finished glass-panel">
          <div class="finished-badge">🎉 CSV-Durchgang beendet!</div>
          <h2>Alle gescannten Karten verarbeitet!</h2>
          <div class="session-stats">
            <div class="stat-box">
              <span class="stat-label">Verkaufte Karten</span>
              <span class="stat-val">${soldCount} / ${totalCards}</span>
            </div>
            <div class="stat-box accent">
              <span class="stat-label">Gesamterlös</span>
              <span class="stat-val">${this.totalSoldValue.toFixed(2)} €</span>
            </div>
          </div>
          <button class="btn btn-primary btn-lg" id="so-restart-btn">🔄 Durchgang neu starten</button>
        </div>
      `;

      const restartBtn = this.container.querySelector('#so-restart-btn');
      if (restartBtn) {
        restartBtn.addEventListener('click', () => {
          this.currentIndex = 0;
          this.render();
        });
      }
      return;
    }

    const cardCode = currentCard.detectedCode || currentCard.rawCode || 'Code k.A.';
    const cardName = currentCard.detectedName || currentCard.rawName || 'Unbekannte Karte';
    const hasPrice = currentCard.lastPrice !== null && currentCard.lastPrice !== undefined;
    const priceDisplay = hasPrice ? `${currentCard.lastPrice.toFixed(2)} €` : 'Keine DB-Daten';
    const checkDisplay = currentCard.lastCheckRelative || currentCard.lastCheckDate || 'Noch nicht gecheckt';
    const filterDisplay = currentCard.filterInfo || 'Standard Filter';
    const imageSrc = currentCard.rawFile || currentCard.cardDetails?.image_url || 'assets/card-placeholder.png';
    const cmUrl = getCardmarketSearchUrl(currentCard);

    this.container.innerHTML = `
      <div class="stream-overlay-active glass-panel">
        <div class="so-header">
          <div class="so-progress-pill">
            <span class="so-live-dot"></span>
            <span>Karte <strong>${this.currentIndex + 1}</strong> von <strong>${totalCards}</strong></span>
          </div>
          <div class="so-session-summary">
            <span>Umsatz Session: <strong>${this.totalSoldValue.toFixed(2)} €</strong></span>
          </div>
        </div>

        <div class="so-content-grid">
          <div class="so-image-container">
            <img src="${imageSrc}" alt="${cardName}" class="so-card-img" onerror="this.src='https://images.pokemontcg.io/sv3pt5/1_hires.png'" />
          </div>

          <div class="so-details-container">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="so-card-badge">${cardCode}</div>
              <a href="${cmUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding: 6px 14px; font-size: 0.85rem; background: rgba(251, 133, 0, 0.15); border: 1px solid rgba(251, 133, 0, 0.4); color: #fb8500; border-radius: 8px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; font-weight: 600;">
                Check price now ↗
              </a>
            </div>
            <h1 class="so-card-title">${cardName}</h1>

            <div class="so-price-cards">
              <div class="so-price-card primary">
                <span class="price-label">Letzter CM Preis</span>
                <span class="price-value" style="color: ${hasPrice ? '#fb8500' : '#a1a1aa'};">${priceDisplay}</span>
              </div>
              <div class="so-price-card trend">
                <span class="price-label">Letzter Check</span>
                <span class="price-value" style="font-size: 1.1rem; color: #cbd5e1;">${checkDisplay}</span>
                <span style="font-size: 0.78rem; color: #94a3b8; margin-top: 4px;">Filter: ${filterDisplay}</span>
              </div>
            </div>

            <div class="so-meta-info">
              <span>Zustand: <strong>${currentCard.rawCondition || 'Near Mint'}</strong></span>
              <span>Sprache: <strong>${currentCard.rawLanguage || 'EN'}</strong></span>
            </div>

            <div class="so-action-bar">
              <button class="so-btn-sold" id="so-sold-btn">
                <span class="sold-icon">✔</span>
                <span class="sold-text">VERKAUFT</span>
              </button>
            </div>

            <div class="so-nav-row">
              <button class="btn btn-secondary" id="so-prev-btn" ${this.currentIndex === 0 ? 'disabled' : ''}>◄ Vorherige</button>
              <button class="btn btn-secondary" id="so-skip-btn">Überspringen ►</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    const soldBtn = this.container.querySelector('#so-sold-btn');
    if (soldBtn) {
      soldBtn.addEventListener('click', () => {
        soldBtn.classList.add('sold-animated');
        setTimeout(() => this.markAsSold(), 150);
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
