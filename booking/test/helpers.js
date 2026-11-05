// Test harness: the real Accounts app and the real Booking app, side by side on one throwaway database, each connected as its own
// least-privilege login, with one controllable clock. Sign-in goes through the real single sign-on.
import pg from "pg";
import { setup as accountsSetup, GOOD } from "../../accounts/test/helpers.js";
import { sha256 } from "../../accounts/server/crypto.js";
import { createService } from "../server/service.js";
import { createApp } from "../server/app.js";

export { GOOD };
const SECRET = "x".repeat(40);

export async function setup() {
  const a = await accountsSetup();
  await a.owner.query("alter role booking_app password 'test'; alter role audit_reader password 'test'");
  const url = (user) => { const u = new URL("postgresql://postgres:test@localhost:54329/accounts_test"); u.username = user; u.password = "test"; return u.toString(); };
  const pool = new pg.Pool({ connectionString: url("booking_app"), max: 6 });
  const auditPool = new pg.Pool({ connectionString: url("audit_reader"), max: 2 });
  const config = {
    siteUrl: "", origin: "", accountsUrl: a.base, accountsInternalUrl: a.base, clientSecret: SECRET, secureCookies: false,
    sessionCookie: "lc_booking", stateCookie: "lc_state", trustProxy: "false",
  };
  const svc = createService({ pool, auditPool, now: () => new Date(a.clock.t) });
  const app = createApp({ svc, config });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  config.siteUrl = base; config.origin = base;
  await a.owner.query("update accounts.apps set redirect_uris = array[$1], secret_hash = $2 where key = 'booking'", [`${base}/auth/callback`, sha256(SECRET)]);

  function jar(origin = base) {
    let cookie = "";
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, redirect: "manual",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      for (const sc of res.headers.getSetCookie?.() ?? []) { const [pair] = sc.split(";"); cookie = /Max-Age=0/i.test(sc) ? "" : pair; }
      let json = null; try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, json, location: res.headers.get("location") };
    };
    return { call, get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), patch: (p, b) => call("PATCH", p, b),
             get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
  }

  // Sign a user in to Accounts, then walk the real single sign-on into Booking. Returns a Booking browser.
  async function login(user, { mfa } = {}) {
    const { b: acc } = await a.signIn(user);
    if (mfa) await acc.post("/api/mfa/verify", { code: a.code(mfa) });
    const r1 = await fetch(`${base}/auth/login?return=/`, { redirect: "manual" });
    const state = r1.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("lc_state="));
    const loc = new URL(r1.headers.get("location"));
    const r2 = await acc.get(loc.pathname + loc.search);
    const cb = new URL(r2.location);
    const r3 = await fetch(base + cb.pathname + cb.search, { redirect: "manual", headers: { cookie: state } });
    const b = jar();
    for (const sc of r3.headers.getSetCookie()) { const [pair] = sc.split(";"); if (!/Max-Age=0/i.test(sc)) b.cookie = pair; }
    return { b, acc, status: r3.status };
  }
  // Common cast of users.
  async function people() {
    const secretary = await a.makeUser({ email: "sec@demo.jo", name: "Sara Secretary" });
    const secretary2 = await a.makeUser({ email: "sec2@demo.jo", name: "Reem Secretary" });
    const admin = await a.makeUser({ email: "admin@demo.jo", name: "Layla Admin", role: "clinic_admin", mfa: true });
    const readonly = await a.makeUser({ email: "ro@demo.jo", name: "Read Only", role: "readonly" });
    const doctor = await a.makeUser({ email: "dr@demo.jo", name: "Dr Lina", role: "doctor", doctor: a.doctorA });
    const other = await a.makeUser({ email: "x@other.jo", name: "Other Clinic", clinic: a.clinicB });
    return { secretary, secretary2, admin, readonly, doctor, other };
  }
  const SERVICE = "00000000-0000-4000-8000-0000000000";   // prefix; real ids read from the seed
  void SERVICE;

  async function seedIds() {
    const services = (await a.owner.query("select id, name_en, duration_minutes from services where clinic_id = $1 order by sort", [a.clinicA])).rows;
    const docs = (await a.owner.query("select id, name_en from doctors where clinic_id = $1 order by name_en", [a.clinicA])).rows;
    return { services, docs, lina: docs[0].id, omar: docs[1].id };
  }

  async function reset() { await a.owner.query("delete from appointments; delete from patients; delete from time_off;"); await a.reset(); }
  return { ...a, reset, base, bookingJar: jar, login, people, seedIds, pool, async close() { server.close(); await pool.end(); await auditPool.end(); await a.close(); } };
}
