// Forms before the visit (Records, phase C; design: booking/design/records-phase-c.html §4–§6). No HTTP in here.
// The clinic's forms (Settings) go with a booking by service and first visit. A private link for that booking (only its hash is
// kept) opens them on the patient's phone, without sign-in, until some hours after the visit. What the patient sends is kept as it
// was, with a copy of the form's version; a signed consent also becomes a locked copy in Documents.
// Answers are never added to the chart by themselves: a list answer (allergy, medicine, condition) goes on the chart as
// "patient-reported" until a doctor confirms it, and an answer for a specialty field waits in the Forms tab for the doctor.
import crypto from "node:crypto";
import { HttpError, bad, notFound } from "./http.js";

// The same content whatever the key order (the database keeps JSON keys in its own order).
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((y) => [y, v[y]])) : v));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const LISTS = { allergy: "show_allergies", medicine: "show_medicines", condition: "show_conditions" };
const TEMPLATE = `id, title_en, title_ar, questions, consent, agree_en, agree_ar, first_visit_only, service_ids, minutes, version, hidden, sort,
  updated_at, updated_by_name, row_version`;

// The text of a question's answer, as it goes on the chart or into a specialty field.
function answerText(q, a, lang) {
  if (!a) return null;
  if (q.kind === "yesno" || q.kind === "yesno_details") return a.value === "yes" ? (a.details?.trim() || (lang === "ar" ? q.ar : q.en)) : null;
  if (q.kind === "choice") { const o = (q.options ?? []).find((x) => x.en === a.value); return o ? (lang === "ar" ? o.ar : o.en) : null; }
  return a.value?.trim() || null;
}

// The patient's answers, checked against the form as it is now.
export function checkAnswers(questions, answers) {
  const out = {};
  for (const q of questions) {
    const a = answers?.[q.key];
    const v = typeof a?.value === "string" ? a.value.trim() : "";
    if (!v) { if (q.required) throw bad("answer_required", { key: q.key }); continue; }
    if ((q.kind === "yesno" || q.kind === "yesno_details") && !["yes", "no"].includes(v)) throw bad("invalid_value", { key: q.key });
    if (q.kind === "choice" && !(q.options ?? []).some((o) => o.en === v)) throw bad("invalid_value", { key: q.key });
    if (q.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad("invalid_value", { key: q.key });
    if (v.length > 300) throw bad("invalid_value", { key: q.key });
    const details = q.kind === "yesno_details" && v === "yes" && typeof a.details === "string" ? a.details.trim().slice(0, 300) || null : null;
    out[q.key] = { value: v, ...(details ? { details } : {}) };
  }
  return out;
}

export function createForms({ pool, svc, files, siteUrl, now = () => new Date() }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];
  const conflict = (row) => new HttpError(409, "version_conflict", { rowVersion: row.row_version });

  // ---------------------------------------------------------------- the clinic's forms (Settings)
  async function templates(ctx) {
    return (await pool.query(`select ${TEMPLATE} from form_templates where clinic_id = $1 order by hidden, sort, title_en`, [ctx.clinicId])).rows;
  }
  // A change to the questions or the consent makes a new version; filled forms keep the version they were filled on.
  async function saveTemplate(ctx, id, b) {
    const keys = b.questions.map((q) => q.key);
    if (new Set(keys).size !== keys.length) throw bad("duplicate_field");
    for (const q of b.questions) if (q.kind === "choice" && !q.options?.length) throw bad("choice_needs_options");
    if (b.consent && (!b.agreeEn?.trim() || !b.agreeAr?.trim())) throw bad("consent_needs_text");
    return svc.tx(ctx, async (c) => {
      const s = await svc.settingsRow(c, ctx.clinicId);
      for (const q of b.questions) {
        if (q.goesTo?.startsWith("field:") && !s.specialty_fields.some((f) => `field:${f.key}` === q.goesTo)) throw bad("unknown_field");
      }
      if (b.serviceIds.length) {
        const n = (await one(c, "select count(*)::int as n from services where clinic_id = $1 and id = any($2::uuid[])", [ctx.clinicId, b.serviceIds])).n;
        if (n !== new Set(b.serviceIds).size) throw bad("unknown_service");
      }
      const qs = JSON.stringify(b.questions.map((q) => ({ key: q.key, en: q.en.trim(), ar: q.ar.trim(), kind: q.kind, required: !!q.required, goesTo: q.goesTo ?? null,
        ...(q.kind === "choice" ? { options: q.options.map((o) => ({ en: o.en.trim(), ar: o.ar.trim() })) } : {}) })));
      const vals = [b.titleEn.trim(), b.titleAr.trim(), qs, !!b.consent, b.consent ? b.agreeEn.trim() : null, b.consent ? b.agreeAr.trim() : null,
                    !!b.firstVisitOnly, b.serviceIds, b.minutes, b.hidden ?? false, b.sort ?? 0, ctx.user.name];
      // A new form goes last; an edited one keeps its place unless a place is given.
      if (!id) {
        if (b.sort === undefined) vals[10] = (await one(c, "select coalesce(max(sort), 0) + 1 as n from form_templates where clinic_id = $1", [ctx.clinicId])).n;
        return one(c, `insert into form_templates (clinic_id, title_en, title_ar, questions, consent, agree_en, agree_ar, first_visit_only, service_ids, minutes, hidden, sort, updated_by_name)
                       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning ${TEMPLATE}`, [ctx.clinicId, ...vals]);
      }
      const cur = await one(c, "select * from form_templates where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
      if (!cur) throw notFound("form_not_found");
      if (cur.row_version !== b.expectedVersion) throw conflict(cur);
      if (b.sort === undefined) vals[10] = cur.sort;
      const changed = canon(cur.questions) !== canon(JSON.parse(qs)) || cur.consent !== !!b.consent || (cur.agree_en ?? null) !== vals[4] || (cur.agree_ar ?? null) !== vals[5];
      return one(c,
        `update form_templates set title_en = $2, title_ar = $3, questions = $4, consent = $5, agree_en = $6, agree_ar = $7, first_visit_only = $8,
                service_ids = $9, minutes = $10, hidden = $11, sort = $12, updated_by_name = $13, version = version + $14, row_version = row_version + 1
          where id = $1 returning ${TEMPLATE}`, [id, ...vals, changed ? 1 : 0]);
    });
  }

  // ---------------------------------------------------------------- which forms go with a booking
  async function formsFor(c, clinicId, a) {
    const first = !(await one(c, "select 1 from appointments where clinic_id = $1 and patient_id = $2 and status = 'completed' and starts_at < $3 limit 1",
      [clinicId, a.patient_id, a.starts_at]));
    return (await c.query(
      `select ${TEMPLATE} from form_templates where clinic_id = $1 and not hidden and (cardinality(service_ids) = 0 or $2 = any(service_ids))
          and (not first_visit_only or $3) order by sort, title_en`, [clinicId, a.service_id, first])).rows;
  }

  // The patient's forms: what was filled (doctors read the answers; everyone else sees only that a form was filled), and their
  // coming bookings with the state of the link.
  async function forPatient(ctx, patientId) {
    return svc.tx(ctx, async (c) => {
      const s = await svc.settingsRow(c, ctx.clinicId);
      if (!s.forms_on) throw new HttpError(409, "forms_off");
      await svc.allowedPatient(c, ctx, patientId, s);
      const responses = (await c.query(
        `select r.id, r.appointment_id, r.template_id, r.version, r.title_en, r.title_ar, r.consent, r.submitted_at, r.copy_file_id, r.reviewed_at, r.reviewed_by_name,
                r.row_version, ${ctx.canChart ? "r.questions, r.answers, r.agree_text, r.signature, r.signed_name, r.language, r.pending" : "null as questions"}
           from form_responses r where r.clinic_id = $1 and r.patient_id = $2 order by r.submitted_at desc limit 100`, [ctx.clinicId, patientId])).rows;
      if (ctx.canChart) {
        const entries = (await c.query(
          `select id, kind, title, detail, form_response_id, confirmed_at, error_at, row_version from chart_entries
            where clinic_id = $1 and patient_id = $2 and form_response_id is not null`, [ctx.clinicId, patientId])).rows;
        for (const r of responses) r.entries = entries.filter((e) => e.form_response_id === r.id);
      }
      const coming = (await c.query(
        `select a.id, a.starts_at, a.ends_at, a.status, a.service_id, a.patient_id, s.name_en as service_en, s.name_ar as service_ar,
                l.created_at as link_at, l.sent_count, l.opened_at, l.expires_at
           from appointments a join services s on s.id = a.service_id left join form_links l on l.appointment_id = a.id
          where a.clinic_id = $1 and a.patient_id = $2 and a.status in ('booked', 'confirmed') and a.ends_at > $3 order by a.starts_at limit 5`,
        [ctx.clinicId, patientId, now()])).rows;
      for (const a of coming) {
        const forms = await formsFor(c, ctx.clinicId, a);
        const done = new Set(responses.filter((r) => r.appointment_id === a.id).map((r) => r.template_id));
        a.forms = forms.map((f) => ({ id: f.id, title_en: f.title_en, title_ar: f.title_ar, filled: done.has(f.id) }));
      }
      return { responses, coming };
    });
  }

  // A new private link for a booking (sending again makes a new one; the old stops working). The message holds no health
  // information: the clinic, the date and the link. Sent from the clinic's own WhatsApp for now (the approved Meta message later).
  async function makeLink(ctx, appointmentId) {
    if (!ctx.canFormsSend) throw new HttpError(403, "forbidden");
    return svc.tx(ctx, async (c) => {
      const s = await svc.settingsRow(c, ctx.clinicId);
      if (!s.forms_on) throw new HttpError(409, "forms_off");
      const a = await one(c,
        `select a.id, a.clinic_id, a.patient_id, a.service_id, a.doctor_id, a.starts_at, a.ends_at, a.status, p.phone_e164, p.preferred_language, cl.name_en as clinic_en, cl.name_ar as clinic_ar, cl.timezone, cl.default_language
           from appointments a join patients p on p.id = a.patient_id join clinics cl on cl.id = a.clinic_id where a.clinic_id = $1 and a.id = $2`,
        [ctx.clinicId, appointmentId]);
      if (!a) throw notFound("appointment_not_found");
      await svc.allowedPatient(c, ctx, a.patient_id, s);
      if (!["booked", "confirmed"].includes(a.status) || new Date(a.ends_at) <= now()) throw new HttpError(409, "booking_not_open");
      const forms = await formsFor(c, ctx.clinicId, a);
      if (!forms.length) throw new HttpError(409, "no_forms");
      return linkFor(c, ctx, s, a, forms);
    });
  }
  async function linkFor(c, ctx, s, a, forms) {
    const token = crypto.randomBytes(32).toString("base64url");
    const lang = a.preferred_language === "en" || a.preferred_language === "ar" ? a.preferred_language : a.default_language === "en" ? "en" : "ar";
    const expires = new Date(new Date(a.ends_at).getTime() + s.form_link_hours * 3600_000);
    await c.query(
      `insert into form_links (clinic_id, appointment_id, patient_id, token_hash, language, expires_at, created_at, created_by_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (appointment_id) do update set token_hash = excluded.token_hash, language = excluded.language, expires_at = excluded.expires_at,
              created_at = excluded.created_at, created_by_name = excluded.created_by_name, sent_count = form_links.sent_count + 1, opened_at = null`,
      [ctx.clinicId, a.id, a.patient_id, sha(token), lang, expires, now(), ctx.user.name]);
    const url = `${typeof siteUrl === "function" ? siteUrl() : siteUrl}/f/${token}`;
    const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB",
      { timeZone: a.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(a.starts_at));
    const minutes = forms.reduce((n, f) => n + f.minutes, 0);
    const message = (lang === "ar" ? s.form_message_ar : s.form_message_en)
      .replaceAll("{clinic}", lang === "ar" ? a.clinic_ar : a.clinic_en).replaceAll("{date}", date).replaceAll("{minutes}", String(minutes)).replaceAll("{link}", url);
    const digits = (a.phone_e164 || "").replace(/\D/g, "");
    return { url, message, whatsapp: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null, expiresAt: expires.toISOString(), forms: forms.length };
  }

  // ---------------------------------------------------------------- the patient's phone (no sign-in: the link is the key)
  async function byToken(c, token, lock = false) {
    if (typeof token !== "string" || token.length !== 43) throw new HttpError(410, "link_ended");
    const l = await one(c, `select * from form_links where token_hash = $1${lock ? " for update" : ""}`, [sha(token)]);
    if (!l || l.expires_at < now()) throw new HttpError(410, "link_ended");
    const a = await one(c, "select id, clinic_id, patient_id, service_id, doctor_id, starts_at, ends_at, status from appointments where id = $1", [l.appointment_id]);
    const s = await svc.settingsRow(c, l.clinic_id);
    if (!a || !["booked", "confirmed", "completed"].includes(a.status) || !s.forms_on) throw new HttpError(410, "link_ended");
    return { l, a, s };
  }
  const asPatient = (l, name) => ({ clinicId: l.clinic_id, user: { id: `patient:${l.patient_id}`, name: name || "Patient" }, role: "patient", reason: "form filled by the patient" });

  async function open(token) {
    const { l, a } = await byToken(pool, token);
    if (!l.opened_at) await pool.query("update form_links set opened_at = $2 where id = $1", [l.id, now()]);
    const info = await one(pool,
      `select cl.name_en as clinic_en, cl.name_ar as clinic_ar, cl.timezone, s.name_en as service_en, s.name_ar as service_ar, p.full_name
         from appointments a join clinics cl on cl.id = a.clinic_id join services s on s.id = a.service_id join patients p on p.id = a.patient_id where a.id = $1`, [a.id]);
    const forms = await formsFor(pool, l.clinic_id, a);
    const filled = (await pool.query("select template_id from form_responses where appointment_id = $1", [a.id])).rows.map((r) => r.template_id);
    return {
      language: l.language, clinic: { en: info.clinic_en, ar: info.clinic_ar, timezone: info.timezone }, service: { en: info.service_en, ar: info.service_ar },
      startsAt: a.starts_at, firstName: (info.full_name || "").split(/\s+/)[0] || null,
      forms: forms.map((f) => ({ id: f.id, title_en: f.title_en, title_ar: f.title_ar, questions: f.questions, consent: f.consent, agree_en: f.agree_en,
                                 agree_ar: f.agree_ar, minutes: f.minutes, version: f.version, filled: filled.includes(f.id) })),
    };
  }

  async function submit(token, formId, b) {
    const { l: l0 } = await byToken(pool, token);
    const name = (await one(pool, "select full_name from patients where id = $1", [l0.patient_id]))?.full_name;
    return svc.tx(asPatient(l0, name), async (c) => {
      const { l, a, s } = await byToken(c, token, true);
      const f = (await formsFor(c, l.clinic_id, a)).find((x) => x.id === formId);
      if (!f) throw notFound("form_not_found");
      if (await one(c, "select 1 from form_responses where appointment_id = $1 and template_id = $2", [a.id, f.id])) throw new HttpError(409, "already_filled");
      const answers = checkAnswers(f.questions, b.answers);
      if (f.consent && (!b.signature || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.signature) || !b.signedName?.trim())) throw bad("signature_needed");
      const lang = b.language === "en" ? "en" : "ar";
      // Answers for a specialty field wait for the doctor; list answers go on the chart as "patient-reported".
      const pending = f.questions.filter((q) => q.goesTo?.startsWith("field:") && answers[q.key]
        && s.specialty_fields.some((x) => `field:${x.key}` === q.goesTo)).map((q) => q.key);
      const r = await one(c,
        `insert into form_responses (clinic_id, patient_id, appointment_id, template_id, version, title_en, title_ar, questions, answers, consent, agree_text,
                                     signature, signed_name, language, submitted_at, pending)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
        [l.clinic_id, l.patient_id, a.id, f.id, f.version, f.title_en, f.title_ar, JSON.stringify(f.questions), JSON.stringify(answers), f.consent,
         f.consent ? (lang === "ar" ? f.agree_ar : f.agree_en) : null, f.consent ? b.signature : null, f.consent ? b.signedName.trim().slice(0, 120) : null,
         lang, now(), JSON.stringify(pending)]);
      for (const q of f.questions) {
        const list = LISTS[q.goesTo];
        const text = list && s[list] ? answerText(q, answers[q.key], lang) : null;
        if (!text) continue;
        await c.query(
          `insert into chart_entries (clinic_id, patient_id, kind, title, status, alert, source, created_at, created_by, created_by_name, form_response_id)
           values ($1,$2,$3,$4,'active',$5,'patient',$6,$7,$8,$9)`,
          [l.clinic_id, l.patient_id, q.goesTo, text.slice(0, 200), q.goesTo === "allergy", now(), `patient:${l.patient_id}`, name || "Patient", r.id]);
      }
      return { id: r.id, copy: f.consent };
    });
  }

  // The locked copy of a signed consent, drawn on the patient's phone right after sending (PNG), kept in Documents.
  async function copy(token, responseId, raw) {
    const { l: l0 } = await byToken(pool, token);
    const name = (await one(pool, "select full_name from patients where id = $1", [l0.patient_id]))?.full_name;
    return svc.tx(asPatient(l0, name), async (c) => {
      const { l, s } = await byToken(c, token, true);
      const r = await one(c, "select * from form_responses where id = $1 and appointment_id = $2 for update", [responseId, l.appointment_id]);
      if (!r || !r.consent) throw notFound("form_not_found");
      if (r.copy_file_id) throw new HttpError(409, "already_filled");
      if (now() - new Date(r.submitted_at) > 30 * 60_000) throw new HttpError(410, "link_ended");
      const kind = s.doc_kinds.find((k) => k.key === "consent_form") ?? null;
      if (!kind) return { stored: false };
      const ctx = asPatient(l, name);
      const day = (await one(c, "select ($2::timestamptz at time zone timezone)::date::text as d from clinics where id = $1", [l.clinic_id, r.submitted_at])).d;
      let f;
      try {
        f = await files.addFile(c, ctx, s, l.patient_id, { kind: "document", docKind: "consent_form", title: `${r.language === "ar" ? r.title_ar : r.title_en} · v${r.version}`, docDate: day },
          raw, { source: "form", by: { id: ctx.user.id, name: name || "Patient", role: "patient" } });
      } catch (e) {
        if (e?.code === "files_not_set_up") return { stored: false };
        throw e;
      }
      if (f.mime !== "image/png") throw bad("file_type_not_allowed");
      await c.query("update form_responses set copy_file_id = $2 where id = $1", [r.id, f.id]);
      return { stored: true };
    });
  }

  // ---------------------------------------------------------------- the doctor goes through the answers
  async function responseFor(c, ctx, id) {
    if (!ctx.canChartWrite) throw new HttpError(403, "forbidden");
    const r = await one(c, "select * from form_responses where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
    if (!r) throw notFound("form_not_found");
    const s = await svc.settingsRow(c, ctx.clinicId);
    await svc.allowedPatient(c, ctx, r.patient_id, s);
    return { r, s };
  }
  async function settle(c, ctx, r, pending) {
    const open = (await one(c, "select count(*)::int as n from chart_entries where form_response_id = $1 and confirmed_at is null and error_at is null", [r.id])).n;
    const done = !pending.length && !open;
    return one(c, `update form_responses set pending = $2, reviewed_at = $3, reviewed_by_name = $4 where id = $1
                   returning id, pending, reviewed_at, reviewed_by_name, row_version`,
      [r.id, JSON.stringify(pending), done ? (r.reviewed_at ?? now()) : null, done ? (r.reviewed_by_name ?? ctx.user.name) : null]);
  }
  // A specialty-field answer: saved into the field (as written, or changed first), or set aside.
  async function field(ctx, id, key, value) {
    return svc.tx(ctx, async (c) => {
      const { r } = await responseFor(c, ctx, id);
      if (!r.pending.includes(key)) throw new HttpError(409, "nothing_to_confirm");
      if (value !== null) {
        const q = r.questions.find((x) => x.key === key);
        await svc.setAnswerIn(c, ctx, r.patient_id, q.goesTo.slice(6), value);
      }
      return settle(c, ctx, r, r.pending.filter((k) => k !== key));
    });
  }
  // After a list answer was confirmed or set aside on the chart: the form is marked gone through when nothing is left.
  async function refresh(ctx, id) {
    return svc.tx(ctx, async (c) => { const { r } = await responseFor(c, ctx, id); return settle(c, ctx, r, r.pending); });
  }

  return { templates, saveTemplate, forPatient, makeLink, open, submit, copy, field, refresh, formsFor };
}
