import { createClient } from '@supabase/supabase-js';

export const BASE_SUPABASE_URL = "https://api-supabase.rohdedigital.de";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk";

// In web browsers (e.g. Vercel deployment), use proxy route to bypass CORS preflight restrictions on self-hosted Supabase
const isWebBrowser = typeof window !== 'undefined' && 
  window.location && 
  window.location.protocol.startsWith('http') && 
  !window.location.hostname.includes('localhost') && 
  !window.location.hostname.includes('127.0.0.1');

export const SUPABASE_URL = isWebBrowser 
  ? `${window.location.origin}/supabase-proxy` 
  : BASE_SUPABASE_URL;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

