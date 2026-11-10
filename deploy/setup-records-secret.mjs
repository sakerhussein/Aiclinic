// Run by setup-records.sh on the VPS. Gives the records_app database login (migration 0020) a password made here, registers
// Records with Accounts (its address and the hash of a secret made here), checks the login works, and writes records/.env and
// RECORDS_URL in booking/.env (root only). No secret is printed, and none is ever in git. Does nothing if records/.env exists.
//
// Exit 3: the database login in agent/.env may not change passwords, so setup-records.sh asks for one (OWNER_DATABASE_URL).
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.REPO || "/root/Aiclinic";
const require = createRequire(path.join(REPO, "records", "package.json"));
const pg = require("pg");
const dotenv = require("dotenv");

const RECORDS_ENV = path.join(REPO, "records", ".env");
const BOOKING_ENV = path.join(REPO, "booking", ".env");
const RECORDS_URL = process.env.RECORDS_URL || "https://records.limitsiz.si";
const BOOKING_URL = process.env.BOOKING_URL || "https://booking.limitsiz.si";
const ACCOUNTS_URL = process.env.ACCOUNTS_URL || "https://accounts.limitsiz.si";
if (fs.existsSync(RECORDS_ENV)) { console.log("Settings: records/.env already exists; secrets are left as they are."); process.exit(0); }
if (!fs.existsSync(BOOKING_ENV)) { console.error("booking/.env is missing: run setup-platform.sh first."); process.exit(1); }
const booking = dotenv.parse(fs.readFileSync(BOOKING_ENV));

const agentEnv = path.join(REPO, "agent", ".env");
const agent = fs.existsSync(agentEnv) ? dotenv.parse(fs.readFileSync(agentEnv)) : {};
const ownerUrl = process.env.OWNER_DATABASE_URL || agent.DATABASE_URL;
if (!ownerUrl) { console.error("No database address: agent/.env has no DATABASE_URL."); process.exit(1); }

// Same database address as Booking's own login, with the records_app login instead. Supabase pooler logins are "role.project".
const loginUrl = (role, password) => {
  const u = new URL(booking.DATABASE_URL || ownerUrl);
  const project = decodeURIComponent(new URL(ownerUrl).username).split(".")[1];
  u.username = project ? `${role}.${project}` : role;
  u.password = password;
  if (u.hostname.includes("pooler.supabase.com")) u.port = "5432";
  u.search = "";
  return u.toString();
};
const ssl = new URL(ownerUrl).hostname === "localhost" ? false : { rejectUnauthorized: false };
const password = crypto.randomBytes(32).toString("hex");
const clientSecret = crypto.randomBytes(32).toString("hex");

const db = new pg.Client({ connectionString: ownerUrl, ssl });
await db.connect();
try {
  const { rowCount } = await db.query("select 1 from pg_roles where rolname = 'records_app'");
  if (rowCount !== 1) { console.error("The records_app login does not exist: migration 0020 is not applied to this database."); process.exit(1); }
  await db.query("begin");
  await db.query(`alter role records_app password '${password}'`);   // hex only: nothing to escape
  const r = await db.query("update accounts.apps set url = $1, redirect_uris = $2, secret_hash = $3 where key = 'records'",
    [RECORDS_URL, [`${RECORDS_URL}/auth/callback`], crypto.createHash("sha256").update(clientSecret).digest("hex")]);
  if (r.rowCount !== 1) throw new Error("accounts.apps has no 'records' row: migration 0020 is not applied");
  await db.query("commit");
} catch (e) {
  await db.query("rollback").catch(() => {});
  if (e.code === "42501") { console.error("The database login in agent/.env may not change passwords."); process.exit(3); }
  console.error(`Setting the secrets failed, nothing was changed: ${e.message}`);
  process.exit(1);
} finally {
  await db.end().catch(() => {});
}

// Prove the login works before writing it down. The pooler can take a moment to notice a new password.
let error;
for (let i = 0; i < 10; i++) {
  const c = new pg.Client({ connectionString: loginUrl("records_app", password), ssl });
  try { await c.connect(); await c.query("select 1 from record_settings limit 1"); error = null; await c.end(); break; }
  catch (e) { error = e; await c.end().catch(() => {}); await new Promise((r) => setTimeout(r, 3000)); }
}
if (error) { console.error(`The records_app login does not work: ${error.message}. Nothing was written.`); process.exit(1); }

const line = (k, v) => `${k}='${v}'`;
fs.writeFileSync(RECORDS_ENV, [line("PORT", 3006), line("SITE_URL", RECORDS_URL), line("TRUST_PROXY", 1), line("DATABASE_URL", loginUrl("records_app", password)),
  line("ACCOUNTS_URL", ACCOUNTS_URL), line("ACCOUNTS_INTERNAL_URL", "http://127.0.0.1:3003"), line("RECORDS_CLIENT_SECRET", clientSecret),
  line("BOOKING_URL", BOOKING_URL)].join("\n") + "\n", { mode: 0o600 });
// Booking shows "Open in Records" links once it knows the address.
if (!booking.RECORDS_URL) {
  fs.copyFileSync(BOOKING_ENV, `${BOOKING_ENV}.before-records`);
  fs.chmodSync(`${BOOKING_ENV}.before-records`, 0o600);
  const text = fs.readFileSync(BOOKING_ENV, "utf8");
  fs.writeFileSync(BOOKING_ENV, (text.endsWith("\n") ? text : text + "\n") + "# Records (the patient chart), for the \"Open in Records\" links.\n" + line("RECORDS_URL", RECORDS_URL) + "\n", { mode: 0o600 });
}
console.log("Settings: the records_app login works, Records is registered with Accounts, records/.env is written, and booking/.env has RECORDS_URL (the old file is kept as .env.before-records).");
