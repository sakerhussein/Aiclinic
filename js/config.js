/*
 * Supabase settings for the website's demo/contact form.
 * Replace the two placeholders with your project values:
 *   Supabase dashboard > Project Settings > API
 * The publishable key is safe to expose in the browser. Row Level Security
 * (see supabase/leads.sql) limits it to inserting leads only.
 */
window.LC_CONFIG = {
  SUPABASE_URL: "https://ivefyhpkmytzbynptkam.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_JclCayA2UeFei4j1LuaK6A_NVdNHpAb",
  LEADS_TABLE: "leads"
};
