// What Booking shows from Records phase C on a booking (design: booking/design/records-phase-c.html §7): the treatment course
// line ("Laser course: session 4 of 6"), whether the booking's forms are filled (never the answers), and the forms link to send
// from the clinic's own WhatsApp. Booking reads only the columns migration 0023 allows. No HTTP in here.
import crypto from "node:crypto";
import { HttpError } from "./http.js";

const LIVE = ["booked", "confirmed", "completed"];

export function createVisitLines({ pool, tx, getAppointment, recordsUrl, now = () => new Date() }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];

  // The course a booking belongs to and its session number: the latest course of the service that had started by that day and not
  // ended before it; sessions are the live bookings of the service from the course's first day, in order (as Records counts them).
  async function courseOf(c, ctx, a) {
    const courses = (await c.query(
      `select t.id, t.sessions, t.areas, t.starts_on::text as starts_on, t.ended_at, s.name_en, s.name_ar from treatment_courses t join services s on s.id = t.service_id
        where t.clinic_id = $1 and t.patient_id = $2 and t.service_id = $3 order by t.starts_on, t.id`, [ctx.clinicId, a.patient_id, a.service_id])).rows;
    if (!courses.length) return null;
    const appts = (await c.query(
      `select a.id, a.starts_at, a.status, (a.starts_at at time zone cl.timezone)::date::text as day from appointments a join clinics cl on cl.id = a.clinic_id
        where a.clinic_id = $1 and a.patient_id = $2 and a.service_id = $3 order by a.starts_at`, [ctx.clinicId, a.patient_id, a.service_id])).rows;
    const placed = new Map(courses.map((x) => [x.id, []]));
    for (const x of appts) {
      if (!LIVE.includes(x.status)) continue;
      const home = courses.filter((k) => k.starts_on <= x.day && !(k.ended_at && new Date(k.ended_at) <= new Date(x.starts_at))).at(-1);
      if (home && placed.get(home.id).length < home.sessions) placed.get(home.id).push(x.id);
    }
    const list = (await one(c, "select photo_areas from record_settings where clinic_id = $1", [ctx.clinicId]))?.photo_areas ?? [];
    const names = (keys, l) => keys.map((k) => list.find((x) => x.key === k)?.[l] ?? k).join(l === "ar" ? "، " : ", ");
    for (const k of courses) {
      const n = placed.get(k.id).indexOf(a.id);
      if (n >= 0) return { n: n + 1, of: k.sessions, service_en: k.name_en, service_ar: k.name_ar, areas_en: names(k.areas, "en"), areas_ar: names(k.areas, "ar") };
    }
    return null;
  }

  async function formsFor(c, ctx, a) {
    const first = !(await one(c, "select 1 from appointments where clinic_id = $1 and patient_id = $2 and status = 'completed' and starts_at < $3 limit 1",
      [ctx.clinicId, a.patient_id, a.starts_at]));
    return (await c.query(
      `select id, minutes from form_templates where clinic_id = $1 and not hidden and (cardinality(service_ids) = 0 or $2 = any(service_ids))
          and (not first_visit_only or $3) order by sort, title_en`, [ctx.clinicId, a.service_id, first])).rows;
  }

  async function lines(ctx, id) {
    const a = await getAppointment(ctx, id);
    const s = await one(pool, "select courses_on, forms_on, rx_on from record_settings where clinic_id = $1", [ctx.clinicId]);
    if (!s || !recordsUrl) return { course: null, forms: null, rxOn: false };
    const course = s.courses_on ? await courseOf(pool, ctx, a) : null;
    let forms = null;
    if (s.forms_on) {
      const list = await formsFor(pool, ctx, a);
      if (list.length) {
        const filled = (await pool.query("select template_id from form_responses where appointment_id = $1", [a.id])).rows.map((r) => r.template_id);
        const link = await one(pool, "select created_at, sent_count, opened_at, expires_at from form_links where appointment_id = $1", [a.id]);
        forms = { total: list.length, filled: list.filter((f) => filled.includes(f.id)).length, link: link ?? null,
                  canSend: ["booked", "confirmed"].includes(a.status) && new Date(a.ends_at) > now() };
      }
    }
    return { course, forms, rxOn: !!s.rx_on };
  }

  // The same private link Records makes (sending again ends the old one), with the clinic's message in the patient's language.
  async function formLink(ctx, id) {
    if (!recordsUrl) throw new HttpError(409, "records_not_set_up");
    const a0 = await getAppointment(ctx, id);
    return tx(ctx, async (c) => {
      const s = await one(c, "select forms_on, form_link_hours, form_message_en, form_message_ar from record_settings where clinic_id = $1", [ctx.clinicId]);
      if (!s?.forms_on) throw new HttpError(409, "forms_off");
      const a = await one(c,
        `select a.*, p.phone_e164, p.preferred_language, cl.name_en as clinic_en, cl.name_ar as clinic_ar, cl.timezone, cl.default_language
           from appointments a join patients p on p.id = a.patient_id join clinics cl on cl.id = a.clinic_id where a.id = $1`, [a0.id]);
      if (!["booked", "confirmed"].includes(a.status) || new Date(a.ends_at) <= now()) throw new HttpError(409, "booking_not_open");
      const forms = await formsFor(c, ctx, a);
      if (!forms.length) throw new HttpError(409, "no_forms");
      const token = crypto.randomBytes(32).toString("base64url");
      const lang = a.preferred_language === "en" || a.preferred_language === "ar" ? a.preferred_language : a.default_language === "en" ? "en" : "ar";
      const expires = new Date(new Date(a.ends_at).getTime() + s.form_link_hours * 3600_000);
      await c.query(
        `insert into form_links (clinic_id, appointment_id, patient_id, token_hash, language, expires_at, created_at, created_by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (appointment_id) do update set token_hash = excluded.token_hash, language = excluded.language, expires_at = excluded.expires_at,
                created_at = excluded.created_at, created_by_name = excluded.created_by_name, sent_count = form_links.sent_count + 1, opened_at = null`,
        [ctx.clinicId, a.id, a.patient_id, crypto.createHash("sha256").update(token).digest("hex"), lang, expires, now(), ctx.user.name]);
      const url = `${recordsUrl}/f/${token}`;
      const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB",
        { timeZone: a.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(a.starts_at));
      const message = (lang === "ar" ? s.form_message_ar : s.form_message_en)
        .replaceAll("{clinic}", lang === "ar" ? a.clinic_ar : a.clinic_en).replaceAll("{date}", date)
        .replaceAll("{minutes}", String(forms.reduce((n, f) => n + f.minutes, 0))).replaceAll("{link}", url);
      const digits = (a.phone_e164 || "").replace(/\D/g, "");
      return { url, message, whatsapp: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null, expiresAt: expires.toISOString() };
    });
  }

  return { lines, formLink };
}
