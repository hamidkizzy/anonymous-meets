/* ============================================================
   Shared Supabase connection — used by every page
   ============================================================ */
const SUPABASE_URL = "https://eegjudvpnairytzictud.supabase.co";
const SUPABASE_KEY = "sb_publishable_8CNaloWu5dd48rRoG2wpXQ_zcdZYczv";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
