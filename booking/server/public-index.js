// The online booking page as its own process (PM2: limitsiz-public, 127.0.0.1:3005), so public traffic never slows the staff app,
// and with its own database login (public_app), which can do only what this page needs.
import pg from "pg";
import { agentCaller, loadPublicConfig } from "./config.js";
import { createPublicService } from "./public-service.js";
import { createPublicApp } from "./public-app.js";
import { humanChecker } from "./human-check.js";

const config = loadPublicConfig();
if (!config.databaseUrl) { console.error("Cannot start: PUBLIC_DATABASE_URL is missing (the public_app login)"); process.exit(1); }

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8, ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false } });
pool.on("error", (e) => console.error("database pool error", e.message));

const app = createPublicApp({ svc: createPublicService({ pool, agent: agentCaller(config) }), config, human: humanChecker(config.turnstile) });
app.listen(config.port, "127.0.0.1", () => console.log(`Limitsiz Clinic online booking on 127.0.0.1:${config.port} (${config.siteUrl})`));
