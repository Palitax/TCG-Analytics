import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://api-supabase.rohdedigital.de";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjI3OTk1MzU2MDB9.dLVXX_m4DKuyn028uVpXtQOI_Kp08FmTZ8GvTqT0DSk";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
