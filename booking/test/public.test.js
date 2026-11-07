// The online booking page (book.limitsiz.si/<clinic>) and its staff side.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { setup } from "./helpers.js";

let t, ids, P, adm, sec;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  adm = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  sec = (await t.login(P.secretary)).b;
});

// The test clock is Tuesday 2026-11-10 12:00 in Amman (UTC+3).
const DAY = "2026-11-11";
const at = (hhmm, day = DAY) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const SLUG = "demo-derma";
const svc = () => ids.services[0];
const ONLINE = {
  enabled: true, staffCheck: true, showPrices: false, allowAnyDoctor: true, allowCancel: true, allowReschedule: true, allowForOther: true,
  offerReminders: true, defaultCountryCode: "962", maxUncheckedPerPhone: 1, bookingsPerPhonePerDay: 2, bookingsPerIpPerDay: 50,
  lookupsPerIpPerMinute: 500, managePerIpPerHour: 100, daysPerPage: 7, introEn: null, introAr: null, doneNoteEn: null, doneNoteAr: null,
  shareMessageEn: "Book your appointment at {clinic} here: {link}", shareMessageAr: "احجز موعدك في {clinic} من هذا الرابط: {link}",
  privacyUrl: "https://limitsiz.si/privacy",
};
const turnOn = (over = {}) => adm.patch("/api/settings/online", { ...ONLINE, ...over });
const body = (over = {}) => ({ serviceId: svc().id, doctorId: ids.lina, startsAt: at("10:00"), name: "Huda Online", phone: "0791234567", language: "ar", agree: true, ...over });
const book = (over, opts) => t.pub("POST", `/api/c/${SLUG}/book`, body(over), opts);
const freeOnline = async (day = DAY, doctor = ids.lina) => (await t.pub("GET", `/api/c/${SLUG}/slots?service=${svc().id}&doctor=${doctor}&date=${day}&days=1`)).json.map((s) => s.startsAt);

test("the link is off until an administrator turns it on; a secretary cannot", async () => {
  assert.equal((await t.pub("GET", "/api/health/db")).status, 200);   // the deploy check: public_app reaches the database
  assert.equal((await t.pub("GET", `/api/c/${SLUG}`)).status, 404);
  assert.equal((await t.pub("GET", "/api/c/no-such-clinic")).json.error, "clinic_not_found", "the same answer as a link switched off");
  assert.equal((await sec.patch("/api/settings/online", ONLINE)).status, 403);
  assert.equal((await turnOn()).status, 200);
  const info = (await t.pub("GET", `/api/c/${SLUG}`)).json;
  assert.equal(info.clinic.slug, SLUG);
  assert.ok(info.services.length && info.services.every((s) => s.price_jod === null), "prices hidden by default");
  assert.equal(info.options.daysPerPage, 7);
  await turnOn({ showPrices: true });
  assert.ok((await t.pub("GET", `/api/c/${SLUG}`)).json.services.some((s) => s.price_jod !== null));
  assert.equal((await turnOn({ shareMessageEn: "no link here" })).status, 400, "the WhatsApp message must hold {link}");
});

test("free times follow the patient rules and match the staff app's", async () => {
  await turnOn();
  const staff = (await sec.get(`/api/slots?service=${svc().id}&doctor=${ids.lina}&date=${DAY}`)).json.map((s) => s.startsAt);
  assert.deepEqual(await freeOnline(), staff);
  const today = await freeOnline("2026-11-10");
  assert.ok(today.every((s) => Date.parse(s) >= Date.parse(at("13:00", "2026-11-10"))), "an hour's notice (patient rule)");
  assert.deepEqual(await freeOnline("2026-12-20"), [], "beyond the 30-day window");
});

test("a booking lands in the calendar as Online, not checked, by the patient, until a secretary checks it", async () => {
  await turnOn();
  const r = await book({ from: "qr" });
  assert.equal(r.status, 201);
  assert.match(r.json.manageToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.json.waitingForCheck, true); assert.equal(r.json.shownStatus, "waiting");
  assert.equal(r.json.patient_phone, undefined);
  const shown = async () => (await t.pub("POST", `/api/c/${SLUG}/manage`, { token: r.json.manageToken })).json.shownStatus;
  const list = (await sec.get(`/api/appointments?from=${DAY}&to=${DAY}&unchecked=1`)).json;
  assert.equal(list.length, 1);
  const a = list[0];
  assert.equal(a.source, "web"); assert.equal(a.online_from, "qr"); assert.equal(a.unchecked, true); assert.equal(a.patient_name, "Huda Online");
  const ev = (await t.owner.query("select actor_type, actor_id, ip from audit.events where entity = 'appointment' and entity_id = $1", [a.id])).rows;
  assert.equal(ev[0].actor_type, "patient"); assert.equal(ev[0].actor_id, a.patient_id); assert.ok(ev[0].ip);
  const ro = (await t.login(P.readonly)).b;
  assert.equal((await ro.post(`/api/appointments/${a.id}/check`, { expectedVersion: a.row_version })).status, 403);
  const c = await sec.post(`/api/appointments/${a.id}/check`, { expectedVersion: a.row_version });
  assert.equal(c.status, 200); assert.equal(c.json.unchecked, false);
  assert.equal(await shown(), "confirmed"); // the patient's private link now says Confirmed
  assert.equal((await sec.post(`/api/appointments/${a.id}/check`, { expectedVersion: c.json.row_version })).json.error, "nothing_to_check");
  assert.equal((await sec.get(`/api/appointments?from=${DAY}&to=${DAY}&unchecked=1`)).json.length, 0);
});

test("an existing number never changes the patient's record, and the page does not tell", async () => {
  await turnOn();
  const staff = await sec.post("/api/appointments", { serviceId: svc().id, doctorId: ids.lina, startsAt: at("10:15"), source: "phone", newPatient: { fullName: "Huda Haddad", phone: "0791234567" } });
  assert.equal(staff.status, 201);
  const known = await book({ name: "Someone Else", startsAt: at("11:00") });
  const fresh = await book({ name: "New Person", phone: "0781111111", startsAt: at("12:00") });
  assert.equal(known.status, 201); assert.equal(fresh.status, 201);
  assert.deepEqual(Object.keys(known.json).sort(), Object.keys(fresh.json).sort());
  const p = (await t.owner.query("select full_name from patients where phone_e164 = '+962791234567'")).rows[0];
  assert.equal(p.full_name, "Huda Haddad");
  const a = (await sec.get(`/api/appointments/${known.json.id}`)).json;
  assert.equal(a.booked_name, "Someone Else"); assert.equal(a.name_differs, true);
});

test("phone limits from Settings, all with one answer", async () => {
  await turnOn();
  assert.equal((await book()).status, 201);
  const second = await book({ startsAt: at("11:00") });
  assert.equal(second.json.error, "phone_not_accepted", "one unchecked booking per phone");
  await turnOn({ maxUncheckedPerPhone: 5 });
  assert.equal((await book({ startsAt: at("11:00") })).status, 201);
  assert.equal((await book({ startsAt: at("12:00") })).json.error, "phone_not_accepted", "two a day per phone");
  await turnOn({ maxUncheckedPerPhone: 5, bookingsPerPhonePerDay: 10, staffCheck: false });
  assert.equal((await book({ startsAt: at("12:00") })).status, 201);
  assert.equal((await book({ startsAt: at("13:00") })).json.error, "phone_not_accepted", "the patient rule of 3 upcoming");
  const c = (await sec.get(`/api/appointments?from=${DAY}&to=${DAY}`)).json.find((x) => x.starts_at === at("12:00") || new Date(x.starts_at).toISOString() === at("12:00"));
  assert.equal(c.unchecked, false, "with the staff check off, no mark");
});

test("a taken time, a doctor who does not offer it, a time outside the free ones", async () => {
  await turnOn();
  assert.equal((await book({ startsAt: at("12:00") })).status, 201);
  assert.equal((await book({ phone: "0782222222", startsAt: at("12:00") })).json.error, "slot_taken");
  assert.equal((await book({ phone: "0782222222", startsAt: at("12:07") })).json.error, "slot_taken", "not on the grid");
  assert.equal((await book({ phone: "0782222222", startsAt: at("12:30", "2026-11-10") })).json.error, "slot_taken", "inside the notice period");
  const any = await book({ phone: "0782222222", doctorId: null, startsAt: at("12:00") });
  assert.equal(any.status, 201); assert.notEqual(any.json.doctor.id, ids.lina, "any doctor: the next one free at that time");
  await turnOn({ allowAnyDoctor: false });
  assert.equal((await book({ phone: "0783333333", doctorId: null, startsAt: at("11:00") })).json.error, "choose_a_doctor");
});

test("the private link: see, move, cancel; only on its own clinic's page; not too late", async () => {
  await turnOn();
  const token = (await book()).json.manageToken;
  const m = await t.pub("POST", `/api/c/${SLUG}/manage`, { token });
  assert.equal(m.status, 200); assert.equal(m.json.canCancel, true); assert.equal(m.json.canReschedule, true);
  assert.equal((await t.pub("POST", "/api/c/other-clinic/manage", { token })).status, 404);
  assert.equal((await t.pub("POST", `/api/c/${SLUG}/manage`, { token: "x".repeat(43) })).status, 404);
  const free = (await t.pub("POST", `/api/c/${SLUG}/manage/slots`, { token, date: DAY })).json.map((s) => s.startsAt);
  assert.ok(free.includes(at("10:00")), "its own time stays offered");
  const mv = await t.pub("POST", `/api/c/${SLUG}/manage/reschedule`, { token, startsAt: at("11:00") });
  assert.equal(mv.status, 200); assert.equal(new Date(mv.json.startsAt).toISOString(), at("11:00"));
  await turnOn({ allowCancel: false });
  assert.equal((await t.pub("POST", `/api/c/${SLUG}/manage/cancel`, { token })).json.error, "cannot_cancel");
  await turnOn();
  const cx = await t.pub("POST", `/api/c/${SLUG}/manage/cancel`, { token, reason: "travelling" });
  assert.equal(cx.json.status, "cancelled");
  // Within the change notice (patient rule: 2 hours) the link only says to call.
  const late = (await book({ phone: "0785555555", startsAt: at("13:15", "2026-11-10") })).json.manageToken;
  const lm = (await t.pub("POST", `/api/c/${SLUG}/manage`, { token: late })).json;
  assert.equal(lm.canCancel, false); assert.equal(lm.tooLateToChange, true);
});

test("limits per connection come from Settings; bots and other sites get nowhere", async () => {
  await turnOn({ bookingsPerIpPerDay: 1 });
  assert.equal((await book()).status, 201);
  assert.equal((await book({ phone: "0786666666", startsAt: at("11:00") })).status, 429);
  const bot = await t.pub("POST", `/api/c/${SLUG}/manage`, { token: "a".repeat(43) }, { origin: "https://evil.example" });
  assert.equal(bot.status, 403);
  t.forgetPublic?.();
  await turnOn({ lookupsPerIpPerMinute: 5 });
  let last;
  for (let i = 0; i < 7; i++) last = await t.pub("GET", `/api/c/${SLUG}`);
  assert.equal(last.status, 429);
});

test("the hidden field: a bot sees success and nothing is booked", async () => {
  await turnOn();
  const r = await book({ website: "http://spam" });
  assert.equal(r.status, 201);
  assert.equal((await sec.get(`/api/appointments?from=${DAY}&to=${DAY}`)).json.length, 0);
});

test("the page's database login cannot read patients or add anything but web bookings", async () => {
  await turnOn();
  const u = new URL("postgresql://public_app:test@localhost:54329/accounts_test");
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    await assert.rejects(c.query("select full_name from patients"), /permission denied/);
    await assert.rejects(c.query("select internal_note from appointments"), /permission denied/);
    await assert.rejects(c.query("select reason from time_off"), /permission denied/);
    const p = (await c.query("select public.online_patient($1, '+962790000001', 'X', 'ar', false) as id", [t.clinicA])).rows[0].id;
    await assert.rejects(c.query(`insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source)
      values ($1, $2, $3, $4, now() + interval '2 days', now() + interval '2 days 20 minutes', 'staff')`, [t.clinicA, ids.lina, svc().id, p]), /row-level security/);
    await turnOn({ enabled: false });
    await assert.rejects(c.query("select public.online_patient($1, '+962790000002', 'Y', 'ar', false)", [t.clinicA]), /off/);
  } finally { await c.end(); }
});

test("Send booking link: the clinic's address and its message, from Settings", async () => {
  assert.equal((await sec.get("/api/online-link")).json.enabled, false);
  await turnOn();
  const l = (await sec.get("/api/online-link")).json;
  assert.equal(l.enabled, true);
  assert.equal(l.url, `${t.publicBase}/${SLUG}`);
  assert.ok(l.messageEn.endsWith(`${t.publicBase}/${SLUG}?from=wa`));
  assert.ok(l.messageAr.includes("احجز"));
});
