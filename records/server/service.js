// Records logic: the patient's chart. No HTTP in here.
// Every query is limited to the clinic of the signed-in person (ctx.clinicId), and every change runs in a transaction whose audit
// actor is that person. Who may see what is decided here, where the data is read, so no screen or link can get round it:
//   ctx.canDetails  the patient's details (date of birth, file number, insurance…): doctors, secretaries, administrators
//   ctx.canChart    the chart itself (allergies, medicines, conditions, timeline): doctors only
//   Settings › Chart › "Which doctors can open a chart": all of the clinic's patients, or only those booked with them.
// Insurance: an answer (not asked yet / no insurance / insured) and, when insured, a company from the clinic's own list (or a name
// typed by staff when it is not on the list). Companies are hidden, never deleted.
// Every opening of a patient's record is written down (record_openings, and the audit trail).
import { HttpError, bad, notFound } from "./http.js";

export const KINDS = ["allergy", "medicine", "condition", "procedure", "family"];
const SHOW = { allergy: "show_allergies", medicine: "show_medicines", condition: "show_conditions", procedure: "show_procedures", family: "show_family" };
const DETAIL_FIELDS = ["birth_date", "sex", "national_id", "emergency_contact"];
// Dates of birth go out as "YYYY-MM-DD": as a timestamp they would shift a day with the time zone.
const DETAILS = `patient_id, clinic_id, file_no, birth_date::text as birth_date, sex, national_id, insurance, insurance_status, insurance_company_id,
  emergency_name, emergency_relation, emergency_phone, updated_at, updated_by_name, row_version`;
// A company's card, as staff see it (the patient's insurer).
const CARD = "id, name_en, name_ar, phone, email, address, contact_name, contact_title, contact_phone, contact_email, notes, hidden";
const COMPANY_FIELDS = ["name_en", "name_ar", "phone", "email", "address", "contact_name", "contact_title", "contact_phone", "contact_email", "notes"];
const camel = (k) => k.replace(/_([a-z])/g, (_, x) => x.toUpperCase());

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
      if (e.code === "23505" && /insurance_companies_name/.test(e.constraint || e.message)) throw bad("company_exists");
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
    insuranceInBooking: s.insurance_in_booking, insuranceRequired: s.insurance_required,
    relations: s.relations, photoAreas: s.photo_areas, docKinds: s.doc_kinds, photoConsentRequired: s.photo_consent_required,
    maxFileMb: s.max_file_mb, linkMinutes: s.link_minutes, phoneMinutes: s.phone_minutes,
    // Phase C: before and after the visit.
    coursesOn: s.courses_on, courseAreaRequired: s.course_area_required, courseDefaults: s.course_defaults, rxOn: s.rx_on, rxValidDays: s.rx_valid_days, rxPaper: s.rx_paper, rxFavourites: s.rx_favourites,
    formsOn: s.forms_on, formLinkHours: s.form_link_hours, formMessageEn: s.form_message_en, formMessageAr: s.form_message_ar,
    summaryModel: s.summary_model, summaryDaily: s.summary_daily,
  });

  async function lookups(ctx) {
    const clinic = await one(pool, "select id, slug, name_en, name_ar, timezone from clinics where id = $1", [ctx.clinicId]);
    const doctors = (await pool.query("select id, name_en, name_ar from doctors where clinic_id = $1 and active order by name_en", [ctx.clinicId])).rows;
    const services = (await pool.query("select id, name_en, name_ar from services where clinic_id = $1 order by name_en", [ctx.clinicId])).rows;
    return { clinic, doctors, services, settings: publicSettings(await settingsRow(pool, ctx.clinicId)) };
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
                  and e.status = 'active' and (e.kind = 'allergy' or e.alert)) as alerts,
              -- results added by someone else that wait for the doctor's review
              (select count(*)::int from record_files f join record_settings rs on rs.clinic_id = f.clinic_id
                where f.clinic_id = a.clinic_id and f.patient_id = a.patient_id and f.kind = 'document' and f.reviewed_at is null and f.error_at is null
                  and exists (select 1 from jsonb_array_elements(rs.doc_kinds) k where k ->> 'key' = f.doc_kind and (k ->> 'review')::boolean)) as to_review
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
    // Photos and documents: photos of one area on one day are one line; each document is its own.
    const files = (await c.query(
      `select f.id, f.kind, f.area_key, f.doc_kind, f.title, f.created_at, f.created_by_name, (f.created_at at time zone cl.timezone)::date::text as local_day
         from record_files f join clinics cl on cl.id = f.clinic_id where f.clinic_id = $1 and f.patient_id = $2 and f.error_at is null order by created_at`,
      [ctx.clinicId, patientId])).rows;
    const groups = new Map();
    for (const f of files) {
      if (f.kind === "document") { items.push({ type: "document", at: f.created_at, id: f.id, docKind: f.doc_kind, title: f.title, by: f.created_by_name }); continue; }
      const g = groups.get(`${f.local_day}|${f.area_key}`);
      if (g) g.count += 1; else groups.set(`${f.local_day}|${f.area_key}`, { type: "photos", at: f.created_at, id: f.id, area: f.area_key, count: 1, by: f.created_by_name });
    }
    items.push(...groups.values());
    return items.sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  async function chart(ctx, patientId) {
    return tx(ctx, async (c) => {
      const s = await settingsRow(c, ctx.clinicId);
      const patient = await allowedPatient(c, ctx, patientId, s);
      const details = (await one(c, `select ${DETAILS} from patient_details where clinic_id = $1 and patient_id = $2`, [ctx.clinicId, patientId])) || null;
      await c.query("insert into record_openings (clinic_id, patient_id, user_id, user_name, role, opened_at) values ($1,$2,$3,$4,$5,$6)",
        [ctx.clinicId, patientId, ctx.user.id, ctx.user.name, ctx.role ?? null, now()]);
      // The clinic's companies for the Details form (hidden ones too: a patient may still have one), and the patient's company card.
      const companies = (await c.query("select id, name_en, name_ar, hidden from insurance_companies where clinic_id = $1 order by lower(name_en)", [ctx.clinicId])).rows;
      const insurer = details?.insurance_company_id
        ? (await one(c, `select ${CARD} from insurance_companies where clinic_id = $1 and id = $2`, [ctx.clinicId, details.insurance_company_id])) || null : null;
      const out = { patient, details, settings: publicSettings(s), companies, insurer, chart: null };
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
                  insurance: b.insurance?.trim() || null, emergency_name: b.emergencyName?.trim() || null,
                  emergency_relation: b.emergencyRelation || null, emergency_phone: b.emergencyPhone?.trim() || null };
      // The emergency contact is complete with a name and a phone; the relationship comes from the clinic's list.
      v.emergency_contact = v.emergency_name && v.emergency_phone ? "yes" : null;
      if (v.emergency_relation && !s.relations.some((r) => r.key === v.emergency_relation)) throw bad("invalid_value");
      for (const f of s.required_details) if (DETAIL_FIELDS.includes(f) && !v[f]) throw bad("details_required", { field: f });
      if (v.birth_date && new Date(v.birth_date) > now()) throw bad("birth_date_in_future");
      const cur = await one(c, "select * from patient_details where patient_id = $1 for update", [patientId]);
      if (cur && b.expectedVersion !== undefined && b.expectedVersion !== null && cur.row_version !== b.expectedVersion) throw conflict(cur);
      // Insurance: when insured, a company from the list (a hidden one only if the patient already has it) or a typed name.
      v.insurance_status = b.insuranceStatus ?? cur?.insurance_status ?? "unknown";
      if (s.insurance_required && v.insurance_status === "unknown") throw bad("details_required", { field: "insurance" });
      v.insurance_company_id = null;
      if (v.insurance_status !== "insured") v.insurance = null;
      else {
        const companyId = b.insuranceCompanyId === undefined ? cur?.insurance_company_id ?? null : b.insuranceCompanyId;
        if (companyId) {
          const co = await one(c, "select id, hidden from insurance_companies where clinic_id = $1 and id = $2", [ctx.clinicId, companyId]);
          if (!co || (co.hidden && co.id !== cur?.insurance_company_id)) throw bad("insurance_company_unknown");
          v.insurance_company_id = co.id; v.insurance = null;
        } else if (!v.insurance) throw bad("insurance_company_needed");
      }
      const fileNo = s.file_numbers === "manual" ? (b.fileNo?.trim() || null) : cur?.file_no ?? null;
      if (cur) {
        await c.query(
          `update patient_details set file_no = $2, birth_date = $3, sex = $4, national_id = $5, insurance = $6, updated_by_name = $7,
                  insurance_status = $8, insurance_company_id = $9, emergency_name = $10, emergency_relation = $11, emergency_phone = $12
            where patient_id = $1`, [patientId, fileNo, v.birth_date, v.sex, v.national_id, v.insurance, ctx.user.name,
                                   v.insurance_status, v.insurance_company_id, v.emergency_name, v.emergency_relation, v.emergency_phone]);
      } else {
        await c.query(
          `insert into patient_details (patient_id, clinic_id, file_no, birth_date, sex, national_id, insurance, updated_by_name,
                                       insurance_status, insurance_company_id, emergency_name, emergency_relation, emergency_phone)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [patientId, ctx.clinicId, fileNo, v.birth_date, v.sex, v.national_id, v.insurance,
                                                       ctx.user.name, v.insurance_status, v.insurance_company_id, v.emergency_name, v.emergency_relation, v.emergency_phone]);
      }
      await ensureFileNo(c, ctx, patientId, s);
      const saved = await one(c, `select ${DETAILS} from patient_details where patient_id = $1`, [patientId]);
      // The company's card comes back too, so the page can show it under the name without opening the record again.
      const insurer = saved.insurance_company_id ? await one(c, `select ${CARD} from insurance_companies where id = $1`, [saved.insurance_company_id]) : null;
      return { ...saved, insurer };
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
    return tx(ctx, (c) => setAnswerIn(c, ctx, patientId, key, value));
  }
  async function setAnswerIn(c, ctx, patientId, key, value) {
    {
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
    }
  }

  async function openings(ctx, patientId) {
    const p = await one(pool, "select 1 from patients where clinic_id = $1 and id = $2", [ctx.clinicId, patientId]);
    if (!p) throw notFound("patient_not_found");
    // A file opened shows its kind only (photo, or the kind of document), never its title.
    return (await pool.query(
      `select o.user_name, o.role, o.opened_at, o.what, f.kind as file_kind, f.doc_kind, f.area_key from record_openings o left join record_files f on f.id = o.file_id
        where o.clinic_id = $1 and o.patient_id = $2 order by o.opened_at desc limit 200`, [ctx.clinicId, patientId])).rows;
  }

  // ---------------------------------------------------------------- settings
  async function getSettings(ctx) { return publicSettings(await settingsRow(pool, ctx.clinicId)); }
  async function updateSettings(ctx, b) {
    const keys = b.specialtyFields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) throw bad("duplicate_field");
    for (const f of b.specialtyFields) if (f.kind === "choice" && !f.options?.length) throw bad("choice_needs_options");
    for (const list of [b.relations, b.photoAreas, b.docKinds]) if (list && new Set(list.map((x) => x.key)).size !== list.length) throw bad("duplicate_field");
    return tx(ctx, async (c) => {
      // An area or a kind of document in use can't be removed (the photos, documents and treatment courses keep pointing at it).
      for (const [list, col, kind] of [[b.photoAreas, "area_key", "photo"], [b.docKinds, "doc_kind", "document"]]) {
        if (!list) continue;
        const used = (await c.query(`select distinct ${col} as k from record_files where clinic_id = $1 and kind = $2`, [ctx.clinicId, kind])).rows.map((r) => r.k);
        if (kind === "photo") used.push(...(await c.query("select distinct unnest(areas) as k from treatment_courses where clinic_id = $1", [ctx.clinicId])).rows.map((r) => r.k));
        const gone = used.filter((k) => !list.some((x) => x.key === k));
        if (gone.length) throw bad("in_use", { keys: gone });
      }
      await settingsRow(c, ctx.clinicId, true);
      await c.query(
        `update record_settings set doctors_scope = $2, show_allergies = $3, show_medicines = $4, show_conditions = $5, show_procedures = $6, show_family = $7,
                specialty_fields = $8, file_numbers = $9, next_file_no = $10, file_no_digits = $11, required_details = $12,
                insurance_in_booking = coalesce($13, insurance_in_booking), insurance_required = coalesce($14, insurance_required),
                relations = coalesce($15, relations), photo_areas = coalesce($16, photo_areas), doc_kinds = coalesce($17, doc_kinds),
                photo_consent_required = coalesce($18, photo_consent_required), max_file_mb = coalesce($19, max_file_mb),
                link_minutes = coalesce($20, link_minutes), phone_minutes = coalesce($21, phone_minutes) where clinic_id = $1`,
        [ctx.clinicId, b.doctorsScope, b.show.allergy, b.show.medicine, b.show.condition, b.show.procedure, b.show.family,
         JSON.stringify(b.specialtyFields.map((f) => ({ key: f.key, en: f.en.trim(), ar: f.ar.trim(), kind: f.kind,
           ...(f.kind === "choice" ? { options: f.options.map((o) => ({ en: o.en.trim(), ar: o.ar.trim() })) } : {}) }))),
         b.fileNumbers, b.nextFileNo, b.fileNoDigits, b.requiredDetails, b.insuranceInBooking ?? null, b.insuranceRequired ?? null,
         b.relations ? JSON.stringify(b.relations) : null, b.photoAreas ? JSON.stringify(b.photoAreas) : null, b.docKinds ? JSON.stringify(b.docKinds) : null,
         b.photoConsentRequired ?? null, b.maxFileMb ?? null, b.linkMinutes ?? null, b.phoneMinutes ?? null]);
      return publicSettings(await settingsRow(c, ctx.clinicId));
    });
  }

  // Settings › Before and after the visit (phase C): each part on or off, and its numbers.
  async function updateVisitSettings(ctx, b) {
    return tx(ctx, async (c) => {
      await settingsRow(c, ctx.clinicId, true);
      if (b.courseDefaults.length) {
        const ids = b.courseDefaults.map((x) => x.serviceId);
        if (new Set(ids).size !== ids.length) throw bad("duplicate_field");
        const n = (await one(c, "select count(*)::int as n from services where clinic_id = $1 and id = any($2::uuid[])", [ctx.clinicId, ids])).n;
        if (n !== ids.length) throw bad("unknown_service");
      }
      await c.query(
        `update record_settings set courses_on = $2, course_defaults = $3, rx_on = $4, rx_valid_days = $5, rx_paper = $6, rx_favourites = $7, forms_on = $8,
                form_link_hours = $9, form_message_en = $10, form_message_ar = $11, summary_model = $12, summary_daily = $13, course_area_required = $14
          where clinic_id = $1`,
        [ctx.clinicId, b.coursesOn, JSON.stringify(b.courseDefaults), b.rxOn, b.rxValidDays, b.rxPaper,
         JSON.stringify(b.rxFavourites.map((f) => ({ name: f.name.trim(), how: f.how?.trim() || "", days: f.days ?? null, qty: f.qty?.trim() || "" }))),
         b.formsOn, b.formLinkHours, b.formMessageEn.trim(), b.formMessageAr.trim(), b.summaryModel, b.summaryDaily, b.courseAreaRequired]);
      return publicSettings(await settingsRow(c, ctx.clinicId));
    });
  }

  // ---------------------------------------------------------------- insurance companies (Settings › Chart)
  // The list with how many patients have each, and the names staff typed that are not on the list yet.
  async function insurers(ctx) {
    const companies = (await pool.query(
      `select ${CARD}, row_version, (select count(*)::int from patient_details d where d.clinic_id = c.clinic_id and d.insurance_company_id = c.id) as patients
         from insurance_companies c where clinic_id = $1 order by hidden, lower(name_en)`, [ctx.clinicId])).rows;
    const typed = (await pool.query(
      `select min(insurance) as name, count(*)::int as patients from patient_details
        where clinic_id = $1 and insurance_status = 'insured' and insurance_company_id is null and insurance is not null
        group by lower(btrim(insurance)) order by count(*) desc, min(insurance) limit 50`, [ctx.clinicId])).rows;
    return { companies, typed };
  }
  const companyValues = (b) => COMPANY_FIELDS.map((k) => (typeof b[camel(k)] === "string" ? b[camel(k)].trim() || null : null));
  // fromTyped: a name staff typed; the patients who have it are moved onto the new company.
  async function addInsurer(ctx, b) {
    return tx(ctx, async (c) => {
      const co = await one(c,
        `insert into insurance_companies (clinic_id, ${COMPANY_FIELDS.join(", ")}, updated_by_name)
         values ($1, ${COMPANY_FIELDS.map((_, i) => "$" + (i + 2)).join(", ")}, $${COMPANY_FIELDS.length + 2}) returning id`,
        [ctx.clinicId, ...companyValues(b), ctx.user.name]);
      if (b.fromTyped) {
        await c.query(
          `update patient_details set insurance_company_id = $2, insurance = null, updated_by_name = $4
            where clinic_id = $1 and insurance_status = 'insured' and insurance_company_id is null and lower(btrim(insurance)) = lower(btrim($3))`,
          [ctx.clinicId, co.id, b.fromTyped, ctx.user.name]);
      }
      return one(c, `select ${CARD}, row_version from insurance_companies where id = $1`, [co.id]);
    });
  }
  // Changes the card, or only hides / shows it again (no names given).
  async function updateInsurer(ctx, id, b) {
    return tx(ctx, async (c) => {
      const cur = await one(c, "select * from insurance_companies where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
      if (!cur) throw notFound("company_not_found");
      if (cur.row_version !== b.expectedVersion) throw conflict(cur);
      const vals = b.nameEn === undefined ? COMPANY_FIELDS.map((k) => cur[k]) : companyValues(b);
      return one(c,
        `update insurance_companies set ${COMPANY_FIELDS.map((k, i) => `${k} = $${i + 2}`).join(", ")},
                hidden = $${COMPANY_FIELDS.length + 2}, updated_by_name = $${COMPANY_FIELDS.length + 3}
          where id = $1 returning ${CARD}, row_version`, [id, ...vals, b.hidden ?? cur.hidden, ctx.user.name]);
    });
  }

  // The numbers beside the chart's tabs: how many this person can see, and how many wait for them (results to review, forms to go
  // through, their own prescriptions not printed yet). A separate call, so counting again never adds an opening of the record.
  async function tabCounts(ctx, patientId) {
    const s = await settingsRow(pool, ctx.clinicId);
    await allowedPatient(pool, ctx, patientId, s);
    const kind = (k) => s.doc_kinds.find((x) => x.key === k);
    const files = (await pool.query("select kind, doc_kind, reviewed_at from record_files where clinic_id = $1 and patient_id = $2 and error_at is null",
      [ctx.clinicId, patientId])).rows;
    const docs = files.filter((f) => f.kind === "document" && (ctx.canChart || (ctx.canDetails && !!kind(f.doc_kind)?.secretary)));
    const out = {
      photos: ctx.canPhotos ? { total: files.filter((f) => f.kind === "photo").length, waiting: 0 } : null,
      docs: { total: docs.length, waiting: ctx.canChart ? docs.filter((f) => !f.reviewed_at && kind(f.doc_kind)?.review).length : 0 },
      rx: null, forms: null,
    };
    if (ctx.canChart && s.rx_on) out.rx = await one(pool,
      `select count(*)::int as total, count(*) filter (where status = 'draft' and doctor_id = $3)::int as waiting
         from prescriptions where clinic_id = $1 and patient_id = $2 and error_at is null`,
      [ctx.clinicId, patientId, ctx.doctorId ?? "00000000-0000-0000-0000-000000000000"]);
    if (s.forms_on) {
      const r = await one(pool, "select count(*)::int as total, count(*) filter (where reviewed_at is null)::int as waiting from form_responses where clinic_id = $1 and patient_id = $2",
        [ctx.clinicId, patientId]);
      out.forms = { total: r.total, waiting: ctx.canChart ? r.waiting : 0 };
    }
    return out;
  }

  return { tx, settingsRow, allowedPatient, lookups, listPatients, today, chart, tabCounts, updateDetails, addEntry, updateEntry, markError, confirmEntry, setAnswer, setAnswerIn, openings,
           getSettings, updateSettings, updateVisitSettings, insurers, addInsurer, updateInsurer };
}
