import pg from "pg";
import { loadConfig, checkConfig } from "./config.js";
import { createService } from "./service.js";
import { createApp } from "./app.js";
import { createStorage } from "./storage.js";
import { createFiles } from "./files.js";
import { createBackups } from "./backup.js";

const config = loadConfig();
const problems = checkConfig(config);
if (problems.length) { console.error("Cannot start:\n - " + problems.join("\n - ")); process.exit(1); }

const ssl = (u) => (u.includes("localhost") ? false : { rejectUnauthorized: false });
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8, ssl: ssl(config.databaseUrl) });
pool.on("error", (e) => console.error("database pool error", e.message));

const svc = createService({ pool });
const storage = createStorage(config.storage);
const files = createFiles({ pool, svc, storage, secret: config.clientSecret, siteUrl: config.siteUrl });
const backups = createBackups({ pool, storage, config });
backups.start();                 // the nightly encrypted copy on the VPS (only where BACKUP_DIR is set)
const app = createApp({ svc, config, files, backups });
app.listen(config.port, "127.0.0.1", () => console.log(`Limitsiz Clinic Records on 127.0.0.1:${config.port} (${config.siteUrl}), files: ${storage.kind}, backups: ${config.backup ? config.backup.dir : "off"}`));
