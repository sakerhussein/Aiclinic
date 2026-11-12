// Booking logic: availability, appointments, patients, history. No HTTP in here.
// Every query is limited to the clinic of the signed-in person (ctx.clinicId), and every change runs in a transaction whose
// audit actor is that person, so the audit trail says who did it.
// ctx.onlyDoctor: a doctor sees and handles only their own bookings, and only patients with a booking with them. That limit lives in
// here, where the data is read, so no screen or link can get round it.
import { HttpError, bad, denied, notFound } from "./http.js";
import { createSettings } from "./settings.js";
import { createAudit } from "./audit.js";
import { bookingsFile, patientsFile, todayIn, MAX_EXPORT_ROWS } from "./export.js";
import { freeStarts, MIN } from "./slots.js";
import { createNotes } from "./notes.js";
import { createVisitLines } from "./visit-lines.js";
import { createOnlineVisits, TEAMS_RE } from "./online-visits.js";

const ACTIVE = ["booked", "confirmed"];

export function normalizePhone(raw, country = "962") {
  const digits = String(raw ?? "").replace(/[\s\-().]/g, "");
  let n;
  if (digits.startsWith("+")) n = digits.slice(1);
  else if (digits.startsWith("00")) n = digits.slice(2);
  else if (digits.startsWith("0")) n = country + digits.slice(1);
  else n = digits;
  if (!/^[1-9][0-9]{6,14}$/.test(n)) throw bad("invalid_phone");
  return "+" + n;
}

export function createService({ pool, auditPool, now = () => new Date(), audioDir, speech, tidier, recordsUrl = "", mail = null }) {
  // ---------------------------------------------------------------- transactions with an audit actor
  async function tx(ctx, fn) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select audit.set_actor('user',$1,$2,$3,$4,$5,$6,$7)",
        [ctx.user.id, ctx.user.name, ctx.ip ?? null, ctx.ua ?? null, ctx.requestId ?? null, ctx.reason ?? null, ctx.clinicId]);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];

  // ---------------------------------------------------------------- lookups
  async function lookups(ctx) {
    const clinic = await one(pool, `select id, slug, name_en, name_ar, timezone, slot_step_minutes, default_language, week_start from clinics where id = $1`, [ctx.clinicId]);
    const doctors = (await pool.query(
      `select d.id, d.name_en, d.name_ar, d.title_en, d.title_ar, d.gender, d.online_enabled, d.online_min_notice_minutes, (d.teams_link is not null) as has_teams_link,
              coalesce((select array_agg(ds.service_id) from doctor_services ds where ds.doctor_id = d.id), '{}') as service_ids,
              coalesce((select json_agg(json_build_object('weekday', w.weekday, 'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI')) order by w.weekday, w.start_time)
                          from working_hours w where w.doctor_id = d.id), '[]') as hours
         from doctors d where d.clinic_id = $1 and d.active order by d.name_en`, [ctx.clinicId])).rows;
    const services = (await pool.query(
      `select id, name_en, name_ar, duration_minutes, price_jod, price_is_from, online_allowed from services where clinic_id = $1 and active order by sort, name_en`, [ctx.clinicId])).rows;
    const openingHours = (await pool.query(
      `select weekday, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as "end" from clinic_hours where clinic_id = $1 order by weekday, start_time`, [ctx.clinicId])).rows;
    // Visit notes (Settings > AI Scribe): whether the booking page offers "Start visit note" at all.
    const notesEnabled = !!(await one(pool, "select enabled from scribe_settings where clinic_id = $1", [ctx.clinicId]))?.enabled;
    // Online visits (Settings › Online visits): what the booking form, the booking page and the calendar need.
    const ov = await one(pool, `select enabled, mode, staff_change_mode, link_when, channels, default_channel, next_visit_days, join_opens_minutes
                                  from online_visits where clinic_id = $1`, [ctx.clinicId]);
    const online = ov ? { enabled: ov.enabled, mode: ov.mode, staffChangeMode: ov.staff_change_mode, linkWhen: ov.link_when, channels: ov.channels,
                          defaultChannel: ov.default_channel, nextVisitDays: ov.next_visit_days, joinOpensMinutes: ov.join_opens_minutes, mailReady: !!mail } : { enabled: false };
    return { clinic, doctors, services, openingHours, rules: await staffRules(pool, ctx), notesEnabled, online };
  }

  // Closures and leave touching one local day, for the calendar.
  // Closures and leave touching the days from `day` to `to` (one day, or a week for the week view).
  async function timeOffOn(ctx, day, to = day) {
    const { rows } = await pool.query(
      `select o.id, o.doctor_id, o.starts_at, o.ends_at, o.reason from time_off o join clinics c on c.id = o.clinic_id
        where o.clinic_id = $1 and o.starts_at < (($4::date + 1)::timestamp at time zone c.timezone) and o.ends_at > ($2::date::timestamp at time zone c.timezone)
          and ($3::uuid is null or o.doctor_id is null or o.doctor_id = $3)`, [ctx.clinicId, day, ctx.onlyDoctor ?? null, to]);
    return rows;
  }

  // The calendar's "today" line: today's counts (a doctor's own, or the clinic's) and the next free time today.
  async function todayLine(ctx) {
    const clinic = await clinicRow(pool, ctx);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: clinic.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
    const c = await one(pool,
      `select count(*) filter (where a.status not in ('cancelled', 'voided'))::int as booked,
              count(*) filter (where a.status in ('booked', 'confirmed') and ((a.needs_check and a.checked_at is null) or a.moved_online_at is not null and a.status = 'booked'))::int as not_checked,
              count(*) filter (where a.status = 'completed')::int as completed,
              count(*) filter (where a.status = 'no_show')::int as no_show,
              count(*) filter (where a.status in ('booked', 'confirmed', 'completed') and a.visit_type = 'online')::int as online
         from appointments a join clinics c on c.id = a.clinic_id
        where a.clinic_id = $1 and (a.starts_at at time zone c.timezone)::date = $2::date and ($3::uuid is null or a.doctor_id = $3)`,
      [ctx.clinicId, today, ctx.onlyDoctor ?? null]);
    // The next free time: the earliest start left today for the clinic's shortest service.
    const shortest = await one(pool, "select id from services where clinic_id = $1 and active order by duration_minutes, sort limit 1", [ctx.clinicId]);
    let nextFree = null;
    if (shortest) {
      const free = await slots(ctx, { serviceId: shortest.id, doctorId: ctx.onlyDoctor ?? undefined, from: today }).catch(() => []);
      nextFree = free.find((s) => Date.parse(s.startsAt) > now().getTime())?.startsAt ?? null;
    }
    return { date: today, booked: c.booked, notChecked: c.not_checked, completed: c.completed, noShow: c.no_show, online: c.online, nextFree };
  }

  // The rules for staff, from Settings -> Booking rules (the WhatsApp assistant reads the "patient" row).
  async function staffRules(c, ctx) {
    const r = await one(c, "select * from booking_rules where clinic_id = $1 and audience = 'staff'", [ctx.clinicId]);
    return { minNoticeMinutes: r.min_notice_minutes, windowDays: r.window_days, changeNoticeMinutes: r.change_notice_minutes, maxUpcoming: r.max_upcoming,
             outsideHours: r.outside_hours, walkinBackMinutes: r.walkin_back_minutes, requireCancelReason: r.require_cancel_reason };
  }

  // ---------------------------------------------------------------- availability (the rule itself is in slots.js)

  async function clinicRow(c, ctx) {
    return one(c, "select id, timezone, slot_step_minutes from clinics where id = $1", [ctx.clinicId]);
  }
  async function serviceRow(c, ctx, id) {
    const s = await one(c, "select id, duration_minutes from services where clinic_id = $1 and id = $2 and active", [ctx.clinicId, id]);
    if (!s) throw bad("unknown_service");
    return s;
  }
  async function doctorsFor(c, ctx, serviceId, doctorId) {
    const { rows } = await c.query(
      `select d.id, d.name_en, d.online_enabled, d.online_min_notice_minutes from doctors d join doctor_services ds on ds.doctor_id = d.id and ds.service_id = $2
        where d.clinic_id = $1 and d.active and ($3::uuid is null or d.id = $3::uuid) order by d.name_en`, [ctx.clinicId, serviceId, doctorId ?? null]);
    if (!rows.length) throw bad("doctor_does_not_offer_service");
    return rows;
  }

  // Free start times of a service for one doctor or all who offer it.
  async function slots(ctx, { serviceId, doctorId, from, days = 1 }) {
    const clinic = await clinicRow(pool, ctx), service = await serviceRow(pool, ctx, serviceId);
    const docs = await doctorsFor(pool, ctx, serviceId, doctorId);
    const t0 = now().getTime(), rules = await staffRules(pool, ctx);
    const dayTo = new Date(Date.parse(from + "T00:00:00Z") + (Math.min(days, 31) - 1) * 86400000).toISOString().slice(0, 10);
    const out = [];
    for (const d of docs) {
      const starts = await freeStarts(pool, clinic, d.id, service.duration_minutes, from, dayTo,
        { earliest: t0 + rules.minNoticeMinutes * MIN, latest: t0 + rules.windowDays * 86400000 });
      for (const t of starts) out.push({ doctorId: d.id, startsAt: new Date(t).toISOString(), endsAt: new Date(t + service.duration_minutes * MIN).toISOString() });
    }
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  // ---------------------------------------------------------------- reading appointments
  const SELECT = `select a.id, a.doctor_id, a.service_id, a.patient_id, a.starts_at, a.ends_at, a.status, a.source, a.cancel_reason, a.internal_note,
      a.row_version, a.created_at, a.updated_at, a.updated_by, a.created_by, a.voided_at, a.void_reason,
      p.full_name as patient_name, p.phone_e164 as patient_phone, p.whatsapp_reminders,
      d.name_en as doctor_name_en, d.name_ar as doctor_name_ar, s.name_en as service_name_en, s.name_ar as service_name_ar,
      s.duration_minutes, s.price_jod,
      a.online_from, a.booked_name, a.booked_for_other, a.needs_check, a.checked_at, a.checked_by,
      (a.needs_check and a.checked_at is null) as unchecked,
      a.moved_online_at, (a.moved_online_at is not null and a.status = 'booked') as moved_by_patient,
      (a.booked_name is not null and lower(trim(a.booked_name)) is distinct from lower(trim(p.full_name))) as name_differs,
      vn.status as note_status, (vn.status = 'signed' and not vn.ai_drafted) as note_by_hand,
      a.visit_type, a.online_mode, a.link_channel, a.link_email, a.meeting_url, a.online_consent_at, a.online_consent_version,
      a.identity_checked_at, a.identity_checked_by_name, a.next_online, a.next_online_mode, a.next_online_by_name, a.next_online_at, a.next_online_used_by,
      (select u.starts_at from appointments u where u.id = a.next_online_used_by) as next_online_used_at,
      p.email as patient_email, p.preferred_language, d.online_enabled as doctor_online, (d.teams_link is not null) as doctor_has_link, s.online_allowed as service_online,
      case when a.visit_type = 'online' then coalesce(a.meeting_url, d.teams_link) end as join_url
    from appointments a
    join patients p on p.clinic_id = a.clinic_id and p.id = a.patient_id
    join doctors d on d.clinic_id = a.clinic_id and d.id = a.doctor_id
    join services s on s.clinic_id = a.clinic_id and s.id = a.service_id
    left join visit_notes vn on vn.appointment_id = a.id and vn.status <> 'discarded'`;

  async function listAppointments(ctx, q, limit = 500) {
    const where = ["a.clinic_id = $1"], p = [ctx.clinicId];
    const add = (sql, v) => { p.push(v); where.push(sql.replace("?", `$${p.length}`)); };
    if (ctx.onlyDoctor) add("a.doctor_id = ?", ctx.onlyDoctor);
    const tz = "(select timezone from clinics where id = a.clinic_id)";
    if (q.from) add(`a.starts_at >= (?::date)::timestamp at time zone ${tz}`, q.from);
    if (q.to) add(`a.starts_at < ((?::date) + 1)::timestamp at time zone ${tz}`, q.to);
    if (q.doctorId) add("a.doctor_id = ?", q.doctorId);
    if (q.patientId) add("a.patient_id = ?", q.patientId);
    if (q.source) add("a.source = ?", q.source);
    if (q.visit) add("a.visit_type = ?", q.visit);
    // Online bookings waiting for the clinic: the person not checked yet, or a new time chosen by the patient not confirmed yet.
    if (q.unchecked) where.push("((a.needs_check and a.checked_at is null and a.status in ('booked','confirmed')) or (a.moved_online_at is not null and a.status = 'booked'))");
    // Visit note (AI Scribe): none yet, not signed (recording, making the draft, draft, failed), or signed.
    if (q.note === "none") where.push("vn.id is null");
    else if (q.note === "unsigned") where.push("vn.status in ('recording', 'processing', 'draft', 'failed')");
    else if (q.note === "signed") where.push("vn.status = 'signed'");
    if (q.status) add("a.status = ?::appointment_status", q.status); else if (!q.includeVoided) where.push("a.status <> 'voided'");
    if (q.q) { p.push(`%${q.q.replace(/[%_\\]/g, "\\$&")}%`); where.push(`(p.full_name ilike $${p.length} or p.phone_e164 like $${p.length})`); }
    const { rows } = await pool.query(`${SELECT} where ${where.join(" and ")} order by a.starts_at, d.name_en limit ${Number(limit)}`, p);
    return rows;
  }
  async function getAppointment(ctx, id, c = pool) {
    const row = await one(c, `${SELECT} where a.clinic_id = $1 and a.id = $2 and ($3::uuid is null or a.doctor_id = $3)`, [ctx.clinicId, id, ctx.onlyDoctor ?? null]);
    if (!row) throw notFound("appointment_not_found");
    return row;
  }

  // The audit trail of one booking: who did what, when, from where. Read through the audit login, which only sees this clinic.
  async function history(ctx, id) {
    await getAppointment(ctx, id);
    if (!auditPool) return [];
    const c = await auditPool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.clinic_id', $1, true)", [ctx.clinicId]);
      const { rows } = await c.query(
        `select at, actor_type, actor_label, action, changed_fields, reason, before, after from audit.events
          where chain_key = $1 and entity = 'appointment' and entity_id = $2 order by seq`, [ctx.clinicId, id]);
      await c.query("commit");
      return rows;
    } finally { c.release(); }
  }

  // ---------------------------------------------------------------- patients
  async function patientRow(c, ctx, id) {
    const r = await one(c, "select * from patients where clinic_id = $1 and id = $2", [ctx.clinicId, id]);
    if (!r) throw notFound("patient_not_found");
    return r;
  }
  // A patient this person may open: for a doctor, one with a booking with them. A voided booking was a mistake, so it does not count.
  async function visiblePatient(c, ctx, id) {
    const r = await one(c, `select p.* from patients p where p.clinic_id = $1 and p.id = $2 and ($3::uuid is null or exists (
      select 1 from appointments a where a.clinic_id = p.clinic_id and a.patient_id = p.id and a.doctor_id = $3 and a.status <> 'voided'))`, [ctx.clinicId, id, ctx.onlyDoctor ?? null]);
    if (!r) throw notFound("patient_not_found");
    return r;
  }
  // The insurance line from Records (Settings › Chart › "Show the insurance line in Booking"), with the company's card.
  // null: the clinic switched the line off, or Records has nothing for this patient yet. Only these columns are readable here.
  async function insurance(ctx, id) {
    await visiblePatient(pool, ctx, id);
    const s = await one(pool, "select insurance_in_booking from record_settings where clinic_id = $1", [ctx.clinicId]);
    if (!s?.insurance_in_booking) return { on: false, status: null };
    const d = await one(pool, "select insurance_status, insurance_company_id, insurance from patient_details where clinic_id = $1 and patient_id = $2", [ctx.clinicId, id]);
    const company = d?.insurance_company_id ? await one(pool,
      `select id, name_en, name_ar, phone, email, address, contact_name, contact_title, contact_phone, contact_email, notes, hidden
         from insurance_companies where clinic_id = $1 and id = $2`, [ctx.clinicId, d.insurance_company_id]) : null;
    return { on: true, status: d?.insurance_status ?? "unknown", company: company ?? null, other: d?.insurance ?? null };
  }
  async function createPatient(ctx, b, c) {
    const phone = b.phone ? normalizePhone(b.phone) : null;
    const run = async (cc) => {
      if (phone) {
        const ex = await one(cc, "select id, full_name from patients where clinic_id = $1 and phone_e164 = $2", [ctx.clinicId, phone]);
        if (ex) throw new HttpError(409, "patient_exists", ctx.onlyDoctor ? { patientId: ex.id } : { patientId: ex.id, fullName: ex.full_name });
      }
      return one(cc, `insert into patients (clinic_id, full_name, phone_e164, preferred_language, whatsapp_reminders, email)
                      values ($1,$2,$3,$4,$5,$6) returning *`, [ctx.clinicId, b.fullName.trim(), phone, b.language ?? null, !!(b.whatsappReminders && phone), b.email?.trim().toLowerCase() || null]);
    };
    return c ? run(c) : tx(ctx, run);
  }
  async function updatePatient(ctx, id, b) {
    return tx(ctx, async (c) => {
      const cur = await visiblePatient(c, ctx, id);
      const phone = b.phone === undefined ? cur.phone_e164 : b.phone ? normalizePhone(b.phone) : null;
      if (phone && phone !== cur.phone_e164) {
        const ex = await one(c, "select id from patients where clinic_id = $1 and phone_e164 = $2 and id <> $3", [ctx.clinicId, phone, id]);
        if (ex) throw new HttpError(409, "patient_exists", { patientId: ex.id });
      }
      // "Can book online visits" (the profile mark) remembers who set it and when; the doctor or staff change it here.
      const allowed = b.onlineAllowed ?? cur.online_allowed, markChanged = allowed !== cur.online_allowed;
      return one(c, `update patients set full_name = $3, phone_e164 = $4, preferred_language = $5, whatsapp_reminders = $6, email = $7,
                        online_allowed = $8, online_mode = $9,
                        online_allowed_by = case when $10 then (case when $8 then $11::uuid end) else online_allowed_by end,
                        online_allowed_by_name = case when $10 then (case when $8 then $12 end) else online_allowed_by_name end,
                        online_allowed_at = case when $10 then (case when $8 then now() end) else online_allowed_at end
                      where clinic_id = $1 and id = $2 returning *`,
        [ctx.clinicId, id, b.fullName?.trim() ?? cur.full_name, phone, b.language === undefined ? cur.preferred_language : b.language,
         phone ? (b.whatsappReminders ?? cur.whatsapp_reminders) : false, b.email === undefined ? cur.email : b.email?.trim().toLowerCase() || null,
         allowed, b.onlineMode === undefined ? cur.online_mode : b.onlineMode, markChanged, ctx.user.id, ctx.user.name]);
    });
  }
  async function searchPatients(ctx, q, limit = 50) {
    const like = `%${String(q || "").replace(/[%_\\]/g, "\\$&")}%`;
    const { rows } = await pool.query(
      `select p.id, p.full_name, p.phone_e164, p.preferred_language, p.whatsapp_reminders,
              (select max(a.starts_at) from appointments a where a.patient_id = p.id and a.clinic_id = p.clinic_id and a.status in ('completed','booked','confirmed')
                  and ($3::uuid is null or a.doctor_id = $3)) as last_visit
         from patients p where p.clinic_id = $1 and ($2 = '%%' or p.full_name ilike $2 or p.phone_e164 like $2)
          and ($3::uuid is null or exists (select 1 from appointments a where a.clinic_id = p.clinic_id and a.patient_id = p.id and a.doctor_id = $3 and a.status <> 'voided'))
        order by p.full_name nulls last limit ${Number(limit)}`, [ctx.clinicId, like, ctx.onlyDoctor ?? null]);
    return rows;
  }
  async function getPatient(ctx, id) {
    const p = await visiblePatient(pool, ctx, id);
    const appts = await listAppointments(ctx, { patientId: id, includeVoided: true });
    // A doctor's "next follow-up can be online" not used yet: shown on the profile next to the standing mark.
    const next = appts.filter((a) => a.next_online && !a.next_online_used_by && a.status !== "voided")
      .sort((x, y) => String(y.next_online_at).localeCompare(String(x.next_online_at)))[0] ?? null;
    return { patient: p, appointments: appts.reverse(),
             nextOnline: next && { appointmentId: next.id, byName: next.next_online_by_name, at: next.next_online_at, mode: next.next_online_mode, visitAt: next.starts_at } };
  }

  // ---------------------------------------------------------------- creating and changing bookings
  function checkTime(rules, startsAt, source) {
    const t = startsAt.getTime(), n = now().getTime();
    if (t > n + rules.windowDays * 86400000) throw bad("too_far_ahead");
    const back = source === "walkin" ? rules.walkinBackMinutes * MIN : 0;
    if (t < n - back - 5 * MIN) throw bad("in_the_past");     // a few minutes of grace for a form left open
    if (source !== "walkin" && rules.minNoticeMinutes && t < n + rules.minNoticeMinutes * MIN) throw bad("too_soon");
  }
  // Staff may be limited too (default: no limit). A walk-in in the room is not "changing an appointment".
  function checkChangeNotice(rules, startsAt) {
    if (rules.changeNoticeMinutes && startsAt.getTime() - now().getTime() < rules.changeNoticeMinutes * MIN) throw new HttpError(409, "too_late_to_change");
  }

  // The chosen time is one of the free times, or an "other time": what happens then is the clinic's Staff rule
  // (block it, warn and ask for a confirmation, or allow it). Returns true for an other time.
  async function checkFree(c, ctx, clinic, rules, doctorId, service, startsAt, override, excludeId) {
    const dayBefore = new Date(startsAt.getTime() - 86400000).toISOString().slice(0, 10);
    const dayAfter = new Date(startsAt.getTime() + 86400000).toISOString().slice(0, 10);
    const free = await freeStarts(c, clinic, doctorId, service.duration_minutes, dayBefore, dayAfter,
      { earliest: -Infinity, latest: Infinity, excludeId });
    if (free.includes(startsAt.getTime())) return false;
    if (rules.outsideHours === "block") throw new HttpError(409, "outside_hours_blocked");
    if (rules.outsideHours === "warn" && !override) throw new HttpError(409, "not_a_free_time", { warning: "outside_hours_or_grid" });
    return true;
  }

  // Everything that changes a booking comes through here, which is why a doctor who can manage bookings still reaches only their own.
  async function lockAppointment(c, ctx, id) {
    const cur = await one(c, "select * from appointments where clinic_id = $1 and id = $2 and ($3::uuid is null or doctor_id = $3) for update", [ctx.clinicId, id, ctx.onlyDoctor ?? null]);
    if (!cur) throw notFound("appointment_not_found");
    return cur;
  }

  // ---------------------------------------------------------------- online visits (Settings › Online visits)
  // An online booking needs online visits on, a service offered online and a doctor who offers them. Staff are only warned inside
  // the doctor's "earliest online booking" (allowInsideBuffer books anyway); patients on the page can't book there at all.
  async function onlineCheck(c, ctx, b, serviceId) {
    const v = await one(c, "select * from online_visits where clinic_id = $1", [ctx.clinicId]);
    if (!v?.enabled) throw new HttpError(409, "online_visits_off");
    if (!(await one(c, "select online_allowed from services where clinic_id = $1 and id = $2", [ctx.clinicId, serviceId]))?.online_allowed) throw bad("service_not_online");
    if (b.meetingUrl && !TEAMS_RE.test(b.meetingUrl)) throw bad("invalid_teams_link");
    if (b.linkChannel && (b.linkChannel === "sms" || !v.channels.includes(b.linkChannel))) throw bad("channel_off");
    return v;
  }
  function checkOnlineBuffer(doctor, startsAt, allow) {
    if (!allow && doctor.online_min_notice_minutes && startsAt.getTime() < now().getTime() + doctor.online_min_notice_minutes * MIN) {
      throw new HttpError(409, "inside_online_buffer", { minutes: doctor.online_min_notice_minutes });
    }
  }
  // Video or audio: the most specific setting wins (the doctor's "next follow-up" tick, then the patient's profile, then the clinic).
  // Staff may choose for one booking when Settings allows it; "patient chooses" falls back to what staff picked, or audio.
  async function onlineMode(c, ctx, v, patientId, asked) {
    const p = patientId ? await one(c, "select online_mode from patients where clinic_id = $1 and id = $2", [ctx.clinicId, patientId]) : null;
    const tick = patientId ? await pendingTick(c, ctx, patientId) : null;
    const chosen = tick?.next_online_mode ?? p?.online_mode ?? v.mode;
    if (v.staff_change_mode && asked) return asked;
    return chosen === "patient" ? asked ?? "audio" : chosen;
  }
  const pendingTick = (c, ctx, patientId, except = null) => one(c,
    `select id, next_online_mode from appointments where clinic_id = $1 and patient_id = $2 and next_online and next_online_used_by is null
        and status <> 'voided' and ($3::uuid is null or id <> $3) order by next_online_at desc nulls last limit 1`, [ctx.clinicId, patientId, except]);
  // The doctor's one-time tick is used up by the next online booking of that patient.
  async function useTick(c, ctx, patientId, newId) {
    const t = await pendingTick(c, ctx, patientId, newId);
    if (t) await c.query("update appointments set next_online_used_by = $2 where id = $1", [t.id, newId]);
  }

  async function createAppointment(ctx, input) {
    if (ctx.onlyDoctor && input.doctorId !== "any" && input.doctorId !== ctx.onlyDoctor) throw denied("own_bookings_only");
    const b = ctx.onlyDoctor ? { ...input, doctorId: ctx.onlyDoctor } : input;
    const startsAt = new Date(b.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw bad("invalid_time");
    return tx(ctx, async (c) => {
      const rules = await staffRules(c, ctx);
      checkTime(rules, startsAt, b.source);
      const clinic = await clinicRow(c, ctx), service = await serviceRow(c, ctx, b.serviceId);
      const isOnline = b.visitType === "online";
      const ov = isOnline ? await onlineCheck(c, ctx, b, b.serviceId) : null;
      let docs = await doctorsFor(c, ctx, b.serviceId, b.doctorId === "any" ? null : b.doctorId);
      if (isOnline) { docs = docs.filter((d) => d.online_enabled); if (!docs.length) throw bad("doctor_not_online"); }
      let doctor = null, other = false;
      for (const d of docs) {                                  // "any available": the first doctor with this time free
        try { other = await checkFree(c, ctx, clinic, rules, d.id, service, startsAt, b.override, null); doctor = d; break; }
        catch (e) { if (!(e instanceof HttpError) || docs.length === 1 || b.doctorId !== "any") throw e; }
      }
      if (!doctor) throw new HttpError(409, "slot_unavailable");
      if (isOnline) checkOnlineBuffer(doctor, startsAt, b.allowInsideBuffer);
      let patientId = b.patientId;
      if (b.newPatient) patientId = (await createPatient(ctx, b.newPatient, c)).id;
      else await patientRow(c, ctx, patientId);      // any patient of the clinic: a doctor reaches an existing one from "this phone number exists"
      const mode = isOnline ? await onlineMode(c, ctx, ov, patientId, b.onlineMode) : null;
      const email = isOnline && b.linkChannel === "email" ? (b.linkEmail?.trim().toLowerCase()
        || (await one(c, "select email from patients where id = $1", [patientId]))?.email) : null;
      if (isOnline && b.linkChannel === "email" && !email) throw bad("email_needed");
      const dup = await one(c, `select 1 from appointments where patient_id = $1 and status in ('booked','confirmed') and starts_at < $3 and ends_at > $2`,
        [patientId, startsAt, new Date(startsAt.getTime() + service.duration_minutes * MIN)]);
      if (dup) throw new HttpError(409, "patient_already_booked_then");
      if (rules.maxUpcoming && !b.allowOverLimit) {           // for staff this is a warning, not a wall
        const { n } = await one(c, "select count(*)::int n from appointments where patient_id = $1 and status in ('booked','confirmed') and ends_at > $2", [patientId, now()]);
        if (n >= rules.maxUpcoming) throw new HttpError(409, "over_max_upcoming", { limit: rules.maxUpcoming });
      }
      try {
        const r = await one(c, `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source, internal_note, created_by, updated_by,
            visit_type, online_mode, link_channel, link_email, meeting_url)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14) returning id`,
          [ctx.clinicId, doctor.id, b.serviceId, patientId, startsAt, new Date(startsAt.getTime() + service.duration_minutes * MIN), b.source, b.internalNote || null, ctx.user.id,
           isOnline ? "online" : "in_clinic", mode, isOnline ? b.linkChannel ?? ov.default_channel : null, email, isOnline ? b.meetingUrl?.trim() || null : null]);
        if (isOnline) await useTick(c, ctx, patientId, r.id);
        return { ...(await getAppointment(ctx, r.id, c)), outside_hours: other };
      } catch (e) {
        if (e.constraint === "no_overlapping_appointments") throw new HttpError(409, "slot_taken");
        throw e;
      }
    });
  }

  function conflict(cur) {
    return new HttpError(409, "version_conflict", { currentVersion: cur.row_version, changedAt: cur.updated_at, changedByStaff: !!cur.updated_by, status: cur.status });
  }

  // Move or edit an active booking. The save is refused if somebody else changed it meanwhile (expectedVersion).
  async function updateAppointment(ctx, id, b) {
    return tx(ctx, async (c) => {
      const cur = await lockAppointment(c, ctx, id);
      if (ctx.onlyDoctor && b.doctorId && b.doctorId !== ctx.onlyDoctor) throw denied("own_bookings_only");
      if (cur.row_version !== b.expectedVersion) throw conflict(cur);
      if (!ACTIVE.includes(cur.status)) throw new HttpError(409, "not_editable");
      const serviceId = b.serviceId ?? cur.service_id, doctorId = b.doctorId ?? cur.doctor_id;
      const startsAt = b.startsAt ? new Date(b.startsAt) : cur.starts_at;
      const service = await serviceRow(c, ctx, serviceId);
      await doctorsFor(c, ctx, serviceId, doctorId);
      const moved = +startsAt !== +cur.starts_at || serviceId !== cur.service_id || doctorId !== cur.doctor_id;
      if (moved) {
        const rules = await staffRules(c, ctx);
        checkChangeNotice(rules, cur.starts_at);
        checkTime(rules, startsAt, cur.source);
        await checkFree(c, ctx, await clinicRow(c, ctx), rules, doctorId, service, startsAt, b.override, id);
      }
      const patientId = b.patientId ?? cur.patient_id;
      if (patientId !== cur.patient_id) await visiblePatient(c, ctx, patientId);
      // Online or at the clinic. Becoming online (or moving an online visit) follows the same rules as a new online booking.
      const visitType = b.visitType ?? cur.visit_type, isOnline = visitType === "online", becameOnline = isOnline && cur.visit_type !== "online";
      let mode = null, channel = null, email = null, meetingUrl = null;
      if (isOnline) {
        const ov = await onlineCheck(c, ctx, b, serviceId);
        const doc = (await doctorsFor(c, ctx, serviceId, doctorId))[0];
        if (!doc.online_enabled) throw bad("doctor_not_online");
        if (moved || becameOnline) checkOnlineBuffer(doc, startsAt, b.allowInsideBuffer);
        mode = b.onlineMode ?? (becameOnline ? await onlineMode(c, ctx, ov, patientId, null) : cur.online_mode);
        if (!ov.staff_change_mode && b.onlineMode && b.onlineMode !== cur.online_mode && !becameOnline) mode = cur.online_mode;
        channel = b.linkChannel ?? cur.link_channel ?? ov.default_channel;
        email = b.linkEmail === undefined ? cur.link_email : b.linkEmail?.trim().toLowerCase() || null;
        if (channel === "email" && !email) email = (await one(c, "select email from patients where id = $1", [patientId]))?.email ?? null;
        if (channel === "email" && !email) throw bad("email_needed");
        meetingUrl = b.meetingUrl === undefined ? cur.meeting_url : b.meetingUrl?.trim() || null;
      }
      try {
        await c.query(`update appointments set doctor_id=$3, service_id=$4, patient_id=$5, starts_at=$6, ends_at=$7, internal_note=$8, updated_by=$9,
                          visit_type=$10, online_mode=$11, link_channel=$12, link_email=$13, meeting_url=$14
                        where clinic_id=$1 and id=$2`,
          [ctx.clinicId, id, doctorId, serviceId, patientId, startsAt, new Date(startsAt.getTime() + service.duration_minutes * MIN),
           b.internalNote === undefined ? cur.internal_note : b.internalNote || null, ctx.user.id, visitType, mode, channel, email, meetingUrl]);
        // Back to the clinic: the Join links stop. Newly online: the doctor's one-time tick is used up.
        if (!isOnline && cur.visit_type === "online") await c.query("update join_links set stopped_at = now() where appointment_id = $1 and stopped_at is null", [id]);
        if (becameOnline) await useTick(c, ctx, patientId, id);
      } catch (e) {
        if (e.constraint === "no_overlapping_appointments") throw new HttpError(409, "slot_taken");
        throw e;
      }
      return getAppointment(ctx, id, c);
    });
  }

  // Allowed moves. Cancelled, completed and no-show are final for everybody except those who may restore (administrators).
  const NEXT = {
    booked: ["confirmed", "cancelled", "completed", "no_show"],
    confirmed: ["cancelled", "completed", "no_show"],
  };
  async function setStatus(ctx, id, { status, reason, expectedVersion }, perms) {
    return tx({ ...ctx, reason: reason ?? null }, async (c) => {
      const cur = await lockAppointment(c, ctx, id);
      if (cur.row_version !== expectedVersion) throw conflict(cur);
      const rules = await staffRules(c, ctx);
      const needReason = status === "cancelled" ? rules.requireCancelReason : status === "voided";
      if (needReason && !(reason || "").trim()) throw bad("reason_required");
      if (status === "cancelled" && ACTIVE.includes(cur.status)) checkChangeNotice(rules, cur.starts_at);
      const admin = perms.includes("booking.appointments.restore");
      let allowed = NEXT[cur.status] ?? [];
      if (status === "voided") allowed = ACTIVE.includes(cur.status) || ["cancelled"].includes(cur.status) ? ["voided"] : [];
      if (!allowed.includes(status)) {
        const correction = admin && ["completed", "no_show"].includes(cur.status) && ["completed", "no_show"].includes(status) && (reason || "").trim();
        if (!correction) throw new HttpError(409, "status_change_not_allowed", { from: cur.status, to: status });
      }
      try {
        await c.query(`update appointments set status = $3::appointment_status, cancel_reason = case when $3 = 'cancelled' then $4 else cancel_reason end,
              void_reason = case when $3 = 'voided' then $4 else void_reason end,
              voided_at = case when $3 = 'voided' then now() else voided_at end, voided_by = case when $3 = 'voided' then $5::uuid else voided_by end,
              updated_by = $5 where clinic_id = $1 and id = $2`, [ctx.clinicId, id, status, reason || null, ctx.user.id]);
      } catch (e) {
        if (e.constraint === "no_overlapping_appointments") throw new HttpError(409, "slot_taken");
        throw e;
      }
      return getAppointment(ctx, id, c);
    });
  }

  // "Online, not checked" -> checked: a secretary called or messaged the number and it is the patient's.
  async function markChecked(ctx, id, { expectedVersion }) {
    return tx(ctx, async (c) => {
      const cur = await lockAppointment(c, ctx, id);
      if (cur.row_version !== expectedVersion) throw conflict(cur);
      if (!cur.needs_check || cur.checked_at) throw new HttpError(409, "nothing_to_check");
      await c.query("update appointments set checked_at = now(), checked_by = $3, updated_by = $3 where clinic_id = $1 and id = $2", [ctx.clinicId, id, ctx.user.id]);
      return getAppointment(ctx, id, c);
    });
  }

  // For the "Send booking link" button: the clinic's link and message, only while the link is on.
  async function onlineLink(ctx, baseUrl) {
    const r = await one(pool, `select c.slug, c.name_en, c.name_ar, o.enabled, o.share_message_en, o.share_message_ar
                                 from clinics c join online_booking o on o.clinic_id = c.id where c.id = $1`, [ctx.clinicId]);
    if (!r || !baseUrl) return { enabled: false };
    const url = `${baseUrl}/${r.slug}`;
    const fill = (m, name, from) => m.replaceAll("{clinic}", name).replaceAll("{link}", `${url}?from=${from}`);
    return { enabled: r.enabled, url, qrUrl: `${url}?from=qr`,
             messageEn: fill(r.share_message_en, r.name_en, "wa"), messageAr: fill(r.share_message_ar, r.name_ar, "wa") };
  }

  // A voided booking comes back as "booked", if the slot is still free.
  async function restore(ctx, id, { expectedVersion }) {
    return tx(ctx, async (c) => {
      const cur = await lockAppointment(c, ctx, id);
      if (cur.row_version !== expectedVersion) throw conflict(cur);
      if (cur.status !== "voided") throw new HttpError(409, "not_voided");
      try {
        await c.query(`update appointments set status = 'booked', voided_at = null, voided_by = null, updated_by = $3 where clinic_id = $1 and id = $2`, [ctx.clinicId, id, ctx.user.id]);
      } catch (e) {
        if (e.constraint === "no_overlapping_appointments") throw new HttpError(409, "slot_taken");
        throw e;
      }
      return getAppointment(ctx, id, c);
    });
  }

  const settings = createSettings({ pool, tx, now });
  const audit = createAudit({ pool, auditPool, now });
  const notes = createNotes({ pool, tx, now, audioDir, getAppointment, speech, tidier });

  // ---------------------------------------------------------------- Excel files. Recorded before the file exists: no record, no file.
  async function exportFile(ctx, what, fetchRows, build, filters, lang) {
    const tz = (await pool.query("select timezone from clinics where id = $1", [ctx.clinicId])).rows[0].timezone;
    const found = await fetchRows(MAX_EXPORT_ROWS + 1);
    const truncated = found.length > MAX_EXPORT_ROWS;
    const rows = truncated ? found.slice(0, MAX_EXPORT_ROWS) : found;
    await audit.record(ctx, "data_exported", { what, rows: rows.length, truncated, filters, language: lang });
    return { buffer: await build(rows, { lang, tz, truncated }), filename: `limitsiz-${what}-${todayIn(now(), tz)}.xlsx` };
  }
  const exportBookings = (ctx, q, lang) => exportFile(ctx, "bookings", (n) => listAppointments(ctx, q, n), bookingsFile, q, lang);
  const exportPatients = (ctx, q, lang) => exportFile(ctx, "patients", (n) => searchPatients(ctx, q, n), patientsFile, q ? { q } : {}, lang);
  const visit = createVisitLines({ pool, tx, getAppointment, recordsUrl, now });
  const online = createOnlineVisits({ pool, tx, now, getAppointment, mail });
  return { settings, audit, notes, visit, online, lookups, timeOffOn, slots, listAppointments, getAppointment, history, createAppointment, updateAppointment, setStatus, restore, markChecked, onlineLink,
           searchPatients, exportBookings, exportPatients, getPatient, insurance, todayLine, createPatient: (ctx, b) => createPatient(ctx, b), updatePatient, tx };
}
