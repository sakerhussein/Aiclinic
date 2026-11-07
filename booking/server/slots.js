// Free start times. Shared by staff Booking and the online booking page, and the same rule as the WhatsApp assistant
// (agent/limitsiz_agent/booking/slots.py): the doctor's hours inside the clinic's opening hours, the whole appointment inside one
// period, on the doctor's interval from the start of the period, nothing overlapping leave or a closure, and the doctor's buffer kept
// after every booking and after this one (the buffer may run past the end of a period).
export const MIN = 60_000;

export async function freeStarts(c, clinic, doctorId, durationMin, dayFrom, dayTo, { earliest, latest, excludeId = null }) {
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
  const doctor = (await c.query("select slot_minutes, buffer_minutes from doctors where id = $1", [doctorId])).rows[0];
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

// Local calendar day (YYYY-MM-DD) n days after `from`.
export const addDays = (from, n) => new Date(Date.parse(from + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
