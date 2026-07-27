/**
 * TCGdex Bulk Importer Script for TCG Card Tracker
 * 
 * Fetches all German and English Pokémon sets & cards from TCGdex API,
 * attaches Set Names and Full Card Numbers (e.g. "Glurak 12/202 (Schwert & Schild)"),
 * and bulk-upserts them directly into Supabase (card_images table).
 * 
 * Usage:
 *   node scripts/import_tcgdex.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://api-supabase.rohdedigital.de";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk";

function slugify(text) {
  if (!text) return '';
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  return resp.json();
}

async function bulkUpsertCardImages(records) {
  if (!records || records.length === 0) return 0;
  
  const batchSize = 300;
  let totalUploaded = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/card_images`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(batch)
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(`[Batch ${i / batchSize + 1}] Warning response:`, resp.status, errText);
      } else {
        totalUploaded += batch.length;
        console.log(`[Batch ${Math.floor(i / batchSize) + 1}] Uploaded ${totalUploaded} / ${records.length} card images...`);
      }
    } catch (e) {
      console.error(`[Batch ${Math.floor(i / batchSize) + 1}] Exception:`, e.message);
    }
  }

  return totalUploaded;
}

async function processLanguageSets(lang) {
  console.log(`📦 Fetching ${lang.toUpperCase()} sets from TCGdex...`);
  const setsList = await fetchJSON(`https://api.tcgdex.net/v2/${lang}/sets`);
  console.log(`✅ Found ${setsList.length} ${lang.toUpperCase()} sets.`);

  const recordsMap = new Map();

  for (let sIdx = 0; sIdx < setsList.length; sIdx++) {
    const setSummary = setsList[sIdx];
    try {
      const setDetail = await fetchJSON(`https://api.tcgdex.net/v2/${lang}/sets/${setSummary.id}`);
      const setName = setDetail.name || setSummary.name || '';
      const setSlug = slugify(setName);
      const officialCount = setDetail.cardCount?.official || setDetail.cardCount?.total || '';
      const cards = setDetail.cards || [];

      for (const card of cards) {
        if (!card.image) continue;

        const imageUrl = card.image.endsWith('.png') || card.image.endsWith('.webp') || card.image.endsWith('.jpg')
          ? card.image
          : `${card.image}/high.webp`;

        const cardName = card.name || '';
        const localId = card.localId || '';
        const cardNameSlug = slugify(cardName);
        const fullNumber = officialCount ? `${localId}/${officialCount}` : localId;

        // Keys for card_images database table:
        // 1. Primary TCGdex ID
        const keyTcgdex = `tcgdex_${card.id}`;
        // 2. Full title key with Set Name and full fraction number: e.g. "Glurak 12/202 (Schwert & Schild)"
        const keyFullTitle = setSlug 
          ? `/Pokemon/Products/Singles/${setSlug}/${cardNameSlug}-${localId}`
          : `/Pokemon/Products/Singles/${cardNameSlug}-${localId}`;
        
        // 3. Readable card title key: "Glurak 12/202 (Schwert & Schild)"
        const keyReadable = `${cardName} ${fullNumber} (${setName})`.trim();

        if (imageUrl) {
          recordsMap.set(keyTcgdex, { card_id: keyTcgdex, image_url: imageUrl });
          recordsMap.set(keyFullTitle, { card_id: keyFullTitle, image_url: imageUrl });
          recordsMap.set(keyReadable, { card_id: keyReadable, image_url: imageUrl });
          if (localId && fullNumber) {
            const keyFrac = `/Pokemon/Products/Singles/${cardNameSlug}-${localId}-${officialCount}`;
            recordsMap.set(keyFrac, { card_id: keyFrac, image_url: imageUrl });
          }
        }
      }

      if ((sIdx + 1) % 20 === 0 || sIdx === setsList.length - 1) {
        console.log(`[${lang.toUpperCase()}] Processed ${sIdx + 1} / ${setsList.length} sets...`);
      }
    } catch (err) {
      console.warn(`[${lang.toUpperCase()}] Could not process set ${setSummary.id}:`, err.message);
    }
  }

  return Array.from(recordsMap.values());
}

async function runImport() {
  console.log('🚀 Starting Enhanced TCGdex Bulk Importer (Set Names + Full Card Numbers)...');
  console.log(`📍 Supabase Endpoint: ${SUPABASE_URL}`);

  try {
    const deRecords = await processLanguageSets('de');
    console.log(`📊 Prepared ${deRecords.length} German card image records.`);

    const enRecords = await processLanguageSets('en');
    console.log(`📊 Prepared ${enRecords.length} English card image records.`);

    const allRecordsMap = new Map();
    for (const r of [...deRecords, ...enRecords]) {
      if (!allRecordsMap.has(r.card_id)) {
        allRecordsMap.set(r.card_id, r);
      }
    }

    const uniqueRecords = Array.from(allRecordsMap.values());
    console.log(`📊 Total unique card image records to upsert: ${uniqueRecords.length}`);

    const count = await bulkUpsertCardImages(uniqueRecords);
    console.log(`🎉 Import completed! Successfully upserted ${count} card image records into Supabase.`);
  } catch (err) {
    console.error('❌ Import failed with error:', err);
  }
}

runImport();
