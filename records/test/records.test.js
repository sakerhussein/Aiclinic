// Records, phase A: sign-in, who sees what, the chart's entries (never deleted), details and file numbers, openings, settings.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, P;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); P = await t.people(); });

test("sign-in goes through Accounts; Read-only has no Records, and the launcher lists it only for those who have it", async () => {
  const { b, status } = await t.login(P.doctor);
  assert.equal(status, 302);
  const me = await b.get("/api/me");
  assert.equal(me.status, 200);
  assert.ok(me.json.permissions.includes("records.chart.read"));
  const ro = await t.login(P.readonly);
  assert.equal(ro.error, "no_access_to_service");
  assert.equal((await ro.b.get("/api/me")).status, 401);
  const { b: acc } = await t.signIn(P.secretary);
  const apps = (await acc.get("/api/apps")).json;
  assert.ok(JSON.stringify(apps).includes("records"));
});

test("a secretary sees details but never the chart; a doctor sees both", async () => {
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b: dr } = await t.login(P.doctor);
  assert.equal((await dr.post(`/api/patients/${pid}/entries`, { kind: "allergy", title: "Penicillin", detail: "hives" })).status, 201);
  const { b: sec } = await t.login(P.secretary);
  const r = await sec.get(`/api/patients/${pid}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.chart, null);
  assert.equal(r.json.patient.full_name, "Lina Haddad");
  assert.ok(!JSON.stringify(r.json).includes("Penicillin"));
  assert.equal((await sec.post(`/api/patients/${pid}/entries`, { kind: "allergy", title: "x" })).status, 403);
  assert.equal((await sec.get("/api/today")).status, 403);
  const d = await dr.get(`/api/patients/${pid}`);
  assert.equal(d.json.chart.entries[0].title, "Penicillin");
  assert.equal(d.json.chart.entries[0].alert, true);              // allergies are always alerts
});

test("another clinic's patient is not found", async () => {
  const pid = await t.patient("Elsewhere", { clinic: t.clinicB });
  const { b } = await t.login(P.doctor);
  assert.equal((await b.get(`/api/patients/${pid}`)).status, 404);
  assert.equal((await b.post(`/api/patients/${pid}/entries`, { kind: "allergy", title: "x" })).status, 404);
});

test("'only patients they treat' hides other doctors' patients from a doctor, in the list and by address", async () => {
  const mine = await t.patient("Mine", { doctor: P.lina });
  const theirs = await t.patient("Theirs", { doctor: P.omar });
  const { b } = await t.login(P.doctor);
  assert.equal((await b.get(`/api/patients/${theirs}`)).status, 200);          // default: every doctor in the clinic
  await t.owner.query("update record_settings set doctors_scope = 'treated' where clinic_id = $1", [t.clinicA]);
  assert.equal((await b.get(`/api/patients/${theirs}`)).status, 404);
  assert.equal((await b.get(`/api/patients/${mine}`)).status, 200);
  const names = (await b.get("/api/patients?q=")).json.map((p) => p.full_name);
  assert.deepEqual(names, ["Mine"]);
  const { b: sec } = await t.login(P.secretary);                               // the setting is about doctors only
  assert.equal((await sec.get(`/api/patients/${theirs}`)).status, 200);
});

test("entries are corrected or marked in error, never deleted; a marked entry is locked; old copies are refused", async () => {
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b } = await t.login(P.doctor);
  const e = (await b.post(`/api/patients/${pid}/entries`, { kind: "medicine", title: "Isotretinoin 20 mg", detail: "daily", alert: true })).json;
  const up = await b.patch(`/api/entries/${e.id}`, { detail: "daily with food", expectedVersion: e.row_version });
  assert.equal(up.status, 200);
  assert.equal(up.json.detail, "daily with food");
  assert.equal((await b.patch(`/api/entries/${e.id}`, { detail: "old copy", expectedVersion: e.row_version })).status, 409);
  const err = await b.post(`/api/entries/${e.id}/error`, { reason: "wrong patient", expectedVersion: up.json.row_version });
  assert.equal(err.status, 200);
  assert.equal(err.json.error_by_name, "Dr Lina");
  assert.equal((await b.patch(`/api/entries/${e.id}`, { detail: "again", expectedVersion: err.json.row_version })).status, 409);
  // The login cannot delete, and the database refuses changes to a marked entry even from Records' own login.
  await assert.rejects(t.pool.query("delete from chart_entries where id = $1", [e.id]), /permission denied/);
  await assert.rejects(t.pool.query("update chart_entries set title = 'x' where id = $1", [e.id]), /locked/);
  const chart = (await b.get(`/api/patients/${pid}`)).json.chart;
  assert.equal(chart.entries.length, 1);
  assert.ok(chart.timeline.some((x) => x.type === "error" && x.reason === "wrong patient"));
});

test("file numbers: handed out once, in order, skipping numbers typed by hand; manual mode takes the typed one", async () => {
  const p1 = await t.patient("One"), p2 = await t.patient("Two"), p3 = await t.patient("Three");
  const { b } = await t.login(P.secretary);
  await t.owner.query("insert into patient_details (patient_id, clinic_id, file_no) values ($1,$2,'00002')", [p3, t.clinicA]);
  const d1 = await b.put(`/api/patients/${p1}/details`, { birthDate: "1992-03-14", sex: "female" });
  assert.equal(d1.json.file_no, "00001");
  assert.equal(d1.json.birth_date, "1992-03-14");                          // a plain date, never shifted by the time zone
  const d2 = await b.put(`/api/patients/${p2}/details`, { sex: "male" });
  assert.equal(d2.json.file_no, "00003");                                  // 00002 was already taken
  const again = await b.put(`/api/patients/${p1}/details`, { birthDate: "1992-03-14", sex: "female", insurance: "Card 55", expectedVersion: d1.json.row_version });
  assert.equal(again.json.file_no, "00001");
  assert.equal((await b.put(`/api/patients/${p1}/details`, { sex: "male", expectedVersion: d1.json.row_version })).status, 409);
  await t.owner.query("update record_settings set file_numbers = 'manual', required_details = '{birth_date}' where clinic_id = $1", [t.clinicA]);
  const p4 = await t.patient("Four");
  assert.equal((await b.put(`/api/patients/${p4}/details`, { fileNo: "A-17" })).json.error, "details_required");
  assert.equal((await b.put(`/api/patients/${p4}/details`, { fileNo: "00001", birthDate: "2000-01-01" })).json.error, "file_no_taken");
  assert.equal((await b.put(`/api/patients/${p4}/details`, { fileNo: "A-17", birthDate: "2000-01-01" })).json.file_no, "A-17");
});

test("specialty answers must fit the field", async () => {
  const pid = await t.patient("Lina Haddad");
  const { b } = await t.login(P.doctor);
  assert.equal((await b.put(`/api/patients/${pid}/answers/skin_type`, { value: "III" })).status, 200);
  assert.equal((await b.put(`/api/patients/${pid}/answers/skin_type`, { value: "VII" })).json.error, "invalid_value");
  assert.equal((await b.put(`/api/patients/${pid}/answers/pregnant`, { value: "maybe" })).json.error, "invalid_value");
  assert.equal((await b.put(`/api/patients/${pid}/answers/nope`, { value: "yes" })).json.error, "unknown_field");
  const chart = (await b.get(`/api/patients/${pid}`)).json.chart;
  assert.deepEqual(chart.answers.map((x) => [x.field_key, x.value]), [["skin_type", "III"]]);
});

test("every opening is recorded and only an administrator sees the list; the audit trail never holds the words", async () => {
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b: dr } = await t.login(P.doctor);
  await dr.get(`/api/patients/${pid}`);
  await dr.post(`/api/patients/${pid}/entries`, { kind: "allergy", title: "Penicillin", detail: "hives" });
  t.advance(1);
  const { b: sec } = await t.login(P.secretary);
  await sec.get(`/api/patients/${pid}`);
  assert.equal((await sec.get(`/api/patients/${pid}/openings`)).status, 403);
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const list = (await adm.get(`/api/patients/${pid}/openings`)).json;
  assert.deepEqual(list.map((x) => x.user_name), ["Sara Secretary", "Dr Lina"]);
  const audit = (await t.owner.query("select entity, action, after::text as a, before::text as b from audit.events where entity in ('chart', 'chart_entry')")).rows;
  assert.ok(audit.some((x) => x.entity === "chart" && x.action === "opened"));
  assert.ok(audit.some((x) => x.entity === "chart_entry" && x.action === "created"));
  assert.ok(!JSON.stringify(audit).includes("Penicillin") && !JSON.stringify(audit).includes("hives"));
});

test("today's patients: the doctor's own bookings today, with the number of alerts", async () => {
  const p = await t.patient("Today One", { doctor: P.lina, at: "2026-11-10T08:00:00Z", status: "booked" });
  await t.patient("Other Doctor", { doctor: P.omar, at: "2026-11-10T08:30:00Z", status: "booked" });
  await t.patient("Tomorrow", { doctor: P.lina, at: "2026-11-11T08:00:00Z", status: "booked" });
  const { b } = await t.login(P.doctor);
  await b.post(`/api/patients/${p}/entries`, { kind: "allergy", title: "Penicillin" });
  await b.post(`/api/patients/${p}/entries`, { kind: "condition", title: "Acne" });          // not an alert
  const rows = (await b.get("/api/today")).json;
  assert.deepEqual(rows.map((r) => [r.full_name, r.alerts]), [["Today One", 1]]);
});

test("settings: an administrator changes them; switching a list off stops new entries of that kind", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const s = (await adm.get("/api/settings")).json;
  assert.equal(s.specialtyFields.length, 3);
  const next = { ...s, show: { ...s.show, procedure: false }, specialtyFields: [...s.specialtyFields, { key: "spf", en: "Uses sunscreen", ar: "يستخدم واقي الشمس", kind: "yesno" }] };
  const saved = await adm.put("/api/settings", next);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.specialtyFields.length, 4);
  assert.equal((await adm.put("/api/settings", { ...next, specialtyFields: [...next.specialtyFields, next.specialtyFields[0]] })).json.error, "duplicate_field");
  const { b: dr } = await t.login(P.doctor);
  assert.equal((await dr.get("/api/settings")).status, 403);
  const pid = await t.patient("Lina Haddad");
  assert.equal((await dr.post(`/api/patients/${pid}/entries`, { kind: "procedure", title: "Peel" })).json.error, "kind_off");
});

test("Booking's login reads only the alert line of the chart", async () => {
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b } = await t.login(P.doctor);
  await b.post(`/api/patients/${pid}/entries`, { kind: "allergy", title: "Penicillin", detail: "hives" });
  await b.put(`/api/patients/${pid}/details`, { nationalId: "9921000000" });
  const r = await t.bookingPool.query("select kind, title, alert from chart_entries where patient_id = $1", [pid]);
  assert.equal(r.rows[0].title, "Penicillin");
  await assert.rejects(t.bookingPool.query("select detail from chart_entries"), /permission denied/);
  await assert.rejects(t.bookingPool.query("select * from patient_details"), /permission denied/);
  await assert.rejects(t.bookingPool.query("select * from record_openings"), /permission denied/);
  await assert.rejects(t.pool.query("select content from visit_notes"), /permission denied/);
});
