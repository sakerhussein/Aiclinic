// Online visits on Microsoft Teams, staff side (design: booking/design/online-visits.html, migration 0024).
// Settings › Online visits and Settings › Payment, each doctor's online settings, the "Join the visit" links staff send, the
// identity tick and the doctor's "next follow-up can be online" tick. The patient side is in public-service.js.
// The patient never gets the Teams address in a message: a Join link of ours, kept only as a hash, opens it near the time.
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { HttpError, bad, notFound } from "./http.js";

export const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const TEAMS_RE = /^https:\/\/teams\.(microsoft|live)\.com\//;

// Settings › Online visits: each body field and its column.
export const OV_FIELDS = {
  enabled: "enabled", mode: "mode", staffChangeMode: "staff_change_mode", whoCanBook: "who_can_book", linkWhen: "link_when",
  joinOpensMinutes: "join_opens_minutes", joinClosesMinutes: "join_closes_minutes", channels: "channels", patientPicks: "patient_picks",
  defaultChannel: "default_channel", printSize: "print_size", printLanguages: "print_languages", nextVisitDays: "next_visit_days",
  consentEn: "consent_en", consentAr: "consent_ar", howToEn: "how_to_en", howToAr: "how_to_ar", messageEn: "message_en", messageAr: "message_ar",
  emailSubjectEn: "email_subject_en", emailSubjectAr: "email_subject_ar",
};
export const PAY_FIELDS = { cliqEnabled: "cliq_enabled", cliqAlias: "cliq_alias", cliqName: "cliq_name", payWhen: "pay_when", forOnline: "for_online", noteEn: "note_en", noteAr: "note_ar" };
// The ways a patient can get the link (SMS waits for a provider). Print is done at the desk only. WhatsApp also goes out by itself
// from the assistant's number once the clinic's WhatsApp is connected and Meta approved the message (agent/whatsapp/visit_links.py).
export const BUILT_CHANNELS = ["whatsapp", "email", "print"];

const loc = (lang) => (lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB");
/** "Wed 11 Nov, 17:10" in the clinic's time zone. */
export function whenText(at, tz, lang) {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat(loc(lang), { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${day}${lang === "ar" ? "، " : ", "}${time}`;
}
export const fillText = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
// What the patient is told about paying, or null when the clinic has no payment switched on for online visits.
export function paymentNote(pay, price, lang) {
  if (!pay?.cliq_enabled || !pay.for_online) return null;
  const p = price === null || price === undefined ? "" : String(Number(price));
  return fillText(lang === "ar" ? pay.note_ar : pay.note_en, { price: p, alias: pay.cliq_alias, name: pay.cliq_name }).replace(/\s{2,}/g, " ").trim();
}

// Email to patients (the visit link). Without SMTP on the server it is "not set up", and Settings says so.
export function createPatientMailer(config, { log = console.log } = {}) {
  const s = config.smtp;
  if (!s) return null;
  const transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
  return async ({ to, subject, text, html, fromName }) => {
    await transport.sendMail({ from: fromName ? { name: fromName, address: s.from } : s.from, to, subject, text, html });
    log(`[visit link emailed] ${subject}`);
    return true;
  };
}
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function createOnlineVisits({ pool, tx, now = () => new Date(), getAppointment, mail = null }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];
  const friendly = (e) => (e?.code === "23514" ? bad("invalid_value") : e);

  // ---------------------------------------------------------------- settings
  async function settings(c, clinicId) { return one(c, "select * from online_visits where clinic_id = $1", [clinicId]); }
  async function payment(c, clinicId) { return one(c, "select * from clinic_payment where clinic_id = $1", [clinicId]); }
  async function read(ctx) {
    const v = await settings(pool, ctx.clinicId), p = await payment(pool, ctx.clinicId);
    return { visits: v, payment: p, mailReady: !!mail, builtChannels: BUILT_CHANNELS };
  }

  async function update(ctx, b) {
    if (!b.channels.includes(b.defaultChannel)) throw bad("invalid_value");
    try {
      await tx(ctx, async (c) => {
        const cur = await settings(c, ctx.clinicId);
        const keys = Object.keys(OV_FIELDS);
        const sets = keys.map((k, i) => `${OV_FIELDS[k]} = $${i + 2}`).join(", ");
        const vals = keys.map((k) => (typeof b[k] === "string" ? b[k].trim() : b[k]));
        // A changed consent text is a new version: bookings keep the version the patient agreed to.
        const changed = cur.consent_en !== b.consentEn.trim() || cur.consent_ar !== b.consentAr.trim();
        await c.query(`update online_visits set ${sets}, consent_version = consent_version + $${keys.length + 2}, row_version = row_version + 1 where clinic_id = $1`,
          [ctx.clinicId, ...vals, changed ? 1 : 0]);
        if (b.onlineServiceIds) {
          const known = (await c.query("select id from services where clinic_id = $1 and id = any($2::uuid[])", [ctx.clinicId, b.onlineServiceIds])).rows;
          if (known.length !== new Set(b.onlineServiceIds).size) throw bad("unknown_service");
          await c.query("update services set online_allowed = (id = any($2::uuid[])) where clinic_id = $1 and online_allowed is distinct from (id = any($2::uuid[]))",
            [ctx.clinicId, b.onlineServiceIds]);
        }
      });
    } catch (e) { throw friendly(e); }
    return { ok: true };
  }

  async function updatePayment(ctx, b) {
    if (b.cliqEnabled && (!b.cliqAlias || !b.cliqName)) throw bad("cliq_details_needed");
    const keys = Object.keys(PAY_FIELDS);
    try {
      await tx(ctx, (c) => c.query(`update clinic_payment set ${keys.map((k, i) => `${PAY_FIELDS[k]} = $${i + 2}`).join(", ")}, row_version = row_version + 1 where clinic_id = $1`,
        [ctx.clinicId, ...keys.map((k) => (typeof b[k] === "string" ? b[k].trim() || null : b[k]))]));
    } catch (e) { throw friendly(e); }
    return { ok: true };
  }

  async function updateDoctor(ctx, id, b) {
    const link = (b.teamsLink || "").trim() || null;
    if (link && !TEAMS_RE.test(link)) throw bad("invalid_teams_link");
    try {
      await tx(ctx, async (c) => {
        const r = await c.query("update doctors set online_enabled = $3, online_min_notice_minutes = $4, teams_link = $5 where clinic_id = $1 and id = $2",
          [ctx.clinicId, id, b.onlineEnabled, b.onlineMinNoticeMinutes, link]);
        if (!r.rowCount) throw notFound("doctor_not_found");
      });
    } catch (e) { throw friendly(e); }
    return { ok: true };
  }

  // ---------------------------------------------------------------- the Join links of one booking (never the token)
  async function links(ctx, id) {
    await getAppointment(ctx, id);
    return (await pool.query(`select id, channel, auto, sent_to, sent_at, sent_by_name, first_opened_at, last_opened_at, opens, stopped_at
                                from join_links where clinic_id = $1 and appointment_id = $2 order by sent_at`, [ctx.clinicId, id])).rows;
  }

  // One send = one Join link. Returns the link and the clinic's text with it filled in, in the patient's language. Email is sent
  // here; WhatsApp (from the clinic's own number), print and copy are done by the browser with what comes back.
  async function send(ctx, id, { channel, email }, publicUrl) {
    if (!publicUrl) throw new HttpError(409, "public_page_not_set_up");
    const a = await getAppointment(ctx, id);
    if (a.visit_type !== "online") throw new HttpError(409, "not_an_online_visit");
    if (!["booked", "confirmed"].includes(a.status)) throw new HttpError(409, "not_editable");
    const v = await settings(pool, ctx.clinicId);
    if (!v.enabled) throw new HttpError(409, "online_visits_off");
    if (channel === "sms") throw new HttpError(409, "sms_not_set_up");
    if (channel !== "copy" && !v.channels.includes(channel)) throw new HttpError(409, "channel_off");
    const to = channel === "email" ? (email || a.link_email || a.patient_email || "").trim().toLowerCase() : null;
    if (channel === "email" && !to) throw bad("email_needed");
    if (channel === "email" && !mail) throw new HttpError(409, "mail_not_set_up");
    const k = await one(pool, "select slug, name_en, name_ar, phone, timezone from clinics where id = $1", [ctx.clinicId]);
    const lang = a.preferred_language === "en" ? "en" : a.preferred_language === "ar" ? "ar" : (await one(pool, "select default_language from clinics where id = $1", [ctx.clinicId])).default_language;
    const token = crypto.randomBytes(32).toString("base64url");
    const url = `${publicUrl}/${k.slug}/j#${token}`;
    const vars = { clinic: lang === "ar" ? k.name_ar : k.name_en, doctor: lang === "ar" ? a.doctor_name_ar : a.doctor_name_en,
                   when: whenText(a.starts_at, k.timezone, lang), link: url };
    const message = fillText(lang === "ar" ? v.message_ar : v.message_en, vars);
    if (channel === "email") {
      const pay = paymentNote(await payment(pool, ctx.clinicId), a.price_jod, lang);
      const how = lang === "ar" ? v.how_to_ar : v.how_to_en;
      const emergency = lang === "ar" ? "ليست للطوارئ." : "Not for emergencies.";
      const button = lang === "ar" ? "ادخل الزيارة" : "Join the visit";
      const text = [message, how, pay, emergency, k.phone ? `${lang === "ar" ? "هاتف العيادة" : "Clinic phone"}: ${k.phone}` : ""].filter(Boolean).join("\n\n");
      const dir = lang === "ar" ? "rtl" : "ltr";
      const html = `<div dir="${dir}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0A0F14">`
        + `<p>${esc(fillText(lang === "ar" ? v.message_ar : v.message_en, { ...vars, link: "" }).trim())}</p>`
        + `<p><a href="${esc(url)}" style="display:inline-block;background:#2EE6B5;color:#0A0F14;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${button}</a></p>`
        + `<p>${esc(how)}</p>${pay ? `<p>${esc(pay)}</p>` : ""}<p style="color:#4B5863">${esc(emergency)}${k.phone ? ` · ${esc(k.phone)}` : ""}</p></div>`;
      await insertLink(ctx, a, token, channel, to);
      try { await mail({ to, subject: fillText(lang === "ar" ? v.email_subject_ar : v.email_subject_en, vars), text, html, fromName: vars.clinic }); }
      catch { throw new HttpError(502, "mail_failed"); }
      return { channel, url, message, sentTo: to, language: lang };
    }
    await insertLink(ctx, a, token, channel, null);
    return { channel, url, message, phone: a.patient_phone, language: lang,
             slip: channel === "print" ? { opensMinutes: v.join_opens_minutes, size: v.print_size, languages: v.print_languages,
               clinicPhone: k.phone, howToEn: v.how_to_en, howToAr: v.how_to_ar } : undefined };
  }
  async function insertLink(ctx, a, token, channel, to) {
    await tx(ctx, (c) => c.query(`insert into join_links (clinic_id, appointment_id, token_hash, channel, sent_to, sent_by, sent_by_name)
                                  values ($1, $2, $3, $4, $5, $6, $7)`, [ctx.clinicId, a.id, sha256hex(token), channel, to, ctx.user.id, ctx.user.name]));
  }

  // After the clinic confirms an online visit (or changes the time or doctor of a confirmed one): the link goes by email straight
  // away when that is the patient's way, once for each time (appointments.link_sent_at, cleared by the database when the time or
  // doctor changes). WhatsApp goes out by itself from the assistant (agent/whatsapp/visit_links.py) on the same mark; print and
  // the clinic's own WhatsApp are sent by staff from the booking.
  async function afterConfirm(ctx, a, publicUrl) {
    if (a.visit_type !== "online" || a.status !== "confirmed" || a.link_channel !== "email" || !mail || !publicUrl) return null;
    const v = await settings(pool, ctx.clinicId);
    if (!v.enabled || v.link_when !== "confirmed" || !v.channels.includes("email")) return null;
    const due = await one(pool, "select 1 from appointments where id = $1 and link_sent_at is null", [a.id]);
    if (!due) return null;
    try {
      const sent = await send(ctx, a.id, { channel: "email" }, publicUrl);
      await tx(ctx, (c) => c.query("update appointments set link_sent_at = now() where id = $1", [a.id]));
      return sent;
    } catch { return null; }
  }

  // ---------------------------------------------------------------- the identity tick, and the doctor's "next follow-up can be online"
  async function lockVisit(c, ctx, id, expectedVersion) {
    const cur = await one(c, "select * from appointments where clinic_id = $1 and id = $2 and ($3::uuid is null or doctor_id = $3) for update", [ctx.clinicId, id, ctx.onlyDoctor ?? null]);
    if (!cur) throw notFound("appointment_not_found");
    if (expectedVersion !== undefined && cur.row_version !== expectedVersion) {
      throw new HttpError(409, "version_conflict", { currentVersion: cur.row_version, changedAt: cur.updated_at, status: cur.status });
    }
    return cur;
  }
  async function identity(ctx, id, { checked, expectedVersion }) {
    return tx(ctx, async (c) => {
      const cur = await lockVisit(c, ctx, id, expectedVersion);
      if (cur.visit_type !== "online") throw new HttpError(409, "not_an_online_visit");
      await c.query(`update appointments set identity_checked_at = case when $3 then now() end, identity_checked_by = case when $3 then $4::uuid end,
                       identity_checked_by_name = case when $3 then $5 end, updated_by = $4 where clinic_id = $1 and id = $2`,
        [ctx.clinicId, id, checked, ctx.user.id, ctx.user.name]);
      return getAppointment(ctx, id, c);
    });
  }
  // Ticked on the visit where the doctor decided it (the doctor or staff, on a booking that is not cancelled or voided).
  async function nextOnline(ctx, id, { on, mode, expectedVersion }) {
    return tx(ctx, async (c) => {
      const cur = await lockVisit(c, ctx, id, expectedVersion);
      if (["cancelled", "voided"].includes(cur.status)) throw new HttpError(409, "not_editable");
      if (cur.next_online_used_by && !on) throw new HttpError(409, "already_used");
      await c.query(`update appointments set next_online = $3, next_online_mode = case when $3 then $4 end,
                       next_online_by = case when $3 then $5::uuid end, next_online_by_name = case when $3 then $6 end,
                       next_online_at = case when $3 then now() end, updated_by = $5 where clinic_id = $1 and id = $2`,
        [ctx.clinicId, id, on, mode ?? null, ctx.user.id, ctx.user.name]);
      return getAppointment(ctx, id, c);
    });
  }

  return { read, update, updatePayment, updateDoctor, links, send, afterConfirm, identity, nextOnline, settings, payment };
}
