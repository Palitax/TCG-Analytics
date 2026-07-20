const SUPABASE_URL = "https://pjorjwwhiinaaebxvhhi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqb3Jqd3doaWluYWFlYnh2aGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjQ4NzEsImV4cCI6MjA5OTUwMDg3MX0.T8Gs9JaF9X-DbEgx0fSN9VeSEUPsV6nlFMd0RRW2hOs";



// Fetch remote image and convert to Base64 in service worker background thread
async function fetchAndConvertToBase64(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  
  try {
    // Route through our Vercel Image Proxy to bypass Amazon S3 referer & CORS blocks
    const proxyUrl = `https://tcg-analytics-chi.vercel.app/api/image-proxy?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    const base64 = btoa(binary);
    const mimeType = blob.type || 'image/jpeg';
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.error("Failed to convert image to base64 via proxy:", err);
    return null; // Returning null here ensures clipping fails explicitly rather than saving a hotlink S3 url
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
            const base64 = await fetchAndConvertToBase64(imageUrl);
            if (!base64) {
              throw new Error("Failed to convert image to base64");
            }
            
            const { clippedImages = [] } = await chrome.storage.local.get('clippedImages');
            const exists = clippedImages.some(img => img.cardId === cardId && img.image === base64);
            if (!exists) {
              clippedImages.unshift({
                cardId,
                tcg,
                image: base64,
                timestamp: Date.now()
              });
              if (clippedImages.length > 50) {
                clippedImages.pop();
              }
              await chrome.storage.local.set({ clippedImages });
            }
            sendResponse({ success: true, image: base64 });
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
    } catch (err) {
      console.error("Error handling message:", err);
      sendResponse({ error: err.message });
    }
  })();
  return true; // Keep message channel open for asynchronous responses
});
