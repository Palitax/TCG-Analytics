import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = "https://api-supabase.rohdedigital.de";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk";

// Sanitize localStorage auth token before client initialization to prevent _getUser crash
try {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.includes('supabase') || key.includes('auth-token'))) {
      const val = localStorage.getItem(key);
      if (val) {
        try {
          const parsed = JSON.parse(val);
          if (!parsed || !parsed.access_token || (parsed.expires_at && parsed.expires_at * 1000 < Date.now() - 60000)) {
            console.warn('Removing expired auth storage key:', key);
            localStorage.removeItem(key);
          }
        } catch (pe) {
          console.warn('Removing corrupted auth storage key:', key);
          localStorage.removeItem(key);
        }
      }
    }
  }
} catch (e) {}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
