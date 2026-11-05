import pg from "pg";
import { loadConfig, checkConfig } from "./config.js";
import { createCore } from "./core.js";
import { createMailer } from "./mail.js";
import { createApp } from "./app.js";

const config = loadConfig();
const problems = checkConfig(config);
if (problems.length) { console.error("Cannot start:\n - " + problems.join("\n - ")); process.exit(1); }

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8, ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
pool.on("error", (e) => console.error("database pool error", e.message));

const core = createCore({ pool, config, mail: createMailer(config) });
const app = createApp({ core, config });
app.listen(config.port, "127.0.0.1", () => console.log(`Limitsiz Clinic Accounts on 127.0.0.1:${config.port} (${config.siteUrl})`));

// Housekeeping: old codes, resets and ended sessions are removed once an hour.
setInterval(() => pool.query(
  `delete from accounts.sso_codes where expires_at < now() - interval '1 hour';
   delete from accounts.password_resets where expires_at < now() - interval '7 days';
   delete from accounts.app_sessions where revoked_at < now() - interval '7 days'`).catch((e) => console.error("cleanup failed", e.message)), 3_600_000).unref();
