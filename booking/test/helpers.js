// Test harness: the real Accounts app and the real Booking app, side by side on one throwaway database, each connected as its own
// least-privilege login, with one controllable clock. Sign-in goes through the real single sign-on.
import pg from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setup as accountsSetup, GOOD } from "../../accounts/test/helpers.js";
import { ScribeError, createScribe, sampleDrafter } from "../server/scribe.js";
import { sampleTidier } from "../server/dictation.js";
import { sha256 } from "../../accounts/server/crypto.js";
import { createService } from "../server/service.js";
import { createApp } from "../server/app.js";
import { createPublicService } from "../server/public-service.js";
import { createPublicApp } from "../server/public-app.js";
import { humanChecker } from "../server/human-check.js";

export { GOOD };
const SECRET = "x".repeat(40);

export async function setup() {
  const a = await accountsSetup();
  await a.owner.query("alter role booking_app password 'test'; alter role audit_reader password 'test'; alter role public_app password 'test'");
  const url = (user) => { const u = new URL("postgresql://postgres:test@localhost:54329/accounts_test"); u.username = user; u.password = "test"; return u.toString(); };
  const pool = new pg.Pool({ connectionString: url("booking_app"), max: 6 });
  const auditPool = new pg.Pool({ connectionString: url("audit_reader"), max: 2 });
  const publicPool = new pg.Pool({ connectionString: url("public_app"), max: 4 });
  const config = {
    siteUrl: "", origin: "", accountsUrl: a.base, accountsInternalUrl: a.base, clientSecret: SECRET, secureCookies: false,
    sessionCookie: "lc_booking", stateCookie: "lc_state", trustProxy: "false",
  };
  // AI Scribe: recordings wait in a folder of their own; the worker runs on the same clock. drafter.fail makes the draft fail.
  const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-scribe-test-"));
  const drafter = { fail: null, calls: [], async draft(x) { drafter.calls.push(x); if (drafter.fail) throw new ScribeError(drafter.fail); return sampleDrafter.draft(x); } };
  const scribe = createScribe({ pool, audioDir, drafter, now: () => new Date(a.clock.t), log: { error() {} } });
  const tidier = { fail: null, calls: [], async tidy(x) { tidier.calls.push(x); if (tidier.fail) throw new ScribeError(tidier.fail); return sampleTidier.tidy(x); } };
  // Online visits: the visit-link emails are caught here instead of sent.
  const patientMails = [];
  const mail = async (m) => { patientMails.push(m); return true; };
  const svc = createService({ pool, auditPool, now: () => new Date(a.clock.t), audioDir, tidier, recordsUrl: "http://records.test", mail });
  const app = createApp({ svc, config });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  config.siteUrl = base; config.origin = base;
  // The online booking page, its own app on its own login, on the same clock.
  const publicConfig = { siteUrl: "", origin: "", secure: false, trustProxy: "false" };
  // The assistant is scripted here (its own tests are in agent/tests/test_web_chat.py): agent.next holds the answers.
  const agent = { next: [], calls: [], down: false };
  const callAgent = async (p) => { agent.calls.push(p); if (agent.down) throw new Error("down"); return agent.next.shift() ?? { reply: "OK" }; };
  // The human check talks to a pretend Cloudflare (its own tests are in test/human-check.test.js). cf.keys: the Cloudflare keys are
  // set; cf.answer: "pass" (tokens "good:<form>" pass, others fail), "down" (no answer), "500"; cf.hostname: what Cloudflare says
  // the page was; cf.calls: what our server sent.
  const cf = { keys: false, answer: "pass", hostname: null, calls: [] };
  const cfFetch = async (url, init) => {
    const sent = JSON.parse(init.body); cf.calls.push({ url, ...sent });
    if (cf.answer === "down") throw new TypeError("fetch failed");
    if (cf.answer === "500") return new Response("oops", { status: 500 });
    const [kind, action] = String(sent.response).split(":");
    const ok = kind === "good";
    return Response.json({ success: ok, "error-codes": ok ? [] : ["invalid-input-response"], action: ok ? action : undefined,
      hostname: cf.hostname ?? new URL(publicConfig.siteUrl).hostname });
  };
  const checker = humanChecker({ siteKey: "site-key-for-tests", secret: "secret-for-tests" }, { fetch: cfFetch, log: { warn() {} } });
  const human = { get siteKey() { return cf.keys ? checker.siteKey : null; }, check: checker.check };
  const publicApp = createPublicApp({ svc: createPublicService({ pool: publicPool, now: () => new Date(a.clock.t), agent: callAgent }), config: publicConfig,
    now: () => a.clock.t, human });
  const publicServer = await new Promise((r) => { const s = publicApp.listen(0, "127.0.0.1", () => r(s)); });
  const publicBase = `http://127.0.0.1:${publicServer.address().port}`;
  publicConfig.siteUrl = publicBase; publicConfig.origin = publicBase; config.publicBookingUrl = publicBase;
  async function pub(method, path, body, { origin = publicBase, ip } = {}) {
    const res = await fetch(publicBase + path, { method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  }
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

  // A piece of a recording, as the browser sends it.
  const putAudio = (b, noteId, seq, buf = Buffer.from("fake-opus-audio"), type = "audio/webm;codecs=opus") =>
    fetch(`${base}/api/notes/${noteId}/audio/${seq}`, { method: "PUT", headers: { origin: base, cookie: b.cookie, "content-type": type }, body: buf })
      .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  async function reset() { agent.next = []; agent.calls = []; agent.down = false; Object.assign(cf, { keys: false, answer: "pass", hostname: null, calls: [] }); drafter.fail = null; drafter.calls = []; tidier.fail = null; tidier.calls = []; patientMails.length = 0;
    for (const d of fs.readdirSync(audioDir)) fs.rmSync(path.join(audioDir, d), { recursive: true, force: true });
    await a.owner.query(`delete from prescriptions; delete from form_responses; delete from form_templates; delete from form_links; delete from treatment_courses;
      update record_settings set courses_on = false, forms_on = false, rx_on = false, form_link_hours = 24, form_message_en = default, form_message_ar = default;
      delete from web_callbacks; delete from web_chats; delete from appointments; delete from patients; delete from time_off; delete from clinic_hours;
      delete from insurance_companies; update record_settings set insurance_in_booking = true;
      update doctors set slot_minutes = null, buffer_minutes = 0, active = true, scribe_enabled = false, licence_no = null;
      update scribe_settings set enabled = false, note_language = 'en', max_recording_minutes = 45, transcript_keep_days = 30, notes_per_doctor_per_day = 40,
        speech_service = 'stand_in', draft_model = 'claude-opus-5-5', dictation_enabled = false, dictation_model = 'claude-haiku-5-5',
        dictation_translate = true, dictation_field_seconds = 120, dictation_note_minutes = 5, dictations_per_doctor_per_day = 200;
      update booking_rules set min_notice_minutes = 0, window_days = 365, change_notice_minutes = 0, max_upcoming = null, outside_hours = 'warn', walkin_back_minutes = 120, require_cancel_reason = true where audience = 'staff';
      update booking_rules set min_notice_minutes = 60, window_days = 30, change_notice_minutes = 120, max_upcoming = 3 where audience = 'patient';
      update clinic_settings set idle_timeout_minutes = 60, lock_after_minutes = 10, require_2fa_all = false, audit_retention_months = null, assistant_enabled = true;
      delete from doctors where name_en like 'Test %'; delete from services where name_en like 'Test %';
      delete from online_booking; insert into online_booking (clinic_id) select id from clinics;
      delete from online_visits; insert into online_visits (clinic_id) select id from clinics; delete from clinic_payment; insert into clinic_payment (clinic_id) select id from clinics;
      update doctors set online_enabled = false, online_min_notice_minutes = 60, teams_link = null; update services set online_allowed = false;
      update clinics set wa_phone_number_id = null;`); publicApp.locals.forget(); await a.reset(); }
  return { ...a, accountsBase: a.base, reset, base, publicBase, pub, agent, cf, config, forgetPublic: () => publicApp.locals.forget(), bookingJar: jar, login, people, seedIds, pool,
    audioDir, scribe, drafter, tidier, putAudio, patientMails,
    // Dictation, as the browser sends it: the whole recording at once.
    dictate: (b, noteId, q, buf = Buffer.from("fake-opus-audio"), type = "audio/webm;codecs=opus") =>
      fetch(`${base}/api/notes/${noteId}/dictate?${new URLSearchParams(q)}`, { method: "POST", headers: { origin: base, cookie: b.cookie, "content-type": type }, body: buf })
        .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })),
    async close() { server.close(); publicServer.close(); await publicPool.end(); await pool.end(); await auditPool.end(); await a.close(); fs.rmSync(audioDir, { recursive: true, force: true }); } };
}
