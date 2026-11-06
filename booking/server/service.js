// Booking logic: availability, appointments, patients, history. No HTTP in here.
// Every query is limited to the clinic of the signed-in person (ctx.clinicId), and every change runs in a transaction whose
// audit actor is that person, so the audit trail says who did it.
// ctx.onlyDoctor: a doctor sees and handles only their own bookings, and only patients with a booking with them. That limit lives in
// here, where the data is read, so no screen or link can get round it.
import { HttpError, bad, denied, notFound } from "./http.js";
import { createSettings } from "./settings.js";
import { createAudit } from "./audit.js";

const ACTIVE = ["booked", "confirmed"];
const MIN = 60_000;

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

export function createService({ pool, auditPool, now = () => new Date() }) {
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
      `select d.id, d.name_en, d.name_ar, d.title_en, d.title_ar, d.gender,
              coalesce((select array_agg(ds.service_id) from doctor_services ds where ds.doctor_id = d.id), '{}') as service_ids,
              coalesce((select json_agg(json_build_object('weekday', w.weekday, 'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI')) order by w.weekday, w.start_time)
                          from working_hours w where w.doctor_id = d.id), '[]') as hours
         from doctors d where d.clinic_id = $1 and d.active order by d.name_en`, [ctx.clinicId])).rows;
    const services = (await pool.query(
      `select id, name_en, name_ar, duration_minutes, price_jod, price_is_from from services where clinic_id = $1 and active order by sort, name_en`, [ctx.clinicId])).rows;
    const openingHours = (await pool.query(
      `select weekday, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as "end" from clinic_hours where clinic_id = $1 order by weekday, start_time`, [ctx.clinicId])).rows;
    return { clinic, doctors, services, openingHours, rules: await staffRules(pool, ctx) };
  }

  // Closures and leave touching one local day, for the calendar.
  async function timeOffOn(ctx, day) {
    const { rows } = await pool.query(
      `select o.id, o.doctor_id, o.starts_at, o.ends_at, o.reason from time_off o join clinics c on c.id = o.clinic_id
        where o.clinic_id = $1 and o.starts_at < (($2::date + 1)::timestamp at time zone c.timezone) and o.ends_at > ($2::date::timestamp at time zone c.timezone)
          and ($3::uuid is null or o.doctor_id is null or o.doctor_id = $3)`, [ctx.clinicId, day, ctx.onlyDoctor ?? null]);
    return rows;
  }

  // The rules for staff, from Settings -> Booking rules (the WhatsApp assistant reads the "patient" row).
  async function staffRules(c, ctx) {
    const r = await one(c, "select * from booking_rules where clinic_id = $1 and audience = 'staff'", [ctx.clinicId]);
    return { minNoticeMinutes: r.min_notice_minutes, windowDays: r.window_days, changeNoticeMinutes: r.change_notice_minutes, maxUpcoming: r.max_upcoming,
             outsideHours: r.outside_hours, walkinBackMinutes: r.walkin_back_minutes, requireCancelReason: r.require_cancel_reason };
  }

  // ---------------------------------------------------------------- availability
  // Same rule as the WhatsApp assistant (agent/limitsiz_agent/booking/slots.py): the doctor's hours inside the clinic's opening hours,
  // the whole appointment inside one period, on the doctor's interval from the start of the period, nothing overlapping leave or a
  // closure, and the doctor's buffer kept after every booking and after this one (the buffer may run past the end of a period).
  async function freeStarts(c, clinic, doctorId, durationMin, dayFrom, dayTo, { earliest, latest, excludeId = null }) {
    const shifts = (await c.query(
      `with ch as (select weekday, start_time, end_time from clinic_hours where clinic_id = $5),
            periods as (
              select w.weekday, w.start_time as st, w.end_time as en from working_hours w
               where w.doctor_id = $1 and not exists (select 1 from ch)
              union all
              select w.weekday, greatest(w.start_time, h.start_time), least(w.end_time, h.end_time)
                from working_hours w join ch h on h.weekday = w.weekday
               where w.doctor_id = $1 and w.start_time < h.end_time and h.start_time < w.end_time)
       select (d::date + p.st) at time zone $4 as s, (d::date + p.en) at time zone $4 as e
         from generate_series($2::date, $3::date, interval '1 day') d
         join periods p on p.weekday = extract(dow from d)::int
        order by 1`, [doctorId, dayFrom, dayTo, clinic.timezone, clinic.id])).rows;
    if (!shifts.length) return [];
    const lo = shifts[0].s, hi = shifts[shifts.length - 1].e;
    const doctor = await one(c, "select slot_minutes, buffer_minutes from doctors where id = $1", [doctorId]);
    const buffer = doctor.buffer_minutes * MIN;
    // Wider than the day by the buffer: a booking just outside can still reach in.
    const bookings = (await c.query(
      `select starts_at, ends_at from appointments where doctor_id = $1 and status in ('booked','confirmed') and starts_at < $3 and ends_at > $2
          and ($4::uuid is null or id <> $4::uuid)`, [doctorId, new Date(lo.getTime() - buffer), new Date(hi.getTime() + buffer), excludeId])).rows.map((r) => [r.starts_at.getTime(), r.ends_at.getTime()]);
    const blocked = (await c.query(
      `select starts_at, ends_at from time_off where clinic_id = $1 and (doctor_id is null or doctor_id = $2) and starts_at < $4 and ends_at > $3`,
      [clinic.id, doctorId, lo, hi])).rows.map((r) => [r.starts_at.getTime(), r.ends_at.getTime()]);
    const step = (doctor.slot_minutes ?? clinic.slot_step_minutes) * MIN, dur = durationMin * MIN, out = [];
    for (const sh of shifts) {
      for (let t = sh.s.getTime(); t + dur <= sh.e.getTime(); t += step) {
        if (t < earliest || t > latest) continue;
        if (blocked.some(([bs, be]) => bs < t + dur && t < be)) continue;
        if (bookings.some(([bs, be]) => bs < t + dur + buffer && t < be + buffer)) continue;
        out.push(t);
      }
    }
    return out;
  }

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
      `select d.id, d.name_en from doctors d join doctor_services ds on ds.doctor_id = d.id and ds.service_id = $2
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
      s.duration_minutes, s.price_jod
    from appointments a
    join patients p on p.clinic_id = a.clinic_id and p.id = a.patient_id
    join doctors d on d.clinic_id = a.clinic_id and d.id = a.doctor_id
    join services s on s.clinic_id = a.clinic_id and s.id = a.service_id`;

  async function listAppointments(ctx, q) {
    const where = ["a.clinic_id = $1"], p = [ctx.clinicId];
    const add = (sql, v) => { p.push(v); where.push(sql.replace("?", `$${p.length}`)); };
    if (ctx.onlyDoctor) add("a.doctor_id = ?", ctx.onlyDoctor);
    const tz = "(select timezone from clinics where id = a.clinic_id)";
    if (q.from) add(`a.starts_at >= (?::date)::timestamp at time zone ${tz}`, q.from);
    if (q.to) add(`a.starts_at < ((?::date) + 1)::timestamp at time zone ${tz}`, q.to);
    if (q.doctorId) add("a.doctor_id = ?", q.doctorId);
    if (q.patientId) add("a.patient_id = ?", q.patientId);
    if (q.source) add("a.source = ?", q.source);
    if (q.status) add("a.status = ?::appointment_status", q.status); else if (!q.includeVoided) where.push("a.status <> 'voided'");
    if (q.q) { p.push(`%${q.q.replace(/[%_\\]/g, "\\$&")}%`); where.push(`(p.full_name ilike $${p.length} or p.phone_e164 like $${p.length})`); }
    const { rows } = await pool.query(`${SELECT} where ${where.join(" and ")} order by a.starts_at, d.name_en limit 500`, p);
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
  async function createPatient(ctx, b, c) {
    const phone = b.phone ? normalizePhone(b.phone) : null;
    const run = async (cc) => {
      if (phone) {
        const ex = await one(cc, "select id, full_name from patients where clinic_id = $1 and phone_e164 = $2", [ctx.clinicId, phone]);
        if (ex) throw new HttpError(409, "patient_exists", ctx.onlyDoctor ? { patientId: ex.id } : { patientId: ex.id, fullName: ex.full_name });
      }
      return one(cc, `insert into patients (clinic_id, full_name, phone_e164, preferred_language, whatsapp_reminders)
                      values ($1,$2,$3,$4,$5) returning *`, [ctx.clinicId, b.fullName.trim(), phone, b.language ?? null, !!(b.whatsappReminders && phone)]);
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
      return one(c, `update patients set full_name = $3, phone_e164 = $4, preferred_language = $5, whatsapp_reminders = $6
                      where clinic_id = $1 and id = $2 returning *`,
        [ctx.clinicId, id, b.fullName?.trim() ?? cur.full_name, phone, b.language === undefined ? cur.preferred_language : b.language,
         phone ? (b.whatsappReminders ?? cur.whatsapp_reminders) : false]);
    });
  }
  async function searchPatients(ctx, q) {
    const like = `%${String(q || "").replace(/[%_\\]/g, "\\$&")}%`;
    const { rows } = await pool.query(
      `select p.id, p.full_name, p.phone_e164, p.preferred_language, p.whatsapp_reminders,
              (select max(a.starts_at) from appointments a where a.patient_id = p.id and a.clinic_id = p.clinic_id and a.status in ('completed','booked','confirmed')
                  and ($3::uuid is null or a.doctor_id = $3)) as last_visit
         from patients p where p.clinic_id = $1 and ($2 = '%%' or p.full_name ilike $2 or p.phone_e164 like $2)
          and ($3::uuid is null or exists (select 1 from appointments a where a.clinic_id = p.clinic_id and a.patient_id = p.id and a.doctor_id = $3 and a.status <> 'voided'))
        order by p.full_name nulls last limit 50`, [ctx.clinicId, like, ctx.onlyDoctor ?? null]);
    return rows;
  }
  async function getPatient(ctx, id) {
    const p = await visiblePatient(pool, ctx, id);
    const appts = await listAppointments(ctx, { patientId: id, includeVoided: true });
    return { patient: p, appointments: appts.reverse() };
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

  async function createAppointment(ctx, input) {
    if (ctx.onlyDoctor && input.doctorId !== "any" && input.doctorId !== ctx.onlyDoctor) throw denied("own_bookings_only");
    const b = ctx.onlyDoctor ? { ...input, doctorId: ctx.onlyDoctor } : input;
    const startsAt = new Date(b.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw bad("invalid_time");
    return tx(ctx, async (c) => {
      const rules = await staffRules(c, ctx);
      checkTime(rules, startsAt, b.source);
      const clinic = await clinicRow(c, ctx), service = await serviceRow(c, ctx, b.serviceId);
      const docs = await doctorsFor(c, ctx, b.serviceId, b.doctorId === "any" ? null : b.doctorId);
      let doctor = null, other = false;
      for (const d of docs) {                                  // "any available": the first doctor with this time free
        try { other = await checkFree(c, ctx, clinic, rules, d.id, service, startsAt, b.override, null); doctor = d; break; }
        catch (e) { if (!(e instanceof HttpError) || docs.length === 1 || b.doctorId !== "any") throw e; }
      }
      if (!doctor) throw new HttpError(409, "slot_unavailable");
      let patientId = b.patientId;
      if (b.newPatient) patientId = (await createPatient(ctx, b.newPatient, c)).id;
      else await patientRow(c, ctx, patientId);      // any patient of the clinic: a doctor reaches an existing one from "this phone number exists"
      const dup = await one(c, `select 1 from appointments where patient_id = $1 and status in ('booked','confirmed') and starts_at < $3 and ends_at > $2`,
        [patientId, startsAt, new Date(startsAt.getTime() + service.duration_minutes * MIN)]);
      if (dup) throw new HttpError(409, "patient_already_booked_then");
      if (rules.maxUpcoming && !b.allowOverLimit) {           // for staff this is a warning, not a wall
        const { n } = await one(c, "select count(*)::int n from appointments where patient_id = $1 and status in ('booked','confirmed') and ends_at > $2", [patientId, now()]);
        if (n >= rules.maxUpcoming) throw new HttpError(409, "over_max_upcoming", { limit: rules.maxUpcoming });
      }
      try {
        const r = await one(c, `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source, internal_note, created_by, updated_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) returning id`,
          [ctx.clinicId, doctor.id, b.serviceId, patientId, startsAt, new Date(startsAt.getTime() + service.duration_minutes * MIN), b.source, b.internalNote || null, ctx.user.id]);
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
      try {
        await c.query(`update appointments set doctor_id=$3, service_id=$4, patient_id=$5, starts_at=$6, ends_at=$7, internal_note=$8, updated_by=$9
                        where clinic_id=$1 and id=$2`,
          [ctx.clinicId, id, doctorId, serviceId, patientId, startsAt, new Date(startsAt.getTime() + service.duration_minutes * MIN),
           b.internalNote === undefined ? cur.internal_note : b.internalNote || null, ctx.user.id]);
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
  return { settings, audit, lookups, timeOffOn, slots, listAppointments, getAppointment, history, createAppointment, updateAppointment, setStatus, restore,
           searchPatients, getPatient, createPatient: (ctx, b) => createPatient(ctx, b), updatePatient, tx };
}
