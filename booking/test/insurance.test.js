// The insurance line from Records on Booking's booking and patient pages: on at the start, switched off in Records' settings,
// the company's card with it, and a doctor limited to their own patients sees only theirs.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, ids, P, sec, dr, pid, other;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const at = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse("2026-11-11T00:00:00Z") + ((h - 3) * 60 + m) * 60000).toISOString(); };

beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  sec = (await t.login(P.secretary)).b;
  dr = (await t.login(P.doctor)).b;
  const me = (await dr.get("/api/me")).json.doctorId;
  other = ids.docs.map((d) => d.id).find((id) => id !== me);
  const a = (await sec.post("/api/appointments", { serviceId: ids.services[0].id, doctorId: other, startsAt: at("12:00"), source: "phone",
    newPatient: { fullName: "Rania Saleh", phone: "0785550102" } })).json;
  pid = a.patient_id;
});

test("on at the start: 'not asked yet' until Records has an answer, then the company with its card", async () => {
  assert.deepEqual((await sec.get(`/api/patients/${pid}/insurance`)).json, { on: true, status: "unknown", company: null, other: null });
  const co = (await t.owner.query(
    `insert into insurance_companies (clinic_id, name_en, name_ar, phone, contact_name, contact_phone, notes)
     values ($1, 'MedNet', 'ميدنت', '+962 6 555 0101', 'Rana', '+962 79 555 0199', 'Approval before laser.') returning id`, [t.clinicA])).rows[0].id;
  await t.owner.query(`insert into patient_details (patient_id, clinic_id, insurance_status, insurance_company_id) values ($1, $2, 'insured', $3)`, [pid, t.clinicA, co]);
  const r = (await sec.get(`/api/patients/${pid}/insurance`)).json;
  assert.equal(r.status, "insured");
  assert.equal(r.company.name_ar, "ميدنت");
  assert.equal(r.company.notes, "Approval before laser.");
  assert.equal(r.company.contact_phone, "+962 79 555 0199");
  assert.ok(!("national_id" in r) && !("birth_date" in r));
});

test("switched off in Records' settings: nothing is shown", async () => {
  await t.owner.query("update record_settings set insurance_in_booking = false");
  assert.deepEqual((await sec.get(`/api/patients/${pid}/insurance`)).json, { on: false, status: null });
});

test("a doctor limited to their own patients does not get another doctor's patient's insurance", async () => {
  assert.equal((await dr.get(`/api/patients/${pid}/insurance`)).status, 404);
  const { b: ro } = await t.login(P.readonly);
  assert.equal((await ro.get(`/api/patients/${pid}/insurance`)).status, 200);
});
