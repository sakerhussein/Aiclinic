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
import { paymentNote } from "./online-visits.js";

const ACTIVE = ["booked", "confirmed"];
const DAY = 86400000;
export const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");

// agent: async ({ clinic_id, chat_id, text, events }) => { reply, buttons, proposal, callback, emergency } — the WhatsApp
// assistant's web mode (agent/limitsiz_agent/agent/web.py), or null when the web chat is not set up on this server.
export function createPublicService({ pool, now = () => new Date(), agent = null }) {
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
    const k = await one(pool, `select o.lookups_per_ip_per_minute, o.bookings_per_ip_per_day, o.manage_per_ip_per_hour, o.find_per_ip_per_hour
      from clinics c join online_booking o on o.clinic_id = c.id where c.slug = $1`, [slug]);
    return k ?? null;
  }

  // ---------------------------------------------------------------- online visits (Settings › Online visits, Settings › Payment)
  const onlineOf = (c, clinicId) => one(c, "select * from online_visits where clinic_id = $1", [clinicId]);
  const paymentOf = (c, clinicId) => one(c, "select * from clinic_payment where clinic_id = $1", [clinicId]);
  // The ways the patient can pick on the page: WhatsApp (sent by the clinic) and email. SMS waits for a provider; print is at the desk.
  const pageChannels = (ov) => ov.channels.filter((c) => c === "whatsapp" || c === "email");
  async function payment(c, clinicId, price) {
    const p = await paymentOf(c, clinicId);
    const en = paymentNote(p, price, "en");
    return en ? { noteEn: en, noteAr: paymentNote(p, price, "ar"), alias: p.cliq_alias, name: p.cliq_name, when: p.pay_when } : null;
  }
  // The way into Teams for this visit, from the private link or a Join link (the database decides: confirmed, inside the window).
  async function joinInfo(c, hash, count = false) {
    const j = await one(c, "select * from public.online_join($1, $2, $3)", [hash, count, now()]);
    return j ? { state: j.state, opensAt: j.opens_at, closesAt: j.closes_at, url: j.url, appointmentId: j.appointment_id, clinicId: j.clinic_id } : null;
  }

  async function info(slug) {
    const k = await clinicBySlug(pool, slug);
    const services = (await pool.query(
      `select s.id, s.name_en, s.name_ar, s.description_en, s.description_ar, s.duration_minutes, s.price_jod, s.price_is_from, s.online_allowed
         from services s where s.clinic_id = $1 and s.active
          and exists (select 1 from doctor_services ds join doctors d on d.id = ds.doctor_id and d.active where ds.service_id = s.id)
        order by s.sort, s.name_en`, [k.id])).rows.map((s) => (k.show_prices ? s : { ...s, price_jod: null, price_is_from: false }));
    const doctors = (await pool.query(
      `select d.id, d.name_en, d.name_ar, d.title_en, d.title_ar, d.online_enabled, d.online_min_notice_minutes,
              coalesce(array_agg(ds.service_id) filter (where ds.service_id is not null), '{}') as service_ids
         from doctors d left join doctor_services ds on ds.doctor_id = d.id where d.clinic_id = $1 and d.active group by d.id order by d.name_en`, [k.id])).rows;
    // Online visits are offered when they are on and at least one service offered online has a doctor who offers them.
    const ov = await onlineOf(pool, k.id);
    const onlineOn = !!ov?.enabled && services.some((s) => s.online_allowed && doctors.some((d) => d.online_enabled && d.service_ids.includes(s.id)));
    const chans = onlineOn ? pageChannels(ov) : [];
    const online = onlineOn ? { enabled: true, modeChoice: ov.mode === "patient", consentEn: ov.consent_en, consentAr: ov.consent_ar, consentVersion: ov.consent_version,
      howToEn: ov.how_to_en, howToAr: ov.how_to_ar, channels: ov.patient_picks ? chans : [], defaultChannel: chans.includes(ov.default_channel) ? ov.default_channel : chans[0] ?? null,
      linkWhen: ov.link_when, whoCanBook: ov.who_can_book } : { enabled: false };
    const pay = onlineOn ? await paymentOf(pool, k.id) : null;
    return {
      clinic: { slug: k.slug, nameEn: k.name_en, nameAr: k.name_ar, phone: k.phone, addressEn: k.address_en, addressAr: k.address_ar, mapsUrl: k.maps_url,
                timezone: k.timezone, defaultLanguage: k.default_language, weekStart: k.week_start },
      services, doctors,
      options: { allowAnyDoctor: k.allow_any_doctor, allowForOther: k.allow_for_other, offerReminders: k.offer_reminders, showPrices: k.show_prices,
                 daysPerPage: k.days_per_page, windowDays: k.window_days, countryCode: k.default_country_code,
                 introEn: k.intro_en, introAr: k.intro_ar, doneNoteEn: k.done_note_en, doneNoteAr: k.done_note_ar, privacyUrl: k.privacy_url,
                 findEnabled: (await one(pool, "select public.online_find_available($1) as ok", [k.id])).ok,
                 chatEnabled: !!(k.chat_enabled && agent), online,
                 payment: pay?.cliq_enabled && pay.for_online ? { alias: pay.cliq_alias, name: pay.cliq_name, when: pay.pay_when } : null },
    };
  }

  // ---------------------------------------------------------------- "Talk to the assistant"
  // The assistant only proposes a time. The booking is made here, by book(), when the patient presses Yes, with the name and
  // number from the page's form: they never reach the AI. What happens here goes to the assistant as "events".
  async function chatClinic(slug) {
    const k = await clinicBySlug(pool, slug);
    if (!k.chat_enabled || !agent) throw notFound("chat_not_available");
    return k;
  }
  async function chatRow(c, k, chatId, lock = false) {
    const r = await one(c, `select * from web_chats where id = $1 and clinic_id = $2${lock ? " for update" : ""}`, [chatId, k.id]);
    if (!r) throw notFound("chat_not_found");
    return r;
  }
  const event = (c, id, text) => c.query("update web_chats set events = events || to_jsonb($2::text), last_at = now() where id = $1", [id, text]);

  async function chatStart(slug, ctx) {
    const k = await chatClinic(slug);
    const { n } = await one(pool, "select count(*)::int as n from web_chats where clinic_id = $1 and ip = $2 and created_at > now() - interval '1 day'", [k.id, ctx.ip ?? null]);
    if (n >= k.chat_chats_per_ip_per_day) throw new HttpError(429, "too_many_chats");
    return { chatId: (await one(pool, "insert into web_chats (clinic_id, ip) values ($1, $2) returning id", [k.id, ctx.ip ?? null])).id };
  }

  // language: the page's language, which follows the conversation (see chat.tsx languageOf); the assistant answers in it.
  async function chatMessage(slug, chatId, text, language) {
    const k = await chatClinic(slug);
    const c = await pool.connect();
    let events;
    try {
      await c.query("begin");
      const chat = await chatRow(c, k, chatId, true);
      if (chat.messages >= k.chat_messages_per_chat) throw new HttpError(429, "chat_limit");
      const { used } = await one(c, "select coalesce(sum(messages), 0)::int as used from web_chats where clinic_id = $1 and created_at > now() - interval '1 day'", [k.id]);
      if (used >= k.chat_messages_per_clinic_per_day) throw new HttpError(503, "assistant_busy");
      events = chat.events ?? [];
      await c.query("update web_chats set messages = messages + 1, events = '[]', last_at = now() where id = $1", [chatId]);
      await c.query("commit");
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
    let out;
    try { out = await agent({ clinic_id: k.id, chat_id: chatId, text, events, ...(language ? { language } : {}) }); }
    catch { throw new HttpError(503, "assistant_unavailable"); }
    // Kept for the Yes button and the call-back form: only what the assistant proposed or passed on, never typed details.
    await pool.query("update web_chats set proposal = coalesce($2::jsonb, proposal), callback = coalesce($3::jsonb, callback) where id = $1",
      [chatId, out.proposal ? JSON.stringify(out.proposal) : null, out.callback ? JSON.stringify(out.callback) : null]);
    const p = out.proposal;
    return { reply: out.reply ?? null, buttons: out.buttons ?? null, emergency: !!out.emergency, callback: !!out.callback,
             proposal: p ? { serviceEn: p.serviceEn, serviceAr: p.serviceAr, doctorEn: p.doctorEn, doctorAr: p.doctorAr, startsAt: p.startsAt } : null };
  }

  async function chatBook(slug, chatId, ctx, b) {
    const k = await chatClinic(slug);
    const chat = await chatRow(pool, k, chatId);
    const p = chat.proposal;
    if (!p) throw new HttpError(409, "nothing_to_book");
    try {
      const r = await book(slug, ctx, { serviceId: p.serviceId, doctorId: p.doctorId, startsAt: p.startsAt, name: b.name, phone: b.phone,
        language: b.language, from: "chat", reminders: false, forOther: false });
      await pool.query("update web_chats set appointment_id = $2, proposal = null where id = $1", [chatId, r.id]);
      await event(pool, chatId, `The booking was made: ${p.summary}. ${r.waitingForCheck ? "The clinic will check it and may call or message the patient." : ""} `
        + "The patient got a private link to see the status, change or cancel it.");
      return r;
    } catch (e) {
      const why = e.code === "slot_taken" ? " The time was just taken; offer other times."
        : e.code === "phone_not_accepted" ? " The clinic did not accept a booking for this number online. Offer a call-back or the clinic's phone." : "";
      await event(pool, chatId, `The booking could not be made (${e.code ?? "error"}). Nothing was booked.${why}`);
      throw e;
    }
  }

  async function chatCallback(slug, chatId, ctx, b) {
    const k = await chatClinic(slug);
    const chat = await chatRow(pool, k, chatId);
    if ((chat.callback?.sent ?? 0) >= 2) throw new HttpError(429, "too_many_requests");      // at most two call-backs per chat
    const phone = normalizePhone(b.phone, k.default_country_code);
    const cb = chat.callback?.reason ? chat.callback : { reason: "patient_request", summary: "Asked to talk to a person." };
    await pool.query(`insert into web_callbacks (clinic_id, chat_id, kind, reason, summary, full_name, phone_e164)
                      values ($1, $2, 'call_back', $3, $4, $5, $6)`, [k.id, chatId, cb.reason, cb.summary, b.name.trim(), phone]);
    await pool.query(`update web_chats set callback = coalesce(callback, '{}'::jsonb) || jsonb_build_object('sent', coalesce((callback->>'sent')::int, 0) + 1)
                      where id = $1`, [chatId]);
    await event(pool, chatId, "The patient left their name and number for a call-back; the clinic was told.");
    return { ok: true };
  }

  // ---------------------------------------------------------------- "Find my booking"
  // Queues a new link for each upcoming online booking of the number; the WhatsApp assistant sends it. The answer is the same
  // whether the number has bookings or not, so this cannot be used to learn about a number.
  async function find(slug, ctx, phoneRaw) {
    const k = await one(pool, `select c.id, o.default_country_code from clinics c join online_booking o on o.clinic_id = c.id where c.slug = $1`, [slug]);
    if (!k || !(await one(pool, "select public.online_find_available($1) as ok", [k.id])).ok) throw notFound("find_not_available");
    const phone = normalizePhone(phoneRaw, k.default_country_code);
    await pool.query("select public.online_find($1, $2, $3)", [k.id, phone, ctx.ip ?? null]);
    return { ok: true };
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
      `select d.id, d.online_enabled, d.online_min_notice_minutes from doctors d join doctor_services ds on ds.doctor_id = d.id and ds.service_id = $2
        where d.clinic_id = $1 and d.active and ($3::uuid is null or d.id = $3::uuid) order by d.name_en`, [k.id, serviceId, doctorId ?? null]);
    if (!rows.length) throw bad("doctor_does_not_offer_service");
    return rows;
  }
  // An online visit: online visits on, the service offered online, and only doctors who offer them.
  async function onlineDoctors(c, k, s, docs) {
    const ov = await onlineOf(c, k.id);
    if (!ov?.enabled) throw new HttpError(409, "online_visits_off");
    if (!(await one(c, "select online_allowed from services where id = $1", [s.id]))?.online_allowed) throw bad("service_not_online");
    const online = docs.filter((d) => d.online_enabled);
    if (!online.length) throw bad("doctor_not_online");
    return { ov, docs: online };
  }
  // The doctor's "earliest online booking" (Settings › Doctors), on top of the clinic's minimum notice for patients.
  const boundsFor = (k, d, isOnline) => {
    const b = bounds(k);
    return isOnline ? { ...b, earliest: Math.max(b.earliest, now().getTime() + (d.online_min_notice_minutes ?? 0) * MIN) } : b;
  };
  async function slots(slug, { serviceId, doctorId, from, days, visit }) {
    const k = await clinicBySlug(pool, slug), s = await service(pool, k, serviceId);
    let docs = await doctorsFor(pool, k, serviceId, doctorId);
    const isOnline = visit === "online";
    if (isOnline) docs = (await onlineDoctors(pool, k, s, docs)).docs;
    const n = Math.min(days ?? k.days_per_page, k.days_per_page), out = [];
    for (const d of docs) {
      for (const t of await freeStarts(pool, k, d.id, s.duration_minutes, from, addDays(from, n - 1), boundsFor(k, d, isOnline))) out.push({ doctorId: d.id, startsAt: new Date(t).toISOString() });
    }
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  async function isFree(c, k, doctor, durationMin, startsAt, excludeId = null, isOnline = false) {
    const day = startsAt.toISOString().slice(0, 10);
    const free = await freeStarts(c, k, doctor.id, durationMin, addDays(day, -1), addDays(day, 1), { ...boundsFor(k, doctor, isOnline), excludeId });
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
    const isOnline = b.visitType === "online";
    try {
      return await tx(ctx, k.id, async (c) => {
        const s = await service(c, k, b.serviceId);
        let docs = await doctorsFor(c, k, b.serviceId, b.doctorId ?? null);
        // Online: who may book it themselves is the clinic's setting (the profile mark, seen before, or everyone), or the doctor's
        // one-time "next follow-up can be online". A number that may not gets the same answer as every other refusal.
        let ov = null, check = null, mode = null, channel = null, email = null;
        if (isOnline) {
          ({ ov, docs } = await onlineDoctors(c, k, s, docs));
          if (b.onlineConsent !== true) throw bad("consent_needed");
          check = await one(c, "select * from public.online_visit_check($1, $2)", [k.id, phone]);
          if (!check.allowed) throw phoneRefused();
          mode = check.mode === "patient" ? b.onlineMode : check.mode;
          if (!mode) throw new HttpError(409, "choose_mode");
          const chans = pageChannels(ov);
          channel = ov.patient_picks && b.linkChannel ? b.linkChannel : chans.includes(ov.default_channel) ? ov.default_channel : chans[0] ?? ov.default_channel;
          if (ov.patient_picks && b.linkChannel && !chans.includes(b.linkChannel)) throw bad("channel_off");
          email = channel === "email" ? b.email?.trim().toLowerCase() || null : null;
          if (channel === "email" && !email) throw bad("email_needed");
        }
        let doctorId = null;
        for (const d of docs) if (await isFree(c, k, d, s.duration_minutes, startsAt, null, isOnline)) { doctorId = d.id; break; }
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
            booked_for_other, needs_check, manage_token_hash, visit_type, online_mode, link_channel, link_email, online_consent_at, online_consent_version)
            values ($1,$2,$3,$4,$5,$6,'web',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
          [k.id, doctorId, s.id, patientId, startsAt, endsAt, b.from ?? null, b.name.trim(), !!b.forOther, k.staff_check, sha256hex(token),
           isOnline ? "online" : "in_clinic", mode, channel, email, isOnline ? now() : null, isOnline ? ov.consent_version : null]);
        if (check?.next_from) await c.query("select public.online_visit_use($1, $2)", [check.next_from, r.id]);
        const out = { ...(await summary(c, r.id)), manageToken: token };
        if (isOnline) out.join = await joinInfo(c, sha256hex(token));
        return out;
      });
    } catch (e) {
      if (e.constraint === "no_overlapping_appointments") throw new HttpError(409, "slot_taken");
      throw e;
    }
  }

  // What the patient may see of a booking: never the phone number or the clinic's notes.
  async function summary(c, id) {
    const a = await one(c, `select a.id, a.clinic_id, a.starts_at, a.ends_at, a.status, a.needs_check, a.checked_at, a.booked_name, a.moved_online_at,
        a.visit_type, a.online_mode, s.price_jod,
        s.id as service_id, s.name_en as service_name_en, s.name_ar as service_name_ar, s.duration_minutes,
        d.id as doctor_id, d.name_en as doctor_name_en, d.name_ar as doctor_name_ar, d.title_en as doctor_title_en, d.title_ar as doctor_title_ar
      from appointments a join services s on s.id = a.service_id join doctors d on d.id = a.doctor_id where a.id = $1`, [id]);
    const k = await clinicById(c, a.clinic_id);
    const t = now().getTime(), active = ACTIVE.includes(a.status), future = a.starts_at.getTime() > t;
    const inTime = a.starts_at.getTime() - t >= k.change_notice_minutes * MIN;
    return {
      id: a.id, startsAt: a.starts_at, endsAt: a.ends_at, status: a.status, name: a.booked_name, waitingForCheck: a.needs_check && !a.checked_at,
      // What the patient is told: "waiting" while the clinic has not checked the person or not accepted the patient's new time;
      // "confirmed" once it confirmed the booking or checked the person (and the time is the one it agreed to).
      shownStatus: !active ? a.status : a.status === "confirmed" ? "confirmed"
        : a.moved_online_at || (a.needs_check && !a.checked_at) ? "waiting" : a.needs_check ? "confirmed" : "booked",
      service: { id: a.service_id, nameEn: a.service_name_en, nameAr: a.service_name_ar, durationMinutes: a.duration_minutes },
      doctor: { id: a.doctor_id, nameEn: a.doctor_name_en, nameAr: a.doctor_name_ar, titleEn: a.doctor_title_en, titleAr: a.doctor_title_ar },
      clinic: { slug: k.slug, nameEn: k.name_en, nameAr: k.name_ar, phone: k.phone, addressEn: k.address_en, addressAr: k.address_ar, mapsUrl: k.maps_url,
                timezone: k.timezone, doneNoteEn: k.done_note_en, doneNoteAr: k.done_note_ar, daysPerPage: k.days_per_page, windowDays: k.window_days },
      changeNoticeMinutes: k.change_notice_minutes,
      visitType: a.visit_type, onlineMode: a.online_mode,
      ...(a.visit_type === "online" ? await onlineExtras(c, a) : {}),
      canCancel: k.enabled && k.allow_cancel && active && future && inTime,
      canReschedule: k.enabled && k.allow_reschedule && active && future && inTime,
      tooLateToChange: active && future && !inTime,
    };
  }

  // How to join and how to pay, for an online visit (the clinic's texts).
  async function onlineExtras(c, a) {
    const ov = await onlineOf(c, a.clinic_id);
    return { howToEn: ov.how_to_en, howToAr: ov.how_to_ar, payment: await payment(c, a.clinic_id, a.price_jod) };
  }

  // ---------------------------------------------------------------- "Join the visit": book.limitsiz.si/<clinic>/j#<token>
  // Only joins: nothing here can change or cancel. The database says whether the Teams address may be shown now.
  async function join(slug, token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound("link_not_found");
    const j = await joinInfo(pool, sha256hex(token), true);
    if (!j) throw notFound("link_not_found");
    const k = await clinicById(pool, j.clinicId);
    if (!k || k.slug !== slug) throw notFound("link_not_found");
    const a = await one(pool, `select a.id, a.starts_at, a.ends_at, a.status, a.booked_name, a.online_mode, s.name_en as service_name_en, s.name_ar as service_name_ar, s.price_jod,
        d.name_en as doctor_name_en, d.name_ar as doctor_name_ar from appointments a join services s on s.id = a.service_id join doctors d on d.id = a.doctor_id where a.id = $1`, [j.appointmentId]);
    const ov = await onlineOf(pool, k.id);
    return { state: j.state, opensAt: j.opensAt, closesAt: j.closesAt, url: j.url, startsAt: a.starts_at, endsAt: a.ends_at, name: a.booked_name, onlineMode: a.online_mode,
             service: { nameEn: a.service_name_en, nameAr: a.service_name_ar }, doctor: { nameEn: a.doctor_name_en, nameAr: a.doctor_name_ar },
             clinic: { slug: k.slug, nameEn: k.name_en, nameAr: k.name_ar, phone: k.phone, timezone: k.timezone, defaultLanguage: k.default_language },
             howToEn: ov.how_to_en, howToAr: ov.how_to_ar, payment: await payment(pool, k.id, a.price_jod) };
  }

  // ---------------------------------------------------------------- the private link
  async function byToken(c, slug, token, lock = false) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound("link_not_found");
    // The link works only on its own clinic's page.
    const a = await one(c, `select a.id, a.clinic_id, a.doctor_id, a.service_id, a.patient_id, a.starts_at, a.status, a.visit_type from appointments a
                             where a.manage_token_hash = $1 and a.source = 'web' and a.clinic_id = (select id from clinics where slug = $2)${lock ? " for update of a" : ""}`,
      [sha256hex(token), slug]);
    if (!a) {
      // A link replaced through "Find my booking" says so, and points to the newest one.
      if ((await one(c, "select public.online_link_replaced($1, $2) as yes", [slug, sha256hex(token)])).yes) throw new HttpError(410, "link_replaced");
      throw notFound("link_not_found");
    }
    return a;
  }
  async function manage(slug, token) {
    const a = await byToken(pool, slug, token);
    const s = await summary(pool, a.id);
    if (a.visit_type === "online") s.join = await joinInfo(pool, sha256hex(token));
    return s;
  }
  const doctorRow = (c, id) => one(c, "select id, online_enabled, online_min_notice_minutes from doctors where id = $1", [id]);

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
    const starts = await freeStarts(pool, k, a.doctor_id, s.duration_minutes, from, addDays(from, k.days_per_page - 1),
      { ...boundsFor(k, await doctorRow(pool, a.doctor_id), a.visit_type === "online"), excludeId: a.id });
    return starts.map((t) => ({ doctorId: a.doctor_id, startsAt: new Date(t).toISOString() }));
  }

  // Same doctor and service, a new time. The database (migration 0012) puts it back to booked and marks it "Time changed by
  // patient" until the clinic confirms: the clinic has not agreed to the new time yet. The check of the person stays.
  async function reschedule(slug, token, startsAtRaw, ctx) {
    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) throw bad("invalid_time");
    const a0 = await byToken(pool, slug, token);
    try {
      return await tx({ ...ctx, patientId: a0.patient_id }, a0.clinic_id, async (c) => {
        const a = await byToken(c, slug, token, true);
        if (!(await summary(c, a.id)).canReschedule) throw new HttpError(409, "cannot_reschedule");
        const k = await clinicById(c, a.clinic_id), s = await service(c, k, a.service_id);
        if (!(await isFree(c, k, await doctorRow(c, a.doctor_id), s.duration_minutes, startsAt, a.id, a.visit_type === "online"))) throw new HttpError(409, "slot_taken");
        await c.query("update appointments set starts_at = $2, ends_at = $3 where id = $1", [a.id, startsAt, new Date(startsAt.getTime() + s.duration_minutes * MIN)]);
        return summary(c, a.id);
      });
    } catch (e) {
      if (e.constraint === "no_overlapping_appointments") throw new HttpError(409, "slot_taken");
      throw e;
    }
  }

  const ping = () => pool.query("select 1");
  return { info, slots, book, find, manage, cancel, manageSlots, reschedule, limits, ping, chatStart, chatMessage, chatBook, chatCallback, join };
}
