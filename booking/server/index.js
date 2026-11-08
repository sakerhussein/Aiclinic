import pg from "pg";
import { loadConfig, checkConfig } from "./config.js";
import { createService } from "./service.js";
import { createApp } from "./app.js";
import { createMailer, startNightly } from "./nightly.js";

const config = loadConfig();
const problems = checkConfig(config);
if (problems.length) { console.error("Cannot start:\n - " + problems.join("\n - ")); process.exit(1); }

const ssl = (u) => (u.includes("localhost") ? false : { rejectUnauthorized: false });
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: ssl(config.databaseUrl) });
const auditPool = config.auditDatabaseUrl ? new pg.Pool({ connectionString: config.auditDatabaseUrl, max: 3, ssl: ssl(config.auditDatabaseUrl) }) : null;
pool.on("error", (e) => console.error("database pool error", e.message));

const app = createApp({ svc: createService({ pool, auditPool, audioDir: config.scribeAudioDir }), config });
startNightly({ pool, send: createMailer(config), tz: config.nightlyTz, hour: config.nightlyHour });
app.listen(config.port, "127.0.0.1", () => console.log(`Limitsiz Clinic Booking on 127.0.0.1:${config.port} (${config.siteUrl})`));
