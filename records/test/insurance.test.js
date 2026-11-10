// Insurance in Records: the answer and the company, the clinic's list of companies (hidden, never deleted), names typed by staff,
// the two settings, and what Booking may read.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, P;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); P = await t.people(); });

const MEDNET = { nameEn: "MedNet", nameAr: "ميدنت", phone: "+962 6 555 0101", email: "approvals@example.jo", address: "Amman, Shmeisani",
                 contactName: "Rana Haddad", contactTitle: "Medical approvals", contactPhone: "+962 79 555 0199", notes: "Approval before laser." };

test("a patient starts as 'not asked yet'; insured needs a company from the list or a typed name; other answers clear it", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const co = await adm.post("/api/insurers", MEDNET);
  assert.equal(co.status, 201);
  assert.equal(co.json.contact_name, "Rana Haddad");
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b: sec } = await t.login(P.secretary);
  const first = (await sec.get(`/api/patients/${pid}`)).json;
  assert.equal(first.details, null);
  assert.deepEqual(first.companies.map((c) => c.name_en), ["MedNet"]);

  assert.equal((await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "insured" })).json.error, "insurance_company_needed");
  const saved = await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "insured", insuranceCompanyId: co.json.id, insurance: "ignored" });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.insurance_status, "insured");
  assert.equal(saved.json.insurance_company_id, co.json.id);
  assert.equal(saved.json.insurance, null);                       // a company from the list: no typed name kept beside it
  const card = (await sec.get(`/api/patients/${pid}`)).json.insurer;
  assert.equal(card.phone, "+962 6 555 0101");
  assert.equal(card.notes, "Approval before laser.");

  const typed = await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "insured", insuranceCompanyId: null, insurance: " Jordan Health Plus " });
  assert.equal(typed.json.insurance, "Jordan Health Plus");
  assert.equal(typed.json.insurance_company_id, null);
  const none = await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "none", insurance: "x", insuranceCompanyId: co.json.id });
  assert.equal(none.json.insurance_status, "none");
  assert.equal(none.json.insurance, null);
  assert.equal(none.json.insurance_company_id, null);
});

test("another clinic's company, or a hidden one, can't be picked; a patient who already has a hidden company keeps it", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const co = (await adm.post("/api/insurers", MEDNET)).json;
  const otherCo = (await t.owner.query("insert into insurance_companies (clinic_id, name_en, name_ar) values ($1, 'Elsewhere', 'أخرى') returning id", [t.clinicB])).rows[0].id;
  const pid = await t.patient("Lina Haddad");
  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "insured", insuranceCompanyId: otherCo })).json.error, "insurance_company_unknown");
  const d = (await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "insured", insuranceCompanyId: co.id })).json;
  const hidden = await adm.patch(`/api/insurers/${co.id}`, { hidden: true, expectedVersion: co.row_version });
  assert.equal(hidden.json.hidden, true);
  assert.equal(hidden.json.name_en, "MedNet");                    // hiding keeps the card as it was
  const kept = await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "insured", insuranceCompanyId: co.id, expectedVersion: d.row_version });
  assert.equal(kept.status, 200);
  const p2 = await t.patient("Omar Saleh");
  assert.equal((await sec.put(`/api/patients/${p2}/details`, { insuranceStatus: "insured", insuranceCompanyId: co.id })).json.error, "insurance_company_unknown");
  assert.equal((await t.owner.query("select count(*)::int as n from insurance_companies where clinic_id = $1", [t.clinicA])).rows[0].n, 1);
});

test("only an administrator manages the list; names must be unique; a typed name becomes a company and its patients move onto it", async () => {
  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.post("/api/insurers", MEDNET)).status, 403);
  assert.equal((await sec.get("/api/insurers")).status, 403);
  const p1 = await t.patient("Lina Haddad"), p2 = await t.patient("Omar Saleh");
  await sec.put(`/api/patients/${p1}/details`, { insuranceStatus: "insured", insurance: "Jordan Health Plus" });
  await sec.put(`/api/patients/${p2}/details`, { insuranceStatus: "insured", insurance: "jordan health plus" });

  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const list = (await adm.get("/api/insurers")).json;
  assert.deepEqual(list.typed, [{ name: "Jordan Health Plus", patients: 2 }]);
  assert.equal((await adm.post("/api/insurers", MEDNET)).status, 201);
  assert.equal((await adm.post("/api/insurers", { ...MEDNET, nameEn: " mednet " })).json.error, "company_exists");
  const jhp = await adm.post("/api/insurers", { nameEn: "Jordan Health Plus", nameAr: "Jordan Health Plus", fromTyped: "Jordan Health Plus" });
  assert.equal(jhp.status, 201);
  const after = (await adm.get("/api/insurers")).json;
  assert.deepEqual(after.typed, []);
  assert.equal(after.companies.find((c) => c.name_en === "Jordan Health Plus").patients, 2);

  const edited = await adm.patch(`/api/insurers/${jhp.json.id}`, { nameEn: "JHP", nameAr: "جي إتش بي", phone: "+962 6 000", expectedVersion: jhp.json.row_version });
  assert.equal(edited.json.name_ar, "جي إتش بي");
  assert.equal((await adm.patch(`/api/insurers/${jhp.json.id}`, { hidden: true, expectedVersion: jhp.json.row_version })).json.error, "version_conflict");
});

test("settings: insurance can be made a required answer; the Booking line can be switched off", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const s = (await adm.get("/api/settings")).json;
  assert.equal(s.insuranceInBooking, true);
  assert.equal(s.insuranceRequired, false);
  const saved = (await adm.put("/api/settings", { ...s, insuranceRequired: true, insuranceInBooking: false })).json;
  assert.equal(saved.insuranceRequired, true);
  assert.equal(saved.insuranceInBooking, false);
  const pid = await t.patient("Lina Haddad");
  const { b: sec } = await t.login(P.secretary);
  const r = await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "unknown" });
  assert.equal(r.json.error, "details_required");
  assert.equal(r.json.field, "insurance");
  assert.equal((await sec.put(`/api/patients/${pid}/details`, { insuranceStatus: "none" })).status, 200);
});

test("Booking's login reads the insurance line and the company card, nothing else of the details", async () => {
  await t.bookingPool.query("select patient_id, insurance_status, insurance_company_id, insurance from patient_details");
  await t.bookingPool.query("select name_en, phone, contact_name, notes from insurance_companies");
  await t.bookingPool.query("select insurance_in_booking from record_settings");
  await assert.rejects(t.bookingPool.query("select national_id from patient_details"), /permission denied/);
  await assert.rejects(t.bookingPool.query("select birth_date from patient_details"), /permission denied/);
  await assert.rejects(t.bookingPool.query("select doctors_scope from record_settings"), /permission denied/);
  await assert.rejects(t.bookingPool.query("update insurance_companies set hidden = true"), /permission denied/);
});
