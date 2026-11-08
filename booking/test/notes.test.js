// AI Scribe, steps 4 and 5: the visit note. Consent first, the treating doctor only, the audio gone once it is text, a signed note
// locked, the audit trail with every step and none of the words, and the clinic's limits.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setup } from "./helpers.js";

let t, ids, P, dr, sec, appt, other;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const TOMORROW = "2026-11-11";
const at = (day, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const book = (b, doctorId, name, phone, time = "12:00") => b.post("/api/appointments", { serviceId: ids.services[0].id, doctorId, startsAt: at(TOMORROW, time), source: "phone", newPatient: { fullName: name, phone } });
const scribeOn = async (doctorOn = true) => {
  await t.owner.query("update scribe_settings set enabled = true");
  await t.owner.query("update doctors set scribe_enabled = $1 where id = $2", [doctorOn, P.doctorRecord]);
};
// The words of the sample consultation and its draft: none may reach the audit log.
const WORDS = ["eczema", "Mometasone", "حكة", "pharmacy cream", "كريم من الصيدلية", "elbows", "Itchy"];

async function recordAndDraft() {
  const n = (await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true })).json;
  assert.equal((await t.putAudio(dr, n.id, 0)).status, 200);
  assert.equal((await t.putAudio(dr, n.id, 1)).status, 200);
  assert.equal((await dr.post(`/api/notes/${n.id}/stop`, { seconds: 300 })).json.status, "processing");
  assert.equal(await t.scribe.processOne(), true);
  return (await dr.get(`/api/appointments/${appt.id}/note`)).json.note;
}

beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  dr = (await t.login(P.doctor)).b;
  sec = (await t.login(P.secretary)).b;
  P.doctorRecord = (await dr.get("/api/me")).json.doctorId;
  other = ids.docs.map((d) => d.id).find((id) => id !== P.doctorRecord);
  appt = (await book(sec, P.doctorRecord, "Rania Saleh", "0785550102")).json;
});

test("visit notes stay closed until the clinic switches the Scribe on", async () => {
  const v = (await dr.get(`/api/appointments/${appt.id}/note`)).json;
  assert.equal(v.settings.enabled, false);
  assert.equal(v.note, null);
  assert.equal((await dr.post(`/api/appointments/${appt.id}/note`, { mode: "manual" })).json.error, "scribe_off");
  assert.equal((await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true })).json.error, "scribe_off");
});

test("recording needs the patient's agreement and the doctor's own switch, and is the treating doctor's alone", async () => {
  await scribeOn(false);
  assert.equal((await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true })).json.error, "scribe_not_for_doctor");
  await scribeOn(true);
  assert.equal((await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe" })).json.error, "consent_required");
  assert.equal((await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: false })).json.error, "consent_required");
  const s = await sec.post(`/api/appointments/${appt.id}/note`, { mode: "manual" });
  assert.equal(s.status, 403, "a secretary has no notes permission");
  assert.equal((await sec.get(`/api/appointments/${appt.id}/note`)).status, 403, "nor can she read one");
  // The database itself refuses a recorded note without the agreement.
  await assert.rejects(t.pool.query(`insert into visit_notes (clinic_id, appointment_id, patient_id, doctor_id, kind, status, language, sections, created_by)
    values ($1,$2,$3,$4,'scribe','recording','en','[]','x')`, [t.clinicA, appt.id, appt.patient_id, P.doctorRecord]), /visit_notes_consent/);
  const r = await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, "recording");
  assert.ok(r.json.consentAt);
});

test("record, stop, draft, edit, sign: the audio is gone once it is text, and a signed note is locked", async () => {
  await scribeOn();
  const n = (await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true })).json;
  assert.equal((await t.putAudio(dr, n.id, 0)).status, 200);
  assert.equal((await t.putAudio(dr, n.id, 1)).status, 200);
  assert.equal(fs.readdirSync(path.join(t.audioDir, n.id)).length, 2, "the pieces wait on this server");
  assert.equal((await t.putAudio(dr, n.id, 2, Buffer.from("x"), "text/plain")).json.error, "not_audio");
  assert.equal((await t.putAudio(sec, n.id, 3)).status, 403, "a secretary cannot add to a recording");
  assert.equal((await sec.get(`/api/appointments/${appt.id}`)).json.note_status, "recording", "the secretary sees only the state");

  assert.equal((await dr.post(`/api/notes/${n.id}/stop`, { seconds: 300 })).json.status, "processing");
  assert.equal((await dr.post(`/api/notes/${n.id}/stop`, {})).json.status, "processing", "a second stop changes nothing");
  assert.equal((await t.putAudio(dr, n.id, 4)).json.error, "not_recording");
  assert.equal(await t.scribe.processOne(), true);
  assert.equal(await t.scribe.processOne(), false, "nothing else waiting");
  assert.equal(fs.existsSync(path.join(t.audioDir, n.id)), false, "the audio is deleted once it is text");

  const v = (await dr.get(`/api/appointments/${appt.id}/note`)).json.note;
  assert.equal(v.status, "draft");
  assert.equal(v.aiDrafted, true);
  assert.equal(v.content.reason, "Itchy rash on both elbows for 3 weeks.");
  assert.ok(v.transcript.length > 5, "the transcript is kept beside the draft");
  assert.ok(v.flags.some((f) => f.kind === "medicine" && f.text === "Mometasone 0.1% cream"));
  assert.equal(t.drafter.calls[0].model, "claude-opus-5-5");
  assert.equal(t.drafter.calls[0].language, "en");
  assert.equal((await sec.get(`/api/appointments/${appt.id}`)).json.note_status, "draft");

  // Edits: an old copy is refused; a changed medicine is no longer marked.
  assert.equal((await dr.patch(`/api/notes/${n.id}`, { content: { plan: "x" }, expectedVersion: v.rowVersion - 1 })).json.error, "version_conflict");
  const plan = "Hydrocortisone 1% cream twice daily for 1 week.";
  const e = (await dr.patch(`/api/notes/${n.id}`, { content: { plan }, expectedVersion: v.rowVersion })).json;
  assert.equal(e.content.plan, plan);
  assert.equal(e.content.reason, v.content.reason, "untouched sections stay");
  assert.ok(!e.flags.some((f) => f.section === "plan"), "the old marks in the plan are gone with its words");

  assert.equal((await dr.post(`/api/notes/${n.id}/sign`, { expectedVersion: e.rowVersion })).json.error, "invalid_input", "the doctor must confirm reading it");
  const s = (await dr.post(`/api/notes/${n.id}/sign`, { expectedVersion: e.rowVersion, confirmRead: true })).json;
  assert.equal(s.status, "signed");
  assert.equal(s.signedName, "Dr Lina");
  assert.equal((await dr.patch(`/api/notes/${n.id}`, { content: { plan: "changed" }, expectedVersion: s.rowVersion })).json.error, "not_a_draft");
  assert.equal((await dr.post(`/api/notes/${n.id}/discard`)).json.error, "note_signed");
  await assert.rejects(t.pool.query(`update visit_notes set content = '{}' where id = $1`, [n.id]), /signed/, "locked in the database too");

  const add = await dr.post(`/api/notes/${n.id}/additions`, { text: "Patient called: rash improving." });
  assert.equal(add.status, 201);
  assert.equal(add.json.additions.length, 1);
  await assert.rejects(t.pool.query("update visit_note_additions set text = 'x'"), /permission denied/, "additions are never changed");

  // The patient's page: the secretary sees the row and its state, never the words.
  const rows = (await sec.get(`/api/patients/${appt.patient_id}/notes`)).json;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "signed");
  assert.equal(rows[0].additions, 1);
  assert.ok(!JSON.stringify(rows).includes("Itchy") && !("content" in rows[0]));
});

test("the audit trail has every step of the note and none of its words", async () => {
  await scribeOn();
  const v = await recordAndDraft();
  const e = (await dr.patch(`/api/notes/${v.id}`, { content: { followup: "In 2 weeks." }, expectedVersion: v.rowVersion })).json;
  await dr.post(`/api/notes/${v.id}/sign`, { expectedVersion: e.rowVersion, confirmRead: true });
  await dr.post(`/api/notes/${v.id}/additions`, { text: "Itchy again, cream restarted." });
  const { rows } = await t.owner.query("select actor_type, actor_label, action, before, after, changed_fields from audit.events where entity = 'visit_note' and entity_id = $1 order by seq", [v.id]);
  assert.deepEqual(rows.map((r) => r.action),
    ["consent_recorded", "recording_stopped", "transcribed", "audio_deleted", "draft_made", "edited", "signed", "addition_added"]);
  assert.equal(rows.find((r) => r.action === "draft_made").actor_label, "AI Scribe");
  assert.equal(rows.find((r) => r.action === "signed").actor_label, "Dr Lina");
  assert.deepEqual(rows.find((r) => r.action === "edited").changed_fields, ["content", "flags"], "the follow-up's unsure mark went with the old words");
  const all = JSON.stringify(rows);
  for (const w of WORDS) assert.ok(!all.includes(w), `"${w}" must not be in the audit log`);
});

test("written by hand, and when the Scribe fails: try again, or write by hand", async () => {
  await scribeOn(false);                               // the doctor may not record, but may still write
  const m = await dr.post(`/api/appointments/${appt.id}/note`, { mode: "manual" });
  assert.equal(m.status, 201);
  assert.equal(m.json.status, "draft");
  assert.equal(m.json.kind, "manual");
  assert.equal((await dr.post(`/api/notes/${m.json.id}/sign`, { expectedVersion: m.json.rowVersion, confirmRead: true })).json.error, "note_empty");
  const w = (await dr.patch(`/api/notes/${m.json.id}`, { content: { reason: "Follow-up of eczema." }, expectedVersion: m.json.rowVersion })).json;
  assert.equal((await dr.post(`/api/notes/${w.id}/sign`, { expectedVersion: w.rowVersion, confirmRead: true })).json.status, "signed");

  await scribeOn(true);
  const second = (await book(sec, P.doctorRecord, "Omar Haddad", "0785550103", "13:00")).json;
  const n = (await dr.post(`/api/appointments/${second.id}/note`, { mode: "scribe", consent: true })).json;
  await t.putAudio(dr, n.id, 0);
  await dr.post(`/api/notes/${n.id}/stop`, {});
  t.drafter.fail = "draft_service_529";
  await t.scribe.processOne();
  let v = (await dr.get(`/api/appointments/${second.id}/note`)).json.note;
  assert.equal(v.status, "failed");
  assert.equal(v.error, "draft_service_529");
  assert.ok(v.transcript, "the text was made before the draft failed, and the audio is gone");
  assert.equal(fs.existsSync(path.join(t.audioDir, n.id)), false);
  t.drafter.fail = null;
  assert.equal((await dr.post(`/api/notes/${n.id}/retry`)).json.status, "processing");
  await t.scribe.processOne();
  v = (await dr.get(`/api/appointments/${second.id}/note`)).json.note;
  assert.equal(v.status, "draft");

  // A recording with no sound at all fails, and the doctor writes by hand beside nothing.
  const third = (await book(sec, P.doctorRecord, "Dana Saleh", "0785550104", "13:30")).json;
  const q = (await dr.post(`/api/appointments/${third.id}/note`, { mode: "scribe", consent: true })).json;
  await dr.post(`/api/notes/${q.id}/stop`, {});
  await t.scribe.processOne();
  assert.equal((await dr.get(`/api/appointments/${third.id}/note`)).json.note.error, "no_audio");
  assert.equal((await dr.post(`/api/notes/${q.id}/retry`)).json.error, "nothing_to_retry");
  const h = (await dr.post(`/api/notes/${q.id}/by-hand`)).json;
  assert.equal(h.status, "draft");
  assert.equal(h.aiDrafted, false);
});

test("limits: one note per visit, discarding frees it, the daily cap, the longest recording", async () => {
  await scribeOn();
  const n = (await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true })).json;
  await t.putAudio(dr, n.id, 0);
  assert.equal((await dr.post(`/api/appointments/${appt.id}/note`, { mode: "manual" })).json.error, "note_exists");
  assert.equal((await dr.post(`/api/notes/${n.id}/discard`)).json.ok, true);
  assert.equal(fs.existsSync(path.join(t.audioDir, n.id)), false, "a discarded recording's audio goes with it");
  assert.equal((await sec.get(`/api/appointments/${appt.id}`)).json.note_status, null);

  await t.owner.query("update scribe_settings set notes_per_doctor_per_day = 1, max_recording_minutes = 5");
  const again = (await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true }));
  assert.equal(again.status, 201, "a discarded note does not count");
  const second = (await book(sec, P.doctorRecord, "Omar Haddad", "0785550103", "13:00")).json;
  const capped = await dr.post(`/api/appointments/${second.id}/note`, { mode: "scribe", consent: true });
  assert.equal(capped.status, 429);
  assert.equal(capped.json.error, "scribe_daily_limit");
  assert.equal((await dr.post(`/api/appointments/${second.id}/note`, { mode: "manual" })).status, 201, "writing by hand is never capped");

  t.advance(7);
  assert.equal((await t.putAudio(dr, again.json.id, 0)).json.error, "recording_too_long");

  const cancelled = (await book(sec, P.doctorRecord, "Dana Saleh", "0785550104", "13:30")).json;
  await sec.post(`/api/appointments/${cancelled.id}/status`, { status: "cancelled", reason: "Patient asked", expectedVersion: cancelled.row_version });
  assert.equal((await dr.post(`/api/appointments/${cancelled.id}/note`, { mode: "manual" })).json.error, "visit_not_open");
});

test("recordings left running are stopped; transcripts go after the keep days; leftover audio is removed", async () => {
  await scribeOn();
  const n = (await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true })).json;
  await t.putAudio(dr, n.id, 0);
  t.advance(2);
  assert.equal((await dr.post(`/api/notes/${n.id}/alive`)).json.ok, true, "paused, still there");
  t.advance(2);
  await t.scribe.sweep();
  assert.equal((await dr.get(`/api/appointments/${appt.id}/note`)).json.note.status, "recording", "a sign of life 2 minutes ago");
  t.advance(4);
  await t.scribe.sweep();
  const stopped = (await dr.get(`/api/appointments/${appt.id}/note`)).json.note;
  assert.equal(stopped.status, "processing", "left: stopped, and made into a note with what was recorded");
  assert.equal(stopped.recordingSeconds, 120);
  await t.scribe.processOne();

  const orphan = path.join(t.audioDir, "6f1c2a3b-0000-4000-8000-000000000001");
  fs.mkdirSync(orphan); fs.writeFileSync(path.join(orphan, "000000.part"), "x");
  t.advance(31 * 24 * 60);
  await t.scribe.sweep();
  assert.equal(fs.existsSync(orphan), false, "audio with no recording behind it is removed");
  const v = (await t.owner.query("select status, transcript, transcript_deleted_at from visit_notes where id = $1", [n.id])).rows[0];
  assert.equal(v.transcript, null);
  assert.ok(v.transcript_deleted_at);
  assert.equal(v.status, "draft", "the note itself stays");
  const { rows } = await t.owner.query("select action, actor_label from audit.events where entity = 'visit_note' and entity_id = $1 and action = 'transcript_deleted'", [n.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_label, "AI Scribe");
});

test("a doctor reaches only their own patients' notes, by any link", async () => {
  await scribeOn();
  const v = await recordAndDraft();
  const dr2user = await t.makeUser({ email: "dr2@demo.jo", name: "Dr Omar", role: "doctor", doctor: other });
  const dr2 = (await t.login(dr2user)).b;
  assert.equal((await dr2.get(`/api/appointments/${appt.id}/note`)).status, 404);
  assert.equal((await dr2.patch(`/api/notes/${v.id}`, { content: { plan: "x" }, expectedVersion: v.rowVersion })).json.error, "note_not_found");
  assert.equal((await dr2.post(`/api/notes/${v.id}/sign`, { expectedVersion: v.rowVersion, confirmRead: true })).json.error, "note_not_found");
  assert.equal((await dr2.post(`/api/notes/${v.id}/discard`)).json.error, "note_not_found");
  assert.equal((await t.putAudio(dr2, v.id, 9)).json.error, "note_not_found");
  assert.equal((await dr2.get(`/api/patients/${appt.patient_id}/notes`)).status, 404);
  // Another doctor's visit: no note may be started on it.
  const theirs = (await book(sec, other, "Their Patient", "0785550109", "15:00")).json;
  assert.equal((await dr.post(`/api/appointments/${theirs.id}/note`, { mode: "manual" })).status, 404);
});

test("Settings > AI Scribe: validated, saved with the doctors' switches, audited; read-only for secretaries", async () => {
  const adm = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  const s = (await adm.get("/api/settings")).json;
  assert.equal(s.scribe.enabled, false);
  assert.equal(s.scribe.sections.length, 7);
  assert.equal(s.scribe.transcript_keep_days, 30);
  const body = {
    enabled: true, noteLanguage: "ar", consentEn: "We record to help write the note. OK?", consentAr: "رح نسجّل الزيارة. موافق؟",
    sections: [...s.scribe.sections.slice(0, 6), { key: "s_photos", en: "Photos taken", ar: "الصور", hint: "Which areas were photographed." }],
    maxRecordingMinutes: 30, transcriptKeepDays: 14, notesPerDoctorPerDay: 20, speechService: "stand_in", draftModel: "claude-sonnet-5-5",
    doctors: [{ id: P.doctorRecord, scribeEnabled: true }],
  };
  assert.equal((await sec.patch("/api/settings/scribe", body)).status, 403);
  assert.equal((await adm.patch("/api/settings/scribe", { ...body, draftModel: "gpt" })).status, 400);
  assert.equal((await adm.patch("/api/settings/scribe", { ...body, sections: [body.sections[0], body.sections[0]] })).json.error, "duplicate_section");
  assert.equal((await adm.patch("/api/settings/scribe", { ...body, sections: [{ key: "Bad Key", en: "x", ar: "x" }] })).status, 400);
  assert.equal((await adm.patch("/api/settings/scribe", { ...body, draftModel: "claude-haiku-5-5" })).status, 200, "Haiku 5.5 is a choice");
  assert.equal((await adm.patch("/api/settings/scribe", body)).status, 200);
  const after = (await adm.get("/api/settings")).json;
  assert.equal(after.scribe.note_language, "ar");
  assert.equal(after.scribe.sections.at(-1).key, "s_photos");
  assert.equal(after.doctors.find((d) => d.id === P.doctorRecord).scribe_enabled, true);

  // A note begun now keeps these sections, and the draft is asked in Arabic with the chosen model.
  const n = (await dr.post(`/api/appointments/${appt.id}/note`, { mode: "scribe", consent: true })).json;
  assert.equal(n.language, "ar");
  await t.putAudio(dr, n.id, 0);
  await dr.post(`/api/notes/${n.id}/stop`, {});
  await t.scribe.processOne();
  assert.equal(t.drafter.calls[0].model, "claude-sonnet-5-5");
  assert.equal(t.drafter.calls[0].language, "ar");
  const v = (await dr.get(`/api/appointments/${appt.id}/note`)).json.note;
  assert.equal(v.content.s_photos, "لم يُذكر.");

  const { rows } = await t.owner.query("select action, changed_fields from audit.events where clinic_id = $1 and entity = 'scribe_settings' order by seq desc limit 1", [t.clinicA]);
  assert.ok(rows[0].changed_fields.includes("draft_model"));
});

test("the Bookings list shows each visit note's state, and filters by it", async () => {
  await scribeOn();
  const v = await recordAndDraft();                                                   // Rania: a draft
  const signedByHand = (await book(sec, P.doctorRecord, "Omar Haddad", "0785550103", "13:00")).json;
  const m = (await dr.post(`/api/appointments/${signedByHand.id}/note`, { mode: "manual" })).json;
  const w = (await dr.patch(`/api/notes/${m.id}`, { content: { reason: "Follow-up." }, expectedVersion: m.rowVersion })).json;
  await dr.post(`/api/notes/${w.id}/sign`, { expectedVersion: w.rowVersion, confirmRead: true });
  const none = (await book(sec, P.doctorRecord, "Dana Saleh", "0785550104", "13:30")).json;
  const list = async (b, q = "") => Object.fromEntries((await b.get(`/api/appointments?from=${TOMORROW}${q}`)).json.map((a) => [a.id, [a.note_status, a.note_by_hand]]));
  const all = await list(sec);
  assert.deepEqual(all[appt.id], ["draft", false]);
  assert.deepEqual(all[signedByHand.id], ["signed", true], "signed, written by hand");
  assert.deepEqual(all[none.id], [null, null]);
  assert.deepEqual(Object.keys(await list(sec, "&note=unsigned")), [appt.id]);
  assert.deepEqual(Object.keys(await list(sec, "&note=signed")), [signedByHand.id]);
  assert.deepEqual(Object.keys(await list(sec, "&note=none")), [none.id]);
  assert.equal((await sec.get("/api/appointments?note=maybe")).status, 400);
  assert.ok(!JSON.stringify((await sec.get(`/api/appointments?from=${TOMORROW}`)).json).includes("Itchy"), "the list never carries the note's words");
  void v;
});
