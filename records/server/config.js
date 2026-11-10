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
  };
}

export function checkConfig(c) {
  const p = [];
  if (!c.databaseUrl) p.push("DATABASE_URL is missing");
  if (!c.clientSecret || c.clientSecret.length < 32) p.push("RECORDS_CLIENT_SECRET must be a long random value (the same one Accounts holds as a hash)");
  return p;
}
