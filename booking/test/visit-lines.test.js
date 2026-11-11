// Records phase C in Booking: the doctor's licence number, the treatment course line on a booking, the forms' state (never the
// answers) and the forms link sent from the clinic's WhatsApp.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, ids, P, sec, adm, pid, doctorId;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const at = (day, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };

beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  sec = (await t.login(P.secretary)).b;
  doctorId = ids.docs[0].id;
  const a = (await sec.post("/api/appointments", { serviceId: ids.services[0].id, doctorId, startsAt: at("2026-11-11", "12:00"), source: "phone",
    newPatient: { fullName: "Huda Al-Khatib", phone: "0791234567", language: "en" } })).json;
  pid = a.patient_id;
});

test("the licence number is kept with the doctor in Settings › Doctors", async () => {
  adm = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  const d = (await adm.get("/api/settings")).json.doctors.find((x) => x.id === doctorId);
  assert.equal(d.licence_no, null);
  const body = { nameEn: d.name_en, nameAr: d.name_ar, titleEn: d.title_en, titleAr: d.title_ar, gender: d.gender, slotMinutes: d.slot_minutes,
                 bufferMinutes: d.buffer_minutes, active: true, licenceNo: " JMC-18342 " };
  assert.equal((await adm.patch(`/api/settings/doctors/${doctorId}`, body)).status, 200);
  assert.equal((await adm.get("/api/settings")).json.doctors.find((x) => x.id === doctorId).licence_no, "JMC-18342");
  // Saving without the field keeps it.
  const { licenceNo, ...rest } = body;
  await adm.patch(`/api/settings/doctors/${doctorId}`, rest);
  assert.equal((await adm.get("/api/settings")).json.doctors.find((x) => x.id === doctorId).licence_no, "JMC-18342");
});

test("the course line: the booking's session number in its course; nothing while courses are off", async () => {
  const sid = ids.services[0].id;
  const earlier = (await t.owner.query(
    `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status, source)
     values ($1,$2,$3,$4,'2026-09-30T09:00:00Z','2026-09-30T09:30:00Z','completed','staff') returning id`, [t.clinicA, doctorId, sid, pid])).rows[0].id;
  await t.owner.query(
    `insert into treatment_courses (clinic_id, patient_id, service_id, sessions, every_weeks, areas, starts_on, created_by, created_by_name)
     values ($1,$2,$3,6,6,'{legs,underarms}','2026-09-01','x','Dr')`, [t.clinicA, pid, sid]);
  const now = (await t.owner.query("select id from appointments where patient_id = $1 and id <> $2", [pid, earlier])).rows[0].id;
  assert.deepEqual((await sec.get(`/api/appointments/${now}/visit-lines`)).json, { course: null, forms: null, rxOn: false });
  await t.owner.query("update record_settings set courses_on = true, rx_on = true");
  const l = (await sec.get(`/api/appointments/${now}/visit-lines`)).json;
  assert.deepEqual([l.course.n, l.course.of, l.course.service_en, l.course.areas_en, l.course.areas_ar], [2, 6, ids.services[0].name_en, "Legs, Underarms", "الساقان، تحت الإبط"]);
  assert.equal(l.rxOn, true);
  assert.equal((await sec.get(`/api/appointments/${earlier}/visit-lines`)).json.course.n, 1);
});

test("forms: the state shows how many are filled; the link goes out in the patient's language, from the clinic's WhatsApp", async () => {
  const appt = (await t.owner.query("select id from appointments where patient_id = $1", [pid])).rows[0].id;
  await t.owner.query(
    `insert into form_templates (clinic_id, title_en, title_ar, questions, minutes) values ($1, 'Medical history', 'التاريخ الطبي', '[]', 2), ($1, 'Laser consent', 'موافقة الليزر', '[]', 1)`,
    [t.clinicA]);
  assert.equal((await sec.post(`/api/appointments/${appt}/form-link`)).json.error, "forms_off");
  await t.owner.query("update record_settings set forms_on = true");
  const before = (await sec.get(`/api/appointments/${appt}/visit-lines`)).json.forms;
  assert.deepEqual({ total: before.total, filled: before.filled, link: before.link, canSend: before.canSend }, { total: 2, filled: 0, link: null, canSend: true });

  const link = await sec.post(`/api/appointments/${appt}/form-link`);
  assert.equal(link.status, 201);
  assert.match(link.json.url, /^http:\/\/records\.test\/f\/[A-Za-z0-9_-]{43}$/);
  assert.match(link.json.message, /^Limitsiz .*before your visit on .*about 3 minutes.*records\.test\/f\//);
  assert.match(link.json.whatsapp, /^https:\/\/wa\.me\/962791234567\?text=/);
  const after1 = (await sec.get(`/api/appointments/${appt}/visit-lines`)).json.forms;
  assert.equal(after1.link.sent_count, 1);
  await sec.post(`/api/appointments/${appt}/form-link`);
  assert.equal((await sec.get(`/api/appointments/${appt}/visit-lines`)).json.forms.link.sent_count, 2);

  // Filled (by the patient, in Records): Booking sees that it was filled, never what was written.
  const tpl = (await t.owner.query("select id from form_templates where title_en = 'Medical history'")).rows[0].id;
  await t.owner.query(
    `insert into form_responses (clinic_id, patient_id, appointment_id, template_id, version, title_en, title_ar, questions, answers, language)
     values ($1,$2,$3,$4,1,'Medical history','التاريخ الطبي','[]','{"x":{"value":"secret"}}','en')`, [t.clinicA, pid, appt, tpl]);
  assert.equal((await sec.get(`/api/appointments/${appt}/visit-lines`)).json.forms.filled, 1);
  await assert.rejects(t.pool.query("select answers from form_responses"), /permission denied/);
});
