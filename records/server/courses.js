// Treatment courses (Records, phase C; design: booking/design/records-phase-c.html §2). No HTTP in here.
// A course is a series of sessions of one service. A session counts when a booking for that service is completed in Booking, on or
// after the day the course starts: nothing is typed twice. Booked sessions show as booked; no-shows and cancellations don't count.
// Doctors start, change and end courses; secretaries see them (to book the next session) but not the notes behind them.
// A course is ended, never deleted.
import { HttpError, bad, notFound } from "./http.js";

const LIVE = ["booked", "confirmed", "completed"];

// Which bookings belong to which course: each booking goes to the latest course of its service that had started by that day and
// had not ended before it; a course takes at most its number of sessions.
export function placeSessions(courses, appts) {
  const out = new Map(courses.map((c) => [c.id, []]));
  const byStart = [...courses].sort((a, b) => (a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : new Date(a.created_at) - new Date(b.created_at)));
  for (const a of appts) {
    if (!LIVE.includes(a.status)) continue;
    let home = null;
    for (const c of byStart) {
      if (c.service_id !== a.service_id || c.starts_on > a.local_day) continue;
      if (c.ended_at && new Date(c.ended_at) <= new Date(a.starts_at)) continue;
      home = c;
    }
    if (home && out.get(home.id).length < home.sessions) out.get(home.id).push(a);
  }
  return out;
}

// The course's areas: keys from the clinic's body areas, each once; at least one while Settings asks for it.
function checkAreas(s, areas) {
  if (new Set(areas).size !== areas.length) throw bad("invalid_value");
  for (const k of areas) if (!s.photo_areas.some((x) => x.key === k)) throw bad("unknown_area");
  if (s.course_area_required && !areas.length) throw bad("area_required");
  return areas;
}

const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function createCourses({ pool, svc, now = () => new Date() }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];
  const conflict = (row) => new HttpError(409, "version_conflict", { rowVersion: row.row_version });

  // A patient's courses with their sessions (for the chart, and for Booking's "Book session 5").
  async function forPatient(c, ctx, patientId) {
    const courses = (await c.query(
      `select t.*, t.starts_on::text as starts_on, s.name_en as service_en, s.name_ar as service_ar from treatment_courses t join services s on s.id = t.service_id
        where t.clinic_id = $1 and t.patient_id = $2 order by t.ended_at is not null, t.starts_on desc, t.created_at desc`, [ctx.clinicId, patientId])).rows;
    if (!courses.length) return [];
    const appts = (await c.query(
      `select a.id, a.service_id, a.starts_at, a.status, (a.starts_at at time zone cl.timezone)::date::text as local_day,
              d.name_en as doctor_en, d.name_ar as doctor_ar
         from appointments a join clinics cl on cl.id = a.clinic_id join doctors d on d.id = a.doctor_id
        where a.clinic_id = $1 and a.patient_id = $2 and a.service_id = any($3::uuid[]) order by a.starts_at`,
      [ctx.clinicId, patientId, [...new Set(courses.map((x) => x.service_id))]])).rows;
    const today = (await one(c, "select (($2::timestamptz) at time zone timezone)::date::text as d from clinics where id = $1", [ctx.clinicId, now()])).d;
    const placed = placeSessions(courses, appts);
    return courses.map((t) => {
      const list = placed.get(t.id);
      const done = list.filter((a) => a.status === "completed").length;
      const last = list.at(-1);
      const next = list.length < t.sessions && !t.ended_at ? list.length + 1 : null;
      // The next session is suggested from the last one and the interval (never in the past).
      let nextAbout = null;
      if (next && t.every_weeks > 0) { nextAbout = last ? addDays(last.local_day, t.every_weeks * 7) : t.starts_on; if (nextAbout < today) nextAbout = today; }
      return {
        id: t.id, service_id: t.service_id, service_en: t.service_en, service_ar: t.service_ar, sessions: t.sessions, every_weeks: t.every_weeks,
        areas: t.areas, note: t.note, starts_on: t.starts_on,
        created_at: t.created_at, created_by_name: t.created_by_name, ended_at: t.ended_at, ended_by_name: t.ended_by_name, end_reason: t.end_reason,
        row_version: t.row_version, done, complete: done >= t.sessions, next, next_about: nextAbout,
        list: list.map((a, i) => ({ n: i + 1, appointment_id: a.id, starts_at: a.starts_at, status: a.status, doctor_en: a.doctor_en, doctor_ar: a.doctor_ar })),
      };
    });
  }

  async function guard(c, ctx, patientId, { edit = false } = {}) {
    if (!(edit ? ctx.canCoursesEdit : ctx.canCourses)) throw new HttpError(403, "forbidden");
    const s = await svc.settingsRow(c, ctx.clinicId);
    if (!s.courses_on) throw new HttpError(409, "courses_off");
    await svc.allowedPatient(c, ctx, patientId, s);
    return s;
  }

  async function list(ctx, patientId) {
    return svc.tx(ctx, async (c) => { await guard(c, ctx, patientId); return forPatient(c, ctx, patientId); });
  }

  async function start(ctx, patientId, b) {
    return svc.tx(ctx, async (c) => {
      const s = await guard(c, ctx, patientId, { edit: true });
      const areas = checkAreas(s, b.areas ?? []);
      const svcRow = await one(c, "select id from services where clinic_id = $1 and id = $2", [ctx.clinicId, b.serviceId]);
      if (!svcRow) throw bad("unknown_service");
      // One course of a service at a time: the current one is finished or ended first.
      const open = (await forPatient(c, ctx, patientId)).find((x) => x.service_id === b.serviceId && !x.ended_at && !x.complete);
      if (open) throw new HttpError(409, "course_open", { id: open.id });
      const today = (await one(c, "select (($2::timestamptz) at time zone timezone)::date::text as d from clinics where id = $1", [ctx.clinicId, now()])).d;
      await c.query(
        `insert into treatment_courses (clinic_id, patient_id, service_id, sessions, every_weeks, areas, note, starts_on, created_at, created_by, created_by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ctx.clinicId, patientId, b.serviceId, b.sessions, b.everyWeeks, areas, b.note?.trim() || null, b.startsOn || today, now(), ctx.user.id, ctx.user.name]);
      return forPatient(c, ctx, patientId);
    });
  }

  async function courseFor(c, ctx, id) {
    const t = await one(c, "select * from treatment_courses where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
    if (!t) throw notFound("course_not_found");
    await guard(c, ctx, t.patient_id, { edit: true });
    if (t.ended_at) throw new HttpError(409, "course_ended");
    return t;
  }

  // Change the number of sessions ("Add a session"), the interval, the areas or the note.
  async function update(ctx, id, b) {
    return svc.tx(ctx, async (c) => {
      const t = await courseFor(c, ctx, id);
      if (t.row_version !== b.expectedVersion) throw conflict(t);
      const done = (await forPatient(c, ctx, t.patient_id)).find((x) => x.id === id);
      if (b.sessions !== undefined && b.sessions < done.list.length) throw bad("fewer_than_booked", { n: done.list.length });
      const areas = b.areas === undefined ? t.areas : checkAreas(await svc.settingsRow(c, ctx.clinicId), b.areas);
      await c.query("update treatment_courses set sessions = $2, every_weeks = $3, areas = $4, note = $5, updated_by_name = $6 where id = $1",
        [id, b.sessions ?? t.sessions, b.everyWeeks ?? t.every_weeks, areas, b.note === undefined ? t.note : (b.note?.trim() || null), ctx.user.name]);
      return forPatient(c, ctx, t.patient_id);
    });
  }

  async function end(ctx, id, b) {
    return svc.tx(ctx, async (c) => {
      const t = await courseFor(c, ctx, id);
      if (t.row_version !== b.expectedVersion) throw conflict(t);
      await c.query("update treatment_courses set ended_at = $2, ended_by_name = $3, end_reason = $4, updated_by_name = $3 where id = $1",
        [id, now(), ctx.user.name, b.reason.trim()]);
      return forPatient(c, ctx, t.patient_id);
    });
  }

  return { forPatient, list, start, update, end };
}
