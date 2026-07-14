const SUPABASE_URL = "https://pjorjwwhiinaaebxvhhi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqb3Jqd3doaWluYWFlYnh2aGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjQ4NzEsImV4cCI6MjA5OTUwMDg3MX0.T8Gs9JaF9X-DbEgx0fSN9VeSEUPsV6nlFMd0RRW2hOs";

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

        const { tcg, cardId, condition, language, sellerCountry, currentPrice, comment, force } = message;
        const accessToken = session.access_token;
        const userId = session.user.id;

        // 1. Fetch full historical price list from Supabase sorted ascending (oldest first)
        const getUrl = `${SUPABASE_URL}/rest/v1/price_history?tcg=eq.${encodeURIComponent(tcg)}&card_id=eq.${encodeURIComponent(cardId)}&condition=eq.${encodeURIComponent(condition)}&language=eq.${encodeURIComponent(language)}&seller_country=eq.${encodeURIComponent(sellerCountry)}&order=scanned_at.asc`;
        
        const getResponse = await fetch(getUrl, {
          method: "GET",
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
          const timeSinceLastScan = Date.now() - new Date(latestRecordBeforeScan.scanned_at).getTime();
          
          if (force === true) {
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
          const newRecordData = {
            tcg: tcg,
            card_id: cardId,
            price: currentPrice,
            condition: condition,
            language: language,
            seller_country: sellerCountry,
            comment: comment || null,
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

        sendResponse({
          success: true,
          history: history,
          latestRecordBeforeScan: latestRecordBeforeScan,
          currentUserId: userId,
          blocked: blocked,
          remainingTime: remainingTime
        });
      }
    } catch (err) {
      console.error("Error handling message:", err);
      sendResponse({ error: err.message });
    }
  })();
  return true; // Keep message channel open for asynchronous responses
});
