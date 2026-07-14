import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://pjorjwwhiinaaebxvhhi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqb3Jqd3doaWluYWFlYnh2aGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjQ4NzEsImV4cCI6MjA5OTUwMDg3MX0.T8Gs9JaF9X-DbEgx0fSN9VeSEUPsV6nlFMd0RRW2hOs";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
