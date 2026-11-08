// HTTP layer of Booking. Sign-in is Accounts' (single sign-on); every request is checked with Accounts.
import express from "express";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, parseCookies, cookieString, parse, z, denied } from "./http.js";

const uuid = z.guid();         // any UUID Postgres stores; z.string().uuid() would refuse ids outside RFC 9562
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "dist");

export function createApp({ svc, config, fetchImpl = fetch }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy === "false" ? false : Number(config.trustProxy) || config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
      ...(config.secureCookies ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    });
    if (req.path.startsWith("/api") || req.path.startsWith("/auth")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "20kb" }));
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin") !== config.origin) return next(new HttpError(403, "bad_origin"));
    req.ctxBase = { ip: req.ip, ua: (req.get("user-agent") || "").slice(0, 300), requestId: crypto.randomBytes(8).toString("base64url") };
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const cookieOpts = { secure: config.secureCookies };
  const setCookie = (res, name, value, maxAgeSeconds) => res.append("Set-Cookie", cookieString(name, value, { ...cookieOpts, maxAgeSeconds }));

  // ---- talking to Accounts (server to server, on the same machine)
  async function accounts(pathname, body) {
    let res;
    try {
      res = await fetchImpl(config.accountsInternalUrl + pathname, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: "booking", secret: config.clientSecret, ...body }) });
    } catch { throw new HttpError(503, "accounts_unreachable"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status === 400 ? 400 : 502, data.error || "accounts_error");
    return data;
  }

  // ---------------------------------------------------------------- sign-in (single sign-on)
  app.get("/auth/login", (req, res) => {
    const state = crypto.randomBytes(16).toString("base64url");
    const back = typeof req.query.return === "string" && /^\/(?!\/)[^\s]*$/.test(req.query.return) ? req.query.return : "/";
    setCookie(res, config.stateCookie, `${state}|${back}`, 600);
    const u = new URL("/authorize", config.accountsUrl);
    u.searchParams.set("client", "booking");
    u.searchParams.set("redirect_uri", `${config.siteUrl}/auth/callback`);
    u.searchParams.set("state", state);
    res.redirect(302, u.toString());
  });
  app.get("/auth/callback", wrap(async (req, res) => {
    const [state, back = "/"] = (parseCookies(req.headers.cookie)[config.stateCookie] || "").split("|");
    setCookie(res, config.stateCookie, "", 0);
    if (!state || state !== req.query.state || typeof req.query.code !== "string") return res.redirect(302, "/auth/login");
    const r = await accounts("/token", { code: req.query.code, redirect_uri: `${config.siteUrl}/auth/callback` });
    setCookie(res, config.sessionCookie, r.appSessionToken);
    res.redirect(302, back);
  }));

  // ---------------------------------------------------------------- every request is checked with Accounts
  const NOBODY = "00000000-0000-0000-0000-000000000000";
  const auth = (perm) => wrap(async (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[config.sessionCookie];
    if (!token) throw new HttpError(401, "not_signed_in");
    const touch = req.method !== "GET" || req.path === "/api/activity";
    const s = await accounts("/introspect", { token, touch });
    if (!s.active) { setCookie(res, config.sessionCookie, "", 0); throw new HttpError(401, "not_signed_in"); }
    if (s.state !== "ok") throw new HttpError(423, "locked", { state: s.state });
    if (!s.clinic) throw denied("no_clinic");
    req.session = s;
    req.token = token;
    req.ctx = { ...req.ctxBase, clinicId: s.clinic.id, user: { id: s.user.id, name: s.user.name } };
    if (s.role === "doctor") req.ctx.onlyDoctor = s.doctorId ?? NOBODY;      // no linked record: sees nothing rather than everything
    if (perm && !s.permissions.includes(perm)) throw denied("forbidden");
    next();
  });
  const can = (req, p) => req.session.permissions.includes(p);

  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/health/db", wrap(async (req, res) => {
    try { await svc.tx({ clinicId: null, user: { id: "health", name: "health" } }, (c) => c.query("select 1")); res.json({ ok: true }); }
    catch { res.status(503).json({ ok: false }); }
  }));

  app.get("/api/me", auth(), (req, res) => res.json({
    user: req.session.user, clinic: req.session.clinic, role: req.session.role, doctorId: req.session.doctorId,
    permissions: req.session.permissions, security: req.session.security, accountsUrl: config.accountsUrl,
  }));
  app.post("/api/activity", auth(), (req, res) => res.json({ ok: true }));
  app.post("/api/logout", auth(), wrap(async (req, res) => {
    await accounts("/app-logout", { token: req.token });
    setCookie(res, config.sessionCookie, "", 0);
    res.json({ ok: true, next: `${config.accountsUrl}/signout` });
  }));

  // ---------------------------------------------------------------- lookups and free times
  app.get("/api/lookups", auth("booking.appointments.view"), wrap(async (req, res) => res.json(await svc.lookups(req.ctx))));
  app.get("/api/time-off", auth("booking.appointments.view"), wrap(async (req, res) => res.json(await svc.timeOffOn(req.ctx, parse(z.object({ date: day }), req.query).date))));
  app.get("/api/slots", auth("booking.appointments.view"), wrap(async (req, res) => {
    const q = parse(z.object({ service: uuid, doctor: uuid.optional(), date: day, days: z.coerce.number().int().min(1).max(31).optional() }), req.query);
    res.json(await svc.slots(req.ctx, { serviceId: q.service, doctorId: req.ctx.onlyDoctor ?? q.doctor, from: q.date, days: q.days }));
  }));

  // ---------------------------------------------------------------- appointments
  const apptFilter = z.object({
    from: day.optional(), to: day.optional(), doctor: uuid.optional(), patient: uuid.optional(), q: z.string().max(80).optional(),
    status: z.enum(["booked", "confirmed", "cancelled", "completed", "no_show", "voided"]).optional(),
    source: z.enum(["whatsapp", "phone", "walkin", "staff", "web"]).optional(), voided: z.enum(["1"]).optional(), unchecked: z.enum(["1"]).optional(),
  });
  const apptQuery = (q) => ({ from: q.from, to: q.to, doctorId: q.doctor, patientId: q.patient, q: q.q, status: q.status, source: q.source,
                              includeVoided: !!q.voided, unchecked: !!q.unchecked });
  app.get("/api/appointments", auth("booking.appointments.view"), wrap(async (req, res) => {
    res.json(await svc.listAppointments(req.ctx, apptQuery(parse(apptFilter, req.query))));
  }));
  app.get("/api/appointments/:id", auth("booking.appointments.view"), wrap(async (req, res) => res.json(await svc.getAppointment(req.ctx, parse(uuid, req.params.id)))));
  app.get("/api/appointments/:id/history", auth("booking.appointments.view"), wrap(async (req, res) => res.json(await svc.history(req.ctx, parse(uuid, req.params.id)))));

  const newPatient = z.object({ fullName: z.string().trim().min(1).max(120), phone: z.string().max(30).nullish(), language: z.enum(["ar", "en"]).nullish(), whatsappReminders: z.boolean().optional() });
  app.post("/api/appointments", auth("booking.appointments.create"), wrap(async (req, res) => {
    const b = parse(z.object({
      serviceId: uuid, doctorId: z.union([uuid, z.literal("any")]), startsAt: z.string().max(40), source: z.enum(["phone", "walkin"]),
      patientId: uuid.optional(), newPatient: newPatient.optional(), internalNote: z.string().max(500).nullish(), override: z.boolean().optional(),
      allowOverLimit: z.boolean().optional(),
    }).refine((x) => !!x.patientId !== !!x.newPatient), req.body);
    if (b.newPatient && !can(req, "booking.patients.edit")) throw denied("forbidden");
    res.status(201).json(await svc.createAppointment(req.ctx, b));
  }));
  app.patch("/api/appointments/:id", auth("booking.appointments.edit"), wrap(async (req, res) => {
    const b = parse(z.object({
      expectedVersion: z.number().int(), serviceId: uuid.optional(), doctorId: uuid.optional(), patientId: uuid.optional(),
      startsAt: z.string().max(40).optional(), internalNote: z.string().max(500).nullish(), override: z.boolean().optional(),
    }), req.body);
    res.json(await svc.updateAppointment(req.ctx, parse(uuid, req.params.id), b));
  }));
  // One door for every status change, with the permission each needs.
  const NEEDS = { confirmed: "booking.appointments.edit", completed: "booking.appointments.edit", no_show: "booking.appointments.edit",
                  cancelled: "booking.appointments.cancel", voided: "booking.appointments.void" };
  app.post("/api/appointments/:id/status", auth(), wrap(async (req, res) => {
    const b = parse(z.object({ status: z.enum(["confirmed", "cancelled", "completed", "no_show", "voided"]), reason: z.string().trim().max(300).optional(), expectedVersion: z.number().int() }), req.body);
    if (!can(req, NEEDS[b.status])) throw denied("forbidden");
    res.json(await svc.setStatus(req.ctx, parse(uuid, req.params.id), b, req.session.permissions));
  }));
  app.post("/api/appointments/:id/check", auth("booking.appointments.edit"), wrap(async (req, res) => {
    const b = parse(z.object({ expectedVersion: z.number().int() }), req.body);
    res.json(await svc.markChecked(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.get("/api/online-link", auth("booking.appointments.view"), wrap(async (req, res) => res.json(await svc.onlineLink(req.ctx, config.publicBookingUrl))));
  app.post("/api/appointments/:id/restore", auth("booking.appointments.restore"), wrap(async (req, res) => {
    const b = parse(z.object({ expectedVersion: z.number().int() }), req.body);
    res.json(await svc.restore(req.ctx, parse(uuid, req.params.id), b));
  }));

  // ---------------------------------------------------------------- patients
  app.get("/api/patients", auth("booking.patients.view"), wrap(async (req, res) => res.json(await svc.searchPatients(req.ctx, String(req.query.q ?? "").slice(0, 80)))));
  app.get("/api/patients/:id", auth("booking.patients.view"), wrap(async (req, res) => res.json(await svc.getPatient(req.ctx, parse(uuid, req.params.id)))));
  app.post("/api/patients", auth("booking.patients.edit"), wrap(async (req, res) => {
    if (req.ctx.onlyDoctor) throw denied("own_bookings_only");       // a doctor's patient comes with a booking, or they could not see it afterwards
    res.status(201).json(await svc.createPatient(req.ctx, parse(newPatient, req.body)));
  }));
  app.patch("/api/patients/:id", auth("booking.patients.edit"), wrap(async (req, res) => {
    const b = parse(newPatient.partial(), req.body);
    res.json(await svc.updatePatient(req.ctx, parse(uuid, req.params.id), b));
  }));
  // The patient's visit notes: date, doctor and state only. Secretaries see this list too; the content opens on the note screen.
  app.get("/api/patients/:id/notes", auth("booking.patients.view"), wrap(async (req, res) => res.json(await svc.notes.forPatient(req.ctx, parse(uuid, req.params.id)))));

  // ---------------------------------------------------------------- visit notes (AI Scribe)
  // Reading needs booking.notes.read, recording and editing booking.notes.write, signing booking.notes.sign: doctors by default.
  // notes.js adds the rest: a doctor reaches only their own patients' notes, and only the treating doctor writes or signs.
  const NOTES = svc.notes;
  const READ_NOTES = auth("booking.notes.read"), WRITE_NOTES = auth("booking.notes.write"), SIGN_NOTES = auth("booking.notes.sign");
  const noteId = (req) => parse(uuid, req.params.id);
  app.get("/api/appointments/:id/note", READ_NOTES, wrap(async (req, res) => res.json(await NOTES.forVisit(req.ctx, noteId(req)))));
  app.post("/api/appointments/:id/note", WRITE_NOTES, wrap(async (req, res) => res.status(201).json(await NOTES.start(req.ctx, noteId(req),
    parse(z.object({ mode: z.enum(["scribe", "manual"]), consent: z.boolean().optional() }), req.body)))));
  // A few seconds of the recording at a time, so a long visit never meets an upload limit.
  app.put("/api/notes/:id/audio/:seq", WRITE_NOTES, express.raw({ type: () => true, limit: "2mb" }), wrap(async (req, res) =>
    res.json(await NOTES.saveChunk(req.ctx, noteId(req), parse(z.coerce.number().int().min(0).max(9999), req.params.seq), req.get("content-type"), req.body))));
  app.post("/api/notes/:id/alive", WRITE_NOTES, wrap(async (req, res) => res.json(await NOTES.alive(req.ctx, noteId(req)))));
  app.post("/api/notes/:id/stop", WRITE_NOTES, wrap(async (req, res) => res.json(await NOTES.stop(req.ctx, noteId(req),
    parse(z.object({ seconds: z.number().int().min(0).max(7200).optional() }), req.body)))));
  app.patch("/api/notes/:id", WRITE_NOTES, wrap(async (req, res) => res.json(await NOTES.save(req.ctx, noteId(req),
    parse(z.object({ content: z.record(z.string().max(40), z.string().max(4000)), expectedVersion: z.number().int() }), req.body)))));
  app.post("/api/notes/:id/sign", SIGN_NOTES, wrap(async (req, res) => res.json(await NOTES.sign(req.ctx, noteId(req),
    parse(z.object({ expectedVersion: z.number().int(), confirmRead: z.literal(true) }), req.body)))));
  app.post("/api/notes/:id/additions", WRITE_NOTES, wrap(async (req, res) => res.status(201).json(await NOTES.addition(req.ctx, noteId(req),
    parse(z.object({ text: z.string().trim().min(1).max(4000) }), req.body)))));
  app.post("/api/notes/:id/retry", WRITE_NOTES, wrap(async (req, res) => res.json(await NOTES.retry(req.ctx, noteId(req)))));
  app.post("/api/notes/:id/by-hand", WRITE_NOTES, wrap(async (req, res) => res.json(await NOTES.byHand(req.ctx, noteId(req)))));
  app.post("/api/notes/:id/discard", WRITE_NOTES, wrap(async (req, res) => res.json(await NOTES.discard(req.ctx, noteId(req)))));

  // ---------------------------------------------------------------- Excel files (administrators)
  const sendXlsx = (res, f) => {
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${f.filename}"` });
    res.send(f.buffer);
  };
  const fileLang = { lang: z.enum(["ar", "en"]).default("en") };
  app.get("/api/export/bookings", auth("booking.data.export"), wrap(async (req, res) => {
    const q = parse(apptFilter.extend(fileLang), req.query);
    sendXlsx(res, await svc.exportBookings(req.ctx, apptQuery(q), q.lang));
  }));
  app.get("/api/export/patients", auth("booking.data.export"), wrap(async (req, res) => {
    const q = parse(z.object({ q: z.string().max(80).default(""), ...fileLang }), req.query);
    sendXlsx(res, await svc.exportPatients(req.ctx, q.q, q.lang));
  }));

  // ---------------------------------------------------------------- settings
  const VIEW = auth("booking.settings.view"), EDIT = auth("booking.settings.edit");
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  const periods = z.array(z.object({ weekday: z.number().int().min(0).max(6), start: hhmm, end: hhmm })).max(70);
  const name = z.string().trim().min(1).max(120), optText = z.string().trim().max(300).nullish();
  const pick = (...v) => z.number().int().refine((x) => v.includes(x));
  const S = svc.settings;

  app.get("/api/settings", VIEW, wrap(async (req, res) => res.json({ ...(await S.read(req.ctx)), onlineLink: await svc.onlineLink(req.ctx, config.publicBookingUrl) })));
  const n = (lo, hi) => z.number().int().min(lo).max(hi), text500 = z.string().trim().max(500).nullish();
  app.patch("/api/settings/online", EDIT, wrap(async (req, res) => res.json(await S.updateOnline(req.ctx, parse(z.object({
    enabled: z.boolean(), staffCheck: z.boolean(), showPrices: z.boolean(), allowAnyDoctor: z.boolean(), allowCancel: z.boolean(),
    allowReschedule: z.boolean(), allowForOther: z.boolean(), offerReminders: z.boolean(), defaultCountryCode: z.string().regex(/^[1-9][0-9]{0,3}$/),
    maxUncheckedPerPhone: n(1, 20), bookingsPerPhonePerDay: n(1, 50), bookingsPerIpPerDay: n(1, 200), lookupsPerIpPerMinute: n(5, 1000),
    managePerIpPerHour: n(5, 1000), daysPerPage: n(1, 31),
    introEn: text500, introAr: text500, doneNoteEn: text500, doneNoteAr: text500,
    shareMessageEn: z.string().trim().min(1).max(500).refine((m) => m.includes("{link}")), shareMessageAr: z.string().trim().min(1).max(500).refine((m) => m.includes("{link}")),
    privacyUrl: z.string().trim().url().max(300).refine((u) => u.startsWith("https://")),
    findEnabled: z.boolean(), findPerPhonePerDay: n(1, 20), findPerIpPerHour: n(1, 200),
    chatEnabled: z.boolean(), chatMessagesPerChat: n(5, 200), chatChatsPerIpPerDay: n(1, 100), chatMessagesPerClinicPerDay: n(10, 100000), chatKeepDays: n(1, 365),
    brochureColour: z.string().regex(/^#[0-9A-Fa-f]{6}$/), brochureCardLanguages: z.enum(["ar_en", "ar", "en"]), brochureShowAi: z.boolean(),
    findMessageEn: z.string().trim().min(1).max(600).refine((m) => m.includes("{link}")), findMessageAr: z.string().trim().min(1).max(600).refine((m) => m.includes("{link}")),
  }), req.body)))));
  // Settings > AI Scribe. The models and speech services on offer are the ones the plan names; the tests (plan steps 2 and 3) add more.
  const section = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), en: z.string().trim().min(1).max(80), ar: z.string().trim().min(1).max(80),
    hint: z.string().trim().max(200).optional() });
  app.patch("/api/settings/scribe", EDIT, wrap(async (req, res) => res.json(await S.updateScribe(req.ctx, parse(z.object({
    enabled: z.boolean(), noteLanguage: z.enum(["en", "ar"]),
    consentEn: z.string().trim().min(1).max(1000), consentAr: z.string().trim().min(1).max(1000),
    sections: z.array(section).min(1).max(12),
    maxRecordingMinutes: n(5, 120), transcriptKeepDays: n(1, 365), notesPerDoctorPerDay: n(1, 500),
    speechService: z.enum(["stand_in"]), draftModel: z.enum(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]),
    doctors: z.array(z.object({ id: uuid, scribeEnabled: z.boolean() })).max(200),
  }), req.body)))));
  app.patch("/api/settings/profile", EDIT, wrap(async (req, res) => res.json(await S.updateProfile(req.ctx, parse(z.object({
    nameEn: name, nameAr: name, phone: z.string().trim().max(30).nullish(), addressEn: optText, addressAr: optText, mapsUrl: z.string().trim().url().max(500).nullish().or(z.literal("")),
    timezone: z.string().max(60), defaultLanguage: z.enum(["ar", "en"]), weekStart: z.number().int().min(0).max(6), slotStepMinutes: pick(5, 10, 15, 20, 30, 60),
  }), req.body)))));
  app.put("/api/settings/hours", EDIT, wrap(async (req, res) => res.json(await S.setClinicHours(req.ctx, parse(z.object({ periods }), req.body).periods))));
  const timeOff = z.object({ doctorId: uuid.nullish(), startsAt: z.string().datetime(), endsAt: z.string().datetime(), reason: z.string().trim().max(120).nullish() });
  app.post("/api/settings/time-off", EDIT, wrap(async (req, res) => res.status(201).json(await S.addTimeOff(req.ctx, parse(timeOff, req.body)))));
  app.delete("/api/settings/time-off/:id", EDIT, wrap(async (req, res) => res.json(await S.removeTimeOff(req.ctx, parse(uuid, req.params.id)))));

  const doctor = z.object({ nameEn: name, nameAr: name, titleEn: optText, titleAr: optText, gender: z.enum(["f", "m"]).nullish(),
    slotMinutes: pick(5, 10, 15, 20, 30, 60).nullish(), bufferMinutes: pick(0, 5, 10, 15).optional(), active: z.boolean().optional() });
  app.post("/api/settings/doctors", EDIT, wrap(async (req, res) => res.status(201).json(await S.createDoctor(req.ctx, parse(doctor, req.body)))));
  app.patch("/api/settings/doctors/:id", EDIT, wrap(async (req, res) => {
    const b = parse(doctor.required({ bufferMinutes: true, active: true }), req.body);
    res.json(await S.updateDoctor(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.put("/api/settings/doctors/:id/hours", EDIT, wrap(async (req, res) => res.json(await S.setDoctorHours(req.ctx, parse(uuid, req.params.id), parse(z.object({ periods }), req.body).periods))));
  app.put("/api/settings/doctors/:id/services", EDIT, wrap(async (req, res) => res.json(await S.setDoctorServices(req.ctx, parse(uuid, req.params.id), parse(z.object({ serviceIds: z.array(uuid).max(200) }), req.body).serviceIds))));

  const service = z.object({ nameEn: name, nameAr: name, descriptionEn: optText, descriptionAr: optText, durationMinutes: z.number().int().min(5).max(480),
    priceJod: z.number().min(0).max(100000).nullish(), priceIsFrom: z.boolean().optional(), active: z.boolean().optional() });
  app.post("/api/settings/services", EDIT, wrap(async (req, res) => res.status(201).json(await S.createService(req.ctx, parse(service, req.body)))));
  app.patch("/api/settings/services/:id", EDIT, wrap(async (req, res) => res.json(await S.updateService(req.ctx, parse(uuid, req.params.id), parse(service.required({ active: true }), req.body)))));

  app.patch("/api/settings/rules/:audience", EDIT, wrap(async (req, res) => {
    const audience = parse(z.enum(["patient", "staff"]), req.params.audience);
    res.json(await S.updateRules(req.ctx, audience, parse(z.object({
      minNoticeMinutes: z.number().int().min(0).max(43200), windowDays: z.number().int().min(1).max(730), changeNoticeMinutes: z.number().int().min(0).max(43200),
      maxUpcoming: z.number().int().min(1).max(100).nullish(), outsideHours: z.enum(["block", "warn", "allow"]).optional(),
      walkinBackMinutes: z.number().int().min(0).max(1440).optional(), requireCancelReason: z.boolean().optional(),
    }), req.body)));
  }));
  app.patch("/api/settings/general", EDIT, wrap(async (req, res) => res.json(await S.updateGeneral(req.ctx, parse(z.object({
    idleTimeoutMinutes: pick(15, 30, 60, 120, 240), lockAfterMinutes: pick(0, 5, 10, 15, 30), require2faAll: z.boolean(),
    conversationVisibility: z.enum(["none", "handoff", "all"]), auditRetentionMonths: z.number().int().min(12).max(240).nullish(),
    remindersEnabled: z.boolean(), reminderOffsetsMinutes: z.array(pick(2880, 1440, 720, 240, 120, 60)).max(2), quietStart: hhmm, quietEnd: hhmm,
    assistantEnabled: z.boolean(), afterHoursMessageEn: z.string().trim().max(500).nullish(), afterHoursMessageAr: z.string().trim().max(500).nullish(),
    handoffAlertEmails: z.array(z.string().trim().toLowerCase().email().max(200)).max(10),
  }), req.body)))));

  const faq = z.object({ topic: z.string().trim().min(1).max(60), questionEn: z.string().trim().min(1).max(300), questionAr: z.string().trim().min(1).max(300),
    answerEn: z.string().trim().min(1).max(1000), answerAr: z.string().trim().min(1).max(1000) });
  app.post("/api/settings/faqs", EDIT, wrap(async (req, res) => res.status(201).json(await S.addFaq(req.ctx, parse(faq, req.body)))));
  app.patch("/api/settings/faqs/:id", EDIT, wrap(async (req, res) => res.json(await S.updateFaq(req.ctx, parse(uuid, req.params.id), parse(faq, req.body)))));
  app.delete("/api/settings/faqs/:id", EDIT, wrap(async (req, res) => res.json(await S.removeFaq(req.ctx, parse(uuid, req.params.id)))));

  // ---------------------------------------------------------------- audit log (administrators)
  const auditFilter = z.object({ from: day.optional(), to: day.optional(), actor: z.string().max(80).optional(),
    type: z.enum(["bookings", "patients", "settings", "security", "audit"]).optional(), q: z.string().trim().max(80).optional() });
  app.get("/api/audit", auth("booking.audit.view"), wrap(async (req, res) => {
    const f = parse(auditFilter.extend({ before: z.coerce.number().int().positive().optional() }), req.query);
    const r = await svc.audit.list(req.ctx, f);
    // Whose access changed: names come from Accounts, and only for people of this clinic.
    const uuidLike = /^[0-9a-f-]{36}$/i;
    const people = r.rows.filter((x) => ["membership", "user"].includes(x.entity) && uuidLike.test(x.entity_id || ""));
    if (people.length) {
      const names = await accounts("/people", { token: req.token, ids: [...new Set(people.map((x) => x.entity_id))] }).catch(() => ({}));
      for (const x of people) if (names[x.entity_id]) x.subject = names[x.entity_id];
    }
    res.json(r);
  }));
  app.get("/api/audit/facets", auth("booking.audit.view"), wrap(async (req, res) => res.json(await svc.audit.facets(req.ctx))));
  app.get("/api/audit/status", auth("booking.audit.view"), wrap(async (req, res) => res.json(await svc.audit.status(req.ctx))));
  app.post("/api/audit/verify", auth("booking.audit.view"), wrap(async (req, res) => res.json(await svc.audit.verify(req.ctx))));
  app.get("/api/audit/export", auth("booking.audit.export"), wrap(async (req, res) => {
    const csv = await svc.audit.exportCsv(req.ctx, parse(auditFilter, req.query));
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="limitsiz-audit-${new Date().toISOString().slice(0, 10)}.csv"` });
    res.send(csv);
  }));

  // ---------------------------------------------------------------- the pages (built React app)
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.endsWith(".html")) res.set("Cache-Control", "no-store"); } }));
    app.get(/^\/(?!api\/|auth\/).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") return res.status(400).json({ error: "invalid_input" });
    if (err?.code === "22P02" || err?.code === "22007") return res.status(400).json({ error: "invalid_input" });
    console.error(`[${req.ctxBase?.requestId}]`, err);
    res.status(500).json({ error: "server_error", requestId: req.ctxBase?.requestId });
  });
  return app;
}
