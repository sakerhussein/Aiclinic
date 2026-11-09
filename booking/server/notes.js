// Visit notes (AI Scribe, plan steps 4 and 5): what the doctor does on the appointment. Consent, recording in small pieces, stop,
// edit, sign, additions. The speech and the draft happen in scribe.js, in its own process.
// Who: a doctor reaches only their own patients' notes (as with bookings), and only the treating doctor records, edits and signs.
// A secretary never gets the content: the booking and the patient's page show only whether there is a note and its state.
import { HttpError, bad, denied, notFound } from "./http.js";
import { DEFAULT_AUDIO_DIR, STUCK_MS, ScribeError, audioFiles, removeAudio, writeChunk } from "./scribe.js";
import { DICTATION_SPEECH, appendTo, checkTidy } from "./dictation.js";

const OPEN_VISIT = ["booked", "confirmed", "completed"];

export function createNotes({ pool, tx, now = () => new Date(), audioDir = DEFAULT_AUDIO_DIR, getAppointment, speech = DICTATION_SPEECH, tidier = null, log = console }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];
  const settingsOf = (c, clinicId) => one(c, "select * from scribe_settings where clinic_id = $1", [clinicId]);

  async function noteRow(c, ctx, id, lock = false) {
    const n = await one(c, `select * from visit_notes where clinic_id = $1 and id = $2 and ($3::uuid is null or doctor_id = $3)${lock ? " for update" : ""}`,
      [ctx.clinicId, id, ctx.onlyDoctor ?? null]);
    if (!n) throw notFound("note_not_found");
    return n;
  }
  const theDoctor = (ctx, n) => { if (!ctx.onlyDoctor || ctx.onlyDoctor !== n.doctor_id) throw denied("own_patients_only"); };
  const sameVersion = (n, v) => { if (v !== undefined && n.row_version !== v) throw new HttpError(409, "version_conflict", { version: n.row_version }); };
  const additionsOf = async (c, id) => (await c.query("select id, text, added_at, added_by_name from visit_note_additions where note_id = $1 order by added_at", [id])).rows;

  // The note as the doctor's screen needs it.
  const view = (n, additions = []) => ({
    id: n.id, appointmentId: n.appointment_id, kind: n.kind, status: n.status, language: n.language, sections: n.sections, content: n.content,
    flags: n.flags, transcript: n.transcript, transcriptDeletedAt: n.transcript_deleted_at, aiDrafted: n.ai_drafted, consentAt: n.consent_at,
    recordingStartedAt: n.recording_started_at, recordingSeconds: n.recording_seconds, error: n.error, model: n.model,
    speechService: n.speech_service, signedAt: n.signed_at, signedName: n.signed_name, rowVersion: n.row_version,
    // A draft taking far longer than usual: the screen offers to write by hand instead.
    slow: n.status === "processing" && now() - new Date(n.recording_stopped_at ?? n.updated_at) > STUCK_MS / 2,
    additions: additions.map((x) => ({ id: x.id, text: x.text, addedAt: x.added_at, addedByName: x.added_by_name })),
  });

  // The visit note screen: the booking, what this clinic allows, and the note if there is one.
  async function forVisit(ctx, appointmentId) {
    const a = await getAppointment(ctx, appointmentId);
    const s = await settingsOf(pool, ctx.clinicId);
    const d = await one(pool, "select scribe_enabled from doctors where clinic_id = $1 and id = $2", [ctx.clinicId, a.doctor_id]);
    const n = await one(pool, "select * from visit_notes where clinic_id = $1 and appointment_id = $2 and status <> 'discarded'", [ctx.clinicId, appointmentId]);
    return {
      appointment: a,
      settings: {
        enabled: s.enabled, recording: s.enabled && !!d?.scribe_enabled, language: s.note_language, consentEn: s.consent_en, consentAr: s.consent_ar,
        maxMinutes: s.max_recording_minutes, keepDays: s.transcript_keep_days, standIn: s.speech_service === "stand_in",
        isTheDoctor: ctx.onlyDoctor === a.doctor_id, openVisit: OPEN_VISIT.includes(a.status),
        dictation: { enabled: s.dictation_enabled, tidy: s.dictation_model !== "none", fieldSeconds: s.dictation_field_seconds, noteMinutes: s.dictation_note_minutes },
      },
      note: n ? view(n, await additionsOf(pool, n.id)) : null,
    };
  }

  // "Start recording" (after the agreement is ticked) or "Write without recording".
  async function start(ctx, appointmentId, { mode, consent }) {
    return tx(ctx, async (c) => {
      const a = await getAppointment(ctx, appointmentId, c);
      theDoctor(ctx, a);
      if (!OPEN_VISIT.includes(a.status)) throw bad("visit_not_open");
      const s = await settingsOf(c, ctx.clinicId);
      if (!s.enabled) throw denied("scribe_off");
      const t = now();
      if (mode === "scribe") {
        if (consent !== true) throw bad("consent_required");
        const d = await one(c, "select scribe_enabled from doctors where clinic_id = $1 and id = $2", [ctx.clinicId, a.doctor_id]);
        if (!d?.scribe_enabled) throw denied("scribe_not_for_doctor");
        const { timezone } = await one(c, "select timezone from clinics where id = $1", [ctx.clinicId]);
        const { used } = await one(c,
          `select count(*)::int as used from visit_notes where clinic_id = $1 and doctor_id = $2 and kind = 'scribe' and status <> 'discarded'
              and (created_at at time zone $3)::date = ($4::timestamptz at time zone $3)::date`, [ctx.clinicId, a.doctor_id, timezone, t]);
        if (used >= s.notes_per_doctor_per_day) throw new HttpError(429, "scribe_daily_limit");
      }
      try {
        const n = await one(c,
          `insert into visit_notes (clinic_id, appointment_id, patient_id, doctor_id, kind, status, language, sections, consent_at, recording_started_at, created_by, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11) returning *`,
          [ctx.clinicId, a.id, a.patient_id, a.doctor_id, mode, mode === "scribe" ? "recording" : "draft", s.note_language, JSON.stringify(s.sections),
           mode === "scribe" ? t : null, ctx.user.id, t]);
        return view(n);
      } catch (e) {
        if (e.code === "23505") throw new HttpError(409, "note_exists");
        throw e;
      }
    });
  }

  async function recording(c, ctx, id) {
    const n = await noteRow(c, ctx, id, true);
    theDoctor(ctx, n);
    if (n.status !== "recording") throw new HttpError(409, "not_recording");
    return n;
  }

  // One piece of the recording (a few seconds). Kept on this server's disk until it becomes text.
  async function saveChunk(ctx, id, seq, mime, buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad("empty_audio");
    if (!/^audio\/[a-z0-9.+-]+(\s*;.*)?$/i.test(mime || "")) throw bad("not_audio");
    return tx(ctx, async (c) => {
      const n = await recording(c, ctx, id);
      const s = await settingsOf(c, ctx.clinicId);
      if (now() - new Date(n.recording_started_at) > (s.max_recording_minutes + 1) * 60_000) throw new HttpError(409, "recording_too_long");
      await writeChunk(audioDir, n.id, seq, buf);
      await c.query("update visit_notes set last_chunk_at = $2, audio_mime = coalesce(audio_mime, $3) where id = $1", [n.id, now(), mime.slice(0, 100)]);
      return { ok: true };
    });
  }

  // While paused no sound arrives: this keeps the recording from being taken for one that was left.
  async function alive(ctx, id) {
    return tx(ctx, async (c) => {
      const n = await recording(c, ctx, id);
      await c.query("update visit_notes set last_chunk_at = $2 where id = $1", [n.id, now()]);
      return { ok: true };
    });
  }

  // "Stop and make the note". Leaving the page sends it too; a second stop changes nothing.
  async function stop(ctx, id, { seconds }) {
    return tx(ctx, async (c) => {
      const n = await noteRow(c, ctx, id, true);
      theDoctor(ctx, n);
      if (n.status !== "recording") return view(n);
      const t = now();
      const elapsed = Math.max(0, Math.round((t - new Date(n.recording_started_at)) / 1000));
      const r = await one(c, `update visit_notes set status = 'processing', recording_stopped_at = $2, recording_seconds = $3, processing_started_at = null
                               where id = $1 returning *`, [n.id, t, Math.min(seconds ?? elapsed, elapsed, 7200)]);
      return view(r);
    });
  }

  async function draft(c, ctx, id, expectedVersion) {
    const n = await noteRow(c, ctx, id, true);
    theDoctor(ctx, n);
    if (n.status !== "draft") throw new HttpError(409, "not_a_draft");
    sameVersion(n, expectedVersion);
    return n;
  }

  // "Save draft". A marked word the doctor changed is no longer marked.
  async function save(ctx, id, { content, expectedVersion }) {
    return tx(ctx, async (c) => {
      const n = await draft(c, ctx, id, expectedVersion);
      const next = Object.fromEntries(n.sections.map((s) => [s.key, typeof content[s.key] === "string" ? content[s.key] : (n.content[s.key] ?? "")]));
      const flags = n.flags.filter((f) => (next[f.section] ?? "").includes(f.text));
      const r = await one(c, "update visit_notes set content = $2, flags = $3 where id = $1 returning *", [n.id, JSON.stringify(next), JSON.stringify(flags)]);
      return view(r, await additionsOf(c, n.id));
    });
  }

  // "Sign note": the doctor confirms they read it all and checked the medicines and doses. From here it is locked.
  async function sign(ctx, id, { expectedVersion }) {
    const r = await tx(ctx, async (c) => {
      const n = await draft(c, ctx, id, expectedVersion);
      if (!Object.values(n.content).some((v) => String(v ?? "").trim())) throw bad("note_empty");
      return one(c, "update visit_notes set status = 'signed', signed_at = $2, signed_by = $3, signed_name = $4 where id = $1 returning *",
        [n.id, now(), ctx.user.id, ctx.user.name]);
    });
    await removeAudio(audioDir, r.id).catch(() => {});
    return view(r);
  }

  // ---------------------------------------------------------------- dictation (design: booking/design/dictation.html)
  // The doctor's own voice into one field (scope "field") or the whole note (scope "note"). Checked first, then speech and tidying
  // with no transaction open (they take seconds), then the words are added in one transaction, if nobody changed the note meanwhile.
  async function dictate(ctx, id, { scope, section, seconds, expectedVersion, mime, audio }) {
    if (!Buffer.isBuffer(audio) || !audio.length) throw bad("empty_audio");
    if (!/^audio\/[a-z0-9.+-]+(\s*;.*)?$/i.test(mime || "")) throw bad("not_audio");
    const n = await noteRow(pool, ctx, id);
    theDoctor(ctx, n);
    if (n.status !== "draft") throw new HttpError(409, "not_a_draft");
    sameVersion(n, expectedVersion);
    const s = await settingsOf(pool, ctx.clinicId);
    if (!s.enabled || !s.dictation_enabled) throw denied("dictation_off");
    if (scope === "field" && !n.sections.some((x) => x.key === section)) throw bad("unknown_section");
    if (scope === "note" && s.dictation_model === "none") throw bad("whole_note_needs_tidy");
    const limit = scope === "field" ? s.dictation_field_seconds : s.dictation_note_minutes * 60;
    if (seconds > limit + 5) throw bad("dictation_too_long");
    const { timezone } = await one(pool, "select timezone from clinics where id = $1", [ctx.clinicId]);
    const { used } = await one(pool,
      `select count(*)::int as used from visit_note_dictations where clinic_id = $1 and doctor_id = $2
          and (created_at at time zone $3)::date = ($4::timestamptz at time zone $3)::date`, [ctx.clinicId, n.doctor_id, timezone, now()]);
    if (used >= s.dictations_per_doctor_per_day) throw new HttpError(429, "dictation_daily_limit");
    const record = (c, outcome) => c.query(
      "insert into visit_note_dictations (clinic_id, note_id, doctor_id, scope, section, seconds, model, outcome, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [ctx.clinicId, n.id, n.doctor_id, scope, scope === "field" ? section : null, Math.min(1200, Math.max(0, Math.round(seconds))), s.dictation_model, outcome, now()]);
    const fail = async (outcome, err) => { await tx(ctx, (c) => record(c, outcome)); throw err; };

    // 1. Speech to text. The audio lives only in this request.
    const service = speech[s.speech_service];
    if (!service) return fail("failed", new HttpError(502, "speech_failed"));
    let heard;
    try { heard = String((await service.dictate({ audio, mime, section: scope === "field" ? section : null, languages: ["ar", "en"] })) ?? "").trim().slice(0, 20000); }
    catch (e) { log.error("dictation speech:", e?.message); return fail("failed", new HttpError(502, "speech_failed")); }
    if (!heard) return fail("nothing_heard", new HttpError(422, "nothing_heard"));

    // 2. Tidying (if the clinic chose a model). A field whose tidying fails still gets the words as heard.
    let parts, flags = [], tidyFailed = false;
    if (s.dictation_model === "none") parts = { [section]: heard };
    else {
      try {
        if (!tidier) throw new ScribeError("no_tidy_service");
        const out = checkTidy(await tidier.tidy({ model: s.dictation_model, scope, language: n.language, translate: s.dictation_translate,
          sections: n.sections, section: scope === "field" ? section : null, heard }), scope, n.sections);
        if (scope === "field") { parts = out.text ? { [section]: out.text } : {}; flags = out.flags.map((f) => ({ section, ...f })); }
        else { parts = out.parts; flags = out.flags; }
      } catch (e) {
        if (!(e instanceof ScribeError)) log.error("dictation tidy:", e?.message);
        if (scope !== "field") return fail("failed", new HttpError(502, "tidy_failed", { heard }));
        parts = { [section]: heard }; tidyFailed = true;
      }
    }
    if (!Object.keys(parts).length) return fail("nothing_heard", new HttpError(422, "nothing_heard", { heard }));

    // 3. Into the note, after what each field already holds.
    return tx(ctx, async (c) => {
      const cur = await noteRow(c, ctx, id, true);
      if (cur.status !== "draft") throw new HttpError(409, "not_a_draft");
      sameVersion(cur, expectedVersion);
      const content = { ...cur.content };
      for (const [k, v] of Object.entries(parts)) content[k] = appendTo(content[k], v);
      const kept = [...cur.flags, ...flags].filter((f, i, all) => all.findIndex((x) => x.section === f.section && x.text === f.text) === i)
        .filter((f) => (content[f.section] ?? "").includes(f.text));
      const r = await one(c, "update visit_notes set content = $2, flags = $3 where id = $1 returning *", [cur.id, JSON.stringify(content), JSON.stringify(kept)]);
      await record(c, "inserted");
      return { note: view(r, await additionsOf(c, cur.id)), heard, sections: Object.keys(parts), tidyFailed };
    });
  }

  // A dated addition under a signed note: the only way to change it.
  async function addition(ctx, id, { text }) {
    return tx(ctx, async (c) => {
      const n = await noteRow(c, ctx, id, true);
      theDoctor(ctx, n);
      if (n.status !== "signed") throw new HttpError(409, "not_signed");
      await c.query("insert into visit_note_additions (clinic_id, note_id, text, added_at, added_by, added_by_name) values ($1,$2,$3,$4,$5,$6)",
        [ctx.clinicId, n.id, text.trim(), now(), ctx.user.id, ctx.user.name]);
      return view(n, await additionsOf(c, n.id));
    });
  }

  // After a failure: try the draft again (the transcript or the audio is still there).
  async function retry(ctx, id) {
    return tx(ctx, async (c) => {
      const n = await noteRow(c, ctx, id, true);
      theDoctor(ctx, n);
      if (n.status !== "failed") throw new HttpError(409, "not_failed");
      if (!n.transcript && !(await audioFiles(audioDir, n.id)).length) throw new HttpError(409, "nothing_to_retry");
      return view(await one(c, "update visit_notes set status = 'processing', error = null, processing_started_at = null where id = $1 returning *", [n.id]));
    });
  }

  // "Write by hand" when the Scribe failed or is far too slow. The transcript stays beside it, if there is one.
  async function byHand(ctx, id) {
    const r = await tx(ctx, async (c) => {
      const n = await noteRow(c, ctx, id, true);
      theDoctor(ctx, n);
      if (!(n.status === "failed" || (n.status === "processing" && view(n).slow))) throw new HttpError(409, "not_failed");
      const empty = Object.fromEntries(n.sections.map((s) => [s.key, ""]));
      return one(c, "update visit_notes set status = 'draft', ai_drafted = false, content = $2, flags = '[]' where id = $1 returning *", [n.id, JSON.stringify(empty)]);
    });
    await removeAudio(audioDir, r.id).catch(() => {});
    return view(r);
  }

  // Throw away an unsigned note (started by mistake, or the patient changed their mind). Its words and audio go with it.
  async function discard(ctx, id) {
    const r = await tx(ctx, async (c) => {
      const n = await noteRow(c, ctx, id, true);
      theDoctor(ctx, n);
      if (n.status === "signed") throw new HttpError(409, "note_signed");
      if (n.status === "discarded") return n;
      return one(c, "update visit_notes set status = 'discarded', content = '{}', flags = '[]', transcript = null where id = $1 returning *", [n.id]);
    });
    await removeAudio(audioDir, r.id).catch(() => {});
    return { ok: true };
  }

  // The patient's page: one row per note, with its state. Never the content: that opens on the visit note screen.
  async function forPatient(ctx, patientId) {
    const p = await one(pool, `select p.id from patients p where p.clinic_id = $1 and p.id = $2 and ($3::uuid is null or exists (
      select 1 from appointments a where a.clinic_id = p.clinic_id and a.patient_id = p.id and a.doctor_id = $3 and a.status <> 'voided'))`,
      [ctx.clinicId, patientId, ctx.onlyDoctor ?? null]);
    if (!p) throw notFound("patient_not_found");
    const { rows } = await pool.query(
      `select n.id, n.appointment_id, n.kind, n.status, n.ai_drafted, n.signed_at, n.signed_name, a.starts_at,
              d.name_en as doctor_name_en, d.name_ar as doctor_name_ar, s.name_en as service_name_en, s.name_ar as service_name_ar,
              (select count(*) from visit_note_additions x where x.note_id = n.id)::int as additions
         from visit_notes n
         join appointments a on a.clinic_id = n.clinic_id and a.id = n.appointment_id
         join doctors d on d.clinic_id = n.clinic_id and d.id = n.doctor_id
         join services s on s.clinic_id = a.clinic_id and s.id = a.service_id
        where n.clinic_id = $1 and n.patient_id = $2 and n.status <> 'discarded' and ($3::uuid is null or n.doctor_id = $3)
        order by a.starts_at desc`, [ctx.clinicId, patientId, ctx.onlyDoctor ?? null]);
    return rows;
  }

  return { forVisit, start, saveChunk, alive, stop, save, dictate, sign, addition, retry, byHand, discard, forPatient };
}
