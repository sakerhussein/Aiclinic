import pg from "pg";
import { loadConfig, checkConfig } from "./config.js";
import { createService } from "./service.js";
import { createApp } from "./app.js";
import { createMailer, startNightly } from "./nightly.js";
import Anthropic from "@anthropic-ai/sdk";
import { claudeTidier } from "./dictation.js";
import { createPatientMailer } from "./online-visits.js";

const config = loadConfig();
const problems = checkConfig(config);
if (problems.length) { console.error("Cannot start:\n - " + problems.join("\n - ")); process.exit(1); }

const ssl = (u) => (u.includes("localhost") ? false : { rejectUnauthorized: false });
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: ssl(config.databaseUrl) });
const auditPool = config.auditDatabaseUrl ? new pg.Pool({ connectionString: config.auditDatabaseUrl, max: 3, ssl: ssl(config.auditDatabaseUrl) }) : null;
pool.on("error", (e) => console.error("database pool error", e.message));

// Dictation tidies the doctor's words with Claude (the same key as the AI Scribe). Without the key, words go in as heard.
const tidier = process.env.ANTHROPIC_API_KEY ? claudeTidier({ client: new Anthropic() }) : null;
// Online visits: the "Join the visit" link by email, from the same SMTP as the nightly audit email (none set up: email is "not set up").
const mail = createPatientMailer(config);
const app = createApp({ svc: createService({ pool, auditPool, audioDir: config.scribeAudioDir, tidier, recordsUrl: config.recordsUrl, mail }), config });
startNightly({ pool, send: createMailer(config), tz: config.nightlyTz, hour: config.nightlyHour });
app.listen(config.port, "127.0.0.1", () => console.log(`Limitsiz Clinic Booking on 127.0.0.1:${config.port} (${config.siteUrl})`));
