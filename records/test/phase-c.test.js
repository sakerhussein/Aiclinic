// Records, phase C: treatment courses, printed prescriptions, forms before the visit and the AI summary. Every part starts off,
// who may do what, nothing deleted, and patient answers never reach the chart without a doctor.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, P;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); P = await t.people(); });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const SIG = `data:image/png;base64,${PNG.toString("base64")}`;
const VISIT = { coursesOn: false, courseAreaRequired: true, courseDefaults: [], rxOn: false, rxValidDays: 30, rxPaper: "A5", rxFavourites: [], formsOn: false, formLinkHours: 24,
  formMessageEn: "{clinic}: forms before {date} ({minutes} min): {link}", formMessageAr: "{clinic}: نماذج قبل {date} ({minutes} د): {link}",
  summaryModel: "off", summaryDaily: 20 };
async function visitSettings(adm, change) {
  const r = await adm.put("/api/settings/visit", { ...VISIT, ...change });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
const service = async () => (await t.owner.query("select id from services where clinic_id = $1 order by sort limit 1", [t.clinicA])).rows[0].id;

test("treatment courses: off until switched on; completed bookings count as sessions, booked ones show, others don't; secretaries see, doctors change", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const pid = await t.patient("Huda Al-Khatib");
  const { b: dr } = await t.login(P.doctor);
  const sid = await service();
  assert.equal((await dr.get(`/api/patients/${pid}/courses`)).json.error, "courses_off");
  await visitSettings(adm, { coursesOn: true, courseDefaults: [{ serviceId: sid, sessions: 6, weeks: 6 }] });

  await t.booking(pid, P.lina, { at: "2026-07-02T15:00:00Z", status: "completed" });     // before the course: not counted
  // The area comes from the clinic's body areas, apart from the note; Settings asks for at least one (on at first).
  const base = { serviceId: sid, sessions: 4, everyWeeks: 6, note: "Fitzpatrick III, 18 J/cm²", startsOn: "2026-08-01" };
  assert.equal((await dr.post(`/api/patients/${pid}/courses`, base)).json.error, "area_required");
  assert.equal((await dr.post(`/api/patients/${pid}/courses`, { ...base, areas: ["elbows"] })).json.error, "unknown_area");
  assert.equal((await dr.post(`/api/patients/${pid}/courses`, { ...base, areas: ["legs", "legs"] })).json.error, "invalid_value");
  const started = await dr.post(`/api/patients/${pid}/courses`, { ...base, areas: ["underarms", "legs"] });
  assert.equal(started.status, 201);
  assert.deepEqual([started.json[0].areas, started.json[0].note], [["underarms", "legs"], "Fitzpatrick III, 18 J/cm²"]);
  await t.booking(pid, P.lina, { at: "2026-08-13T15:00:00Z", status: "completed" });
  await t.booking(pid, P.lina, { at: "2026-09-24T15:00:00Z", status: "no_show" });       // doesn't count
  await t.booking(pid, P.lina, { at: "2026-09-25T15:00:00Z", status: "completed" });
  await t.booking(pid, P.lina, { at: "2026-11-10T15:00:00Z", status: "booked" });
  const [c] = (await dr.get(`/api/patients/${pid}/courses`)).json;
  assert.equal(c.sessions, 4);
  assert.equal(c.done, 2);
  assert.deepEqual(c.list.map((x) => x.status), ["completed", "completed", "booked"]);
  assert.equal(c.next, 4);
  assert.equal(c.next_about, "2026-12-22");                     // six weeks after the booked session
  // A second course of the same service while this one is open: refused.
  assert.equal((await dr.post(`/api/patients/${pid}/courses`, { serviceId: sid, sessions: 2, everyWeeks: 2, areas: ["face"] })).json.error, "course_open");
  // The areas change later; removing them all is refused while Settings asks for one. An area a course uses stays in Settings.
  assert.equal((await dr.patch(`/api/courses/${c.id}`, { areas: [], expectedVersion: c.row_version })).json.error, "area_required");
  const s = (await adm.get("/api/settings")).json;
  assert.deepEqual((await adm.put("/api/settings", { ...s, photoAreas: s.photoAreas.filter((a) => a.key !== "underarms") })).json.keys, ["underarms"]);

  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.get(`/api/patients/${pid}/courses`)).json.length, 1);
  assert.equal((await sec.post(`/api/patients/${pid}/courses`, { serviceId: sid, sessions: 2, everyWeeks: 2 })).status, 403);

  // "Add a session"; fewer sessions than already booked is refused.
  assert.equal((await dr.patch(`/api/courses/${c.id}`, { sessions: 2, expectedVersion: c.row_version })).json.error, "fewer_than_booked");
  const more = (await dr.patch(`/api/courses/${c.id}`, { sessions: 5, expectedVersion: c.row_version })).json[0];
  assert.equal(more.sessions, 5);
  const ended = (await dr.post(`/api/courses/${c.id}/end`, { reason: "Patient moved abroad", expectedVersion: more.row_version })).json[0];
  assert.ok(ended.ended_at);
  assert.equal(ended.next, null);
  assert.equal((await dr.patch(`/api/courses/${c.id}`, { sessions: 6, expectedVersion: ended.row_version })).json.error, "course_ended");
  await assert.rejects(t.owner.query("update treatment_courses set sessions = 9 where id = $1", [c.id]), /ended and is locked/);
  await assert.rejects(t.pool.query("delete from treatment_courses"), /permission denied/);
});

test("prescriptions: doctors only; the licence number is needed to print; printing gives a number and locks it; copies are counted", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const pid = await t.patient("Huda Al-Khatib", { doctor: P.lina });
  const { b: dr } = await t.login(P.doctor);
  const items = [{ name: "Isotretinoin 20 mg capsules", how: "1 capsule daily with food", days: 30, qty: "30" }];
  assert.equal((await dr.post(`/api/patients/${pid}/prescriptions`, { items, language: "en" })).json.error, "rx_off");
  await visitSettings(adm, { rxOn: true, rxValidDays: 14 });
  await dr.post(`/api/patients/${pid}/entries`, { kind: "allergy", title: "Penicillin", detail: "hives" });

  const draft = await dr.post(`/api/patients/${pid}/prescriptions`, { items, language: "en" });
  assert.equal(draft.status, 201);
  assert.equal(draft.json.status, "draft");
  assert.equal(draft.json.valid_days, 14);                      // the clinic's default
  const edited = (await dr.patch(`/api/prescriptions/${draft.json.id}`, { items: [...items, { name: "Petrolatum lip balm", how: "To the lips 4 times a day" }],
    language: "en", validDays: 30, expectedVersion: draft.json.row_version })).json;
  assert.equal(edited.items.length, 2);
  assert.equal((await dr.post(`/api/prescriptions/${draft.json.id}/print`, { expectedVersion: edited.row_version })).json.error, "licence_missing");

  await t.owner.query("update doctors set licence_no = 'JMC-18342' where id = $1", [P.lina]);
  const printed = (await dr.post(`/api/prescriptions/${draft.json.id}/print`, { expectedVersion: edited.row_version })).json;
  assert.equal(printed.rx_no, "2026-00001");
  assert.equal(printed.copy, false);
  assert.equal(printed.printed.doctor.licence, "JMC-18342");
  assert.deepEqual(printed.printed.allergies, ["Penicillin"]);
  assert.equal((await dr.patch(`/api/prescriptions/${draft.json.id}`, { items, language: "en", validDays: 30, expectedVersion: printed.row_version })).json.error, "rx_printed");
  const copy = (await dr.post(`/api/prescriptions/${draft.json.id}/print`, { expectedVersion: printed.row_version })).json;
  assert.equal(copy.copy, true);
  assert.equal(copy.print_count, 2);
  assert.equal(copy.rx_no, "2026-00001");
  await assert.rejects(t.owner.query("update prescriptions set items = '[{\"name\":\"x\"}]' where id = $1", [draft.json.id]), /printed and is locked/);

  // The next one gets the next number; another doctor's draft can't be printed by someone else.
  const second = (await dr.post(`/api/patients/${pid}/prescriptions`, { items, language: "ar" })).json;
  assert.equal((await dr.post(`/api/prescriptions/${second.id}/print`, { expectedVersion: second.row_version })).json.rx_no, "2026-00002");
  const { b: dr2 } = await t.login(P.doctor2);
  const third = (await dr.post(`/api/patients/${pid}/prescriptions`, { items, language: "en" })).json;
  assert.equal((await dr2.post(`/api/prescriptions/${third.id}/print`, { expectedVersion: third.row_version })).status, 403);

  const wrong = (await dr.post(`/api/prescriptions/${draft.json.id}/error`, { reason: "Wrong patient", expectedVersion: copy.row_version })).json;
  assert.ok(wrong.error_at);
  assert.equal((await dr.post(`/api/prescriptions/${draft.json.id}/print`, { expectedVersion: wrong.row_version })).json.error, "entry_locked");

  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.get(`/api/patients/${pid}/prescriptions`)).status, 403);
  assert.equal((await sec.post(`/api/patients/${pid}/prescriptions`, { items, language: "en" })).status, 403);
});

const HISTORY = { titleEn: "Medical history", titleAr: "التاريخ الطبي", consent: false, firstVisitOnly: false, serviceIds: [], minutes: 2, questions: [
  { key: "allergic", en: "Are you allergic to any medicine?", ar: "هل لديك حساسية من أي دواء؟", kind: "yesno_details", required: true, goesTo: "allergy" },
  { key: "medicines", en: "Medicines you take now", ar: "الأدوية التي تأخذها حالياً", kind: "text", goesTo: "medicine" },
  { key: "pregnant", en: "Are you pregnant or breastfeeding?", ar: "هل أنتِ حامل أو مرضعة؟", kind: "yesno", goesTo: "field:pregnant" },
  { key: "goal", en: "What would you like from this visit?", ar: "ما الذي تريده من هذه الزيارة؟", kind: "text" },
] };
const CONSENT = { titleEn: "Laser consent", titleAr: "موافقة الليزر", consent: true, agreeEn: "I agree to the laser treatment as explained.",
  agreeAr: "أوافق على علاج الليزر كما شُرح لي.", firstVisitOnly: false, serviceIds: [], minutes: 1,
  questions: [{ key: "tan", en: "Have you had a tan in the last 4 weeks?", ar: "هل اسمرّت بشرتك في آخر 4 أسابيع؟", kind: "yesno", required: true }] };

test("forms: the link for a booking opens the forms on the phone; answers go to the chart as patient-reported until a doctor confirms them", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const history = (await adm.post("/api/forms", HISTORY)).json;
  const consent = (await adm.post("/api/forms", CONSENT)).json;
  assert.equal(history.version, 1);
  const pid = await t.patient("Huda Al-Khatib");
  const appt = await t.booking(pid, P.lina, { at: "2026-11-12T15:00:00Z", status: "booked" });
  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.post(`/api/appointments/${appt}/form-link`)).json.error, "forms_off");
  await visitSettings(adm, { formsOn: true });

  const link = await sec.post(`/api/appointments/${appt}/form-link`);
  assert.equal(link.status, 201, JSON.stringify(link.json));
  assert.match(link.json.url, /\/f\/[A-Za-z0-9_-]{43}$/);
  assert.match(link.json.message, /نماذج قبل .* \(3 د\): http/);                 // in the patient's language (the clinic's: Arabic)
  assert.match(link.json.whatsapp, /^https:\/\/wa\.me\/9627\d{8}\?text=/);
  const token = link.json.url.split("/f/")[1];
  const phone = t.jar();
  const opened = (await phone.get(`/api/f/${token}`)).json;
  assert.deepEqual(opened.forms.map((f) => f.title_en), ["Medical history", "Laser consent"]);    // in the order the clinic made them
  assert.equal(opened.language, "ar");

  // A required answer and the consent's signature are checked.
  assert.equal((await phone.post(`/api/f/${token}/forms/${history.id}`, { answers: {}, language: "ar" })).json.error, "answer_required");
  const sent = await phone.post(`/api/f/${token}/forms/${history.id}`, { language: "ar", answers: {
    allergic: { value: "yes", details: "Penicillin, I got a rash" }, medicines: { value: "Thyroxine 50" }, pregnant: { value: "no" }, goal: { value: "Less hair" } } });
  assert.equal(sent.status, 201);
  assert.equal((await phone.post(`/api/f/${token}/forms/${history.id}`, { language: "ar", answers: { allergic: { value: "no" } } })).json.error, "already_filled");
  assert.equal((await phone.post(`/api/f/${token}/forms/${consent.id}`, { language: "en", answers: { tan: { value: "no" } } })).json.error, "signature_needed");
  const signed = await phone.post(`/api/f/${token}/forms/${consent.id}`, { language: "en", answers: { tan: { value: "no" } }, signature: SIG, signedName: "H. Khatib" });
  assert.equal(signed.status, 201);
  // The locked copy: a PNG drawn on the phone, kept in Documents as a consent form.
  const res = await fetch(`${t.base}/api/f/${token}/copy/${signed.json.id}`, { method: "POST", headers: { origin: t.base, "content-type": "image/png" }, body: PNG });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).stored, true);

  // On the chart: patient-reported, not confirmed; the specialty field waits in the Forms tab.
  const { b: dr } = await t.login(P.doctor);
  const chart = (await dr.get(`/api/patients/${pid}`)).json.chart;
  const allergy = chart.entries.find((e) => e.kind === "allergy");
  assert.equal(allergy.title, "Penicillin, I got a rash");
  assert.equal(allergy.source, "patient");
  assert.equal(allergy.confirmed_at, null);
  assert.equal(chart.answers.length, 0);
  const f = (await dr.get(`/api/patients/${pid}/forms`)).json;
  const hist = f.responses.find((r) => r.template_id === history.id);
  assert.deepEqual(hist.pending, ["pregnant"]);
  assert.equal(hist.entries.length, 2);
  assert.equal(hist.answers.goal.value, "Less hair");
  const cons = f.responses.find((r) => r.template_id === consent.id);
  assert.ok(cons.copy_file_id);
  const docs = (await dr.get(`/api/patients/${pid}/files`)).json.documents;
  assert.equal(docs[0].doc_kind, "consent_form");
  assert.equal(docs[0].source, "form");

  // The doctor goes through it: the field is saved, one entry confirmed (changed first), the other set aside.
  const med = hist.entries.find((e) => e.kind === "medicine");
  const fixed = (await dr.patch(`/api/entries/${allergy.id}`, { title: "Penicillin", detail: "rash", expectedVersion: allergy.row_version })).json;
  await dr.post(`/api/entries/${fixed.id}/confirm`);
  await dr.post(`/api/entries/${med.id}/error`, { reason: "Set aside after reading the patient's form", expectedVersion: med.row_version });
  const field = (await dr.post(`/api/form-responses/${hist.id}/fields/pregnant`, { value: "no" })).json;
  assert.deepEqual(field.pending, []);
  assert.ok(field.reviewed_at);
  assert.equal((await dr.get(`/api/patients/${pid}`)).json.chart.answers.find((a) => a.field_key === "pregnant").value, "no");

  // Secretaries see that forms were filled, not what was written.
  const secView = (await sec.get(`/api/patients/${pid}/forms`)).json;
  assert.equal(secView.responses.length, 2);
  assert.equal(secView.responses[0].answers, undefined);
  assert.equal(secView.responses[0].questions, null);
  assert.equal((await sec.post(`/api/form-responses/${hist.id}/fields/pregnant`, { value: "yes" })).status, 403);

  // What the patient sent never changes.
  await assert.rejects(t.owner.query("update form_responses set answers = '{}' where id = $1", [hist.id]), /never changes/);
});

test("forms: sending again ends the old link; the link ends some hours after the visit; a changed form is a new version", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  await visitSettings(adm, { formsOn: true, formLinkHours: 2 });
  const sid = await service();
  const history = (await adm.post("/api/forms", { ...HISTORY, firstVisitOnly: true, serviceIds: [sid] })).json;
  const pid = await t.patient("Lina Haddad");
  const appt = await t.booking(pid, P.lina, { at: "2026-11-10T10:00:00Z", status: "booked" });
  const { b: sec } = await t.login(P.secretary);
  const one = (await sec.post(`/api/appointments/${appt}/form-link`)).json.url.split("/f/")[1];
  const two = (await sec.post(`/api/appointments/${appt}/form-link`)).json.url.split("/f/")[1];
  const phone = t.jar();
  assert.equal((await phone.get(`/api/f/${one}`)).status, 410);
  assert.equal((await phone.get(`/api/f/${two}`)).status, 200);

  const changed = (await adm.put(`/api/forms/${history.id}`, { ...HISTORY, firstVisitOnly: true, serviceIds: [sid], questions: HISTORY.questions.slice(0, 2),
    expectedVersion: history.row_version })).json;
  assert.equal(changed.version, 2, JSON.stringify(changed));
  const renamed = (await adm.put(`/api/forms/${history.id}`, { ...HISTORY, titleEn: "Health questions", firstVisitOnly: true, serviceIds: [sid],
    questions: HISTORY.questions.slice(0, 2), expectedVersion: changed.row_version })).json;
  assert.equal(renamed.version, 2);                              // only the title: the same version

  // First visit only: a patient with an earlier completed visit gets no forms.
  const seen = await t.patient("Seen Before", { doctor: P.lina, at: "2026-10-01T07:00:00Z", status: "completed" });
  const later = await t.booking(seen, P.lina, { at: "2026-11-20T10:00:00Z", status: "booked" });
  assert.equal((await sec.post(`/api/appointments/${later}/form-link`)).json.error, "no_forms");

  t.advance(60 * 4);                                             // the visit ended at about 10:30; two hours later the link is gone
  assert.equal((await phone.get(`/api/f/${two}`)).json.error, "link_ended");
});

test("the AI summary: off until a model is chosen; doctors only; from signed notes and the chart, each line with its source; a daily limit", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const pid = await t.patient("Huda Al-Khatib");
  const a1 = await t.booking(pid, P.lina, { at: "2026-10-12T07:00:00Z", status: "completed" });
  const a2 = await t.booking(pid, P.lina, { at: "2026-11-10T12:00:00Z", status: "booked" });
  const sections = JSON.stringify([{ key: "assessment", en: "Assessment" }, { key: "plan", en: "Plan" }]);
  const note = (await t.owner.query(
    `insert into visit_notes (clinic_id, appointment_id, patient_id, doctor_id, kind, status, language, sections, content, signed_at, signed_by, signed_name, created_by)
     values ($1,$2,$3,$4,'manual','signed','en',$5,$6,'2026-10-12T08:00:00Z','x','Dr Lina','x') returning id`,
    [t.clinicA, a1, pid, P.lina, sections, JSON.stringify({ assessment: "Acne much better", plan: "Isotretinoin 20 mg, month 4 of 6" })])).rows[0].id;
  await t.owner.query(
    `insert into visit_notes (clinic_id, appointment_id, patient_id, doctor_id, kind, status, language, sections, content, created_by)
     values ($1,$2,$3,$4,'manual','draft','en',$5,$6,'x')`, [t.clinicA, a2, pid, P.lina, sections, JSON.stringify({ assessment: "DRAFT WORDS" })]);
  const { b: dr } = await t.login(P.doctor);
  await dr.post(`/api/patients/${pid}/entries`, { kind: "allergy", title: "Penicillin", detail: "hives" });

  const off = (await dr.get(`/api/patients/${pid}/summary`)).json;
  assert.equal(off.on, false);
  assert.equal(off.visitToday, true);
  assert.equal((await dr.post(`/api/patients/${pid}/summary`, {})).json.error, "summary_off");
  await visitSettings(adm, { summaryModel: "claude-haiku-5-5", summaryDaily: 1 });

  const made = (await dr.post(`/api/patients/${pid}/summary`, { lang: "en" })).json;
  assert.equal(made.summary.model, "claude-haiku-5-5");
  assert.equal(made.stale, false);
  const noteLine = made.summary.lines.find((l) => l.source.kind === "note");
  assert.equal(noteLine.source.id, note);
  assert.equal(noteLine.source.appointment_id, a1);
  assert.ok(made.summary.lines.some((l) => l.source.kind === "chart" && /Penicillin/.test(l.text)));
  // Only the signed note was read; never the draft.
  const given = t.summarizer.calls.at(-1);
  assert.equal(given.notes.length, 1);
  assert.ok(!JSON.stringify(given).includes("DRAFT WORDS"));
  assert.equal(given.model, "claude-haiku-5-5");

  assert.equal((await dr.post(`/api/patients/${pid}/summary`, {})).json.error, "summary_limit");
  // A line pointing at something that was not in the material is dropped.
  t.summarizer.impl = { async summarize() { return { lines: [{ text: "Made up", source: "note", id: "00000000-0000-0000-0000-000000000000" }, { text: "Allergic to penicillin", source: "chart", id: "chart" }] }; } };
  await visitSettings(adm, { summaryModel: "claude-sonnet-5-5", summaryDaily: 5 });
  const again = (await dr.post(`/api/patients/${pid}/summary`, {})).json;
  assert.deepEqual(again.summary.lines.map((l) => l.text), ["Allergic to penicillin"]);

  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.get(`/api/patients/${pid}/summary`)).status, 403);
  // The words of notes are reachable only through the signed-notes function, not the table.
  await assert.rejects(t.pool.query("select content from visit_notes"), /permission denied/);
  const viaFn = (await t.pool.query("select * from public.records_signed_notes($1, $2, 10)", [t.clinicA, pid])).rows;
  assert.equal(viaFn.length, 1);
});

test("phase C settings: every part starts off; the message must hold the link; Booking reads only what it needs", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const s = (await adm.get("/api/settings")).json;
  assert.equal(s.coursesOn, false); assert.equal(s.rxOn, false); assert.equal(s.formsOn, false); assert.equal(s.summaryModel, "off");
  assert.equal((await adm.put("/api/settings/visit", { ...VISIT, formMessageEn: "No link here" })).status, 400);
  const { b: dr } = await t.login(P.doctor);
  assert.equal((await dr.put("/api/settings/visit", VISIT)).status, 403);
  await assert.rejects(t.bookingPool.query("select answers from form_responses"), /permission denied/);
  await assert.rejects(t.bookingPool.query("select items from prescriptions"), /permission denied/);
  await t.bookingPool.query("select id, sessions, starts_on from treatment_courses");
  await t.bookingPool.query("select submitted_at, template_id from form_responses");
});
