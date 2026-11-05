import "dotenv/config";

// All settings come from the environment (see .env.example). Nothing secret is in git.
export function loadConfig(env = process.env) {
  const siteUrl = (env.SITE_URL || "http://localhost:3003").replace(/\/+$/, "");
  const secure = siteUrl.startsWith("https://");
  return {
    port: Number(env.PORT || 3003),
    siteUrl,
    origin: new URL(siteUrl).origin,
    databaseUrl: env.DATABASE_URL,
    // 32 random bytes, base64: encrypts the stored two-step secrets.
    mfaKey: env.MFA_KEY,
    secureCookies: secure,
    // __Host- cookies must be Secure, so on plain http (local development) the prefix is dropped.
    cookieName: secure ? "__Host-lc_session" : "lc_session",
    trustProxy: env.TRUST_PROXY ?? "1",
    // Only for development and tests: return invitation and reset links in the API answer.
    exposeLinks: env.EXPOSE_LINKS === "true",
    smtp: env.SMTP_HOST ? {
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS,
      from: env.MAIL_FROM || env.SMTP_USER,
    } : null,
  };
}

export function checkConfig(c) {
  const problems = [];
  if (!c.databaseUrl) problems.push("DATABASE_URL is missing");
  if (!c.mfaKey || Buffer.from(c.mfaKey, "base64").length !== 32) problems.push("MFA_KEY must be 32 random bytes in base64 (node -e \"console.log(crypto.randomBytes(32).toString('base64'))\")");
  return problems;
}
