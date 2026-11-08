// The AI Scribe's own process: node server/scribe-index.js (PM2 "limitsiz-scribe" on the server). It turns stopped recordings into
// draft notes, deletes the audio, and deletes transcripts after each clinic's keep days. Booking itself never waits for it.
// Settings: DATABASE_URL (the booking_app login, as Booking), SCRIBE_AUDIO_DIR (as Booking), ANTHROPIC_API_KEY (for the draft).
import pg from "pg";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import { claudeDrafter, createScribe } from "./scribe.js";

const config = loadConfig();
if (!config.databaseUrl) { console.error("Cannot start: DATABASE_URL is missing"); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error("Cannot start: ANTHROPIC_API_KEY is missing (the draft needs it)"); process.exit(1); }

const ssl = (u) => (u.includes("localhost") ? false : { rejectUnauthorized: false });
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3, ssl: ssl(config.databaseUrl) });
pool.on("error", (e) => console.error("database pool error", e.message));

const scribe = createScribe({ pool, audioDir: config.scribeAudioDir, drafter: claudeDrafter({ client: new Anthropic() }) });
scribe.start();
console.log(`Limitsiz Clinic AI Scribe running (audio waits in ${config.scribeAudioDir})`);
