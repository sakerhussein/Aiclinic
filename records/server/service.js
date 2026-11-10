// Records logic: the patient's chart. No HTTP in here.
// Every query is limited to the clinic of the signed-in person (ctx.clinicId), and every change runs in a transaction whose audit
// actor is that person. Who may see what is decided here, where the data is read, so no screen or link can get round it:
//   ctx.canDetails  the patient's details (date of birth, file number, insurance…): doctors, secretaries, administrators
//   ctx.canChart    the chart itself (allergies, medicines, conditions, timeline): doctors only
//   Settings › Chart › "Which doctors can open a chart": all of the clinic's patients, or only those booked with them.
// Every opening of a patient's record is written down (record_openings, and the audit trail).
import { HttpError, bad, notFound } from "./http.js";

export const KINDS = ["allergy", "medicine", "condition", "procedure", "family"];
const SHOW = { allergy: "show_allergies", medicine: "show_medicines", condition: "show_conditions", procedure: "show_procedures", family: "show_family" };
const DETAIL_FIELDS = ["birth_date", "sex", "national_id", "emergency_contact"];
// Dates of birth go out as "YYYY-MM-DD": as a timestamp they would shift a day with the time zone.
const DETAILS = "patient_id, clinic_id, file_no, birth_date::text as birth_date, sex, national_id, insurance, emergency_contact, updated_at, updated_by_name, row_version";

export function createService({ pool, now = () => new Date() }) {
  async function tx(ctx, fn) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select audit.set_actor('user',$1,$2,$3,$4,$5,$6,$7)",
        [ctx.user.id, ctx.user.name, ctx.ip ?? null, ctx.ua ?? null, ctx.requestId ?? null, ctx.reason ?? null, ctx.clinicId]);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      if (e.code === "23505" && /file_no/.test(e.constraint || e.message)) throw bad("file_no_taken");
      throw e;
    } finally { c.release(); }
  }
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];
  const conflict = (row) => new HttpError(409, "version_conflict", { rowVersion: row.row_version, updatedAt: row.updated_at, by: row.updated_by_name });

  // ---------------------------------------------------------------- settings (one row per clinic, made when the clinic is)
  async function settingsRow(c, clinicId, lock = false) {
    const s = await one(c, `select * from record_settings where clinic_id = $1${lock ? " for update" : ""}`, [clinicId]);
    if (!s) throw new HttpError(500, "settings_missing");
    return s;
  }
  const publicSettings = (s) => ({
    doctorsScope: s.doctors_scope, show: Object.fromEntries(KINDS.map((k) => [k, s[SHOW[k]]])), specialtyFields: s.specialty_fields,
    fileNumbers: s.file_numbers, nextFileNo: s.next_file_no, fileNoDigits: s.file_no_digits, requiredDetails: s.required_details,
  });

  async function lookups(ctx) {
    const clinic = await one(pool, "select id, slug, name_en, name_ar, timezone from clinics where id = $1", [ctx.clinicId]);
    const doctors = (await pool.query("select id, name_en, name_ar from doctors where clinic_id = $1 and active order by name_en", [ctx.clinicId])).rows;
    return { clinic, doctors, settings: publicSettings(await settingsRow(pool, ctx.clinicId)) };
  }

  // ---------------------------------------------------------------- who may be opened
  const onlyTreated = (ctx, s) => ctx.role === "doctor" && s.doctors_scope === "treated";
  async function allowedPatient(c, ctx, patientId, s) {
    const p = await one(c, "select id, full_name, phone_e164, preferred_language, created_at from patients where clinic_id = $1 and id = $2", [ctx.clinicId, patientId]);
    if (!p) throw notFound("patient_not_found");
    if (onlyTreated(ctx, s)) {
      const ok = ctx.doctorId && await one(c, "select 1 from appointments where clinic_id = $1 and patient_id = $2 and doctor_id = $3 and status <> 'voided' limit 1",
        [ctx.clinicId, patientId, ctx.doctorId]);
      if (!ok) throw notFound("patient_not_found");      // the same answer as "no such patient": nothing is given away
    }
    return p;
  }

  const like = (q) => q.replace(/[\\%_]/g, (m) => "\\" + m);
  async function listPatients(ctx, { q = "" }) {
    const s = await settingsRow(pool, ctx.clinicId);
    const text = q.trim(); const digits = text.replace(/\D/g, "");
    const { rows } = await pool.query(
      `select p.id, p.full_name, p.phone_e164, d.file_no, d.birth_date::text as birth_date, d.sex,
              (select max(a.starts_at) from appointments a where a.clinic_id = p.clinic_id and a.patient_id = p.id
                  and a.status in ('booked', 'confirmed', 'completed') and a.starts_at <= $3) as last_visit,
              (select min(a.starts_at) from appointments a where a.clinic_id = p.clinic_id and a.patient_id = p.id
                  and a.status in ('booked', 'confirmed') and a.starts_at > $3) as next_visit
         from patients p left join patient_details d on d.patient_id = p.id
        where p.clinic_id = $1
          and ($2 = '' or p.full_name ilike '%' || $2 || '%' or d.file_no ilike $2 || '%' or ($4 <> '' and p.phone_e164 like '%' || $4 || '%'))
          and ($5::uuid is null or exists (select 1 from appointments a where a.clinic_id = p.clinic_id and a.patient_id = p.id
                                            and a.doctor_id = $5 and a.status <> 'voided'))
        order by p.full_name nulls last limit 50`,
      [ctx.clinicId, like(text), now(), digits.length >= 3 ? digits : "", onlyTreated(ctx, s) ? (ctx.doctorId ?? "00000000-0000-0000-0000-000000000000") : null]);
    return rows;
  }

  // The doctor's patients for today (all doctors' for anyone not linked to one), in the clinic's own time zone.
  async function today(ctx) {
    const { rows } = await pool.query(
      `select a.id, a.starts_at, a.status, a.patient_id, a.doctor_id, p.full_name, pd.file_no, pd.birth_date::text as birth_date, pd.sex,
              s.name_en as service_en, s.name_ar as service_ar, d.name_en as doctor_en, d.name_ar as doctor_ar,
              (select count(*)::int from chart_entries e where e.clinic_id = a.clinic_id and e.patient_id = a.patient_id and e.error_at is null
                  and e.status = 'active' and (e.kind = 'allergy' or e.alert)) as alerts
         from appointments a join clinics c on c.id = a.clinic_id join patients p on p.id = a.patient_id
         join services s on s.id = a.service_id join doctors d on d.id = a.doctor_id
         left join patient_details pd on pd.patient_id = a.patient_id
        where a.clinic_id = $1 and a.status in ('booked', 'confirmed', 'completed')
          and (a.starts_at at time zone c.timezone)::date = ($2::timestamptz at time zone c.timezone)::date
          and ($3::uuid is null or a.doctor_id = $3)
        order by a.starts_at`, [ctx.clinicId, now(), ctx.doctorId ?? null]);
    return rows;
  }

  // ---------------------------------------------------------------- the chart
  async function timeline(c, ctx, patientId, entries) {
    const visits = (await c.query(
      `select a.id, a.starts_at, a.status, a.source, a.doctor_id, s.name_en as service_en, s.name_ar as service_ar,
              d.name_en as doctor_en, d.name_ar as doctor_ar, n.id as note_id, n.status as note_status, n.ai_drafted, n.kind as note_kind,
              n.signed_at, n.signed_name, n.doctor_id as note_doctor_id
         from appointments a join services s on s.id = a.service_id join doctors d on d.id = a.doctor_id
         left join visit_notes n on n.appointment_id = a.id and n.status <> 'discarded'
        where a.clinic_id = $1 and a.patient_id = $2 and a.status <> 'voided'
        order by a.starts_at desc limit 300`, [ctx.clinicId, patientId])).rows;
    const items = visits.map((v) => ({ type: "visit", at: v.starts_at, ...v }));
    for (const e of entries) {
      items.push({ type: "entry", at: e.created_at, id: e.id, kind: e.kind, title: e.title, by: e.created_by_name, source: e.source });
      if (e.error_at) items.push({ type: "error", at: e.error_at, id: e.id, kind: e.kind, title: e.title, by: e.error_by_name, reason: e.error_reason });
    }
    return items.sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  async function chart(ctx, patientId) {
    return tx(ctx, async (c) => {
      const s = await settingsRow(c, ctx.clinicId);
      const patient = await allowedPatient(c, ctx, patientId, s);
      const details = (await one(c, `select ${DETAILS} from patient_details where clinic_id = $1 and patient_id = $2`, [ctx.clinicId, patientId])) || null;
      await c.query("insert into record_openings (clinic_id, patient_id, user_id, user_name, role, opened_at) values ($1,$2,$3,$4,$5,$6)",
        [ctx.clinicId, patientId, ctx.user.id, ctx.user.name, ctx.role ?? null, now()]);
      const out = { patient, details, settings: publicSettings(s), chart: null };
      if (ctx.canChart) {
        const entries = (await c.query("select * from chart_entries where clinic_id = $1 and patient_id = $2 order by created_at", [ctx.clinicId, patientId])).rows;
        const answers = (await c.query("select field_key, value, updated_at, updated_by_name from chart_answers where clinic_id = $1 and patient_id = $2", [ctx.clinicId, patientId])).rows;
        out.chart = { entries, answers, timeline: await timeline(c, ctx, patientId, entries) };
      }
      return out;
    });
  }

  // Automatic file numbers: handed out the first time a patient's details are saved or the chart is written to.
  async function ensureFileNo(c, ctx, patientId, s) {
    const d = await one(c, "select file_no from patient_details where patient_id = $1", [patientId]);
    if (d?.file_no || s.file_numbers !== "auto") return;
    const locked = await settingsRow(c, ctx.clinicId, true);
    let n = locked.next_file_no, fileNo;
    for (;;) {                                         // skip numbers already typed by hand
      fileNo = String(n).padStart(locked.file_no_digits, "0");
      if (!(await one(c, "select 1 from patient_details where clinic_id = $1 and file_no = $2", [ctx.clinicId, fileNo]))) break;
      n += 1;
    }
    await c.query("update record_settings set next_file_no = $2 where clinic_id = $1", [ctx.clinicId, n + 1]);
    await c.query(
      `insert into patient_details (patient_id, clinic_id, file_no, updated_by_name) values ($1,$2,$3,$4)
       on conflict (patient_id) do update set file_no = excluded.file_no, updated_by_name = excluded.updated_by_name`,
      [patientId, ctx.clinicId, fileNo, ctx.user.name]);
  }

  async function updateDetails(ctx, patientId, b) {
    return tx(ctx, async (c) => {
      const s = await settingsRow(c, ctx.clinicId);
      await allowedPatient(c, ctx, patientId, s);
      const v = { birth_date: b.birthDate ?? null, sex: b.sex ?? null, national_id: b.nationalId?.trim() || null,
                  insurance: b.insurance?.trim() || null, emergency_contact: b.emergencyContact?.trim() || null };
      for (const f of s.required_details) if (DETAIL_FIELDS.includes(f) && !v[f]) throw bad("details_required", { field: f });
      if (v.birth_date && new Date(v.birth_date) > now()) throw bad("birth_date_in_future");
      const cur = await one(c, "select * from patient_details where patient_id = $1 for update", [patientId]);
      if (cur && b.expectedVersion !== undefined && b.expectedVersion !== null && cur.row_version !== b.expectedVersion) throw conflict(cur);
      const fileNo = s.file_numbers === "manual" ? (b.fileNo?.trim() || null) : cur?.file_no ?? null;
      if (cur) {
        await c.query(
          `update patient_details set file_no = $2, birth_date = $3, sex = $4, national_id = $5, insurance = $6, emergency_contact = $7, updated_by_name = $8
            where patient_id = $1`, [patientId, fileNo, v.birth_date, v.sex, v.national_id, v.insurance, v.emergency_contact, ctx.user.name]);
      } else {
        await c.query(
          `insert into patient_details (patient_id, clinic_id, file_no, birth_date, sex, national_id, insurance, emergency_contact, updated_by_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [patientId, ctx.clinicId, fileNo, v.birth_date, v.sex, v.national_id, v.insurance, v.emergency_contact, ctx.user.name]);
      }
      await ensureFileNo(c, ctx, patientId, s);
      return one(c, `select ${DETAILS} from patient_details where patient_id = $1`, [patientId]);
    });
  }

  // ---------------------------------------------------------------- chart entries: added, corrected, never deleted
  async function addEntry(ctx, patientId, b) {
    return tx(ctx, async (c) => {
      const s = await settingsRow(c, ctx.clinicId);
      await allowedPatient(c, ctx, patientId, s);
      if (!s[SHOW[b.kind]]) throw bad("kind_off");
      await ensureFileNo(c, ctx, patientId, s);
      return one(c,
        `insert into chart_entries (clinic_id, patient_id, kind, title, detail, status, alert, source, created_at, created_by, created_by_name)
         values ($1,$2,$3,$4,$5,$6,$7,'staff',$8,$9,$10) returning *`,
        [ctx.clinicId, patientId, b.kind, b.title.trim(), b.detail?.trim() || null, b.status ?? "active", b.kind === "allergy" ? true : !!b.alert,
         now(), ctx.user.id, ctx.user.name]);
    });
  }
  async function entryFor(c, ctx, id) {
    const e = await one(c, "select * from chart_entries where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
    if (!e) throw notFound("entry_not_found");
    await allowedPatient(c, ctx, e.patient_id, await settingsRow(c, ctx.clinicId));
    if (e.error_at) throw new HttpError(409, "entry_locked");
    return e;
  }
  async function updateEntry(ctx, id, b) {
    return tx(ctx, async (c) => {
      const e = await entryFor(c, ctx, id);
      if (e.row_version !== b.expectedVersion) throw conflict(e);
      return one(c, "update chart_entries set title = $2, detail = $3, status = $4, alert = $5, updated_by_name = $6 where id = $1 returning *",
        [id, b.title?.trim() ?? e.title, b.detail === undefined ? e.detail : (b.detail?.trim() || null), b.status ?? e.status,
         e.kind === "allergy" ? true : (b.alert ?? e.alert), ctx.user.name]);
    });
  }
  async function markError(ctx, id, b) {
    return tx(ctx, async (c) => {
      const e = await entryFor(c, ctx, id);
      if (e.row_version !== b.expectedVersion) throw conflict(e);
      return one(c, "update chart_entries set error_at = $2, error_by_name = $3, error_reason = $4, updated_by_name = $3 where id = $1 returning *",
        [id, now(), ctx.user.name, b.reason.trim()]);
    });
  }
  async function confirmEntry(ctx, id) {
    return tx(ctx, async (c) => {
      const e = await entryFor(c, ctx, id);
      if (e.source !== "patient" || e.confirmed_at) throw new HttpError(409, "nothing_to_confirm");
      return one(c, "update chart_entries set confirmed_at = $2, confirmed_by_name = $3, updated_by_name = $3 where id = $1 returning *", [id, now(), ctx.user.name]);
    });
  }

  // The clinic's specialty fields: the answer must fit the field (yes/no, one of the choices, or short text).
  async function setAnswer(ctx, patientId, key, value) {
    return tx(ctx, async (c) => {
      const s = await settingsRow(c, ctx.clinicId);
      await allowedPatient(c, ctx, patientId, s);
      const f = s.specialty_fields.find((x) => x.key === key);
      if (!f) throw bad("unknown_field");
      const val = String(value ?? "").trim();
      if (val && f.kind === "yesno" && !["yes", "no"].includes(val)) throw bad("invalid_value");
      if (val && f.kind === "choice" && !f.options.some((o) => o.en === val)) throw bad("invalid_value");
      if (val.length > 200) throw bad("invalid_value");
      return one(c,
        `insert into chart_answers (patient_id, clinic_id, field_key, value, updated_at, updated_by_name) values ($1,$2,$3,$4,$5,$6)
         on conflict (patient_id, field_key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by_name = excluded.updated_by_name
         returning field_key, value, updated_at, updated_by_name`, [patientId, ctx.clinicId, key, val, now(), ctx.user.name]);
    });
  }

  async function openings(ctx, patientId) {
    const p = await one(pool, "select 1 from patients where clinic_id = $1 and id = $2", [ctx.clinicId, patientId]);
    if (!p) throw notFound("patient_not_found");
    return (await pool.query("select user_name, role, opened_at from record_openings where clinic_id = $1 and patient_id = $2 order by opened_at desc limit 200",
      [ctx.clinicId, patientId])).rows;
  }

  // ---------------------------------------------------------------- settings
  async function getSettings(ctx) { return publicSettings(await settingsRow(pool, ctx.clinicId)); }
  async function updateSettings(ctx, b) {
    const keys = b.specialtyFields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) throw bad("duplicate_field");
    for (const f of b.specialtyFields) if (f.kind === "choice" && !f.options?.length) throw bad("choice_needs_options");
    return tx(ctx, async (c) => {
      await settingsRow(c, ctx.clinicId, true);
      await c.query(
        `update record_settings set doctors_scope = $2, show_allergies = $3, show_medicines = $4, show_conditions = $5, show_procedures = $6, show_family = $7,
                specialty_fields = $8, file_numbers = $9, next_file_no = $10, file_no_digits = $11, required_details = $12 where clinic_id = $1`,
        [ctx.clinicId, b.doctorsScope, b.show.allergy, b.show.medicine, b.show.condition, b.show.procedure, b.show.family,
         JSON.stringify(b.specialtyFields.map((f) => ({ key: f.key, en: f.en.trim(), ar: f.ar.trim(), kind: f.kind,
           ...(f.kind === "choice" ? { options: f.options.map((o) => ({ en: o.en.trim(), ar: o.ar.trim() })) } : {}) }))),
         b.fileNumbers, b.nextFileNo, b.fileNoDigits, b.requiredDetails]);
      return publicSettings(await settingsRow(c, ctx.clinicId));
    });
  }

  return { tx, lookups, listPatients, today, chart, updateDetails, addEntry, updateEntry, markError, confirmEntry, setAnswer, openings,
           getSettings, updateSettings };
}
