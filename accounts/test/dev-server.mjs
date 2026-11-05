// Local preview of the Accounts pages on the throwaway Postgres: node test/dev-server.mjs  (then open http://localhost:3003)
// Creates a demo clinic administrator, a secretary and prints their sign-in details. Not for production.
import { setup, GOOD } from "./helpers.js";
import { createApp } from "../server/app.js";

const t = await setup();
const admin = await t.makeUser({ email: "admin@demo.jo", name: "Dr. Layla Haddad", role: "clinic_admin", password: GOOD });
const sec = await t.makeUser({ email: "sara@demo.jo", name: "Sara Nasser", role: "secretary", password: GOOD });
void admin; void sec;
const config = { siteUrl: "http://localhost:3003", origin: "http://localhost:3003", mfaKey: Buffer.alloc(32, 7).toString("base64"), secureCookies: false, cookieName: "lc_session", trustProxy: "false", exposeLinks: true };
const { createCore } = await import("../server/core.js");
const core = createCore({ pool: t.pool, config, mail: { invite: async () => {}, reset: async () => {} } });
createApp({ core, config }).listen(3003, "127.0.0.1", () => console.log(`READY http://localhost:3003  sign in: sara@demo.jo / ${GOOD}   or admin@demo.jo / ${GOOD}`));
