import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, ids, P;     // P = the cast of people
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); P = await t.people(); ids = await t.seedIds(); });

// The demo clinic is in Asia/Amman (UTC+3). The test clock is Tuesday 2026-11-10 09:00Z = 12:00 in Amman.
const TODAY = "2026-11-10", TOMORROW = "2026-11-11";
const at = (day, hhmmLocal) => { const [h, m] = hhmmLocal.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const svc = () => ids.services[0];                       // first demo service
const secretary = async () => (await t.login(P.secretary)).b;
const adminB = async () => (await t.login(P.admin, { mfa: P.admin.secret })).b;
const book = (b, over = {}) => b.post("/api/appointments", { serviceId: svc().id, doctorId: ids.lina, startsAt: at(TOMORROW, "10:00"), source: "phone",
  newPatient: { fullName: "Huda Test", phone: "0791234567" }, ...over });

// ------------------------------------------------------------------ sign-in through Accounts
test("single sign-on: nobody gets in without it; after it the person, clinic and permissions are known", async () => {
  const anon = t.bookingJar();
  assert.equal((await anon.get("/api/me")).status, 401);
  const { b, status } = await t.login(P.secretary);
  assert.equal(status, 302);
  const me = (await b.get("/api/me")).json;
  assert.equal(me.user.name, "Sara Secretary");
  assert.equal(me.clinic.slug, "demo-derma");
  assert.ok(me.permissions.includes("booking.appointments.create"));
  assert.ok(!me.permissions.includes("booking.appointments.restore"));
});

test("a callback with the wrong state is refused", async () => {
  const r = await fetch(`${t.base}/auth/callback?code=abc&state=nope`, { redirect: "manual", headers: { cookie: "lc_state=other|/" } });
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /\/auth\/login/);
});

test("every request is checked: a locked session gets 423, a disabled person 401, and signing out ends it", async () => {
  const { b, acc } = await t.login(P.secretary);
  assert.equal((await b.get("/api/lookups")).status, 200);
  await acc.post("/api/lock");
  const locked = await b.get("/api/lookups");
  assert.deepEqual([locked.status, locked.json.error], [423, "locked"]);
  await acc.post("/api/unlock", { password: P.secretary.password });
  assert.equal((await b.get("/api/lookups")).status, 200);
  t.advance(11);                                        // idle 11 minutes: Accounts locks it
  assert.equal((await b.get("/api/lookups")).status, 423);
  await acc.post("/api/unlock", { password: P.secretary.password });
  await t.owner.query("update accounts.users set status = 'disabled' where id = $1", [P.secretary.id]);
  assert.equal((await b.get("/api/lookups")).status, 401);
});

test("logout ends the Booking session", async () => {
  const b = await secretary();
  const r = await b.post("/api/logout");
  assert.equal(r.status, 200);
  assert.equal((await b.get("/api/me")).status, 401);
});

test("a request from another site is refused (CSRF)", async () => {
  const b = await secretary();
  const evil = t.bookingJar("https://evil.example"); evil.cookie = b.cookie;
  assert.equal((await evil.post("/api/appointments", {})).status, 403);
});

// ------------------------------------------------------------------ free times
test("free times follow the doctor's shifts, the clinic's grid and existing bookings", async () => {
  const b = await secretary();
  const q = (extra = "") => b.get(`/api/slots?service=${svc().id}&doctor=${ids.lina}&date=${TOMORROW}${extra}`);
  const free = (await q()).json.map((s) => s.startsAt);
  assert.ok(free.includes(at(TOMORROW, "10:00")));
  assert.ok(!free.includes(at(TOMORROW, "14:00")), "break between the shifts");
  assert.ok(free.includes(at(TOMORROW, "16:00")));
  assert.ok(!free.some((s) => s < at(TOMORROW, "10:00")), "nothing before the shift starts");
  const grid = free.map((s) => (Date.parse(s) - Date.parse(at(TOMORROW, "10:00"))) / 60000);
  assert.ok(grid.every((m) => m % 15 === 0), "on the 15-minute grid");
  assert.equal((await book(b)).status, 201);
  const after = (await q()).json.map((s) => s.startsAt);
  assert.ok(!after.includes(at(TOMORROW, "10:00")));
  const dur = svc().duration_minutes;
  const end = Date.parse(at(TOMORROW, "10:00")) + dur * 60000;
  const next = after.filter((s) => Date.parse(s) >= end).map(Date.parse)[0];
  assert.ok(next - end < 15 * 60000, "the first free time after the booking is on the next grid step");
  assert.ok(!after.some((s) => Date.parse(s) > Date.parse(at(TOMORROW, "10:00")) && Date.parse(s) < end), "nothing inside the booking");
});

test("time-off closes the whole clinic or one doctor", async () => {
  const b = await secretary();
  await t.owner.query("insert into time_off (clinic_id, doctor_id, starts_at, ends_at, reason) values ($1,$2,$3,$4,'conference')", [t.clinicA, ids.lina, at(TOMORROW, "10:00"), at(TOMORROW, "13:00")]);
  const free = (await b.get(`/api/slots?service=${svc().id}&doctor=${ids.lina}&date=${TOMORROW}`)).json.map((s) => s.startsAt);
  assert.ok(!free.some((s) => s >= at(TOMORROW, "10:00") && s < at(TOMORROW, "13:00")));
  assert.ok(free.includes(at(TOMORROW, "13:00")) || free.some((s) => s >= at(TOMORROW, "13:00")));
});

// ------------------------------------------------------------------ creating bookings
test("a secretary books a phone call with a new patient; the phone number is normalised", async () => {
  const b = await secretary();
  const r = await book(b);
  assert.equal(r.status, 201);
  assert.equal(r.json.patient_phone, "+962791234567");
  assert.equal(r.json.source, "phone");
  assert.equal(r.json.status, "booked");
  assert.equal(r.json.row_version, 1);
  assert.equal(r.json.doctor_name_en, "Dr. Lina Haddad");
  assert.equal(r.json.whatsapp_reminders, false, "consent is never assumed");
});

test("the same time twice is refused: exact overlap, partial overlap, and the database rule behind it", async () => {
  const b = await secretary();
  assert.equal((await book(b)).status, 201);
  const again = await book(b, { newPatient: { fullName: "Second", phone: "0797654321" } });
  assert.equal(again.status, 409);
  assert.ok(["not_a_free_time", "slot_taken"].includes(again.json.error));
  const forced = await book(b, { newPatient: { fullName: "Third", phone: "0797000000" }, startsAt: at(TOMORROW, "10:15"), override: true });
  assert.deepEqual([forced.status, forced.json.error], [409, "slot_taken"], "no override can double-book a doctor");
  assert.equal((await t.owner.query("select count(*)::int n from appointments")).rows[0].n, 1);
});

test("a time that is not a free time needs an explicit confirmation (outside hours = warning, not a block)", async () => {
  const b = await secretary();
  const late = at(TOMORROW, "21:00");
  const r1 = await book(b, { startsAt: late });
  assert.deepEqual([r1.status, r1.json.error], [409, "not_a_free_time"]);
  const r2 = await book(b, { startsAt: late, override: true });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.outside_hours, true);
});

test("'any available doctor' takes the first free one, then the next, then refuses", async () => {
  const b = await secretary();
  const any = (n) => book(b, { doctorId: "any", startsAt: at(TOMORROW, "12:00"), newPatient: { fullName: `P${n}`, phone: `079000000${n}` } });
  const a1 = await any(1), a2 = await any(2), a3 = await any(3);
  assert.equal(a1.json.doctor_name_en, "Dr. Lina Haddad");
  assert.equal(a2.json.doctor_name_en, "Dr. Omar Khalil");
  assert.equal(a3.status, 409);
});

test("a doctor only gets services they offer; unknown ids and past times are refused", async () => {
  const b = await secretary();
  await t.owner.query("delete from doctor_services where doctor_id = $1 and service_id = $2", [ids.lina, svc().id]);
  assert.equal((await book(b)).json.error, "doctor_does_not_offer_service");
  await t.owner.query("insert into doctor_services (clinic_id, doctor_id, service_id) values ($1,$2,$3)", [t.clinicA, ids.lina, svc().id]);
  assert.equal((await book(b, { startsAt: at(TODAY, "09:00") })).json.error, "in_the_past");
  assert.equal((await book(b, { startsAt: "not a time" })).status, 400);
  assert.equal((await book(b, { startsAt: at("2028-01-04", "10:00") })).json.error, "too_far_ahead");
});

test("a walk-in may be entered a little after it started; a phone booking may not be in the past", async () => {
  const b = await secretary();
  const w = await book(b, { source: "walkin", doctorId: ids.omar, startsAt: at(TODAY, "11:30"), override: true });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  const p = await book(b, { source: "phone", doctorId: ids.omar, startsAt: at(TODAY, "11:00"), override: true, newPatient: { fullName: "X", phone: "0790001111" } });
  assert.equal(p.json.error, "in_the_past");
});

test("one patient cannot be in two bookings at once; an existing patient is chosen by id", async () => {
  const b = await secretary();
  const first = await book(b);
  const pid = first.json.patient_id;
  const clash = await b.post("/api/appointments", { serviceId: svc().id, doctorId: ids.omar, startsAt: at(TOMORROW, "12:00"), source: "phone", patientId: pid });
  assert.equal(clash.status, 201, "a different time is fine");
  const overlap = await b.post("/api/appointments", { serviceId: svc().id, doctorId: ids.omar, startsAt: at(TOMORROW, "10:00"), source: "phone", patientId: pid, override: true });
  assert.deepEqual([overlap.status, overlap.json.error], [409, "patient_already_booked_then"]);
});

// ------------------------------------------------------------------ permissions
test("read-only people see but cannot change; doctors need 'can also manage bookings'", async () => {
  const sec = await secretary();
  const made = (await book(sec)).json;
  const ro = (await t.login(P.readonly)).b;
  assert.equal((await ro.get("/api/appointments")).status, 200);
  assert.equal((await book(ro)).status, 403);
  assert.deepEqual([(await ro.post(`/api/appointments/${made.id}/status`, { status: "confirmed", expectedVersion: made.row_version })).status], [403]);
  const dr = (await t.login(P.doctor)).b;
  assert.equal((await dr.get("/api/appointments")).status, 200);
  assert.equal((await book(dr)).status, 403);
  await t.owner.query("update accounts.memberships set can_manage_bookings = true where user_id = $1", [P.doctor.id]);
  assert.equal((await book(dr, { startsAt: at(TOMORROW, "10:30"), newPatient: { fullName: "By Doctor", phone: "0790002222" } })).status, 201);
});

test("another clinic's people cannot see or touch these bookings", async () => {
  const sec = await secretary();
  const made = (await book(sec)).json;
  const foreign = (await t.login(P.other)).b;
  assert.equal((await foreign.get(`/api/appointments/${made.id}`)).status, 404);
  assert.deepEqual((await foreign.get("/api/appointments")).json, []);
  assert.equal((await foreign.post(`/api/appointments/${made.id}/status`, { status: "confirmed", expectedVersion: 1 })).status, 404);
  assert.equal((await foreign.get(`/api/patients/${made.patient_id}`)).status, 404);
});

// ------------------------------------------------------------------ changing bookings
test("confirm, complete; cancelling and voiding need a reason; final states are final", async () => {
  const b = await secretary();
  let a = (await book(b)).json;
  const st = (status, reason) => b.post(`/api/appointments/${a.id}/status`, { status, reason, expectedVersion: a.row_version });
  let r = await st("confirmed"); assert.equal(r.status, 200); a = r.json; assert.equal(a.row_version, 2);
  assert.equal((await st("cancelled")).json.error, "reason_required");
  r = await st("completed"); assert.equal(r.status, 200); a = r.json;
  assert.equal((await st("cancelled", "changed my mind")).json.error, "status_change_not_allowed");
  assert.equal((await st("no_show", "oops")).json.error, "status_change_not_allowed", "a secretary cannot correct a final state");
});

test("cancel frees the slot and keeps the reason", async () => {
  const b = await secretary();
  const a = (await book(b)).json;
  const r = await b.post(`/api/appointments/${a.id}/status`, { status: "cancelled", reason: "patient called", expectedVersion: a.row_version });
  assert.equal(r.json.cancel_reason, "patient called");
  const free = (await b.get(`/api/slots?service=${svc().id}&doctor=${ids.lina}&date=${TOMORROW}`)).json.map((s) => s.startsAt);
  assert.ok(free.includes(at(TOMORROW, "10:00")));
});

test("'delete' is a void: reason required, hidden by default, slot freed, only an administrator restores", async () => {
  const b = await secretary();
  const a = (await book(b)).json;
  const v = (reason) => b.post(`/api/appointments/${a.id}/status`, { status: "voided", reason, expectedVersion: a.row_version });
  assert.equal((await v("")).json.error, "reason_required");
  const voided = (await v("entered by mistake")).json;
  assert.equal(voided.status, "voided");
  assert.equal(voided.void_reason, "entered by mistake");
  assert.equal((await b.get(`/api/appointments?from=${TOMORROW}&to=${TOMORROW}`)).json.length, 0);
  assert.equal((await b.get(`/api/appointments?from=${TOMORROW}&to=${TOMORROW}&voided=1`)).json.length, 1);
  assert.equal((await t.owner.query("select count(*)::int n from appointments")).rows[0].n, 1, "nothing is physically deleted");
  assert.equal((await b.post(`/api/appointments/${a.id}/restore`, { expectedVersion: voided.row_version })).status, 403);

  const adm = await adminB();
  assert.equal((await book(b, { newPatient: { fullName: "Takes The Slot", phone: "0795555555" } })).status, 201);
  const blocked = await adm.post(`/api/appointments/${a.id}/restore`, { expectedVersion: voided.row_version });
  assert.deepEqual([blocked.status, blocked.json.error], [409, "slot_taken"], "restoring cannot double-book");
});

test("an administrator restores a voided booking and corrects a final state with a reason", async () => {
  const sec = await secretary(), adm = await adminB();
  let a = (await book(sec)).json;
  a = (await sec.post(`/api/appointments/${a.id}/status`, { status: "voided", reason: "mistake", expectedVersion: a.row_version })).json;
  a = (await adm.post(`/api/appointments/${a.id}/restore`, { expectedVersion: a.row_version })).json;
  assert.equal(a.status, "booked");
  a = (await adm.post(`/api/appointments/${a.id}/status`, { status: "completed", expectedVersion: a.row_version })).json;
  const fix = await adm.post(`/api/appointments/${a.id}/status`, { status: "no_show", expectedVersion: a.row_version });
  assert.equal(fix.json.error, "status_change_not_allowed", "a correction needs a reason");
  const ok = await adm.post(`/api/appointments/${a.id}/status`, { status: "no_show", reason: "patient never came", expectedVersion: a.row_version });
  assert.equal(ok.json.status, "no_show");
});

test("moving a booking checks the new time and the version", async () => {
  const b = await secretary();
  const a = (await book(b)).json;
  const moved = await b.patch(`/api/appointments/${a.id}`, { expectedVersion: a.row_version, startsAt: at(TOMORROW, "11:00"), internalNote: "prefers late" });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.starts_at, at(TOMORROW, "11:00"));
  assert.equal(moved.json.internal_note, "prefers late");
  assert.equal(moved.json.row_version, 2);
  const stale = await b.patch(`/api/appointments/${a.id}`, { expectedVersion: 1, startsAt: at(TOMORROW, "11:15") });
  assert.deepEqual([stale.status, stale.json.error, stale.json.currentVersion], [409, "version_conflict", 2]);
  assert.equal((await b.patch(`/api/appointments/${a.id}`, { expectedVersion: 2, startsAt: at(TOMORROW, "14:00") })).json.error, "not_a_free_time");
});

test("a change made behind the secretary's back (the WhatsApp assistant) is not overwritten", async () => {
  const b = await secretary();
  const a = (await book(b)).json;
  await t.owner.query("update appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1", [a.id]);
  const r = await b.patch(`/api/appointments/${a.id}`, { expectedVersion: a.row_version, internalNote: "late note" });
  assert.deepEqual([r.status, r.json.error], [409, "version_conflict"]);
  assert.equal((await b.get(`/api/appointments/${a.id}`)).json.internal_note, null, "nothing was overwritten");
});

test("two secretaries save at once: exactly one wins", async () => {
  const b1 = await secretary(), b2 = (await t.login(P.secretary2)).b;
  const a = (await book(b1)).json;
  const [r1, r2] = await Promise.all([
    b1.post(`/api/appointments/${a.id}/status`, { status: "confirmed", expectedVersion: a.row_version }),
    b2.post(`/api/appointments/${a.id}/status`, { status: "cancelled", reason: "x", expectedVersion: a.row_version }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
});

// ------------------------------------------------------------------ patients
test("patients: create, find by name or phone, duplicates refused, patients without a phone allowed", async () => {
  const b = await secretary();
  const p = await b.post("/api/patients", { fullName: "Omar Saleh", phone: "+962 79 111 2222", language: "ar", whatsappReminders: true });
  assert.equal(p.status, 201);
  assert.equal(p.json.phone_e164, "+962791112222");
  assert.equal(p.json.whatsapp_reminders, true);
  const dup = await b.post("/api/patients", { fullName: "Someone Else", phone: "0791112222" });
  assert.deepEqual([dup.status, dup.json.error, dup.json.patientId], [409, "patient_exists", p.json.id]);
  const nophone = await b.post("/api/patients", { fullName: "No Phone", whatsappReminders: true });
  assert.equal(nophone.status, 201);
  assert.equal(nophone.json.phone_e164, null);
  assert.equal(nophone.json.whatsapp_reminders, false, "no number, no WhatsApp reminders");
  assert.equal((await b.get("/api/patients?q=omar")).json.length, 1);
  assert.equal((await b.get("/api/patients?q=1112222")).json.length, 1);
  assert.equal((await b.get("/api/patients")).json.length, 2);
  assert.equal((await b.post("/api/patients", { fullName: "Bad", phone: "12" })).json.error, "invalid_phone");
  const upd = await b.patch(`/api/patients/${p.json.id}`, { fullName: "Omar S. Saleh" });
  assert.equal(upd.json.full_name, "Omar S. Saleh");
  assert.equal(upd.json.phone_e164, "+962791112222");
});

test("the patient page lists their bookings, voided included; read-only people cannot edit patients", async () => {
  const b = await secretary();
  const a = (await book(b)).json;
  assert.equal((await b.get("/api/patients/00000000-0000-0000-0000-000000000001")).status, 404, "an id outside RFC 9562 is still only an unknown id");
  const pg = (await b.get(`/api/patients/${a.patient_id}`)).json;
  assert.equal(pg.appointments.length, 1);
  const ro = (await t.login(P.readonly)).b;
  assert.equal((await ro.get(`/api/patients/${a.patient_id}`)).status, 200);
  assert.equal((await ro.post("/api/patients", { fullName: "Nope" })).status, 403);
  assert.equal((await ro.patch(`/api/patients/${a.patient_id}`, { fullName: "Nope" })).status, 403);
});

// ------------------------------------------------------------------ history and audit
test("history shows who did what, from the audit trail", async () => {
  const b = await secretary();
  let a = (await book(b)).json;
  a = (await b.post(`/api/appointments/${a.id}/status`, { status: "confirmed", expectedVersion: a.row_version })).json;
  a = (await b.patch(`/api/appointments/${a.id}`, { expectedVersion: a.row_version, startsAt: at(TOMORROW, "11:00") })).json;
  await b.post(`/api/appointments/${a.id}/status`, { status: "cancelled", reason: "patient asked", expectedVersion: a.row_version });
  const h = (await b.get(`/api/appointments/${a.id}/history`)).json;
  assert.deepEqual(h.map((e) => e.action), ["created", "status_changed", "rescheduled", "cancelled"]);
  assert.ok(h.every((e) => e.actor_label === "Sara Secretary" && e.actor_type === "user"));
  assert.equal(h.at(-1).reason, "patient asked");
  const ro = (await t.login(P.readonly)).b;
  assert.equal((await ro.get(`/api/appointments/${a.id}/history`)).status, 200);
});

test("the Booking login cannot delete, and cannot read accounts or other clinics' audit", async () => {
  await assert.rejects(t.pool.query("delete from appointments"), /permission denied/);
  await assert.rejects(t.pool.query("delete from patients"), /permission denied/);
  await assert.rejects(t.pool.query("select * from accounts.users"), /permission denied/);
  await assert.rejects(t.pool.query("select * from audit.events"), /permission denied/);
});

test("lookups carry doctors, services and the staff rules; health works", async () => {
  const b = await secretary();
  const l = (await b.get("/api/lookups")).json;
  assert.equal(l.doctors.length, 2);
  assert.ok(l.doctors[0].service_ids.length > 0 && l.doctors[0].hours.length > 0);
  assert.equal(l.clinic.timezone, "Asia/Amman");
  assert.equal(l.rules.windowDays, 365);
  assert.equal((await t.bookingJar().get("/api/health")).status, 200);
  assert.equal((await t.bookingJar().get("/api/health/db")).status, 200);
});
