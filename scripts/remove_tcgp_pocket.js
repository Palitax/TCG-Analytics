/**
 * Script to delete all TCG Pocket (Mobile Game) cards from Supabase card_images.
 * 
 * TCG Pocket cards in TCGdex are stored under series/path '/tcgp/'.
 * 
 * Usage:
 *   node scripts/remove_tcgp_pocket.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://api-supabase.rohdedigital.de";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk";

async function removeTcgpCards() {
  console.log('🚀 Starting removal of Pokémon TCG Pocket cards from Supabase...');

  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      // 1. Fetch batch of TCG Pocket image records
      const fetchUrl = `${SUPABASE_URL}/rest/v1/card_images?select=card_id&image_url=ilike.%25/tcgp/%25&limit=40`;
      const resp = await fetch(fetchUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });

      if (!resp.ok) {
        console.error('Fetch error:', resp.status, await resp.text());
        break;
      }

      const rows = await resp.json();
      if (!rows || rows.length === 0) {
        console.log('✅ No more TCG Pocket card records found with image_url containing /tcgp/.');
        hasMore = false;
        break;
      }

      const idsToDelete = rows.map(r => r.card_id);
      const encodedIds = idsToDelete.map(id => `"${id.replace(/"/g, '""')}"`).join(',');

      // 2. Delete batch
      const deleteUrl = `${SUPABASE_URL}/rest/v1/card_images?card_id=in.(${encodeURIComponent(encodedIds)})`;
      const delResp = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });

      if (delResp.ok) {
        totalDeleted += idsToDelete.length;
        if (totalDeleted % 500 === 0 || idsToDelete.length < 40) {
          console.log(`[Cleaned] Deleted ${totalDeleted} TCG Pocket records...`);
        }
      } else {
        console.error('Delete error:', delResp.status, await delResp.text());
        break;
      }
    } catch (err) {
      console.error('Exception during deletion:', err);
      break;
    }
  }

  console.log(`🎉 Finished cleaning TCG Pocket records! Total deleted: ${totalDeleted}`);
}

removeTcgpCards();
