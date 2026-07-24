const SUPABASE_URL = "https://api-supabase.rohdedigital.de";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk";



// Convert Image Blob to WebP format with max dimension scaling via OffscreenCanvas
async function convertImageBlobToWebP(blob, maxDimension = 800, quality = 0.8) {
  if (!blob) return null;
  try {
    const imageBitmap = await createImageBitmap(blob);
    let width = imageBitmap.width;
    let height = imageBitmap.height;

    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const offscreen = new OffscreenCanvas(width, height);
    const ctx = offscreen.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageBitmap, 0, 0, width, height);

    const webpBlob = await offscreen.convertToBlob({ type: 'image/webp', quality: quality });
    return webpBlob;
  } catch (err) {
    console.warn("OffscreenCanvas WebP conversion fallback:", err);
    return blob;
  }
}

// Fetch remote image directly as a binary Blob in background service worker
async function fetchImageBlob(url) {
  if (!url) return null;
  try {
    if (url.startsWith('data:')) {
      const res = await fetch(url);
      return await res.blob();
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
  } catch (err) {
    console.error("Failed to fetch image blob directly:", err);
    return null;
  }
}

// Robust base64url decoder to decode JWT payload safely
function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    return JSON.parse(atob(padded));
  } catch (err) {
    console.error("Failed to decode JWT:", err);
    return null;
  }
}

// Helper to get active session tokens, with auto-refresh if expired
async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  if (!session) return null;

  // Check if access token is expired or close to expiry (e.g. expires in less than 5 minutes)
  try {
    const payload = decodeJWT(session.access_token);
    if (!payload) return null;
    
    const now = Math.floor(Date.now() / 1000);
    // If token is expired or expiring in under 5 minutes, refresh it
    if (payload.exp - now < 300) {
      console.log("Access token expiring soon. Refreshing...");
      return await refreshSession(session.refresh_token);
    }
    return session;
  } catch (err) {
    console.error("Error checking token expiry:", err);
    return null;
  }
}

// Refresh Supabase session using the refresh token
async function refreshSession(refreshToken) {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = await response.json();
    const newSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user
    };

    await chrome.storage.local.set({ session: newSession });
    console.log("Session refreshed successfully.");
    return newSession;
  } catch (err) {
    console.error("Token refresh failed. User must log in again.", err);
    await chrome.storage.local.remove('session');
    return null;
  }
}

// Trigger Google OAuth authorization flow via launchWebAuthFlow
async function loginUser() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;

  console.log("Starting Web Auth Flow on URL:", authUrl);
  
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, async (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        console.error("OAuth Flow Error:", chrome.runtime.lastError);
        return reject(new Error(chrome.runtime.lastError?.message || "OAuth Flow cancelled"));
      }

      try {
        // Parse returned tokens from URL hash fragment
        const url = new URL(responseUrl.replace('#', '?'));
        const accessToken = url.searchParams.get('access_token');
        const refreshToken = url.searchParams.get('refresh_token');

        if (!accessToken || !refreshToken) {
          throw new Error("Missing tokens in OAuth callback response");
        }

        // Decode JWT payload to get user details
        const payload = decodeJWT(accessToken);
        if (!payload) {
          throw new Error("Failed to decode JWT response from OAuth provider");
        }

        const session = {
          access_token: accessToken,
          refresh_token: refreshToken,
          user: {
            id: payload.sub,
            email: payload.email
          }
        };

        await chrome.storage.local.set({ session });
        console.log("Login successful for user:", payload.email);
        resolve(session);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Main message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === "login") {
        const session = await loginUser();
        sendResponse({ success: true, user: session.user });
      } 
      
      else if (message.action === "logout") {
        await chrome.storage.local.remove('session');
        sendResponse({ success: true });
      } 
      
      else if (message.action === "getSession") {
        const session = await getSession();
        sendResponse({ authenticated: !!session, user: session?.user || null });
      }
      
      else if (message.action === "scanCard") {
        const session = await getSession();
        if (!session) {
          return sendResponse({ error: "UNAUTHENTICATED" });
        }

        const { tcg, cardId, condition, language, sellerCountry, currentPrice, comment, force, matchedCondition, matchedLanguage, matchedCountry } = message;
        const accessToken = session.access_token;
        const userId = session.user.id;

        // 1. Fetch full historical price list from Supabase sorted ascending (oldest first)
        const getUrl = `${SUPABASE_URL}/rest/v1/price_history?tcg=eq.${encodeURIComponent(tcg)}&card_id=eq.${encodeURIComponent(cardId)}&condition=eq.${encodeURIComponent(condition)}&language=eq.${encodeURIComponent(language)}&seller_country=eq.${encodeURIComponent(sellerCountry)}&order=scanned_at.asc`;
        
        const getResponse = await fetch(getUrl, {
          method: "GET",
          cache: "no-store",
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${accessToken}`
          }
        });

        if (!getResponse.ok) {
          throw new Error(`Failed to fetch history: ${getResponse.statusText}`);
        }

        const history = await getResponse.json();
        
        // The latest record before the scan is the last element in the historical list
        const latestRecordBeforeScan = history.length > 0 ? history[history.length - 1] : null;

        let shouldUpload = false;
        let blocked = false;
        let remainingTime = 0;
        
        if (!latestRecordBeforeScan) {
          // No history exists for this specific combination
          shouldUpload = true;
        } else {
          const lastPrice = parseFloat(latestRecordBeforeScan.price);
          const lastComment = latestRecordBeforeScan.comment || '';
          
          let parsedLastComment = lastComment;
          if (lastComment.startsWith('[')) {
            const match = lastComment.match(/^\[[^\]]*\](?:\s*(.*))?$/);
            if (match) {
              parsedLastComment = match[1] || '';
            }
          }
          const currentComment = comment || '';
          const timeSinceLastScan = Date.now() - new Date(latestRecordBeforeScan.scanned_at).getTime();
          
          if (force === true) {
            shouldUpload = true;
          } else if (lastPrice !== currentPrice || parsedLastComment !== currentComment) {
            shouldUpload = true;
          } else if (timeSinceLastScan >= 86400000) {
            shouldUpload = true;
          } else {
            blocked = true;
            remainingTime = 86400000 - timeSinceLastScan;
          }
        }

        // 2. Perform upload if triggered
        if (shouldUpload) {
          // Embed specific match details as metadata prefix in the comment column
          const metadataPrefix = `[${matchedLanguage || ''}|${matchedCountry || ''}|${matchedCondition || ''}]`;
          const dbComment = comment ? `${metadataPrefix} ${comment}` : metadataPrefix;

          const newRecordData = {
            tcg: tcg,
            card_id: cardId,
            price: currentPrice,
            condition: condition,
            language: language,
            seller_country: sellerCountry,
            comment: dbComment,
            user_id: userId
          };

          const postResponse = await fetch(`${SUPABASE_URL}/rest/v1/price_history`, {
            method: "POST",
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify(newRecordData)
          });

          if (!postResponse.ok) {
            const errText = await postResponse.text();
            console.error("Failed to upload new scan to Supabase:", postResponse.status, postResponse.statusText, errText);
          } else {
            console.log(`Successfully uploaded scan: ${tcg} | ${cardId} (${condition} | ${language} | ${sellerCountry}) = ${currentPrice} € (Comment: "${comment || ''}")`);
            
            // Push representation of new record with mock/actual timestamp to history array for graph visualization
            const createdRecord = {
              ...newRecordData,
              scanned_at: new Date().toISOString()
            };
            history.push(createdRecord);
          }
        }

        // 3. Query marked state from the database
        let isMarked = false;
        try {
          const bookmarkUrl = `${SUPABASE_URL}/rest/v1/marked_cards?user_id=eq.${userId}&tcg=eq.${encodeURIComponent(tcg)}&card_id=eq.${encodeURIComponent(cardId)}`;
          const bookmarkResponse = await fetch(bookmarkUrl, {
            method: "GET",
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${accessToken}`
            }
          });
          if (bookmarkResponse.ok) {
            const bookmarks = await bookmarkResponse.json();
            isMarked = bookmarks.length > 0;
          }
        } catch (err) {
          console.error("Failed to query marked status:", err);
        }

        // Query collection state from the database
        let isInCollection = false;
        try {
          const collectionUrl = `${SUPABASE_URL}/rest/v1/collection_cards?user_id=eq.${userId}&tcg=eq.${encodeURIComponent(tcg)}&card_id=eq.${encodeURIComponent(cardId)}`;
          const collectionResponse = await fetch(collectionUrl, {
            method: "GET",
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${accessToken}`
            }
          });
          if (collectionResponse.ok) {
            const collectionItems = await collectionResponse.json();
            isInCollection = collectionItems.length > 0;
          }
        } catch (err) {
          console.error("Failed to query collection status:", err);
        }

        const payload = decodeJWT(accessToken);
        const isAdmin = payload && (
          payload.app_metadata?.role === 'admin' ||
          payload.user_metadata?.role === 'admin' ||
          payload.role === 'admin'
        );

        console.log("[TCG Tracker SW] scanCard completed response. Email:", session.user.email, "isAdmin:", !!isAdmin, "app_metadata:", payload?.app_metadata, "user_metadata:", payload?.user_metadata);

        sendResponse({
          success: true,
          history: history,
          latestRecordBeforeScan: latestRecordBeforeScan,
          currentUserId: userId,
          blocked: blocked,
          remainingTime: remainingTime,
          isMarked: isMarked,
          isInCollection: isInCollection,
          isAdmin: !!isAdmin
        });
      }
      
      else if (message.action === "setFirstScan") {
        const session = await getSession();
        if (!session) {
          return sendResponse({ error: "UNAUTHENTICATED" });
        }

        const payload = decodeJWT(session.access_token);
        const isAdmin = payload && (
          payload.app_metadata?.role === 'admin' ||
          payload.user_metadata?.role === 'admin' ||
          payload.role === 'admin'
        );

        if (!isAdmin) {
          return sendResponse({ error: "UNAUTHORIZED: Admin only option" });
        }

        const { tcg, cardId, condition, language, sellerCountry, price, comment } = message;

        // Fetch the oldest record to get its ID (scanned_at ascending, limit 1)
        const getUrl = `${SUPABASE_URL}/rest/v1/price_history?tcg=eq.${encodeURIComponent(tcg)}&card_id=eq.${encodeURIComponent(cardId)}&condition=eq.${encodeURIComponent(condition)}&language=eq.${encodeURIComponent(language)}&seller_country=eq.${encodeURIComponent(sellerCountry)}&order=scanned_at.asc&limit=1`;
        
        const getRes = await fetch(getUrl, {
          method: "GET",
          cache: "no-store",
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${session.access_token}`
          }
        });

        if (!getRes.ok) {
          return sendResponse({ error: `Failed to fetch oldest record: ${getRes.statusText}` });
        }

        const oldestRecords = await getRes.json();
        console.log("[TCG Tracker SW] setFirstScan - oldestRecords matching filters:", oldestRecords);
        if (oldestRecords.length === 0) {
          return sendResponse({ error: "No records found to overwrite" });
        }

        const firstRecordId = oldestRecords[0].id;

        // Overwrite the first record in the database using PATCH
        const updateUrl = `${SUPABASE_URL}/rest/v1/price_history?id=eq.${firstRecordId}`;
        const metadataPrefix = `[${language}|${sellerCountry}|${condition}]`;
        const dbComment = comment ? `${metadataPrefix} ${comment}` : metadataPrefix;

        const updateRes = await fetch(updateUrl, {
          method: "PATCH",
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            price: parseFloat(price),
            comment: dbComment,
            user_id: session.user.id
          })
        });

        if (!updateRes.ok) {
          const errText = await updateRes.text();
          return sendResponse({ error: `Failed to update record: ${errText}` });
        }

        const updatedData = await updateRes.json();
        console.log("[TCG Tracker SW] PATCH response status:", updateRes.status, "data:", updatedData);
        
        if (updatedData.length === 0) {
          return sendResponse({ error: "Keine Zeile aktualisiert. Bitte prüfe die RLS-Datenbankrechte (UPDATE-Policy auf price_history)." });
        }

        sendResponse({ success: true });
      }

      else if (message.action === "toggleBookmark") {
        const session = await getSession();
        if (!session) {
          return sendResponse({ error: "UNAUTHENTICATED" });
        }

        const { tcg, cardId, shouldMark } = message;
        const accessToken = session.access_token;
        const userId = session.user.id;

        if (shouldMark) {
          const bookmarkData = {
            user_id: userId,
            tcg: tcg,
            card_id: cardId,
            image_url: null
          };

          const postRes = await fetch(`${SUPABASE_URL}/rest/v1/marked_cards`, {
            method: "POST",
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify(bookmarkData)
          });

          if (!postRes.ok) {
            const errTxt = await postRes.text();
            try {
              const errObj = JSON.parse(errTxt);
              if (errObj && errObj.code === "23505") {
                // Already bookmarked - ignore error
                return sendResponse({ success: true });
              }
            } catch (e) {}
            throw new Error(`Failed to bookmark card: ${postRes.statusText} - ${errTxt}`);
          }
        } else {
          const deleteUrl = `${SUPABASE_URL}/rest/v1/marked_cards?user_id=eq.${userId}&tcg=eq.${encodeURIComponent(tcg)}&card_id=eq.${encodeURIComponent(cardId)}`;
          const deleteRes = await fetch(deleteUrl, {
            method: "DELETE",
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${accessToken}`
            }
          });

          if (!deleteRes.ok) {
            const errTxt = await deleteRes.text();
            throw new Error(`Failed to remove bookmark: ${deleteRes.statusText} - ${errTxt}`);
          }
        }

        sendResponse({ success: true });
      }

      else if (message.action === "toggleCollection") {
        const session = await getSession();
        if (!session) {
          return sendResponse({ error: "UNAUTHENTICATED" });
        }

        const { tcg, cardId, shouldCollect } = message;
        const accessToken = session.access_token;
        const userId = session.user.id;

        if (shouldCollect) {
          const collectData = {
            user_id: userId,
            tcg: tcg,
            card_id: cardId,
            image_url: null
          };

          const postRes = await fetch(`${SUPABASE_URL}/rest/v1/collection_cards`, {
            method: "POST",
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify(collectData)
          });

          if (!postRes.ok) {
            const errTxt = await postRes.text();
            try {
              const errObj = JSON.parse(errTxt);
              if (errObj && errObj.code === "23505") {
                // Already in collection - ignore error
                return sendResponse({ success: true });
              }
            } catch (e) {}
            throw new Error(`Failed to add card to collection: ${postRes.statusText} - ${errTxt}`);
          }
        } else {
          const deleteUrl = `${SUPABASE_URL}/rest/v1/collection_cards?user_id=eq.${userId}&tcg=eq.${encodeURIComponent(tcg)}&card_id=eq.${encodeURIComponent(cardId)}`;
          const deleteRes = await fetch(deleteUrl, {
            method: "DELETE",
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${accessToken}`
            }
          });

          if (!deleteRes.ok) {
            const errTxt = await deleteRes.text();
            throw new Error(`Failed to remove card from collection: ${deleteRes.statusText} - ${errTxt}`);
          }
        }

        sendResponse({ success: true });
      }

      else if (message.action === "openTabs") {
        const { urls } = message;
        if (urls && Array.isArray(urls)) {
          (async () => {
            try {
              const session = await getSession();
              let cardPrefs = {};
              let globalPrefs = {};
              if (session && session.user) {
                const userId = session.user.id;
                const cardPrefsKey = 'card_preferences_' + userId;
                const globalPrefsKey = 'preferences_' + userId;
                const storage = await chrome.storage.local.get([cardPrefsKey, globalPrefsKey]);
                cardPrefs = storage[cardPrefsKey] || {};
                globalPrefs = storage[globalPrefsKey] || {};
              }

              const CONDITION_URL_MAP = {
                "MT": "1",
                "NM": "2",
                "EX": "3",
                "GD": "4",
                "LP": "5",
                "PL": "6",
                "PO": "7"
              };

              const LANGUAGE_URL_MAP = {
                "EN": "1",
                "FR": "2",
                "DE": "3",
                "ES": "4",
                "IT": "5",
                "JP": "7",
                "ZH": "8",
                "KO": "10"
              };

              for (const urlStr of urls) {
                let resolvedUrl = urlStr;
                try {
                  const urlObj = new URL(urlStr);
                  const cardId = urlObj.pathname;
                  
                  const filters = cardPrefs[cardId] || globalPrefs || {};
                  const params = new URLSearchParams(urlObj.search);
                  
                  const condition = filters.condition || 'NM';
                  if (CONDITION_URL_MAP[condition]) {
                    params.set('minCondition', CONDITION_URL_MAP[condition]);
                  }
                  
                  const language = filters.language || 'ALL';
                  if (language !== 'ALL' && LANGUAGE_URL_MAP[language]) {
                    params.set('language', LANGUAGE_URL_MAP[language]);
                  }
                  
                  const location = filters.location || 'DE';
                  if (location === 'DE') {
                    params.set('sellerCountry', '7');
                  } else {
                    params.delete('sellerCountry');
                  }
                  
                  urlObj.search = params.toString();
                  resolvedUrl = urlObj.toString();
                } catch (e) {
                  console.error("Failed to parse/resolve URL:", urlStr, e);
                }

                chrome.tabs.create({ url: resolvedUrl, active: false });
                await new Promise(r => setTimeout(r, 50));
              }
            } catch (err) {
              console.error("Error in openTabs loop:", err);
            }
          })();
        }
        sendResponse({ success: true });
      }

      else if (message.action === "saveClippedImage") {
        const { cardId, tcg, imageUrl } = message;
        (async () => {
          try {
            const rawBlob = await fetchImageBlob(imageUrl);
            if (!rawBlob) {
              throw new Error("Failed to fetch image blob");
            }

            const webpBlob = await convertImageBlobToWebP(rawBlob, 800, 0.8);
            
            const sanitizedId = cardId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
            const sanitizedTcg = tcg ? tcg.toLowerCase() : 'tcg';
            const fileName = `${sanitizedTcg}_${sanitizedId}.webp`;
            const bucketName = 'card-images';
            let finalImageUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucketName}/${fileName}`;

            // Sync with Supabase: save to card_images and update marked_cards
            try {
              const { session } = await chrome.storage.local.get('session');
              if (session && session.access_token) {
                const accessToken = session.access_token;

                // Deduplication Pre-check: HEAD request to check if file already exists in Storage
                let fileExists = false;
                try {
                  const headCheck = await fetch(finalImageUrl, { method: 'HEAD' });
                  if (headCheck.ok) {
                    fileExists = true;
                  }
                } catch (e) {}

                if (!fileExists && webpBlob) {
                  const storageRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucketName}/${fileName}`, {
                    method: "POST",
                    headers: {
                      "apikey": SUPABASE_ANON_KEY,
                      "Authorization": `Bearer ${accessToken}`,
                      "Content-Type": "image/webp",
                      "cache-control": "31536000",
                      "x-upsert": "true"
                    },
                    body: webpBlob
                  });

                  if (!storageRes.ok) {
                    console.warn("Storage upload in background failed:", storageRes.status, await storageRes.text());
                  }
                }
                
                // 1. Upsert into card_images
                const imgData = {
                  card_id: cardId,
                  tcg: tcg,
                  image_url: finalImageUrl,
                  updated_at: new Date().toISOString()
                };

                const imgRes = await fetch(`${SUPABASE_URL}/rest/v1/card_images`, {
                  method: "POST",
                  headers: {
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates"
                  },
                  body: JSON.stringify(imgData)
                });

                if (!imgRes.ok) {
                  console.error("Failed to upload clipped image to card_images:", imgRes.status, imgRes.statusText);
                }

                // 2. Update private marked_cards if bookmarked
                const userId = session.user?.id;
                if (userId) {
                  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/marked_cards?user_id=eq.${userId}&card_id=eq.${encodeURIComponent(cardId)}`, {
                    method: "PATCH",
                    headers: {
                      "apikey": SUPABASE_ANON_KEY,
                      "Authorization": `Bearer ${accessToken}`,
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ image_url: finalImageUrl })
                  });

                  if (!updateRes.ok) {
                    console.error("Failed to update marked_cards with clipped image:", updateRes.status, updateRes.statusText);
                  }
                }
              }
            } catch (syncErr) {
              console.error("Failed syncing clipped image to Supabase:", syncErr);
            }

            sendResponse({ success: true, imageUrl: finalImageUrl });
          } catch (err) {
            console.error("Failed to save clipped image:", err);
            sendResponse({ error: err.message });
          }
        })();
      }

      else if (message.action === "getClippedImages") {
        const { cardId } = message;
        (async () => {
          try {
            const { clippedImages = [] } = await chrome.storage.local.get('clippedImages');
            const filtered = cardId 
              ? clippedImages.filter(img => img.cardId === cardId)
              : clippedImages;
            sendResponse({ success: true, images: filtered });
          } catch (err) {
            console.error("Failed to get clipped images:", err);
            sendResponse({ error: err.message });
          }
        })();
      }

      else if (message.action === "deleteClippedImage") {
        const { cardId, image, timestamp } = message;
        (async () => {
          try {
            const { clippedImages = [] } = await chrome.storage.local.get('clippedImages');
            const updated = clippedImages.filter(img => {
              if (timestamp && img.timestamp === timestamp) return false;
              if (img.cardId === cardId && img.image === image) return false;
              return true;
            });
            await chrome.storage.local.set({ clippedImages: updated });
            
            // Return updated list of remaining images for this cardId
            const filtered = cardId 
              ? updated.filter(img => img.cardId === cardId)
              : updated;
            sendResponse({ success: true, images: filtered });
          } catch (err) {
            console.error("Failed to delete clipped image:", err);
            sendResponse({ error: err.message });
          }
        })();
      }
    } catch (err) {
      console.error("Error handling message:", err);
      sendResponse({ error: err.message });
    }
  })();
  return true; // Keep message channel open for asynchronous responses
});
