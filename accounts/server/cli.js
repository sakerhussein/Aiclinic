// Server commands for the Limitsiz owner. The first administrator of a clinic (or a Limitsiz administrator) is invited from here:
//   node server/cli.js invite --clinic demo-derma --email boss@clinic.jo --name "Dr. Boss" [--role clinic_admin]
//   node server/cli.js invite --platform --email you@limitsiz.si --name "Saqqer"
// It prints a one-time link (valid 72 hours). Nothing is emailed and no password is ever handled here.
import pg from "pg";
import { loadConfig, checkConfig } from "./config.js";
import { createCore } from "./core.js";

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

if (cmd !== "invite") { console.error('Usage: node server/cli.js invite --clinic <slug> --email <email> --name "<name>" [--role clinic_admin]\n       node server/cli.js invite --platform --email <email> --name "<name>"'); process.exit(2); }
const config = loadConfig();
const problems = checkConfig(config);
if (problems.length) { console.error("Cannot run:\n - " + problems.join("\n - ")); process.exit(1); }
const platform = args.includes("--platform");
if (!opt("email") || !opt("name") || (!platform && !opt("clinic"))) { console.error("--email, --name and (--clinic <slug> or --platform) are required"); process.exit(2); }

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2, ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
const core = createCore({ pool, config, mail: {} });
try {
  const link = await core.bootstrapInvite({ email: opt("email"), fullName: opt("name"), clinicSlug: opt("clinic"), roleKey: platform ? "platform_admin" : opt("role") || "clinic_admin" });
  console.log(`\nSend this link to ${opt("email")} (works once, for 72 hours):\n\n${link}\n`);
} catch (e) { console.error("Failed:", e.code || e.message); process.exitCode = 1; } finally { await pool.end(); }
