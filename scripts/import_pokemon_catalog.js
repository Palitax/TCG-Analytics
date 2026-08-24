/**
 * Pokémon Product Catalog Importer for TCG Card Tracker
 * 
 * Fetches German, English, and Japanese Pokémon sets & cards from TCGdex API,
 * adds Chinese sets (Gem Pack Vol 1-6, Crossing Shadows, Brave Stars, Nine Colors),
 * attaches Set Names and Card Codes, and bulk-upserts them into Supabase (card_images).
 * 
 * Usage:
 *   node scripts/import_pokemon_catalog.js
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
  
  const batchSize = 250;
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
        console.warn(`[Batch ${Math.floor(i / batchSize) + 1}] Warning response:`, resp.status, errText);
      } else {
        totalUploaded += batch.length;
        console.log(`[Batch ${Math.floor(i / batchSize) + 1}] Uploaded ${totalUploaded} / ${records.length} records...`);
      }
    } catch (e) {
      console.error(`[Batch ${Math.floor(i / batchSize) + 1}] Exception:`, e.message);
    }
  }

  return totalUploaded;
}

async function processLanguageSets(lang) {
  console.log(`📦 Fetching ${lang.toUpperCase()} sets from TCGdex...`);
  let setsList = [];
  try {
    setsList = await fetchJSON(`https://api.tcgdex.net/v2/${lang}/sets`);
    console.log(`✅ Found ${setsList.length} ${lang.toUpperCase()} sets.`);
  } catch (err) {
    console.warn(`Could not fetch set list for ${lang}:`, err.message);
    return [];
  }

  const recordsMap = new Map();

  for (let sIdx = 0; sIdx < setsList.length; sIdx++) {
    const setSummary = setsList[sIdx];
    try {
      const setDetail = await fetchJSON(`https://api.tcgdex.net/v2/${lang}/sets/${setSummary.id}`);
      const setName = setDetail.name || setSummary.name || '';
      const setSlug = slugify(setName);
      const setId = setSummary.id || '';
      const officialCount = setDetail.cardCount?.official || setDetail.cardCount?.total || '';
      const cards = setDetail.cards || [];

      for (const card of cards) {
        const cardName = card.name || '';
        const localId = card.localId || '';
        const cardNameSlug = slugify(cardName);
        const fullNumber = officialCount ? `${localId}/${officialCount}` : localId;

        const imageUrl = card.image
          ? (card.image.endsWith('.png') || card.image.endsWith('.webp') || card.image.endsWith('.jpg') ? card.image : `${card.image}/high.webp`)
          : `https://assets.tcgdex.net/${lang}/${setId}/${localId}/high.webp`;

        // Keys for card matching:
        // 1. Primary Cardmarket Singles path
        const keyFullTitle = setSlug 
          ? `/Pokemon/Products/Singles/${setSlug}/${cardNameSlug}-${localId}`
          : `/Pokemon/Products/Singles/${cardNameSlug}-${localId}`;
        
        // 2. Readable card title key
        const keyReadable = `${cardName} ${fullNumber} (${setName})`.trim();

        // 3. Set Code + Number (e.g. "sv2a 173", "MEW 173")
        const keySetNum = `${setId.toUpperCase()} ${localId}`;

        // 4. Compact Fraction key
        const keyFrac = `/Pokemon/Products/Singles/${cardNameSlug}-${localId}-${officialCount}`;

        recordsMap.set(keyFullTitle, { card_id: keyFullTitle, image_url: imageUrl, tcg: 'Pokemon' });
        recordsMap.set(keyReadable, { card_id: keyReadable, image_url: imageUrl, tcg: 'Pokemon' });
        recordsMap.set(keySetNum, { card_id: keySetNum, image_url: imageUrl, tcg: 'Pokemon' });
        if (officialCount) {
          recordsMap.set(keyFrac, { card_id: keyFrac, image_url: imageUrl, tcg: 'Pokemon' });
        }
      }

      if ((sIdx + 1) % 25 === 0 || sIdx === setsList.length - 1) {
        console.log(`[${lang.toUpperCase()}] Processed ${sIdx + 1} / ${setsList.length} sets...`);
      }
    } catch (err) {
      // ignore individual set error
    }
  }

  return Array.from(recordsMap.values());
}

function getChineseSetRecords() {
  console.log('📦 Generating Chinese Set Product records...');
  const records = [];

  const chineseSets = [
    { code: 'CBB1C', name: 'Gem Pack Vol. 1', slug: 'Gem-Pack-Vol-1', cardsCount: 30, variantsCount: 9 },
    { code: 'CBB2C', name: 'Gem Pack Vol. 2', slug: 'Gem-Pack-Vol-2', cardsCount: 30, variantsCount: 9 },
    { code: 'CBB3C', name: 'Gem Pack Vol. 3', slug: 'Gem-Pack-Vol-3', cardsCount: 30, variantsCount: 9 },
    { code: 'CBB4C', name: 'Gem Pack Vol. 4', slug: 'Gem-Pack-Vol-4', cardsCount: 40, variantsCount: 7 },
    { code: 'CBB5C', name: 'Gem Pack Vol. 5', slug: 'Gem-Pack-Vol5', cardsCount: 40, variantsCount: 7 },
    { code: 'CBB6C', name: 'Gem Pack Vol. 6', slug: 'Gem-Pack-Vol-6', cardsCount: 40, variantsCount: 7 },
    { code: 'CS1a', name: 'Crossing Shadows: Origin', slug: 'Crossing-Shadows-Origin', cardsCount: 150, variantsCount: 1 },
    { code: 'CS1b', name: 'Crossing Shadows: Spark', slug: 'Crossing-Shadows-Spark', cardsCount: 150, variantsCount: 1 },
    { code: 'CS2a', name: 'Brave Stars: Flash', slug: 'Brave-Stars-Flash', cardsCount: 150, variantsCount: 1 },
    { code: 'CS2b', name: 'Brave Stars: Spark', slug: 'Brave-Stars-Spark', cardsCount: 150, variantsCount: 1 },
    { code: 'CS5a', name: 'Nine Colors Gathering: Origin', slug: 'Nine-Colors-Gathering-Origin', cardsCount: 150, variantsCount: 1 },
    { code: 'CS5b', name: 'Nine Colors Gathering: Spark', slug: 'Nine-Colors-Gathering-Spark', cardsCount: 150, variantsCount: 1 }
  ];

  for (const set of chineseSets) {
    for (let c = 1; c <= set.cardsCount; c++) {
      const cardNumPad = String(c).padStart(2, '0');
      for (let v = 1; v <= set.variantsCount; v++) {
        const variantTag = `V${v}`;
        const compoundCode = `${cardNumPad}${String(v).padStart(2, '0')}/${String(set.variantsCount).padStart(2, '0')}`;
        
        // Cardmarket product path keys
        const cmPath = `/Pokemon/Products/Singles/${set.slug}/Card-${variantTag}-${set.code}${cardNumPad}`;
        const keySlug = `${variantTag}-${set.code}${cardNumPad}`;
        const keyCompound = `${set.code} ${compoundCode}`;
        const keySetNum = `${set.code} ${cardNumPad}`;

        records.push({
          card_id: cmPath,
          image_url: null,
          tcg: 'Pokemon'
        });
        records.push({
          card_id: keySlug,
          image_url: null,
          tcg: 'Pokemon'
        });
        records.push({
          card_id: keyCompound,
          image_url: null,
          tcg: 'Pokemon'
        });
        records.push({
          card_id: keySetNum,
          image_url: null,
          tcg: 'Pokemon'
        });
      }
    }
  }

  return records;
}

async function runImport() {
  console.log('🚀 Starting Pokémon Product Catalog Importer...');
  console.log(`📍 Supabase Endpoint: ${SUPABASE_URL}`);

  try {
    const deRecords = await processLanguageSets('de');
    console.log(`📊 Prepared ${deRecords.length} German records.`);

    const enRecords = await processLanguageSets('en');
    console.log(`📊 Prepared ${enRecords.length} English records.`);

    const jaRecords = await processLanguageSets('ja');
    console.log(`📊 Prepared ${jaRecords.length} Japanese records.`);

    const zhRecords = getChineseSetRecords();
    console.log(`📊 Prepared ${zhRecords.length} Chinese records.`);

    const allRecordsMap = new Map();
    for (const r of [...deRecords, ...enRecords, ...jaRecords, ...zhRecords]) {
      if (r.card_id && !allRecordsMap.has(r.card_id)) {
        allRecordsMap.set(r.card_id, r);
      }
    }

    const uniqueRecords = Array.from(allRecordsMap.values());
    console.log(`📊 Total unique Pokémon catalog records to upsert: ${uniqueRecords.length}`);

    const count = await bulkUpsertCardImages(uniqueRecords);
    console.log(`🎉 Pokémon Catalog Import completed! Upserted ${count} records into Supabase.`);
  } catch (err) {
    console.error('❌ Import failed with error:', err);
  }
}

runImport();
