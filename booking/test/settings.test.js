import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setup } from "./helpers.js";

let t, ids, P, adm, sec;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  adm = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  sec = (await t.login(P.secretary)).b;
});

// The test clock is Tuesday 2026-11-10 12:00 in Amman. Wednesday 11 Nov = weekday 3.
const DAY = "2026-11-11", WED = 3;
const at = (hhmm, day = DAY) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const svc = () => ids.services[0];                       // 20 minutes
const free = async (b, doctor = ids.lina, day = DAY) => (await b.get(`/api/slots?service=${svc().id}&doctor=${doctor}&date=${day}`)).json.map((s) => s.startsAt);
const book = (b, over = {}) => b.post("/api/appointments", { serviceId: svc().id, doctorId: ids.lina, startsAt: at("10:00"), source: "phone",
  newPatient: { fullName: "Huda", phone: "0791234567" }, ...over });
const doctorBody = (over = {}) => ({ nameEn: "Dr. Lina Haddad", nameAr: "د. لينا حداد", gender: "f", slotMinutes: null, bufferMinutes: 0, active: true, ...over });

test("administrators read and change settings; secretaries only read; read-only people and other clinics get nothing", async () => {
  const s = (await sec.get("/api/settings")).json;
  assert.equal(s.profile.slug, "demo-derma");
  assert.equal(s.general.lock_after_minutes, 10);
  assert.equal(s.rules.length, 2);
  assert.equal((await sec.patch("/api/settings/rules/staff", { minNoticeMinutes: 0, windowDays: 10, changeNoticeMinutes: 0 })).status, 403);
  assert.equal((await sec.call("PUT", "/api/settings/hours", { periods: [] })).status, 403);
  const ro = (await t.login(P.readonly)).b;
  assert.equal((await ro.get("/api/settings")).status, 403);
  const foreign = (await t.login(P.other)).b;
  assert.equal((await foreign.patch(`/api/settings/doctors/${ids.lina}`, doctorBody())).status, 403);
});

test("clinic opening hours cut the free times, and the same in the booking rule", async () => {
  assert.ok((await free(sec)).includes(at("10:00")));
  const r = await adm.call("PUT", "/api/settings/hours", { periods: [{ weekday: WED, start: "11:00", end: "13:00" }] });
  assert.equal(r.status, 200);
  const f = await free(sec);
  assert.ok(!f.includes(at("10:00")) && f.includes(at("11:00")) && f.every((s) => s < at("13:00")));
  assert.deepEqual(await free(sec, ids.lina, "2026-11-12"), [], "a day not listed is closed");
  assert.equal((await book(sec)).json.error, "not_a_free_time");
});

test("overlapping or backwards periods are refused", async () => {
  const put = (periods) => adm.call("PUT", "/api/settings/hours", { periods });
  assert.equal((await put([{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "14:00" }])).json.error, "hours_overlap");
  assert.equal((await put([{ weekday: 1, start: "12:00", end: "09:00" }])).json.error, "end_before_start");
  assert.equal((await put([{ weekday: 9, start: "09:00", end: "12:00" }])).status, 400);
});

test("changing hours or closing never moves a booking: it lists the ones that no longer fit", async () => {
  const a = (await book(sec)).json;
  const r = await adm.call("PUT", "/api/settings/hours", { periods: [{ weekday: WED, start: "12:00", end: "18:00" }] });
  assert.equal(r.json.outside.length, 1);
  assert.equal(r.json.outside[0].id, a.id);
  assert.equal((await sec.get(`/api/appointments/${a.id}`)).json.status, "booked");
  await adm.call("PUT", "/api/settings/hours", { periods: [] });
  const c = await adm.post("/api/settings/time-off", { startsAt: at("09:00"), endsAt: at("12:00"), reason: "Eid" });
  assert.equal(c.status, 201);
  assert.equal(c.json.outside.length, 1, "a closure over it lists it too");
  assert.equal((await adm.call("DELETE", `/api/settings/time-off/${c.json.id}`)).json.outside.length, 0);
});

test("closures and leave remove free times", async () => {
  await adm.post("/api/settings/time-off", { doctorId: ids.lina, startsAt: at("10:00"), endsAt: at("12:00"), reason: "Conference" });
  const f = await free(sec);
  assert.ok(!f.includes(at("10:30")) && f.includes(at("12:00")));
  assert.equal((await adm.post("/api/settings/time-off", { startsAt: at("12:00"), endsAt: at("10:00") })).json.error, "end_before_start");
});

test("each doctor's interval and buffer", async () => {
  await adm.patch(`/api/settings/doctors/${ids.lina}`, doctorBody({ slotMinutes: 30, bufferMinutes: 10 }));
  let f = await free(sec);
  assert.ok(f.includes(at("10:30")) && !f.includes(at("10:15")));
  await book(sec, { startsAt: at("11:00") });              // 11:00-11:20 + 10
  f = await free(sec);
  assert.ok(!f.includes(at("11:00")) && f.includes(at("11:30")));
  assert.ok(f.includes(at("10:30")), "10:30 + 20 + 10 ends exactly at 11:00");
  assert.equal((await adm.patch(`/api/settings/doctors/${ids.lina}`, doctorBody({ slotMinutes: 7 }))).status, 400);
  assert.equal((await adm.patch(`/api/settings/doctors/${ids.lina}`, doctorBody({ bufferMinutes: 7 }))).status, 400);
});

test("a doctor's hours must fit inside the clinic's; services and a new doctor", async () => {
  const original = (await sec.get("/api/settings")).json.doctors.find((d) => d.id === ids.lina).hours;
  await adm.call("PUT", "/api/settings/hours", { periods: [{ weekday: WED, start: "09:00", end: "17:00" }] });
  assert.equal((await adm.call("PUT", `/api/settings/doctors/${ids.lina}/hours`, { periods: [{ weekday: WED, start: "08:00", end: "12:00" }] })).json.error, "doctor_hours_outside_clinic");
  assert.equal((await adm.call("PUT", `/api/settings/doctors/${ids.lina}/hours`, { periods: [{ weekday: WED, start: "09:00", end: "12:00" }] })).status, 200);
  const nd = await adm.post("/api/settings/doctors", { nameEn: "Test Doctor", nameAr: "طبيب تجريبي", gender: "m", bufferMinutes: 5 });
  assert.equal(nd.status, 201);
  assert.equal((await adm.call("PUT", `/api/settings/doctors/${nd.json.id}/services`, { serviceIds: [svc().id] })).status, 200);
  await adm.call("PUT", `/api/settings/doctors/${nd.json.id}/hours`, { periods: [{ weekday: WED, start: "09:00", end: "10:00" }] });
  assert.ok((await free(sec, nd.json.id)).includes(at("09:00")));
  assert.equal((await sec.get("/api/lookups")).json.doctors.length, 3);
  await t.owner.query("delete from working_hours where doctor_id = $1", [nd.json.id]);
  await t.owner.query("delete from doctor_services where doctor_id = $1", [nd.json.id]);
  await adm.call("PUT", "/api/settings/hours", { periods: [] });
  await adm.call("PUT", `/api/settings/doctors/${ids.lina}/hours`, { periods: original });
});

test("switching a doctor off hides them and lists their bookings; services can be added and retired", async () => {
  const a = (await book(sec)).json;
  const r = await adm.patch(`/api/settings/doctors/${ids.lina}`, doctorBody({ active: false }));
  assert.equal(r.json.outside[0].id, a.id);
  assert.equal((await sec.get("/api/lookups")).json.doctors.length, 1);
  await adm.patch(`/api/settings/doctors/${ids.lina}`, doctorBody());

  const s = await adm.post("/api/settings/services", { nameEn: "Test Peel", nameAr: "تقشير", durationMinutes: 40, priceJod: 25, priceIsFrom: true });
  assert.equal(s.status, 201);
  assert.ok((await sec.get("/api/lookups")).json.services.some((x) => x.id === s.json.id));
  await adm.patch(`/api/settings/services/${s.json.id}`, { nameEn: "Test Peel", nameAr: "تقشير", durationMinutes: 40, active: false });
  assert.ok(!(await sec.get("/api/lookups")).json.services.some((x) => x.id === s.json.id));
  assert.equal((await adm.post("/api/settings/services", { nameEn: "Test X", nameAr: "س", durationMinutes: 2 })).status, 400);
});

test("staff rules: notice, window, change notice, cancel reason", async () => {
  const rule = (o) => adm.patch("/api/settings/rules/staff", { minNoticeMinutes: 0, windowDays: 365, changeNoticeMinutes: 0, ...o });
  await rule({ windowDays: 7 });
  assert.equal((await book(sec, { startsAt: at("10:00", "2026-12-02") })).json.error, "too_far_ahead");
  await rule({ minNoticeMinutes: 60 * 48 });
  assert.equal((await book(sec)).json.error, "too_soon");
  assert.ok(!(await free(sec)).length, "free times follow the notice");
  await rule({});
  const a = (await book(sec)).json;
  await rule({ changeNoticeMinutes: 60 * 48 });
  assert.equal((await sec.patch(`/api/appointments/${a.id}`, { expectedVersion: 1, startsAt: at("11:00") })).json.error, "too_late_to_change");
  assert.equal((await sec.post(`/api/appointments/${a.id}/status`, { status: "cancelled", reason: "x", expectedVersion: 1 })).json.error, "too_late_to_change");
  await rule({ requireCancelReason: false });
  const ok = await sec.post(`/api/appointments/${a.id}/status`, { status: "cancelled", expectedVersion: 1 });
  assert.equal(ok.status, 200, "with no notice and no reason required, the cancel goes through");
});

test("staff rule for times outside the free ones: block, warn, allow", async () => {
  const rule = (outsideHours) => adm.patch("/api/settings/rules/staff", { minNoticeMinutes: 0, windowDays: 365, changeNoticeMinutes: 0, outsideHours });
  const late = at("21:00");
  await rule("block");
  assert.equal((await book(sec, { startsAt: late, override: true })).json.error, "outside_hours_blocked");
  await rule("warn");
  assert.equal((await book(sec, { startsAt: late })).json.error, "not_a_free_time");
  await rule("allow");
  const r = await book(sec, { startsAt: late });
  assert.equal(r.status, 201);
  assert.equal(r.json.outside_hours, true);
  assert.equal((await book(sec, { startsAt: late, newPatient: { fullName: "B", phone: "0790000001" } })).json.error, "slot_taken", "no setting allows a double booking");
});

test("the limit of upcoming bookings warns staff, who may go on", async () => {
  await adm.patch("/api/settings/rules/staff", { minNoticeMinutes: 0, windowDays: 365, changeNoticeMinutes: 0, maxUpcoming: 1 });
  const a = (await book(sec)).json;
  const next = { patientId: a.patient_id, newPatient: undefined, startsAt: at("11:00") };
  assert.deepEqual((({ status, json }) => [status, json.error, json.limit])(await book(sec, next)), [409, "over_max_upcoming", 1]);
  assert.equal((await book(sec, { ...next, allowOverLimit: true })).status, 201);
});

test("the Patient rules saved here are what the assistant reads", async () => {
  await adm.patch("/api/settings/rules/patient", { minNoticeMinutes: 240, windowDays: 14, changeNoticeMinutes: 60, maxUpcoming: null, outsideHours: "block" });
  const { rows } = await t.owner.query("select min_notice_minutes, window_days, change_notice_minutes, max_upcoming, outside_hours from booking_rules where clinic_id = $1 and audience = 'patient'", [t.clinicA]);
  assert.deepEqual(rows[0], { min_notice_minutes: 240, window_days: 14, change_notice_minutes: 60, max_upcoming: null, outside_hours: "warn" }, "the staff-only fields stay out of the patient rules");
});

test("security settings reach Accounts: the lock and sign-out follow what the clinic chose", async () => {
  const general = (await sec.get("/api/settings")).json.general;
  const body = (o) => ({ idleTimeoutMinutes: general.idle_timeout_minutes, lockAfterMinutes: general.lock_after_minutes, require2faAll: false, conversationVisibility: "handoff",
    remindersEnabled: true, reminderOffsetsMinutes: [1440, 120], quietStart: "21:00", quietEnd: "08:00", assistantEnabled: true, handoffAlertEmails: [], ...o });
  assert.equal((await adm.patch("/api/settings/general", body({ lockAfterMinutes: 5 }))).status, 200);
  t.advance(6);
  assert.equal((await sec.get("/api/lookups")).status, 423, "locked after 5 minutes now, not 10");
  await t.core.pool.query("select 1");
  await t.owner.query("update accounts.sessions set locked_at = null, last_activity_at = $1", [new Date(t.clock.t)]);
  assert.equal((await adm.patch("/api/settings/general", body({ lockAfterMinutes: 0, idleTimeoutMinutes: 15 }))).status, 200);
  t.advance(14);
  assert.equal((await sec.get("/api/lookups")).status, 200, "the lock is off");
  t.advance(2);
  assert.equal((await sec.get("/api/lookups")).status, 401, "signed out after the shorter idle time");
});

test("general settings are validated: pick lists, the 12-month audit floor, emails; two-step for everyone applies", async () => {
  const base = { idleTimeoutMinutes: 60, lockAfterMinutes: 10, require2faAll: false, conversationVisibility: "handoff", remindersEnabled: true,
    reminderOffsetsMinutes: [120, 1440], quietStart: "21:00", quietEnd: "08:00", assistantEnabled: false, afterHoursMessageEn: "Back at 9", handoffAlertEmails: ["Team@Clinic.jo"] };
  assert.equal((await adm.patch("/api/settings/general", { ...base, idleTimeoutMinutes: 7 })).status, 400);
  assert.equal((await adm.patch("/api/settings/general", { ...base, auditRetentionMonths: 6 })).status, 400);
  assert.equal((await adm.patch("/api/settings/general", { ...base, handoffAlertEmails: ["nope"] })).status, 400);
  assert.equal((await adm.patch("/api/settings/general", { ...base, reminderOffsetsMinutes: [60, 120, 240] })).status, 400);
  assert.equal((await adm.patch("/api/settings/general", { ...base, recoveryWarnAt: 6 })).status, 400, "recovery-code warning: 1 to 5");
  assert.equal((await adm.patch("/api/settings/general", { ...base, recoveryWarnAt: 2 })).status, 200);
  assert.equal((await adm.get("/api/settings")).json.general.recovery_warn_at, 2);
  assert.equal((await adm.patch("/api/settings/general", base)).status, 200);
  const g = (await t.owner.query("select * from clinic_settings where clinic_id = $1", [t.clinicA])).rows[0];
  assert.equal(g.recovery_warn_at, 2, "left out of the body: kept as it was");
  assert.deepEqual(g.reminder_offsets_minutes, [1440, 120], "kept in order, longest first");
  assert.deepEqual(g.handoff_alert_emails, ["team@clinic.jo"]);
  assert.equal(g.assistant_enabled, false);
  await adm.patch("/api/settings/general", { ...base, require2faAll: true });
  const { r } = await t.signIn(P.secretary2);
  assert.equal(r.json.state, "mfa_setup_required", "everyone now sets up two-step");
});

test("profile, FAQ, and every change in the audit trail with before and after", async () => {
  const s = (await sec.get("/api/settings")).json.profile;
  const body = { nameEn: "Renamed Clinic", nameAr: s.name_ar, phone: s.phone, addressEn: s.address_en, addressAr: s.address_ar, timezone: s.timezone, defaultLanguage: "ar", weekStart: 0, slotStepMinutes: 15 };
  assert.equal((await adm.patch("/api/settings/profile", { ...body, timezone: "Mars/Base" })).json.error, "invalid_timezone");
  assert.equal((await adm.patch("/api/settings/profile", body)).status, 200);
  const f = await adm.post("/api/settings/faqs", { topic: "parking", questionEn: "Parking?", questionAr: "موقف؟", answerEn: "Yes", answerAr: "نعم" });
  assert.equal(f.status, 201);
  assert.equal((await adm.call("DELETE", `/api/settings/faqs/${f.json.id}`)).status, 200);
  const { rows } = await t.owner.query("select actor_label, action, before, after from audit.events where clinic_id = $1 and entity = 'clinic' order by seq desc limit 1", [t.clinicA]);
  assert.equal(rows[0].actor_label, "Layla Admin");
  assert.equal(rows[0].after.name_en, "Renamed Clinic");
  assert.notEqual(rows[0].before.name_en, "Renamed Clinic");
  await t.owner.query("update clinics set name_en = $1, week_start = 6 where id = $2", [s.name_en, t.clinicA]);
});

// The promise of the design: the assistant and Booking give identical free times. Runs the agent's own code when its Python is here.
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const python = [path.join(repo, "agent", ".venv", "Scripts", "python.exe"), path.join(repo, "agent", ".venv", "bin", "python")].find(existsSync);
test("free times are identical to the WhatsApp assistant's, with settings in play", { skip: !python && "the agent's Python is not installed" }, async () => {
  await adm.call("PUT", "/api/settings/hours", { periods: [0, 1, 2, 3, 4, 6].map((weekday) => ({ weekday, start: "10:30", end: "18:00" })) });
  await adm.patch(`/api/settings/doctors/${ids.lina}`, doctorBody({ slotMinutes: 20, bufferMinutes: 10 }));
  await adm.patch(`/api/settings/doctors/${ids.omar}`, doctorBody({ nameEn: "Dr. Omar Khalil", nameAr: "د. عمر خليل", gender: "m", bufferMinutes: 5 }));
  await adm.post("/api/settings/time-off", { startsAt: at("10:30", "2026-11-12"), endsAt: at("13:00", "2026-11-12"), reason: "Closed morning" });
  await adm.post("/api/settings/time-off", { doctorId: ids.omar, startsAt: at("15:00", "2026-11-15"), endsAt: at("17:00", "2026-11-16") });
  await book(sec, { startsAt: at("10:30") });
  await book(sec, { doctorId: ids.omar, startsAt: at("13:00"), newPatient: { fullName: "B", phone: "0790000002" } });
  // Same window on both sides: the assistant's patient rules.
  await adm.patch("/api/settings/rules/staff", { minNoticeMinutes: 60, windowDays: 30, changeNoticeMinutes: 0 });
  const mine = {};
  for (const s of ids.services) for (const d of [ids.lina, ids.omar]) {
    const r = await sec.get(`/api/slots?service=${s.id}&doctor=${d}&date=2026-11-10&days=14`);
    if (Array.isArray(r.json)) mine[`${s.id}|${d}`] = r.json.map((x) => x.startsAt);
  }
  const script = `
import json, sys, psycopg
from datetime import datetime, date, timezone
from limitsiz_agent.booking import find_slots
pairs = json.loads(sys.stdin.read())
out = {}
with psycopg.connect("postgresql://postgres:test@localhost:54329/accounts_test", autocommit=True) as c:
    for key in pairs:
        sid, did = key.split("|")
        rows = find_slots(c, "${t.clinicA}", sid, date_from=date(2026, 11, 10), days=14, doctor_id=did, now=datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc))
        out[key] = [s["starts_at"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z") for s in rows]
print(json.dumps(out))`;
  const theirs = JSON.parse(execFileSync(python, ["-c", script], { input: JSON.stringify(Object.keys(mine)), env: { ...process.env, PYTHONPATH: path.join(repo, "agent") }, maxBuffer: 1 << 24 }).toString());
  let total = 0;
  for (const key of Object.keys(mine)) { total += mine[key].length; assert.deepEqual([...mine[key]].sort(), [...theirs[key]].sort(), key); }
  assert.ok(total > 300, `compared ${total} free times`);
});
