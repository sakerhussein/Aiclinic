import "dotenv/config";

export function loadConfig(env = process.env) {
  const siteUrl = (env.SITE_URL || "http://localhost:3004").replace(/\/+$/, "");
  const secure = siteUrl.startsWith("https://");
  return {
    port: Number(env.PORT || 3004),
    siteUrl, origin: new URL(siteUrl).origin,
    databaseUrl: env.DATABASE_URL,            // the booking_app login
    auditDatabaseUrl: env.AUDIT_DATABASE_URL, // the audit_reader login (booking history); optional
    // Accounts: the public address (browser redirects) and the local one (server to server).
    accountsUrl: (env.ACCOUNTS_URL || "http://localhost:3003").replace(/\/+$/, ""),
    accountsInternalUrl: (env.ACCOUNTS_INTERNAL_URL || "http://127.0.0.1:3003").replace(/\/+$/, ""),
    clientSecret: env.BOOKING_CLIENT_SECRET,
    secureCookies: secure,
    sessionCookie: secure ? "__Host-lc_booking" : "lc_booking",
    stateCookie: secure ? "__Host-lc_state" : "lc_state",
    trustProxy: env.TRUST_PROXY ?? "1",
    // The nightly audit job: when it runs, and who gets the daily email with the newest hashes.
    nightlyHour: Number(env.NIGHTLY_HOUR ?? 2), nightlyTz: env.NIGHTLY_TZ || "Asia/Amman", anchorEmail: env.AUDIT_ANCHOR_EMAIL,
    smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM || env.SMTP_USER } : null,
  };
}

export function checkConfig(c) {
  const p = [];
  if (!c.databaseUrl) p.push("DATABASE_URL is missing");
  if (!c.clientSecret || c.clientSecret.length < 32) p.push("BOOKING_CLIENT_SECRET must be a long random value (the same one Accounts holds as a hash)");
  return p;
}
