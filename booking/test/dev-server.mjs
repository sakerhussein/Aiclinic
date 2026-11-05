// Local preview of Accounts (3003) and Booking (3004) together on the throwaway Postgres: node test/dev-server.mjs
// Real single sign-on between the two. Demo people and a few bookings today. Not for production.
import pg from "pg";
import { setup, GOOD } from "./helpers.js";
import { createApp as accountsApp } from "../../accounts/server/app.js";
import { createService } from "../server/service.js";
import { createApp as bookingApp } from "../server/app.js";
import { sha256 } from "../../accounts/server/crypto.js";

const t = await setup();
await t.reset();
const P = await t.people(); const ids = await t.seedIds();
const SECRET = "dev-secret-".padEnd(40, "x");
await t.owner.query("update accounts.apps set redirect_uris = array['http://localhost:3004/auth/callback'], secret_hash = $1 where key = 'booking'", [sha256(SECRET)]);
await t.owner.query("update accounts.apps set url = 'http://localhost:3004' where key = 'booking'");   // the launcher opens the local Booking
const today = new Date().toISOString().slice(0, 10);
const at = (h, m = 0) => new Date(Date.parse(`${today}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString();
const pat = async (n, ph) => (await t.owner.query("insert into patients (clinic_id, full_name, phone_e164, whatsapp_reminders) values ($1,$2,$3,true) returning id", [t.clinicA, n, ph])).rows[0].id;
const svc = ids.services[0];
for (const [doc, h, m, name, ph, src, st] of [[ids.lina, 10, 0, "Huda Al-Khatib", "+962791110001", "whatsapp", "confirmed"], [ids.lina, 11, 0, "Omar Saleh", "+962791110002", "phone", "booked"],
  [ids.omar, 12, 30, "Dana Mansour", "+962791110003", "walkin", "booked"], [ids.lina, 16, 15, "Rami Faris", "+962791110004", "whatsapp", "booked"]]) {
  const p = await pat(name, ph);
  await t.owner.query("insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source, status) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [t.clinicA, doc, svc.id, p, at(h, m), at(h, m + svc.duration_minutes), src, st]);
}
const common = { trustProxy: "false", secureCookies: false, exposeLinks: true };
const accConfig = { ...common, siteUrl: "http://localhost:3003", origin: "http://localhost:3003", mfaKey: Buffer.alloc(32, 7).toString("base64"), cookieName: "lc_session" };
const { createCore } = await import("../../accounts/server/core.js");
// The tests use a frozen clock; the preview must use the real one (two-step codes, lock after 10 idle minutes, expiry).
const core = createCore({ pool: t.core.pool, config: accConfig, mail: { invite: async () => {}, reset: async () => {} } });
accountsApp({ core, config: accConfig }).listen(3003, "127.0.0.1");
const pool = new pg.Pool({ connectionString: "postgresql://booking_app:test@localhost:54329/accounts_test", max: 5 });
const auditPool = new pg.Pool({ connectionString: "postgresql://audit_reader:test@localhost:54329/accounts_test", max: 2 });
const bkConfig = { ...common, siteUrl: "http://localhost:3004", origin: "http://localhost:3004", accountsUrl: "http://localhost:3003", accountsInternalUrl: "http://127.0.0.1:3003",
  clientSecret: SECRET, sessionCookie: "lc_booking", stateCookie: "lc_state" };
bookingApp({ svc: createService({ pool, auditPool }), config: bkConfig }).listen(3004, "127.0.0.1", () =>
  console.log(`READY  Booking http://localhost:3004   sign in: sec@demo.jo / ${GOOD}   (administrator admin@demo.jo needs two-step)`));
console.log(`Administrator admin@demo.jo has two-step on. Current code:  node -e "import('../accounts/server/crypto.js').then(m=>console.log(m.totp('${P.admin.secret}')))"  (run it in the repo's accounts/ folder... see README)`);
console.log(`ADMIN_SECRET=${P.admin.secret}`);
