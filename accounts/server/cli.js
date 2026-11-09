// Server commands for the Limitsiz owner. The first administrator of a clinic (or a Limitsiz administrator) is invited from here:
//   node server/cli.js invite --clinic demo-derma --email boss@clinic.jo --name "Dr. Boss" [--role clinic_admin]
//   node server/cli.js invite --platform --email you@limitsiz.si --name "Saqqer"
// It prints a one-time link (valid 72 hours). Nothing is emailed and no password is ever handled here.
// When the only administrator lost their phone and every recovery code, and nobody else can reset it:
//   node server/cli.js reset-2fa --email you@clinic.jo
// It turns their two-step off, ends their sessions and emails them; at the next sign-in they scan a new code.
import pg from "pg";
import { loadConfig, checkConfig } from "./config.js";
import { createCore } from "./core.js";
import { createMailer } from "./mail.js";

const USAGE = 'Usage: node server/cli.js invite --clinic <slug> --email <email> --name "<name>" [--role clinic_admin]\n' +
  '       node server/cli.js invite --platform --email <email> --name "<name>"\n' +
  '       node server/cli.js reset-2fa --email <email>';
const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

if (cmd !== "invite" && cmd !== "reset-2fa") { console.error(USAGE); process.exit(2); }
const config = loadConfig();
const problems = checkConfig(config);
if (problems.length) { console.error("Cannot run:\n - " + problems.join("\n - ")); process.exit(1); }
const platform = args.includes("--platform");
if (!opt("email") || (cmd === "invite" && (!opt("name") || (!platform && !opt("clinic"))))) {
  console.error(cmd === "invite" ? "--email, --name and (--clinic <slug> or --platform) are required" : "--email is required"); process.exit(2);
}

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2, ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
const core = createCore({ pool, config, mail: createMailer(config) });
try {
  if (cmd === "invite") {
    const link = await core.bootstrapInvite({ email: opt("email"), fullName: opt("name"), clinicSlug: opt("clinic"), roleKey: platform ? "platform_admin" : opt("role") || "clinic_admin" });
    console.log(`\nSend this link to ${opt("email")} (works once, for 72 hours):\n\n${link}\n`);
  } else {
    const r = await core.serverResetTwoStep(opt("email"));
    console.log(`\nTwo-step is off for ${opt("email")}; ${r.sessionsEnded} session(s) ended. ${r.emailed ? "They were emailed." : "The email could not be sent: tell them yourself."}\nAt the next sign-in they scan a new code and get new recovery codes.\n`);
  }
} catch (e) { console.error("Failed:", e.code || e.message); process.exitCode = 1; } finally { await pool.end(); }
