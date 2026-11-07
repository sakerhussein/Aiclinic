// Run by setup-online-booking.sh on the VPS. Gives the public_app database login (migration 0011) a password made here, checks
// it works, and adds the online booking settings to booking/.env (root only). No secret is printed, and none is ever in git.
// Does nothing if booking/.env already has PUBLIC_DATABASE_URL.
//
// Exit 3: the database login in agent/.env may not change passwords, so setup-online-booking.sh asks for one (OWNER_DATABASE_URL).
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.REPO || "/root/Aiclinic";
const require = createRequire(path.join(REPO, "booking", "package.json"));
const pg = require("pg");
const dotenv = require("dotenv");

const BOOKING_ENV = path.join(REPO, "booking", ".env");
const PUBLIC_URL = process.env.PUBLIC_URL || "https://book.limitsiz.si";
if (!fs.existsSync(BOOKING_ENV)) { console.error("booking/.env is missing: run setup-platform.sh first."); process.exit(1); }
const booking = dotenv.parse(fs.readFileSync(BOOKING_ENV));
if (booking.PUBLIC_DATABASE_URL) { console.log("Settings: booking/.env already has the online booking login; left as it is."); process.exit(0); }

const agentEnv = path.join(REPO, "agent", ".env");
const agent = fs.existsSync(agentEnv) ? dotenv.parse(fs.readFileSync(agentEnv)) : {};
const ownerUrl = process.env.OWNER_DATABASE_URL || agent.DATABASE_URL;
if (!ownerUrl) { console.error("No database address: agent/.env has no DATABASE_URL."); process.exit(1); }

// Same database address as Booking's own login, with the public_app login instead. Supabase pooler logins are "role.project".
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

const db = new pg.Client({ connectionString: ownerUrl, ssl });
await db.connect();
try {
  const { rowCount } = await db.query("select 1 from pg_roles where rolname = 'public_app'");
  if (rowCount !== 1) { console.error("The public_app login does not exist: migration 0011 is not applied to this database."); process.exit(1); }
  await db.query(`alter role public_app password '${password}'`);   // hex only: nothing to escape
} catch (e) {
  if (e.code === "42501") { console.error("The database login in agent/.env may not change passwords."); process.exit(3); }
  console.error(`Setting the password failed, nothing was changed: ${e.message}`);
  process.exit(1);
} finally {
  await db.end().catch(() => {});
}

// Prove the login works before writing it down. The pooler can take a moment to notice a new password.
let error;
for (let i = 0; i < 10; i++) {
  const c = new pg.Client({ connectionString: loginUrl("public_app", password), ssl });
  try { await c.connect(); await c.query("select 1 from online_booking limit 1"); error = null; await c.end(); break; }
  catch (e) { error = e; await c.end().catch(() => {}); await new Promise((r) => setTimeout(r, 3000)); }
}
if (error) { console.error(`The public_app login does not work: ${error.message}. booking/.env was not changed.`); process.exit(1); }

const line = (k, v) => `${k}='${v}'`;
fs.copyFileSync(BOOKING_ENV, `${BOOKING_ENV}.before-online-booking`);
fs.chmodSync(`${BOOKING_ENV}.before-online-booking`, 0o600);
const text = fs.readFileSync(BOOKING_ENV, "utf8");
fs.writeFileSync(BOOKING_ENV, (text.endsWith("\n") ? text : text + "\n") +
  ["# Online booking page (server/public-index.js, PM2 limitsiz-public). Booking also reads PUBLIC_SITE_URL for the clinic's link.",
   line("PUBLIC_SITE_URL", PUBLIC_URL), line("PUBLIC_PORT", 3005), line("PUBLIC_DATABASE_URL", loginUrl("public_app", password))].join("\n") + "\n",
  { mode: 0o600 });
console.log("Settings: the public_app login works, and booking/.env has the online booking settings (the old file is kept as .env.before-online-booking).");
