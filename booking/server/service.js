// Booking logic: availability, appointments, patients, history. No HTTP in here.
// Every query is limited to the clinic of the signed-in person (ctx.clinicId), and every change runs in a transaction whose
// audit actor is that person, so the audit trail says who did it.
import { HttpError, bad, notFound } from "./http.js";

const ACTIVE = ["booked", "confirmed"];
const MIN = 60_000;

// Staff booking rules. Until the Settings tables exist (phase B, Settings), these are the defaults of the design (§5.3).
export const STAFF_RULES = { windowDays: 365, walkinHoursBack: 2, requireCancelReason: true, outsideHours: "warn" };

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
    const clinic = await one(pool, `select id, slug, name_en, name_ar, timezone, slot_step_minutes, default_language from clinics where id = $1`, [ctx.clinicId]);
    const doctors = (await pool.query(
      `select d.id, d.name_en, d.name_ar, d.title_en, d.title_ar, d.gender,
              coalesce((select array_agg(ds.service_id) from doctor_services ds where ds.doctor_id = d.id), '{}') as service_ids,
              coalesce((select json_agg(json_build_object('weekday', w.weekday, 'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI')) order by w.weekday, w.start_time)
                          from working_hours w where w.doctor_id = d.id), '[]') as hours
         from doctors d where d.clinic_id = $1 and d.active order by d.name_en`, [ctx.clinicId])).rows;
    const services = (await pool.query(
      `select id, name_en, name_ar, duration_minutes, price_jod, price_is_from from services where clinic_id = $1 and active order by sort, name_en`, [ctx.clinicId])).rows;
    return { clinic, doctors, services, rules: STAFF_RULES };
  }

  // ---------------------------------------------------------------- availability
  // Same rule as the WhatsApp assistant (agent/limitsiz_agent/booking/slots.py): the whole appointment inside one shift, on the
  // clinic's step grid from the start of the shift, nothing overlapping another active booking, leave or closure.
  async function freeStarts(c, clinic, doctorId, durationMin, dayFrom, dayTo, { earliest, latest, excludeId = null }) {
    const shifts = (await c.query(
      `select (d::date + w.start_time) at time zone $4 as s, (d::date + w.end_time) at time zone $4 as e
         from generate_series($2::date, $3::date, interval '1 day') d
         join working_hours w on w.doctor_id = $1 and w.weekday = extract(dow from d)::int
        order by 1`, [doctorId, dayFrom, dayTo, clinic.timezone])).rows;
    if (!shifts.length) return [];
    const lo = shifts[0].s, hi = shifts[shifts.length - 1].e;
    const busy = (await c.query(
      `select starts_at, ends_at from appointments where doctor_id = $1 and status in ('booked','confirmed') and starts_at < $3 and ends_at > $2
          and ($4::uuid is null or id <> $4::uuid)
       union all
       select starts_at, ends_at from time_off where clinic_id = $5 and (doctor_id is null or doctor_id = $1) and starts_at < $3 and ends_at > $2`,
      [doctorId, lo, hi, excludeId, clinic.id])).rows.map((r) => [r.starts_at.getTime(), r.ends_at.getTime()]);
    const step = clinic.slot_step_minutes * MIN, dur = durationMin * MIN, out = [];
    for (const sh of shifts) {
      for (let t = sh.s.getTime(); t + dur <= sh.e.getTime(); t += step) {
        if (t < earliest || t > latest) continue;
        if (busy.some(([bs, be]) => bs < t + dur && t < be)) continue;
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
    const t0 = now().getTime();
    const dayTo = new Date(Date.parse(from + "T00:00:00Z") + (Math.min(days, 31) - 1) * 86400000).toISOString().slice(0, 10);
    const out = [];
    for (const d of docs) {
      const starts = await freeStarts(pool, clinic, d.id, service.duration_minutes, from, dayTo,
        { earliest: t0, latest: t0 + STAFF_RULES.windowDays * 86400000 });
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
    const row = await one(c, `${SELECT} where a.clinic_id = $1 and a.id = $2`, [ctx.clinicId, id]);
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
  async function createPatient(ctx, b, c) {
    const phone = b.phone ? normalizePhone(b.phone) : null;
    const run = async (cc) => {
      if (phone) {
        const ex = await one(cc, "select id, full_name from patients where clinic_id = $1 and phone_e164 = $2", [ctx.clinicId, phone]);
        if (ex) throw new HttpError(409, "patient_exists", { patientId: ex.id, fullName: ex.full_name });
      }
      return one(cc, `insert into patients (clinic_id, full_name, phone_e164, preferred_language, whatsapp_reminders)
                      values ($1,$2,$3,$4,$5) returning *`, [ctx.clinicId, b.fullName.trim(), phone, b.language ?? null, !!(b.whatsappReminders && phone)]);
    };
    return c ? run(c) : tx(ctx, run);
  }
  async function updatePatient(ctx, id, b) {
    return tx(ctx, async (c) => {
      const cur = await patientRow(c, ctx, id);
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
              (select max(a.starts_at) from appointments a where a.patient_id = p.id and a.clinic_id = p.clinic_id and a.status in ('completed','booked','confirmed')) as last_visit
         from patients p where p.clinic_id = $1 and ($2 = '%%' or p.full_name ilike $2 or p.phone_e164 like $2)
        order by p.full_name nulls last limit 50`, [ctx.clinicId, like]);
    return rows;
  }
  async function getPatient(ctx, id) {
    const p = await patientRow(pool, ctx, id);
    const appts = await listAppointments(ctx, { patientId: id, includeVoided: true });
    return { patient: p, appointments: appts.reverse() };
  }

  // ---------------------------------------------------------------- creating and changing bookings
  function checkTime(startsAt, source) {
    const t = startsAt.getTime(), n = now().getTime();
    if (t > n + STAFF_RULES.windowDays * 86400000) throw bad("too_far_ahead");
    const back = source === "walkin" ? STAFF_RULES.walkinHoursBack * 60 * MIN : 0;
    if (t < n - back - 5 * MIN) throw bad("in_the_past");     // a few minutes of grace for a form left open
  }

  // The chosen time is either one of the free times, or an "other time" the person confirmed (outside hours is a warning here).
  async function checkFree(c, ctx, clinic, doctorId, service, startsAt, override, excludeId) {
    const day = startsAt.toISOString().slice(0, 10);
    const dayBefore = new Date(startsAt.getTime() - 86400000).toISOString().slice(0, 10);
    const dayAfter = new Date(startsAt.getTime() + 86400000).toISOString().slice(0, 10);
    const free = await freeStarts(c, clinic, doctorId, service.duration_minutes, dayBefore, dayAfter,
      { earliest: -Infinity, latest: Infinity, excludeId });
    void day;
    if (free.includes(startsAt.getTime())) return false;
    if (!override) throw new HttpError(409, "not_a_free_time", { warning: "outside_hours_or_grid" });
    if (STAFF_RULES.outsideHours === "block") throw new HttpError(409, "outside_hours_blocked");
    return true;
  }

  async function createAppointment(ctx, b) {
    const startsAt = new Date(b.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw bad("invalid_time");
    checkTime(startsAt, b.source);
    return tx(ctx, async (c) => {
      const clinic = await clinicRow(c, ctx), service = await serviceRow(c, ctx, b.serviceId);
      const docs = await doctorsFor(c, ctx, b.serviceId, b.doctorId === "any" ? null : b.doctorId);
      let doctor = null, other = false;
      for (const d of docs) {                                  // "any available": the first doctor with this time free
        try { other = await checkFree(c, ctx, clinic, d.id, service, startsAt, b.override, null); doctor = d; break; }
        catch (e) { if (!(e instanceof HttpError) || docs.length === 1 || b.doctorId !== "any") throw e; }
      }
      if (!doctor) throw new HttpError(409, "slot_unavailable");
      let patientId = b.patientId;
      if (b.newPatient) patientId = (await createPatient(ctx, b.newPatient, c)).id;
      else await patientRow(c, ctx, patientId);
      const dup = await one(c, `select 1 from appointments where patient_id = $1 and status in ('booked','confirmed') and starts_at < $3 and ends_at > $2`,
        [patientId, startsAt, new Date(startsAt.getTime() + service.duration_minutes * MIN)]);
      if (dup) throw new HttpError(409, "patient_already_booked_then");
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
      const cur = await one(c, "select * from appointments where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
      if (!cur) throw notFound("appointment_not_found");
      if (cur.row_version !== b.expectedVersion) throw conflict(cur);
      if (!ACTIVE.includes(cur.status)) throw new HttpError(409, "not_editable");
      const serviceId = b.serviceId ?? cur.service_id, doctorId = b.doctorId ?? cur.doctor_id;
      const startsAt = b.startsAt ? new Date(b.startsAt) : cur.starts_at;
      const service = await serviceRow(c, ctx, serviceId);
      await doctorsFor(c, ctx, serviceId, doctorId);
      const moved = +startsAt !== +cur.starts_at || serviceId !== cur.service_id || doctorId !== cur.doctor_id;
      if (moved) {
        checkTime(startsAt, cur.source);
        await checkFree(c, ctx, await clinicRow(c, ctx), doctorId, service, startsAt, b.override, id);
      }
      const patientId = b.patientId ?? cur.patient_id;
      if (patientId !== cur.patient_id) await patientRow(c, ctx, patientId);
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
      const cur = await one(c, "select * from appointments where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
      if (!cur) throw notFound("appointment_not_found");
      if (cur.row_version !== expectedVersion) throw conflict(cur);
      const needReason = status === "cancelled" ? STAFF_RULES.requireCancelReason : status === "voided";
      if (needReason && !(reason || "").trim()) throw bad("reason_required");
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
      const cur = await one(c, "select * from appointments where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
      if (!cur) throw notFound("appointment_not_found");
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

  return { lookups, slots, listAppointments, getAppointment, history, createAppointment, updateAppointment, setStatus, restore,
           searchPatients, getPatient, createPatient: (ctx, b) => createPatient(ctx, b), updatePatient, tx };
}
