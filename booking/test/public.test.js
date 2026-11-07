// The online booking page (book.limitsiz.si/<clinic>) and its staff side.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { setup } from "./helpers.js";
import { sha256hex as sha } from "../server/public-service.js";

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
  findEnabled: false, findPerPhonePerDay: 3, findPerIpPerHour: 10,
  findMessageEn: "Your appointment at {clinic}: {when}, {doctor}. Your new private link to see the status, change or cancel: {link}",
  findMessageAr: "موعدك في {clinic}: {when}، {doctor}. رابطك الخاص الجديد لمعرفة حالة الحجز أو تعديله أو إلغائه: {link}",
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

test("a new time chosen by the patient goes back to the clinic; any move restarts the reminders", async () => {
  await turnOn();
  const r = (await book()).json;
  const view = async () => (await t.pub("POST", `/api/c/${SLUG}/manage`, { token: r.manageToken })).json;
  const staff = async () => (await sec.get(`/api/appointments/${r.id}`)).json;
  // The clinic checks and confirms it; reminders were already sent for the old time.
  let a = await staff();
  a = (await sec.post(`/api/appointments/${r.id}/check`, { expectedVersion: a.row_version })).json;
  a = (await sec.post(`/api/appointments/${r.id}/status`, { status: "confirmed", expectedVersion: a.row_version })).json;
  assert.equal(a.status, "confirmed"); assert.equal((await view()).shownStatus, "confirmed");
  await t.owner.query("update appointments set reminder_24h_at = now(), reminder_2h_at = now() where id = $1", [r.id]);
  // The patient moves it: back to booked and "Time changed by patient" until the clinic confirms. The person stays checked.
  const mv = await t.pub("POST", `/api/c/${SLUG}/manage/reschedule`, { token: r.manageToken, startsAt: at("11:00") });
  assert.equal(mv.status, 200); assert.equal(mv.json.status, "booked"); assert.equal(mv.json.shownStatus, "waiting");
  a = await staff();
  assert.equal(a.unchecked, false); assert.ok(a.checked_by, "the check of the person stays");
  assert.equal(a.moved_by_patient, true);
  assert.ok((await sec.get(`/api/appointments?from=${DAY}&to=${DAY}&unchecked=1`)).json.some((x) => x.id === r.id), "in the filter");
  let rem = (await t.owner.query("select reminder_24h_at, reminder_2h_at from appointments where id = $1", [r.id])).rows[0];
  assert.equal(rem.reminder_24h_at, null); assert.equal(rem.reminder_2h_at, null);
  // Mark as checked is not needed again; Confirm accepts the new time.
  assert.equal((await sec.post(`/api/appointments/${r.id}/check`, { expectedVersion: a.row_version })).json.error, "nothing_to_check");
  a = (await sec.post(`/api/appointments/${r.id}/status`, { status: "confirmed", expectedVersion: a.row_version })).json;
  assert.equal(a.moved_by_patient, false); assert.equal((await view()).shownStatus, "confirmed");
  assert.ok(!(await sec.get(`/api/appointments?from=${DAY}&to=${DAY}&unchecked=1`)).json.some((x) => x.id === r.id), "out of the filter");
  // A booking that was only checked (never confirmed): the patient's move still waits for the clinic.
  await turnOn({ staffCheck: false });
  const r2 = (await book({ phone: "0787777777", startsAt: at("12:30") })).json;
  assert.equal(r2.shownStatus, "booked");
  const mv2 = (await t.pub("POST", `/api/c/${SLUG}/manage/reschedule`, { token: r2.manageToken, startsAt: at("13:00") })).json;
  assert.equal(mv2.status, "booked"); assert.equal(mv2.shownStatus, "waiting");
  // A secretary moving it keeps its status, and the reminders start again for the new time.
  a = await staff();
  await t.owner.query("update appointments set reminder_24h_at = now() where id = $1", [r.id]);
  a = await staff();
  const moved = await sec.patch(`/api/appointments/${r.id}`, { expectedVersion: a.row_version, startsAt: at("12:00") });
  assert.equal(moved.status, 200); assert.equal(moved.json.status, "confirmed");
  rem = (await t.owner.query("select reminder_24h_at from appointments where id = $1", [r.id])).rows[0];
  assert.equal(rem.reminder_24h_at, null);
  // A secretary choosing another time for a patient's move settles it too.
  let b2 = (await sec.get(`/api/appointments/${r2.id}`)).json;
  assert.equal(b2.moved_by_patient, true);
  const p2 = await sec.patch(`/api/appointments/${r2.id}`, { expectedVersion: b2.row_version, startsAt: at("11:30") });
  assert.equal(p2.status, 200, JSON.stringify(p2.json));
  assert.equal(p2.json.moved_by_patient, false);
});

test("Find my booking: off until WhatsApp is connected; the same answer for every number; a replaced link says so", async () => {
  // Switched on, but WhatsApp is not connected: not offered, and refused.
  await turnOn({ findEnabled: true });
  const r = (await book()).json;
  const find = (phone, opts) => t.pub("POST", `/api/c/${SLUG}/find`, { phone }, opts);
  const queued = async () => (await t.owner.query("select appointment_id::text as id, phone_e164 from link_requests order by created_at")).rows;
  assert.equal((await t.pub("GET", `/api/c/${SLUG}`)).json.options.findEnabled, false);
  assert.equal((await find("0791234567")).json.error, "find_not_available");
  let set = (await adm.get("/api/settings")).json.online;
  assert.equal(set.whatsapp_connected, false); assert.equal(set.find_enabled, true);
  // Connected.
  await t.owner.query("update clinics set wa_phone_number_id = '1234567890' where slug = $1", [SLUG]);
  t.forgetPublic?.();
  assert.equal((await t.pub("GET", `/api/c/${SLUG}`)).json.options.findEnabled, true);
  const known = await find("0791234567"), unknown = await find("0781112222");
  assert.equal(known.status, 202); assert.equal(unknown.status, 202);
  assert.deepEqual(known.json, unknown.json, "the page never says whether a number has a booking");
  assert.deepEqual(await queued(), [{ id: r.id, phone_e164: "+962791234567" }]);
  assert.equal((await find("12")).status, 400);
  assert.equal((await t.pub("POST", `/api/c/${SLUG}/find`, { phone: "0791234567", website: "x" })).status, 202, "bots see success");
  assert.equal((await queued()).length, 1, "and nothing more is queued");
  // What the WhatsApp assistant does when it sends: a new link replaces the old one, and the old one says "replaced".
  const old = sha(r.manageToken);
  await t.owner.query("update appointments set manage_token_hash = $2 where id = $1", [r.id, sha("a-new-link")]);
  await t.owner.query("update link_requests set status = 'sent', old_token_hash = $1", [old]);
  const m = await t.pub("POST", `/api/c/${SLUG}/manage`, { token: r.manageToken });
  assert.equal(m.status, 410); assert.equal(m.json.error, "link_replaced");
  assert.equal((await t.pub("POST", `/api/c/${SLUG}/manage`, { token: "b".repeat(43) })).json.error, "link_not_found");
  // Per connection per hour, from Settings.
  t.forgetPublic?.();
  await turnOn({ findEnabled: true, findPerIpPerHour: 1 });
  assert.equal((await find("0781112222")).status, 202);
  assert.equal((await find("0781112222")).status, 429);
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
