// Clinic settings (design §5). Administrators change them; secretaries see them read-only. Every change is audited by the database
// with before and after. Changing hours, closures or rules never moves or cancels a booking: the answer lists the bookings that
// no longer fit, so staff can contact those patients.
import { HttpError, bad, notFound } from "./http.js";

export const OPTIONS = {
  slotMinutes: [5, 10, 15, 20, 30, 60], bufferMinutes: [0, 5, 10, 15],
  idleMinutes: [15, 30, 60, 120, 240], lockMinutes: [0, 5, 10, 15, 30],
  reminderMinutes: [2880, 1440, 720, 240, 120, 60],
};

// Settings > Online booking: each body field and its column.
export const ONLINE_FIELDS = {
  enabled: "enabled", staffCheck: "staff_check", showPrices: "show_prices", allowAnyDoctor: "allow_any_doctor", allowCancel: "allow_cancel",
  allowReschedule: "allow_reschedule", allowForOther: "allow_for_other", offerReminders: "offer_reminders", defaultCountryCode: "default_country_code",
  maxUncheckedPerPhone: "max_unchecked_per_phone", bookingsPerPhonePerDay: "bookings_per_phone_per_day", bookingsPerIpPerDay: "bookings_per_ip_per_day",
  lookupsPerIpPerMinute: "lookups_per_ip_per_minute", managePerIpPerHour: "manage_per_ip_per_hour", daysPerPage: "days_per_page",
  introEn: "intro_en", introAr: "intro_ar", doneNoteEn: "done_note_en", doneNoteAr: "done_note_ar", shareMessageEn: "share_message_en", shareMessageAr: "share_message_ar", privacyUrl: "privacy_url",
  findEnabled: "find_enabled", findPerPhonePerDay: "find_per_phone_per_day", findPerIpPerHour: "find_per_ip_per_hour",
  findMessageEn: "find_message_en", findMessageAr: "find_message_ar",
};
const ONLINE_COLS = Object.values(ONLINE_FIELDS);

export function createSettings({ pool, tx, now = () => new Date() }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];

  async function read(ctx) {
    const id = ctx.clinicId;
    const q = (sql) => pool.query(sql, [id]).then((r) => r.rows);
    const [[profile], hours, closures, doctors, services, faqs, rules, [general], [online]] = await Promise.all([
      q(`select id, slug, name_en, name_ar, timezone, phone, address_en, address_ar, maps_url, default_language, week_start, slot_step_minutes from clinics where id = $1`),
      q(`select id, weekday, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as "end" from clinic_hours where clinic_id = $1 order by weekday, start_time`),
      q(`select id, doctor_id, starts_at, ends_at, reason from time_off where clinic_id = $1 and ends_at > now() - interval '30 days' order by starts_at`),
      q(`select d.id, d.name_en, d.name_ar, d.title_en, d.title_ar, d.gender, d.active, d.slot_minutes, d.buffer_minutes,
                coalesce((select array_agg(ds.service_id) from doctor_services ds where ds.doctor_id = d.id), '{}') as service_ids,
                coalesce((select json_agg(json_build_object('weekday', w.weekday, 'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI')) order by w.weekday, w.start_time)
                            from working_hours w where w.doctor_id = d.id), '[]') as hours
           from doctors d where d.clinic_id = $1 order by d.active desc, d.name_en`),
      q(`select id, name_en, name_ar, description_en, description_ar, duration_minutes, price_jod, price_is_from, active, sort from services where clinic_id = $1 order by active desc, sort, name_en`),
      q(`select id, topic, question_en, question_ar, answer_en, answer_ar, sort from clinic_faqs where clinic_id = $1 order by sort`),
      q(`select audience, min_notice_minutes, window_days, change_notice_minutes, max_upcoming, outside_hours, walkin_back_minutes, require_cancel_reason
           from booking_rules where clinic_id = $1 order by audience`),
      q(`select idle_timeout_minutes, lock_after_minutes, require_2fa_all, conversation_visibility, audit_retention_months, reminders_enabled,
                reminder_offsets_minutes, to_char(quiet_start, 'HH24:MI') as quiet_start, to_char(quiet_end, 'HH24:MI') as quiet_end,
                assistant_enabled, after_hours_message_en, after_hours_message_ar, handoff_alert_emails
           from clinic_settings where clinic_id = $1`),
      // "Find my booking" sends by WhatsApp, so it can only be switched on once the clinic's WhatsApp number is connected.
      q(`select ${ONLINE_COLS.map((x) => `o.${x}`).join(", ")}, (c.wa_phone_number_id is not null) as whatsapp_connected
           from online_booking o join clinics c on c.id = o.clinic_id where o.clinic_id = $1`),
    ]);
    return { profile, hours, closures, doctors, services, faqs, rules, general, online, options: OPTIONS, outside: await outside(ctx) };
  }

  // Upcoming active bookings that no longer fit the hours, a closure or leave, or whose doctor was switched off.
  async function outside(ctx) {
    const { rows } = await pool.query(
      `select a.id, a.starts_at, p.full_name as patient_name, p.phone_e164 as patient_phone, d.name_en as doctor_name_en, d.name_ar as doctor_name_ar
         from appointments a
         join clinics c on c.id = a.clinic_id
         join patients p on p.clinic_id = a.clinic_id and p.id = a.patient_id
         join doctors d on d.clinic_id = a.clinic_id and d.id = a.doctor_id
         cross join lateral (select a.starts_at at time zone c.timezone as ls, a.ends_at at time zone c.timezone as le) t
        where a.clinic_id = $1 and a.status in ('booked', 'confirmed') and a.starts_at > $2
          and (not d.active
            or not exists (select 1 from working_hours w where w.doctor_id = a.doctor_id and w.weekday = extract(dow from t.ls)::int
                            and t.ls::time >= w.start_time and t.le::time <= w.end_time)
            or (exists (select 1 from clinic_hours h where h.clinic_id = a.clinic_id)
                and not exists (select 1 from clinic_hours h where h.clinic_id = a.clinic_id and h.weekday = extract(dow from t.ls)::int
                                 and t.ls::time >= h.start_time and t.le::time <= h.end_time))
            or exists (select 1 from time_off o where o.clinic_id = a.clinic_id and (o.doctor_id is null or o.doctor_id = a.doctor_id)
                        and o.starts_at < a.ends_at and o.ends_at > a.starts_at))
        order by a.starts_at limit 100`, [ctx.clinicId, now()]);
    return rows;
  }
  const withOutside = async (ctx) => ({ ok: true, outside: await outside(ctx) });

  const friendly = (e) => {
    if (e.code === "23P01") return new HttpError(409, "hours_overlap");
    if (e.code === "23514") return bad("invalid_value");
    return e;
  };
  const write = async (ctx, fn) => { try { return await tx(ctx, fn); } catch (e) { throw friendly(e); } };
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  function checkPeriods(periods) {
    for (const p of periods) if (toMin(p.end) <= toMin(p.start)) throw bad("end_before_start");
  }

  async function ownDoctor(c, ctx, id) {
    const d = await one(c, "select id from doctors where clinic_id = $1 and id = $2", [ctx.clinicId, id]);
    if (!d) throw notFound("doctor_not_found");
  }

  async function updateProfile(ctx, b) {
    try { new Intl.DateTimeFormat("en", { timeZone: b.timezone }); } catch { throw bad("invalid_timezone"); }
    await write(ctx, (c) => c.query(
      `update clinics set name_en=$2, name_ar=$3, phone=$4, address_en=$5, address_ar=$6, maps_url=$7, timezone=$8, default_language=$9, week_start=$10, slot_step_minutes=$11 where id=$1`,
      [ctx.clinicId, b.nameEn, b.nameAr, b.phone || null, b.addressEn || null, b.addressAr || null, b.mapsUrl || null, b.timezone, b.defaultLanguage, b.weekStart, b.slotStepMinutes]));
    return withOutside(ctx);
  }

  async function setClinicHours(ctx, periods) {
    checkPeriods(periods);
    await write(ctx, async (c) => {
      await c.query("delete from clinic_hours where clinic_id = $1", [ctx.clinicId]);
      for (const p of periods) await c.query("insert into clinic_hours (clinic_id, weekday, start_time, end_time) values ($1,$2,$3,$4)", [ctx.clinicId, p.weekday, p.start, p.end]);
    });
    return withOutside(ctx);
  }

  async function addTimeOff(ctx, b) {
    if (Date.parse(b.endsAt) <= Date.parse(b.startsAt)) throw bad("end_before_start");
    const row = await write(ctx, async (c) => {
      if (b.doctorId) await ownDoctor(c, ctx, b.doctorId);
      return one(c, "insert into time_off (clinic_id, doctor_id, starts_at, ends_at, reason) values ($1,$2,$3,$4,$5) returning id", [ctx.clinicId, b.doctorId ?? null, b.startsAt, b.endsAt, b.reason || null]);
    });
    return { ...(await withOutside(ctx)), id: row.id };
  }
  async function removeTimeOff(ctx, id) {
    await write(ctx, async (c) => {
      const r = await c.query("delete from time_off where clinic_id = $1 and id = $2", [ctx.clinicId, id]);
      if (!r.rowCount) throw notFound("not_found");
    });
    return withOutside(ctx);
  }

  async function createDoctor(ctx, b) {
    const r = await write(ctx, (c) => one(c, `insert into doctors (clinic_id, name_en, name_ar, title_en, title_ar, gender, slot_minutes, buffer_minutes)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [ctx.clinicId, b.nameEn, b.nameAr, b.titleEn || null, b.titleAr || null, b.gender ?? null, b.slotMinutes ?? null, b.bufferMinutes ?? 0]));
    return { ok: true, id: r.id };
  }
  async function updateDoctor(ctx, id, b) {
    await write(ctx, async (c) => {
      await ownDoctor(c, ctx, id);
      await c.query(`update doctors set name_en=$3, name_ar=$4, title_en=$5, title_ar=$6, gender=$7, slot_minutes=$8, buffer_minutes=$9, active=$10 where clinic_id=$1 and id=$2`,
        [ctx.clinicId, id, b.nameEn, b.nameAr, b.titleEn || null, b.titleAr || null, b.gender ?? null, b.slotMinutes ?? null, b.bufferMinutes, b.active]);
    });
    return withOutside(ctx);
  }
  // A doctor's weekly hours must fit inside the clinic's, when those are set.
  async function setDoctorHours(ctx, id, periods) {
    checkPeriods(periods);
    await write(ctx, async (c) => {
      await ownDoctor(c, ctx, id);
      const clinic = (await c.query("select weekday, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as end from clinic_hours where clinic_id = $1", [ctx.clinicId])).rows;
      if (clinic.length) {
        for (const p of periods) {
          if (!clinic.some((h) => h.weekday === p.weekday && toMin(h.start) <= toMin(p.start) && toMin(p.end) <= toMin(h.end))) throw bad("doctor_hours_outside_clinic", { weekday: p.weekday });
        }
      }
      await c.query("delete from working_hours where clinic_id = $1 and doctor_id = $2", [ctx.clinicId, id]);
      for (const p of periods) await c.query("insert into working_hours (clinic_id, doctor_id, weekday, start_time, end_time) values ($1,$2,$3,$4,$5)", [ctx.clinicId, id, p.weekday, p.start, p.end]);
    });
    return withOutside(ctx);
  }
  async function setDoctorServices(ctx, id, serviceIds) {
    await write(ctx, async (c) => {
      await ownDoctor(c, ctx, id);
      const known = (await c.query("select id from services where clinic_id = $1 and id = any($2::uuid[])", [ctx.clinicId, serviceIds])).rows;
      if (known.length !== new Set(serviceIds).size) throw bad("unknown_service");
      await c.query("delete from doctor_services where clinic_id = $1 and doctor_id = $2 and not (service_id = any($3::uuid[]))", [ctx.clinicId, id, serviceIds]);
      for (const s of serviceIds) await c.query("insert into doctor_services (clinic_id, doctor_id, service_id) values ($1,$2,$3) on conflict do nothing", [ctx.clinicId, id, s]);
    });
    return { ok: true };
  }

  const serviceParams = (b) => [b.nameEn, b.nameAr, b.descriptionEn || null, b.descriptionAr || null, b.durationMinutes, b.priceJod ?? null, !!b.priceIsFrom];
  async function createService(ctx, b) {
    const r = await write(ctx, (c) => one(c, `insert into services (clinic_id, name_en, name_ar, description_en, description_ar, duration_minutes, price_jod, price_is_from, sort)
      values ($1,$2,$3,$4,$5,$6,$7,$8, (select coalesce(max(sort), 0) + 1 from services where clinic_id = $1)) returning id`, [ctx.clinicId, ...serviceParams(b)]));
    return { ok: true, id: r.id };
  }
  async function updateService(ctx, id, b) {
    await write(ctx, async (c) => {
      const r = await c.query(`update services set name_en=$3, name_ar=$4, description_en=$5, description_ar=$6, duration_minutes=$7, price_jod=$8, price_is_from=$9, active=$10
        where clinic_id=$1 and id=$2`, [ctx.clinicId, id, ...serviceParams(b), b.active]);
      if (!r.rowCount) throw notFound("not_found");
    });
    return { ok: true };
  }

  async function updateRules(ctx, audience, b) {
    await write(ctx, (c) => c.query(
      `update booking_rules set min_notice_minutes=$3, window_days=$4, change_notice_minutes=$5, max_upcoming=$6,
         outside_hours=coalesce($7, outside_hours), walkin_back_minutes=coalesce($8, walkin_back_minutes), require_cancel_reason=coalesce($9, require_cancel_reason)
       where clinic_id=$1 and audience=$2`,
      [ctx.clinicId, audience, b.minNoticeMinutes, b.windowDays, b.changeNoticeMinutes, b.maxUpcoming ?? null,
       audience === "staff" ? b.outsideHours ?? null : null, audience === "staff" ? b.walkinBackMinutes ?? null : null, audience === "staff" ? b.requireCancelReason ?? null : null]));
    return { ok: true };
  }

  async function updateGeneral(ctx, b) {
    const offsets = [...new Set(b.reminderOffsetsMinutes)].sort((x, y) => y - x);
    await write(ctx, (c) => c.query(
      `update clinic_settings set idle_timeout_minutes=$2, lock_after_minutes=$3, require_2fa_all=$4, conversation_visibility=$5, audit_retention_months=$6,
         reminders_enabled=$7, reminder_offsets_minutes=$8, quiet_start=$9, quiet_end=$10, assistant_enabled=$11,
         after_hours_message_en=$12, after_hours_message_ar=$13, handoff_alert_emails=$14 where clinic_id=$1`,
      [ctx.clinicId, b.idleTimeoutMinutes, b.lockAfterMinutes, b.require2faAll, b.conversationVisibility, b.auditRetentionMonths ?? null,
       b.remindersEnabled, offsets, b.quietStart, b.quietEnd, b.assistantEnabled,
       b.afterHoursMessageEn || null, b.afterHoursMessageAr || null, b.handoffAlertEmails]));
    return { ok: true };
  }

  // Settings > Online booking. Every limit and text of the public page is here.
  async function updateOnline(ctx, b) {
    const keys = Object.keys(ONLINE_FIELDS);
    const sets = keys.map((k, i) => `${ONLINE_FIELDS[k]} = $${i + 2}`).join(", ");
    const vals = keys.map((k) => (typeof b[k] === "string" ? b[k].trim() || null : b[k] ?? null));
    await write(ctx, (c) => c.query(`update online_booking set ${sets} where clinic_id = $1`, [ctx.clinicId, ...vals]));
    return { ok: true };
  }

  async function addFaq(ctx, b) {
    const r = await write(ctx, (c) => one(c, `insert into clinic_faqs (clinic_id, topic, question_en, question_ar, answer_en, answer_ar, sort)
      values ($1,$2,$3,$4,$5,$6,(select coalesce(max(sort), 0) + 1 from clinic_faqs where clinic_id = $1)) returning id`,
      [ctx.clinicId, b.topic, b.questionEn, b.questionAr, b.answerEn, b.answerAr]));
    return { ok: true, id: r.id };
  }
  async function updateFaq(ctx, id, b) {
    await write(ctx, async (c) => {
      const r = await c.query("update clinic_faqs set topic=$3, question_en=$4, question_ar=$5, answer_en=$6, answer_ar=$7 where clinic_id=$1 and id=$2", [ctx.clinicId, id, b.topic, b.questionEn, b.questionAr, b.answerEn, b.answerAr]);
      if (!r.rowCount) throw notFound("not_found");
    });
    return { ok: true };
  }
  async function removeFaq(ctx, id) {
    await write(ctx, async (c) => {
      const r = await c.query("delete from clinic_faqs where clinic_id=$1 and id=$2", [ctx.clinicId, id]);
      if (!r.rowCount) throw notFound("not_found");
    });
    return { ok: true };
  }

  return { read, outside, updateProfile, setClinicHours, addTimeOff, removeTimeOff, createDoctor, updateDoctor, setDoctorHours, setDoctorServices,
           createService, updateService, updateRules, updateGeneral, updateOnline, addFaq, updateFaq, removeFaq };
}
