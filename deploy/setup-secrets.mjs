// Run by setup-platform.sh on the VPS. Creates the secrets of Accounts and Booking there, sets the database passwords and writes
// both .env files (root only). No secret is printed, and none is ever in git. Does nothing if both .env files already exist.
//
// Exit 3: the database login in agent/.env may not change passwords, so setup-platform.sh asks for one (OWNER_DATABASE_URL).
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.REPO || "/root/Aiclinic";
const require = createRequire(path.join(REPO, "accounts", "package.json"));
const pg = require("pg");
const dotenv = require("dotenv");

const ACCOUNTS_ENV = path.join(REPO, "accounts", ".env");
const BOOKING_ENV = path.join(REPO, "booking", ".env");
const ACCOUNTS_URL = process.env.ACCOUNTS_URL || "https://accounts.limitsiz.si";
const BOOKING_URL = process.env.BOOKING_URL || "https://booking.limitsiz.si";
const hex = (n) => crypto.randomBytes(n).toString("hex");

if (fs.existsSync(ACCOUNTS_ENV) && fs.existsSync(BOOKING_ENV)) {
  console.log("Settings: both .env files already exist; secrets are left as they are.");
  process.exit(0);
}
if (fs.existsSync(ACCOUNTS_ENV) || fs.existsSync(BOOKING_ENV)) {
  console.error("Only one of accounts/.env and booking/.env exists. Move it away and run this again, so both get matching secrets.");
  process.exit(1);
}

const read = (f) => (fs.existsSync(f) ? dotenv.parse(fs.readFileSync(f)) : {});
const agent = read(path.join(REPO, "agent", ".env"));
const site = read(path.join(REPO, "app", ".env"));
const ownerUrl = process.env.OWNER_DATABASE_URL || agent.DATABASE_URL;
if (!ownerUrl) { console.error("No database address: agent/.env has no DATABASE_URL."); process.exit(1); }

// The services use the same database address as the agent, each with its own login. Supabase pooler logins are "role.project".
const owner = new URL(ownerUrl);
const project = decodeURIComponent(owner.username).split(".")[1];
const local = owner.hostname === "localhost";
const loginUrl = (role, password) => {
  const u = new URL(ownerUrl);
  u.username = project ? `${role}.${project}` : role;
  u.password = password;
  if (u.hostname.includes("pooler.supabase.com")) u.port = "5432";     // session mode, as in .env.example
  u.search = "";
  return u.toString();
};
const ssl = local ? false : { rejectUnauthorized: false };

const pw = { accounts_app: hex(32), booking_app: hex(32), audit_reader: hex(32) };
const clientSecret = hex(32);
const mfaKey = crypto.randomBytes(32).toString("base64");

// Single quotes keep spaces and # as they are; a value with a single quote takes double ones.
const line = (k, v) => `${k}=${String(v ?? "").includes("'") ? `"${v}"` : `'${v ?? ""}'`}`;
const smtp = [line("SMTP_HOST", site.SMTP_HOST), line("SMTP_PORT", site.SMTP_PORT || 587), line("SMTP_USER", site.SMTP_USER), line("SMTP_PASS", site.SMTP_PASS),
  line("MAIL_FROM", site.ALERT_EMAIL_FROM || site.SMTP_USER)];

const accountsEnv = [line("PORT", 3003), line("SITE_URL", ACCOUNTS_URL), line("TRUST_PROXY", 1), line("DATABASE_URL", loginUrl("accounts_app", pw.accounts_app)),
  line("MFA_KEY", mfaKey), ...smtp, line("EXPOSE_LINKS", "false")];
const bookingEnv = [line("PORT", 3004), line("SITE_URL", BOOKING_URL), line("TRUST_PROXY", 1), line("DATABASE_URL", loginUrl("booking_app", pw.booking_app)),
  line("AUDIT_DATABASE_URL", loginUrl("audit_reader", pw.audit_reader)), line("ACCOUNTS_URL", ACCOUNTS_URL), line("ACCOUNTS_INTERNAL_URL", "http://127.0.0.1:3003"),
  line("BOOKING_CLIENT_SECRET", clientSecret), line("NIGHTLY_HOUR", 2), line("NIGHTLY_TZ", "Asia/Amman"), line("AUDIT_ANCHOR_EMAIL", process.env.AUDIT_EMAIL), ...smtp];

const db = new pg.Client({ connectionString: ownerUrl, ssl });
await db.connect();
try {
  await db.query("begin");
  for (const [role, password] of Object.entries(pw)) await db.query(`alter role ${role} password '${password}'`);   // hex only: nothing to escape
  const { rowCount } = await db.query("update accounts.apps set redirect_uris = $1, secret_hash = $2 where key = 'booking'",
    [[`${BOOKING_URL}/auth/callback`], crypto.createHash("sha256").update(clientSecret).digest("hex")]);
  if (rowCount !== 1) throw new Error("accounts.apps has no 'booking' row");
  // The .env files are written inside the transaction: if writing fails, the database is left as it was.
  fs.writeFileSync(ACCOUNTS_ENV, accountsEnv.join("\n") + "\n", { mode: 0o600 });
  fs.writeFileSync(BOOKING_ENV, bookingEnv.join("\n") + "\n", { mode: 0o600 });
  await db.query("commit");
} catch (e) {
  await db.query("rollback").catch(() => {});
  fs.rmSync(ACCOUNTS_ENV, { force: true });
  fs.rmSync(BOOKING_ENV, { force: true });
  if (e.code === "42501") { console.error("The database login in agent/.env may not change passwords."); process.exit(3); }
  console.error(`Setting the secrets failed, nothing was changed: ${e.message}`);
  process.exit(1);
} finally {
  await db.end().catch(() => {});
}

// Prove each login works. The pooler can take a moment to notice a new password.
for (const [role, password] of Object.entries(pw)) {
  let error;
  for (let i = 0; i < 10; i++) {
    const c = new pg.Client({ connectionString: loginUrl(role, password), ssl });
    try { await c.connect(); await c.query("select 1"); error = null; await c.end(); break; }
    catch (e) { error = e; await c.end().catch(() => {}); await new Promise((r) => setTimeout(r, 3000)); }
  }
  if (error) { console.error(`The ${role} login does not work: ${error.message}`); process.exit(1); }
  console.log(`Settings: the ${role} login works.`);
}
console.log(`Settings: written. Email for invitations and alerts: ${site.SMTP_HOST ? `set, from the website's settings (${site.SMTP_HOST})` : "NOT set: the website has no SMTP settings"}.`);
