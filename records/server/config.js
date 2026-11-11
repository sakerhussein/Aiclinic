import "dotenv/config";

export function loadConfig(env = process.env) {
  const siteUrl = (env.SITE_URL || "http://localhost:3006").replace(/\/+$/, "");
  const secure = siteUrl.startsWith("https://");
  return {
    port: Number(env.PORT || 3006),
    siteUrl, origin: new URL(siteUrl).origin,
    databaseUrl: env.DATABASE_URL,            // the records_app login
    // Accounts: the public address (browser redirects) and the local one (server to server).
    accountsUrl: (env.ACCOUNTS_URL || "http://localhost:3003").replace(/\/+$/, ""),
    accountsInternalUrl: (env.ACCOUNTS_INTERNAL_URL || "http://127.0.0.1:3003").replace(/\/+$/, ""),
    bookingUrl: (env.BOOKING_URL || "http://localhost:3004").replace(/\/+$/, ""),
    clientSecret: env.RECORDS_CLIENT_SECRET,
    secureCookies: secure,
    sessionCookie: secure ? "__Host-lc_records" : "lc_records",
    stateCookie: secure ? "__Host-lc_rstate" : "lc_rstate",
    trustProxy: env.TRUST_PROXY ?? "1",
    // Photos and documents (phase B). "supabase": the private bucket (the service key stays on the VPS, in .env, never shown).
    // "disk": a folder (local testing only). Not set: "off" (uploads refused) until deploy/setup-records-files.sh has run.
    storage: env.STORAGE === "supabase" ? {
      kind: "supabase", url: (env.SUPABASE_URL || "").replace(/\/+$/, ""), key: env.SUPABASE_SERVICE_KEY, bucket: env.STORAGE_BUCKET || "records",
    } : env.STORAGE === "disk" ? { kind: "disk", dir: env.FILES_DIR || "./files" } : { kind: "off" },
    // The nightly encrypted copy on the VPS disk: the folder and the key file (made by deploy/setup-records-files.sh, never shown).
    // Not set: no backups run here (local testing).
    backup: env.BACKUP_DIR ? { dir: env.BACKUP_DIR, keyFile: env.BACKUP_KEY_FILE || `${env.BACKUP_DIR}/backup.key` } : null,
    // The AI summary before the visit (phase C): the same key as Booking's AI Scribe. Not set: the summary stays off.
    anthropicKey: env.ANTHROPIC_API_KEY || null,
    smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM || env.SMTP_USER } : null,
  };
}

export function checkConfig(c) {
  const p = [];
  if (!c.databaseUrl) p.push("DATABASE_URL is missing");
  if (!c.clientSecret || c.clientSecret.length < 32) p.push("RECORDS_CLIENT_SECRET must be a long random value (the same one Accounts holds as a hash)");
  if (c.storage.kind === "supabase" && (!c.storage.url || !c.storage.key)) p.push("STORAGE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY");
  return p;
}
