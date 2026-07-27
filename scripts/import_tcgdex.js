/**
 * TCGdex Bulk Importer Script for TCG Card Tracker
 * 
 * Fetches all German and English Pokémon cards from TCGdex API
 * and bulk-upserts them directly into Supabase (card_images & price_history metadata).
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

async function runImport() {
  console.log('🚀 Starting TCGdex Bulk Import to Supabase...');
  console.log(`📍 Supabase Endpoint: ${SUPABASE_URL}`);

  try {
    console.log('📦 Fetching German cards list from TCGdex API...');
    const deCards = await fetchJSON('https://api.tcgdex.net/v2/de/cards');
    console.log(`✅ Found ${deCards.length} German cards in TCGdex.`);

    const imageRecordsMap = new Map();

    for (const card of deCards) {
      if (!card.image) continue;
      const imageUrl = card.image.endsWith('.png') || card.image.endsWith('.webp') || card.image.endsWith('.jpg') 
        ? card.image 
        : `${card.image}/high.webp`;

      const cardNameSlug = slugify(card.name || '');
      const localId = card.localId || '';
      
      // Standard Cardmarket URL path patterns
      const primaryKey = `tcgdex_${card.id}`;
      const nameKey = cardNameSlug && localId ? `/Pokemon/Products/Singles/${cardNameSlug}-${localId}` : null;
      const rawCodeKey = localId ? `code_${localId}` : null;

      if (imageUrl) {
        imageRecordsMap.set(primaryKey, { card_id: primaryKey, image_url: imageUrl });
        if (nameKey) imageRecordsMap.set(nameKey, { card_id: nameKey, image_url: imageUrl });
        if (rawCodeKey && !imageRecordsMap.has(rawCodeKey)) {
          imageRecordsMap.set(rawCodeKey, { card_id: rawCodeKey, image_url: imageUrl });
        }
      }
    }

    console.log(`📦 Fetching English cards list from TCGdex API...`);
    const enCards = await fetchJSON('https://api.tcgdex.net/v2/en/cards');
    console.log(`✅ Found ${enCards.length} English cards in TCGdex.`);

    for (const card of enCards) {
      if (!card.image) continue;
      const imageUrl = card.image.endsWith('.png') || card.image.endsWith('.webp') || card.image.endsWith('.jpg') 
        ? card.image 
        : `${card.image}/high.webp`;

      const cardNameSlug = slugify(card.name || '');
      const localId = card.localId || '';
      const primaryKey = `tcgdex_${card.id}`;
      const nameKey = cardNameSlug && localId ? `/Pokemon/Products/Singles/${cardNameSlug}-${localId}` : null;

      if (imageUrl) {
        if (!imageRecordsMap.has(primaryKey)) imageRecordsMap.set(primaryKey, { card_id: primaryKey, image_url: imageUrl });
        if (nameKey && !imageRecordsMap.has(nameKey)) imageRecordsMap.set(nameKey, { card_id: nameKey, image_url: imageUrl });
      }
    }

    const uniqueRecords = Array.from(imageRecordsMap.values());
    console.log(`📊 Prepared ${uniqueRecords.length} unique card image records for bulk upsert.`);

    const count = await bulkUpsertCardImages(uniqueRecords);
    console.log(`🎉 Import completed! Successfully upserted ${count} card images into Supabase.`);
  } catch (err) {
    console.error('❌ Import failed with error:', err);
  }
}

runImport();
