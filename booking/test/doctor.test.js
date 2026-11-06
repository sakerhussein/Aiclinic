// A doctor sees and handles only their own bookings, and only patients with a booking with them. Each test tries a way around that.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, ids, P, mine, other, dr, sec;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const TOMORROW = "2026-11-11";
const at = (day, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const svc = () => ids.services[0].id;
const book = (b, doctorId, name, phone, time = "12:00") => b.post("/api/appointments", { serviceId: svc(), doctorId, startsAt: at(TOMORROW, time), source: "phone", newPatient: { fullName: name, phone } });
const canManage = async () => {
  await t.owner.query("update accounts.memberships set can_manage_bookings = true where user_id = $1", [P.doctor.id]);
  dr = (await t.login(P.doctor)).b;
};

let ownBooking, otherBooking;
beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  dr = (await t.login(P.doctor)).b;
  sec = (await t.login(P.secretary)).b;
  mine = (await dr.get("/api/me")).json.doctorId;
  other = ids.docs.map((d) => d.id).find((id) => id !== mine);
  ownBooking = (await book(sec, mine, "My Patient", "0791110001")).json;
  otherBooking = (await book(sec, other, "Their Patient", "0791110002")).json;
});

test("lists hold only the doctor's own bookings, whatever filter is asked for", async () => {
  const idsOf = async (url) => (await dr.get(url)).json.map((a) => a.id);
  assert.deepEqual(await idsOf("/api/appointments"), [ownBooking.id]);
  assert.deepEqual(await idsOf(`/api/appointments?doctor=${other}`), [], "asking for another doctor by name of the filter");
  assert.deepEqual(await idsOf(`/api/appointments?patient=${otherBooking.patient_id}`), []);
  assert.deepEqual(await idsOf("/api/appointments?q=Their"), [], "search");
  assert.deepEqual(await idsOf("/api/appointments?q=0791110002"), [], "search by phone");
  assert.equal((await sec.get("/api/appointments")).json.length, 2, "the secretary still sees the clinic");
});

test("another doctor's booking and its history cannot be opened by link", async () => {
  assert.equal((await dr.get(`/api/appointments/${ownBooking.id}`)).status, 200);
  assert.equal((await dr.get(`/api/appointments/${otherBooking.id}`)).status, 404);
  assert.equal((await dr.get(`/api/appointments/${otherBooking.id}/history`)).status, 404);
});

test("patients: only the doctor's own, in the list, in search and by link", async () => {
  const names = (await dr.get("/api/patients")).json.map((p) => p.full_name);
  assert.deepEqual(names, ["My Patient"]);
  assert.deepEqual((await dr.get("/api/patients?q=Their")).json, []);
  assert.deepEqual((await dr.get("/api/patients?q=0791110002")).json, []);
  assert.equal((await dr.get(`/api/patients/${otherBooking.patient_id}`)).status, 404);
  assert.equal((await dr.get(`/api/patients/${ownBooking.patient_id}`)).status, 200);
  assert.equal((await sec.get("/api/patients")).json.length, 2);
});

test("a patient shared by two doctors: each sees the person and only their own visits", async () => {
  const shared = (await sec.post("/api/appointments", { serviceId: svc(), doctorId: other, startsAt: at(TOMORROW, "13:00"), source: "phone", patientId: ownBooking.patient_id })).json;
  const p = (await dr.get(`/api/patients/${ownBooking.patient_id}`)).json;
  assert.deepEqual(p.appointments.map((a) => a.id), [ownBooking.id]);
  const row = (await dr.get("/api/patients")).json[0];
  assert.ok(new Date(shared.starts_at) > new Date(ownBooking.starts_at));
  assert.equal(new Date(row.last_visit).getTime(), new Date(ownBooking.starts_at).getTime(), "the last visit shown is theirs, not the later one elsewhere");
});

test("a voided booking does not make someone the doctor's patient", async () => {
  const b = (await book(sec, mine, "Wrong Booking", "0791110003", "13:00")).json;
  assert.equal((await sec.post(`/api/appointments/${b.id}/status`, { status: "voided", reason: "typed the wrong doctor", expectedVersion: b.row_version })).status, 200);
  assert.equal((await dr.get(`/api/patients/${b.patient_id}`)).status, 404);
});

test("free times and leave: nothing about other doctors comes back", async () => {
  const slots = (await dr.get(`/api/slots?service=${svc()}&doctor=${other}&date=${TOMORROW}`)).json;
  assert.ok(slots.length > 0);
  assert.ok(slots.every((s) => s.doctorId === mine), "the doctor filter is ignored for a doctor");
  await t.owner.query("insert into time_off (clinic_id, doctor_id, starts_at, ends_at, reason) values ($1,$2,$3,$4,'private reason'),($1,null,$3,$4,'clinic closed')",
    [t.clinicA, other, at(TOMORROW, "16:00"), at(TOMORROW, "17:00")]);
  const off = (await dr.get(`/api/time-off?date=${TOMORROW}`)).json;
  assert.deepEqual(off.map((o) => o.reason), ["clinic closed"]);
  assert.equal((await sec.get(`/api/time-off?date=${TOMORROW}`)).json.length, 2);
});

test("a doctor who can manage bookings still reaches only their own", async () => {
  await canManage();
  const v = otherBooking.row_version;
  assert.equal((await dr.patch(`/api/appointments/${otherBooking.id}`, { expectedVersion: v, internalNote: "x" })).status, 404);
  for (const status of ["confirmed", "cancelled", "completed", "no_show"])
    assert.equal((await dr.post(`/api/appointments/${otherBooking.id}/status`, { status, reason: "x", expectedVersion: v })).status, 404, status);
  assert.equal((await dr.post(`/api/appointments/${otherBooking.id}/status`, { status: "voided", reason: "x", expectedVersion: v })).status, 404);
  assert.equal((await dr.patch(`/api/patients/${otherBooking.patient_id}`, { fullName: "Changed" })).status, 404);
  assert.equal((await book(dr, other, "For Colleague", "0791110004", "13:00")).status, 403, "cannot book for a colleague");
  assert.equal((await dr.patch(`/api/appointments/${ownBooking.id}`, { expectedVersion: ownBooking.row_version, doctorId: other })).status, 403, "cannot hand a booking over");
  assert.equal((await dr.patch(`/api/appointments/${ownBooking.id}`, { expectedVersion: ownBooking.row_version, patientId: otherBooking.patient_id })).status, 404, "cannot swap in another doctor's patient");
  assert.equal((await dr.post("/api/patients", { fullName: "No Booking", phone: "0791110005" })).status, 403, "they could not see the patient afterwards");

  const untouched = (await sec.get(`/api/appointments/${otherBooking.id}`)).json;
  assert.deepEqual([untouched.status, untouched.internal_note, untouched.patient_name], ["booked", null, "Their Patient"]);

  const any = await book(dr, "any", "Any Doctor", "0791110006", "13:00");
  assert.deepEqual([any.status, any.json.doctor_id], [201, mine], "'any available' means themselves");
  assert.equal((await dr.post(`/api/appointments/${ownBooking.id}/status`, { status: "confirmed", expectedVersion: ownBooking.row_version })).status, 200);
});

test("a phone number already registered: no name is given away, and booking it makes the patient theirs", async () => {
  await canManage();
  const dup = await book(dr, mine, "Someone Else", "0791110002", "13:00");
  assert.deepEqual([dup.status, dup.json.error], [409, "patient_exists"]);
  assert.ok(dup.json.patientId);
  assert.equal(dup.json.fullName, undefined);
  assert.equal(JSON.stringify(dup.json).includes("Their Patient"), false);
  assert.equal((await sec.post("/api/patients", { fullName: "Dup", phone: "0791110002" })).json.fullName, "Their Patient", "the front desk still gets the name");

  const r = await dr.post("/api/appointments", { serviceId: svc(), doctorId: mine, startsAt: at(TOMORROW, "13:00"), source: "phone", patientId: dup.json.patientId });
  assert.equal(r.status, 201);
  const p = (await dr.get(`/api/patients/${dup.json.patientId}`)).json;
  assert.deepEqual(p.appointments.map((a) => a.id), [r.json.id], "their booking only, not the colleague's");
});

test("a doctor account with no doctor record sees nothing", async () => {
  await t.owner.query("update accounts.memberships set doctor_id = null where user_id = $1", [P.doctor.id]);
  const lost = (await t.login(P.doctor)).b;
  assert.deepEqual((await lost.get("/api/appointments")).json, []);
  assert.deepEqual((await lost.get("/api/patients")).json, []);
  assert.equal((await lost.get(`/api/appointments/${ownBooking.id}`)).status, 404);
});

test("reception, read-only staff and administrators keep seeing the whole clinic", async () => {
  const ro = (await t.login(P.readonly)).b;
  const admin = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  for (const b of [sec, ro, admin]) {
    assert.equal((await b.get("/api/appointments")).json.length, 2);
    assert.equal((await b.get("/api/patients")).json.length, 2);
    assert.equal((await b.get(`/api/appointments/${otherBooking.id}`)).status, 200);
  }
});
