// The online booking page's logic (book.limitsiz.si/<clinic>). Runs as the public_app login, which cannot read patients at all.
// No sign-in: what protects the clinic is
//   - each clinic's own switch (off by default), its patient rules, and its limits in Settings > Online booking;
//   - "Online, not checked": until WhatsApp proves who owns a number, a secretary checks each online booking;
//   - nothing here ever says whether a number already belongs to a patient, or shows anybody's details;
//   - the private change-or-cancel link, stored only as a hash.
import crypto from "node:crypto";
import { HttpError, bad, notFound } from "./http.js";
import { normalizePhone } from "./service.js";
import { freeStarts, addDays, MIN } from "./slots.js";

const ACTIVE = ["booked", "confirmed"];
const DAY = 86400000;
export const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function createPublicService({ pool, now = () => new Date() }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];

  async function tx(ctx, clinicId, fn) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select audit.set_actor('patient', $1, $2, $3, $4, $5, $6, $7)",
        [ctx.patientId ?? null, "Online booking page", ctx.ip ?? null, ctx.ua ?? null, ctx.requestId ?? null, ctx.reason ?? null, clinicId]);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }

  // ---------------------------------------------------------------- the clinic and its settings
  const ONLINE = `select c.id, c.slug, c.name_en, c.name_ar, c.timezone, c.phone, c.address_en, c.address_ar, c.maps_url, c.default_language,
      c.slot_step_minutes, c.week_start, o.*, r.min_notice_minutes, r.window_days, r.change_notice_minutes, r.max_upcoming
    from clinics c join online_booking o on o.clinic_id = c.id join booking_rules r on r.clinic_id = c.id and r.audience = 'patient'`;
  async function clinicBySlug(c, slug) {
    const k = await one(c, `${ONLINE} where c.slug = $1 and c.active and o.enabled`, [slug]);
    if (!k) throw notFound("clinic_not_found");          // the same answer for "no such clinic" and "link switched off"
    return k;
  }
  async function clinicById(c, id) { return one(c, `${ONLINE} where c.id = $1`, [id]); }
  // The limits the HTTP layer applies per connection, read from the clinic's settings.
  async function limits(slug) {
    const k = await one(pool, `select o.lookups_per_ip_per_minute, o.bookings_per_ip_per_day, o.manage_per_ip_per_hour from clinics c join online_booking o on o.clinic_id = c.id where c.slug = $1`, [slug]);
    return k ?? null;
  }

  async function info(slug) {
    const k = await clinicBySlug(pool, slug);
    const services = (await pool.query(
      `select s.id, s.name_en, s.name_ar, s.description_en, s.description_ar, s.duration_minutes, s.price_jod, s.price_is_from
         from services s where s.clinic_id = $1 and s.active
          and exists (select 1 from doctor_services ds join doctors d on d.id = ds.doctor_id and d.active where ds.service_id = s.id)
        order by s.sort, s.name_en`, [k.id])).rows.map((s) => (k.show_prices ? s : { ...s, price_jod: null, price_is_from: false }));
    const doctors = (await pool.query(
      `select d.id, d.name_en, d.name_ar, d.title_en, d.title_ar, coalesce(array_agg(ds.service_id) filter (where ds.service_id is not null), '{}') as service_ids
         from doctors d left join doctor_services ds on ds.doctor_id = d.id where d.clinic_id = $1 and d.active group by d.id order by d.name_en`, [k.id])).rows;
    return {
      clinic: { slug: k.slug, nameEn: k.name_en, nameAr: k.name_ar, phone: k.phone, addressEn: k.address_en, addressAr: k.address_ar, mapsUrl: k.maps_url,
                timezone: k.timezone, defaultLanguage: k.default_language, weekStart: k.week_start },
      services, doctors,
      options: { allowAnyDoctor: k.allow_any_doctor, allowForOther: k.allow_for_other, offerReminders: k.offer_reminders, showPrices: k.show_prices,
                 daysPerPage: k.days_per_page, windowDays: k.window_days, countryCode: k.default_country_code,
                 introEn: k.intro_en, introAr: k.intro_ar, doneNoteEn: k.done_note_en, doneNoteAr: k.done_note_ar, privacyUrl: k.privacy_url },
    };
  }

  // ---------------------------------------------------------------- free times, under the clinic's patient rules
  const bounds = (k) => { const t = now().getTime(); return { earliest: t + k.min_notice_minutes * MIN, latest: t + k.window_days * DAY }; };
  async function service(c, k, id) {
    const s = await one(c, "select id, duration_minutes, name_en, name_ar from services where clinic_id = $1 and id = $2 and active", [k.id, id]);
    if (!s) throw bad("unknown_service");
    return s;
  }
  async function doctorsFor(c, k, serviceId, doctorId) {
    if (!doctorId && !k.allow_any_doctor) throw bad("choose_a_doctor");
    const { rows } = await c.query(
      `select d.id from doctors d join doctor_services ds on ds.doctor_id = d.id and ds.service_id = $2
        where d.clinic_id = $1 and d.active and ($3::uuid is null or d.id = $3::uuid) order by d.name_en`, [k.id, serviceId, doctorId ?? null]);
    if (!rows.length) throw bad("doctor_does_not_offer_service");
    return rows;
  }
  async function slots(slug, { serviceId, doctorId, from, days }) {
    const k = await clinicBySlug(pool, slug), s = await service(pool, k, serviceId);
    const docs = await doctorsFor(pool, k, serviceId, doctorId);
    const n = Math.min(days ?? k.days_per_page, k.days_per_page), out = [];
    for (const d of docs) {
      for (const t of await freeStarts(pool, k, d.id, s.duration_minutes, from, addDays(from, n - 1), bounds(k))) out.push({ doctorId: d.id, startsAt: new Date(t).toISOString() });
    }
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  async function isFree(c, k, doctorId, durationMin, startsAt, excludeId = null) {
    const day = startsAt.toISOString().slice(0, 10);
    const free = await freeStarts(c, k, doctorId, durationMin, addDays(day, -1), addDays(day, 1), { ...bounds(k), excludeId });
    return free.includes(startsAt.getTime());
  }

  // ---------------------------------------------------------------- booking
  // Every refusal that depends on the phone number gets the same answer, so the page cannot be used to learn about a number.
  const phoneRefused = () => new HttpError(409, "phone_not_accepted");

  async function book(slug, ctx, b) {
    const k = await clinicBySlug(pool, slug);
    const startsAt = new Date(b.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw bad("invalid_time");
    const phone = normalizePhone(b.phone, k.default_country_code);
    if (b.forOther && !k.allow_for_other) throw bad("invalid_input");
    const token = crypto.randomBytes(32).toString("base64url");
    try {
      return await tx(ctx, k.id, async (c) => {
        const s = await service(c, k, b.serviceId);
        const docs = await doctorsFor(c, k, b.serviceId, b.doctorId ?? null);
        let doctorId = null;
        for (const d of docs) if (await isFree(c, k, d.id, s.duration_minutes, startsAt)) { doctorId = d.id; break; }
        if (!doctorId) throw new HttpError(409, "slot_taken");
        const patientId = (await one(c, "select public.online_patient($1, $2, $3, $4, $5) as id",
          [k.id, phone, b.name.trim(), b.language, !!(b.reminders && k.offer_reminders)])).id;
        await c.query("select set_config('app.actor_id', $1, true)", [patientId]);
        const endsAt = new Date(startsAt.getTime() + s.duration_minutes * MIN);
        // "Per day" is counted on the database's clock, the clock that stamps created_at.
        const counts = await one(c, `select
            count(*) filter (where source = 'web' and created_at > now() - interval '1 day')::int as today,
            count(*) filter (where needs_check and checked_at is null and status in ('booked','confirmed') and ends_at > $2)::int as unchecked,
            count(*) filter (where status in ('booked','confirmed') and ends_at > $2)::int as upcoming,
            count(*) filter (where status in ('booked','confirmed') and starts_at < $4 and ends_at > $3)::int as same_time
          from appointments where clinic_id = $1 and patient_id = $5`, [k.id, now(), startsAt, endsAt, patientId]);
        if (counts.today >= k.bookings_per_phone_per_day) throw phoneRefused();
        if (k.staff_check && counts.unchecked >= k.max_unchecked_per_phone) throw phoneRefused();
        if (k.max_upcoming && counts.upcoming >= k.max_upcoming) throw phoneRefused();
        if (counts.same_time) throw phoneRefused();
        const r = await one(c, `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source, online_from, booked_name,
            booked_for_other, needs_check, manage_token_hash) values ($1,$2,$3,$4,$5,$6,'web',$7,$8,$9,$10,$11) returning id`,
          [k.id, doctorId, s.id, patientId, startsAt, endsAt, b.from ?? null, b.name.trim(), !!b.forOther, k.staff_check, sha256hex(token)]);
        return { ...(await summary(c, r.id)), manageToken: token };
      });
    } catch (e) {
      if (e.constraint === "no_overlapping_appointments") throw new HttpError(409, "slot_taken");
      throw e;
    }
  }

  // What the patient may see of a booking: never the phone number or the clinic's notes.
  async function summary(c, id) {
    const a = await one(c, `select a.id, a.clinic_id, a.starts_at, a.ends_at, a.status, a.needs_check, a.checked_at, a.booked_name,
        s.id as service_id, s.name_en as service_name_en, s.name_ar as service_name_ar, s.duration_minutes,
        d.id as doctor_id, d.name_en as doctor_name_en, d.name_ar as doctor_name_ar, d.title_en as doctor_title_en, d.title_ar as doctor_title_ar
      from appointments a join services s on s.id = a.service_id join doctors d on d.id = a.doctor_id where a.id = $1`, [id]);
    const k = await clinicById(c, a.clinic_id);
    const t = now().getTime(), active = ACTIVE.includes(a.status), future = a.starts_at.getTime() > t;
    const inTime = a.starts_at.getTime() - t >= k.change_notice_minutes * MIN;
    return {
      id: a.id, startsAt: a.starts_at, endsAt: a.ends_at, status: a.status, name: a.booked_name, waitingForCheck: a.needs_check && !a.checked_at,
      // What the patient is told: a booking the clinic confirmed or checked is "confirmed"; one it has not checked yet is "waiting".
      shownStatus: !active ? a.status : a.status === "confirmed" || (a.needs_check && a.checked_at) ? "confirmed" : a.needs_check ? "waiting" : "booked",
      service: { id: a.service_id, nameEn: a.service_name_en, nameAr: a.service_name_ar, durationMinutes: a.duration_minutes },
      doctor: { id: a.doctor_id, nameEn: a.doctor_name_en, nameAr: a.doctor_name_ar, titleEn: a.doctor_title_en, titleAr: a.doctor_title_ar },
      clinic: { slug: k.slug, nameEn: k.name_en, nameAr: k.name_ar, phone: k.phone, addressEn: k.address_en, addressAr: k.address_ar, mapsUrl: k.maps_url,
                timezone: k.timezone, doneNoteEn: k.done_note_en, doneNoteAr: k.done_note_ar, daysPerPage: k.days_per_page, windowDays: k.window_days },
      changeNoticeMinutes: k.change_notice_minutes,
      canCancel: k.enabled && k.allow_cancel && active && future && inTime,
      canReschedule: k.enabled && k.allow_reschedule && active && future && inTime,
      tooLateToChange: active && future && !inTime,
    };
  }

  // ---------------------------------------------------------------- the private link
  async function byToken(c, slug, token, lock = false) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound("link_not_found");
    // The link works only on its own clinic's page.
    const a = await one(c, `select a.id, a.clinic_id, a.doctor_id, a.service_id, a.patient_id, a.starts_at, a.status from appointments a
                             where a.manage_token_hash = $1 and a.source = 'web' and a.clinic_id = (select id from clinics where slug = $2)${lock ? " for update of a" : ""}`,
      [sha256hex(token), slug]);
    if (!a) throw notFound("link_not_found");
    return a;
  }
  async function manage(slug, token) { const a = await byToken(pool, slug, token); return summary(pool, a.id); }

  async function cancel(slug, token, ctx) {
    const a0 = await byToken(pool, slug, token);
    return tx({ ...ctx, patientId: a0.patient_id, reason: ctx.reason }, a0.clinic_id, async (c) => {
      const a = await byToken(c, slug, token, true);
      if (!(await summary(c, a.id)).canCancel) throw new HttpError(409, "cannot_cancel");
      await c.query("update appointments set status = 'cancelled', cancel_reason = $2 where id = $1", [a.id, ctx.reason || "Cancelled by the patient online"]);
      return summary(c, a.id);
    });
  }

  async function manageSlots(slug, token, from) {
    const a = await byToken(pool, slug, token);
    const k = await clinicById(pool, a.clinic_id);
    if (!k.enabled) throw notFound("link_not_found");
    const s = await service(pool, k, a.service_id);
    const starts = await freeStarts(pool, k, a.doctor_id, s.duration_minutes, from, addDays(from, k.days_per_page - 1), { ...bounds(k), excludeId: a.id });
    return starts.map((t) => ({ doctorId: a.doctor_id, startsAt: new Date(t).toISOString() }));
  }

  // Same doctor and service, a new time. A booking a secretary already checked stays checked: the number was checked, not the time.
  async function reschedule(slug, token, startsAtRaw, ctx) {
    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) throw bad("invalid_time");
    const a0 = await byToken(pool, slug, token);
    try {
      return await tx({ ...ctx, patientId: a0.patient_id }, a0.clinic_id, async (c) => {
        const a = await byToken(c, slug, token, true);
        if (!(await summary(c, a.id)).canReschedule) throw new HttpError(409, "cannot_reschedule");
        const k = await clinicById(c, a.clinic_id), s = await service(c, k, a.service_id);
        if (!(await isFree(c, k, a.doctor_id, s.duration_minutes, startsAt, a.id))) throw new HttpError(409, "slot_taken");
        await c.query("update appointments set starts_at = $2, ends_at = $3 where id = $1", [a.id, startsAt, new Date(startsAt.getTime() + s.duration_minutes * MIN)]);
        return summary(c, a.id);
      });
    } catch (e) {
      if (e.constraint === "no_overlapping_appointments") throw new HttpError(409, "slot_taken");
      throw e;
    }
  }

  return { info, slots, book, manage, cancel, manageSlots, reschedule, limits };
}
