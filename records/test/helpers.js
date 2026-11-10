// Test harness: the real Accounts app and the real Records app on one throwaway database, each on its own least-privilege
// login, with one controllable clock. Sign-in goes through the real single sign-on.
import pg from "pg";
import { setup as accountsSetup, GOOD } from "../../accounts/test/helpers.js";
import { sha256 } from "../../accounts/server/crypto.js";
import { createService } from "../server/service.js";
import { createApp } from "../server/app.js";

export { GOOD };
const SECRET = "r".repeat(40);

export async function setup() {
  const a = await accountsSetup();
  await a.owner.query("alter role records_app password 'test'; alter role booking_app password 'test'");
  const url = (user) => { const u = new URL("postgresql://postgres:test@localhost:54329/accounts_test"); u.username = user; u.password = "test"; return u.toString(); };
  const pool = new pg.Pool({ connectionString: url("records_app"), max: 6 });
  const bookingPool = new pg.Pool({ connectionString: url("booking_app"), max: 2 });
  const config = { siteUrl: "", origin: "", accountsUrl: a.base, accountsInternalUrl: a.base, bookingUrl: "http://booking.test", clientSecret: SECRET,
                   secureCookies: false, sessionCookie: "lc_records", stateCookie: "lc_rstate", trustProxy: "false" };
  const svc = createService({ pool, now: () => new Date(a.clock.t) });
  const app = createApp({ svc, config });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  config.siteUrl = base; config.origin = base;
  await a.owner.query("update accounts.apps set url = $3, redirect_uris = array[$1], secret_hash = $2 where key = 'records'", [`${base}/auth/callback`, sha256(SECRET), base]);

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
    return { call, get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), patch: (p, b) => call("PATCH", p, b), put: (p, b) => call("PUT", p, b),
             get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
  }

  // Sign in to Accounts, then walk the real single sign-on into Records. Returns a Records browser (or the refusal).
  async function login(user, { mfa } = {}) {
    const { b: acc } = await a.signIn(user);
    if (mfa) await acc.post("/api/mfa/verify", { code: a.code(mfa) });
    const r1 = await fetch(`${base}/auth/login?return=/`, { redirect: "manual" });
    const state = r1.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("lc_rstate="));
    const loc = new URL(r1.headers.get("location"));
    const r2 = await acc.get(loc.pathname + loc.search);
    if (!r2.location) return { b: jar(), acc, status: r2.status, error: r2.json?.error };
    if (r2.location.includes("/no-access")) return { b: jar(), acc, status: r2.status, error: "no_access_to_service" };
    const cb = new URL(r2.location);
    const r3 = await fetch(base + cb.pathname + cb.search, { redirect: "manual", headers: { cookie: state } });
    const b = jar();
    for (const sc of r3.headers.getSetCookie()) { const [pair] = sc.split(";"); if (!/Max-Age=0/i.test(sc)) b.cookie = pair; }
    return { b, acc, status: r3.status };
  }

  async function people() {
    const secretary = await a.makeUser({ email: "sec@demo.jo", name: "Sara Secretary" });
    const admin = await a.makeUser({ email: "admin@demo.jo", name: "Layla Admin", role: "clinic_admin", mfa: true });
    const readonly = await a.makeUser({ email: "ro@demo.jo", name: "Read Only", role: "readonly" });
    const docs = (await a.owner.query("select id from doctors where clinic_id = $1 order by name_en", [a.clinicA])).rows;
    const doctor = await a.makeUser({ email: "dr@demo.jo", name: "Dr Lina", role: "doctor", doctor: docs[0].id });
    const doctor2 = await a.makeUser({ email: "dr2@demo.jo", name: "Dr Omar", role: "doctor", doctor: docs[1].id });
    const other = await a.makeUser({ email: "dr@other.jo", name: "Other Clinic", role: "doctor", clinic: a.clinicB });
    return { secretary, admin, readonly, doctor, doctor2, other, lina: docs[0].id, omar: docs[1].id };
  }

  // A patient, and optionally a booking with a doctor (as the owner, the way Booking would have made them).
  async function patient(name = "Lina Haddad", { doctor, at, status = "completed", clinic = a.clinicA } = {}) {
    const p = (await a.owner.query("insert into patients (clinic_id, full_name, phone_e164) values ($1,$2,$3) returning id",
      [clinic, name, "+9627" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0")])).rows[0].id;
    if (doctor) await booking(p, doctor, { at, status, clinic });
    return p;
  }
  async function booking(patientId, doctor, { at = "2026-11-10T07:00:00Z", status = "completed", clinic = a.clinicA } = {}) {
    const svcRow = (await a.owner.query("select id, duration_minutes from services where clinic_id = $1 order by sort limit 1", [clinic])).rows[0];
    return (await a.owner.query(
      `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status, source) values ($1,$2,$3,$4,$5,$6,$7,'staff') returning id`,
      [clinic, doctor, svcRow.id, patientId, at, new Date(Date.parse(at) + svcRow.duration_minutes * 60000).toISOString(), status])).rows[0].id;
  }

  async function reset() {
    await a.owner.query(`delete from record_openings; delete from chart_answers; delete from chart_entries; delete from patient_details;
      delete from visit_notes; delete from appointments; delete from patients;
      update record_settings set doctors_scope = 'all', show_allergies = true, show_medicines = true, show_conditions = true, show_procedures = true,
        show_family = false, specialty_fields = default, file_numbers = 'auto', next_file_no = 1, file_no_digits = 5, required_details = '{}';`);
    await a.reset();
  }
  return { ...a, reset, base, login, people, patient, booking, pool, bookingPool, jar,
    async close() { server.close(); await pool.end(); await bookingPool.end(); await a.close(); } };
}
