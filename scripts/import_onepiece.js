/**
 * One Piece TCG Bulk Importer Script for TCG Card Tracker
 * 
 * Fetches all English & Japanese One Piece TCG sets & cards from OPTCG API,
 * maps Set Names and Card Codes (e.g. "Roronoa Zoro OP01-001 (Romance Dawn)"),
 * and bulk-upserts them directly into Supabase (card_images table).
 * 
 * Usage:
 *   node scripts/import_onepiece.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://api-supabase.rohdedigital.de";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk";
const OPTCG_API_URL = "https://optcg-api.arjunbansal-ai.workers.dev";

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

async function fetchJSON(url, headers = {}) {
  const resp = await fetch(url, { headers });
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
        console.warn(`[Batch ${Math.floor(i / batchSize) + 1}] Warning response:`, resp.status, errText);
      } else {
        totalUploaded += batch.length;
        if (totalUploaded % 1500 === 0 || i + batchSize >= records.length) {
          console.log(`[Batch ${Math.floor(i / batchSize) + 1}] Uploaded ${totalUploaded} / ${records.length} card images...`);
        }
      }
    } catch (e) {
      console.error(`[Batch ${Math.floor(i / batchSize) + 1}] Exception:`, e.message);
    }
  }

  return totalUploaded;
}

function cleanSetName(rawLabel, setId) {
  if (!rawLabel) return setId || 'One Piece Set';
  let clean = rawLabel.replace(/BOOSTER PACK|STARTER DECK|EXTRA BOOSTER|PREMIUM BOOSTER/gi, '').trim();
  clean = clean.replace(/-\[[^\]]+\]/g, '').replace(/\[[^\]]+\]/g, '').trim();
  clean = clean.replace(/^-\s*/, '').replace(/\s*-$/, '').trim();
  return clean || setId || 'One Piece Set';
}

async function runImport() {
  console.log('🚀 Starting One Piece TCG Bulk Import to Supabase...');
  console.log(`📍 Supabase Endpoint: ${SUPABASE_URL}`);

  try {
    const headers = { 'Origin': 'https://opbindr.com' };

    console.log('📦 Fetching One Piece TCG sets list...');
    const setsResp = await fetchJSON(`${OPTCG_API_URL}/sets`, headers);
    const setList = setsResp.data || [];
    console.log(`✅ Found ${setList.length} One Piece sets.`);

    const setMap = new Map();
    for (const setItem of setList) {
      const cleanedName = cleanSetName(setItem.label, setItem.id);
      setMap.set(setItem.id, cleanedName);
      if (setItem.pack_id) setMap.set(setItem.pack_id, cleanedName);
    }

    console.log('📦 Fetching all One Piece TCG card records (English + Japanese)...');
    const cardsResp = await fetchJSON(`${OPTCG_API_URL}/cards/all`, headers);
    const allCards = cardsResp.data || [];
    console.log(`✅ Fetched ${allCards.length} total card records from OPTCG API.`);

    const imageRecordsMap = new Map();

    for (const card of allCards) {
      if (!card.image_url) continue;

      const rawCode = (card.id || '').split('_')[0].trim();
      const setPrefix = rawCode.split('-')[0] || '';
      const setName = setMap.get(setPrefix) || setMap.get(card.set_id) || setPrefix || 'One Piece TCG';
      
      const isJapanese = card.image_url.includes('/www.onepiece-cardgame.com/') || card.price_ja !== null || /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(card.name || '');
      const langSuffix = isJapanese ? ' Japanese' : '';
      const fullSetName = `${setName}${langSuffix}`;
      
      const setSlug = slugify(fullSetName);
      const cardName = card.name || 'One Piece Card';
      const cardNameSlug = slugify(cardName);

      // Cardmarket URL path format for One Piece singles
      const keyCmPath = setSlug && rawCode
        ? `/OnePiece/Products/Singles/${setSlug}/${cardNameSlug}-${rawCode}`
        : `/OnePiece/Products/Singles/${cardNameSlug}-${rawCode}`;

      // Readable title key e.g. "Roronoa Zoro OP01-001 (Romance Dawn)"
      const keyReadable = `${cardName} ${rawCode} (${fullSetName})`.trim();
      const keyRawCode = rawCode ? `onepiece_${rawCode}` : null;
      const keyCardId = `optcg_${card.id}`;

      if (card.image_url) {
        imageRecordsMap.set(keyCmPath, { card_id: keyCmPath, image_url: card.image_url });
        imageRecordsMap.set(keyReadable, { card_id: keyReadable, image_url: card.image_url });
        imageRecordsMap.set(keyCardId, { card_id: keyCardId, image_url: card.image_url });
        if (keyRawCode && !imageRecordsMap.has(keyRawCode)) {
          imageRecordsMap.set(keyRawCode, { card_id: keyRawCode, image_url: card.image_url });
        }
      }
    }

    const uniqueRecords = Array.from(imageRecordsMap.values());
    console.log(`📊 Prepared ${uniqueRecords.length} unique One Piece card image records.`);

    const count = await bulkUpsertCardImages(uniqueRecords);
    console.log(`🎉 Import completed! Successfully upserted ${count} One Piece card image records into Supabase.`);
  } catch (err) {
    console.error('❌ Import failed with error:', err);
  }
}

runImport();
