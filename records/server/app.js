// HTTP layer of Records. Sign-in is Accounts' (single sign-on), exactly as in Booking; every request is checked with Accounts.
import express from "express";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, parseCookies, cookieString, parse, z, denied } from "./http.js";
import { KINDS } from "./service.js";

const uuid = z.guid();
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "dist");
const text = (max) => z.string().max(max);

export function createApp({ svc, config, files, backups = null, courses, rx, forms, summary, fetchImpl = fetch }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy === "false" ? false : Number(config.trustProxy) || config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
      ...(config.secureCookies ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    });
    if (req.path.startsWith("/api") || req.path.startsWith("/auth")) res.set("Cache-Control", "no-store");
    next();
  });
  // The patient's form page sends a drawn signature, so its answers may be larger; everything else stays small.
  const small = express.json({ limit: "40kb" }), signed = express.json({ limit: "300kb" });
  app.use((req, res, next) => (req.path.startsWith("/api/f/") ? signed : small)(req, res, next));
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin") !== config.origin) return next(new HttpError(403, "bad_origin"));
    req.ctxBase = { ip: req.ip, ua: (req.get("user-agent") || "").slice(0, 300), requestId: crypto.randomBytes(8).toString("base64url") };
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const setCookie = (res, name, value, maxAgeSeconds) => res.append("Set-Cookie", cookieString(name, value, { secure: config.secureCookies, maxAgeSeconds }));

  // ---- talking to Accounts (server to server, on the same machine)
  async function accounts(pathname, body) {
    let res;
    try {
      res = await fetchImpl(config.accountsInternalUrl + pathname, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: "records", secret: config.clientSecret, ...body }) });
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
    u.searchParams.set("client", "records");
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
  // auth(...perms): the person needs at least one of them (none given: only signed in).
  const auth = (...perms) => wrap(async (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[config.sessionCookie];
    if (!token) throw new HttpError(401, "not_signed_in");
    const touch = req.method !== "GET" || req.path === "/api/activity";
    const s = await accounts("/introspect", { token, touch });
    if (!s.active) { setCookie(res, config.sessionCookie, "", 0); throw new HttpError(401, "not_signed_in"); }
    if (s.state !== "ok") throw new HttpError(423, "locked", { state: s.state });
    if (!s.clinic) throw denied("no_clinic");
    if (!s.permissions.some((p) => p.startsWith("records."))) throw denied("no_access_to_service");
    req.session = s;
    req.token = token;
    const has = (p) => s.permissions.includes(p);
    req.ctx = { ...req.ctxBase, clinicId: s.clinic.id, user: { id: s.user.id, name: s.user.name }, role: s.role, doctorId: s.doctorId ?? null,
                canChart: has("records.chart.read"), canDetails: has("records.details.view"), canChartWrite: has("records.chart.write"),
                canPhotos: has("records.photos.view"), canAddFiles: has("records.files.add"),
                canCourses: has("records.courses.view"), canCoursesEdit: has("records.courses.edit"), canRx: has("records.rx.write"), canFormsSend: has("records.forms.send") };
    if (perms.length && !perms.some(has)) throw denied("forbidden");
    next();
  });

  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/health/db", wrap(async (req, res) => {
    try { await svc.tx({ clinicId: null, user: { id: "health", name: "health" } }, (c) => c.query("select 1")); res.json({ ok: true }); }
    catch { res.status(503).json({ ok: false }); }
  }));

  app.get("/api/me", auth(), (req, res) => res.json({
    user: req.session.user, clinic: req.session.clinic, role: req.session.role, doctorId: req.session.doctorId,
    permissions: req.session.permissions, security: req.session.security, accountsUrl: config.accountsUrl, bookingUrl: config.bookingUrl,
  }));
  app.post("/api/activity", auth(), (req, res) => res.json({ ok: true }));
  app.post("/api/logout", auth(), wrap(async (req, res) => {
    await accounts("/app-logout", { token: req.token });
    setCookie(res, config.sessionCookie, "", 0);
    res.json({ ok: true, next: `${config.accountsUrl}/signout` });
  }));
  app.get("/api/lookups", auth(), wrap(async (req, res) => res.json(await svc.lookups(req.ctx))));

  // ---------------------------------------------------------------- patients and the chart
  const CHART = "records.chart.read", DETAILS = "records.details.view";
  app.get("/api/patients", auth(CHART, DETAILS), wrap(async (req, res) => {
    res.json(await svc.listPatients(req.ctx, parse(z.object({ q: text(80).optional() }), req.query)));
  }));
  app.get("/api/today", auth(CHART), wrap(async (req, res) => res.json(await svc.today(req.ctx))));
  app.get("/api/patients/:id", auth(CHART, DETAILS), wrap(async (req, res) => res.json(await svc.chart(req.ctx, parse(uuid, req.params.id)))));
  app.get("/api/patients/:id/tab-counts", auth(CHART, DETAILS), wrap(async (req, res) => res.json(await svc.tabCounts(req.ctx, parse(uuid, req.params.id)))));
  app.put("/api/patients/:id/details", auth("records.details.edit"), wrap(async (req, res) => {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const b = parse(z.object({
      fileNo: text(20).nullish(), birthDate: day.nullish(), sex: z.enum(["female", "male"]).nullish(), nationalId: text(20).nullish(),
      insurance: text(120).nullish(), expectedVersion: z.number().int().nullish(),
      emergencyName: text(80).nullish(), emergencyRelation: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).nullish(), emergencyPhone: text(30).nullish(),
      insuranceStatus: z.enum(["unknown", "none", "insured"]).optional(), insuranceCompanyId: uuid.nullish(),
    }), req.body);
    res.json(await svc.updateDetails(req.ctx, parse(uuid, req.params.id), b));
  }));

  const WRITE = "records.chart.write";
  app.post("/api/patients/:id/entries", auth(WRITE), wrap(async (req, res) => {
    const b = parse(z.object({ kind: z.enum(KINDS), title: z.string().trim().min(1).max(200), detail: text(1000).nullish(),
      status: z.enum(["active", "past"]).optional(), alert: z.boolean().optional() }), req.body);
    res.status(201).json(await svc.addEntry(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.patch("/api/entries/:id", auth(WRITE), wrap(async (req, res) => {
    const b = parse(z.object({ title: z.string().trim().min(1).max(200).optional(), detail: text(1000).nullish(),
      status: z.enum(["active", "past"]).optional(), alert: z.boolean().optional(), expectedVersion: z.number().int() }), req.body);
    res.json(await svc.updateEntry(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.post("/api/entries/:id/error", auth(WRITE), wrap(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(1).max(300), expectedVersion: z.number().int() }), req.body);
    res.json(await svc.markError(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.post("/api/entries/:id/confirm", auth(WRITE), wrap(async (req, res) => res.json(await svc.confirmEntry(req.ctx, parse(uuid, req.params.id)))));
  app.put("/api/patients/:id/answers/:key", auth(WRITE), wrap(async (req, res) => {
    const b = parse(z.object({ value: text(200) }), req.body);
    res.json(await svc.setAnswer(req.ctx, parse(uuid, req.params.id), parse(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), req.params.key), b.value));
  }));
  app.get("/api/patients/:id/openings", auth("records.openings.view"), wrap(async (req, res) => res.json(await svc.openings(req.ctx, parse(uuid, req.params.id)))));

  // ---------------------------------------------------------------- settings
  app.get("/api/settings", auth("records.settings.view"), wrap(async (req, res) => res.json(await svc.getSettings(req.ctx))));
  app.put("/api/settings", auth("records.settings.edit"), wrap(async (req, res) => {
    const label = z.string().trim().min(1).max(60);
    const named = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), en: label, ar: label });
    const b = parse(z.object({
      doctorsScope: z.enum(["all", "treated"]),
      show: z.object(Object.fromEntries(KINDS.map((k) => [k, z.boolean()]))),
      specialtyFields: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), en: label, ar: label, kind: z.enum(["yesno", "choice", "text"]),
        options: z.array(z.object({ en: z.string().trim().min(1).max(40), ar: z.string().trim().min(1).max(40) })).max(12).optional() })).max(30),
      fileNumbers: z.enum(["auto", "manual"]), nextFileNo: z.number().int().min(1).max(99999999), fileNoDigits: z.number().int().min(3).max(8),
      requiredDetails: z.array(z.enum(["birth_date", "sex", "national_id", "emergency_contact"])).max(4),
      insuranceInBooking: z.boolean().optional(), insuranceRequired: z.boolean().optional(),
      relations: z.array(named).min(1).max(20).optional(), photoAreas: z.array(named).min(1).max(40).optional(),
      docKinds: z.array(named.extend({ secretary: z.boolean(), review: z.boolean() })).min(1).max(30).optional(),
      photoConsentRequired: z.boolean().optional(), maxFileMb: z.number().int().min(1).max(50).optional(),
      linkMinutes: z.number().int().min(1).max(60).optional(), phoneMinutes: z.number().int().min(2).max(60).optional(),
    }), req.body);
    res.json(await svc.updateSettings(req.ctx, b));
  }));

  // The clinic's insurance companies: hidden, never deleted.
  const company = z.object({
    nameEn: z.string().trim().min(1).max(80), nameAr: z.string().trim().min(1).max(80), phone: text(30).nullish(), email: text(120).nullish(),
    address: text(200).nullish(), contactName: text(80).nullish(), contactTitle: text(80).nullish(), contactPhone: text(30).nullish(),
    contactEmail: text(120).nullish(), notes: text(500).nullish(),
  });
  app.get("/api/insurers", auth("records.settings.view"), wrap(async (req, res) => res.json(await svc.insurers(req.ctx))));
  app.post("/api/insurers", auth("records.settings.edit"), wrap(async (req, res) => {
    const b = parse(company.extend({ fromTyped: text(120).nullish() }), req.body);
    res.status(201).json(await svc.addInsurer(req.ctx, b));
  }));
  app.patch("/api/insurers/:id", auth("records.settings.edit"), wrap(async (req, res) => {
    const b = parse(z.union([company.extend({ hidden: z.boolean().optional(), expectedVersion: z.number().int() }),
                             z.object({ hidden: z.boolean(), expectedVersion: z.number().int() })]), req.body);
    res.json(await svc.updateInsurer(req.ctx, parse(uuid, req.params.id), b));
  }));

  // ---------------------------------------------------------------- photos and documents (phase B)
  const raw = express.raw({ type: () => true, limit: "51mb" });
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
  app.get("/api/patients/:id/files", auth(CHART, DETAILS), wrap(async (req, res) => res.json(await files.list(req.ctx, parse(uuid, req.params.id)))));
  app.post("/api/patients/:id/files", auth("records.photos.view", "records.files.add"), raw, wrap(async (req, res) => {
    const m = parse(z.union([z.object({ kind: z.literal("photo"), area: key }),
      z.object({ kind: z.literal("document"), docKind: key, title: z.string().trim().min(1).max(200), docDate: day.optional() })]), req.query);
    res.status(201).json(await files.upload(req.ctx, parse(uuid, req.params.id), m, Buffer.isBuffer(req.body) ? req.body : null));
  }));
  app.get("/api/patients/:id/photo-links", auth("records.photos.view"), wrap(async (req, res) => res.json(await files.photoLinks(req.ctx, parse(uuid, req.params.id)))));
  app.get("/api/files/:id/link", auth(CHART, DETAILS), wrap(async (req, res) => res.json(await files.link(req.ctx, parse(uuid, req.params.id)))));
  app.get("/api/files/:id/content", auth(CHART, DETAILS), wrap(async (req, res) => {
    const f = await files.content(req.ctx, parse(uuid, req.params.id), req.query.e, req.query.s);
    res.set({ "Content-Type": f.mime, "Content-Disposition": "inline", "Cache-Control": "private, no-store",
              "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'none'" });
    res.end(f.buf);
  }));
  app.post("/api/files/:id/review", auth(WRITE), wrap(async (req, res) => {
    res.json(await files.review(req.ctx, parse(uuid, req.params.id), parse(z.object({ expectedVersion: z.number().int() }), req.body)));
  }));
  app.post("/api/files/:id/error", auth(WRITE, "records.files.add"), wrap(async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(1).max(300), expectedVersion: z.number().int() }), req.body);
    res.json(await files.markError(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.put("/api/patients/:id/photo-consent", auth("records.photos.view"), wrap(async (req, res) => {
    const b = parse(z.object({ value: z.enum(["record", "teaching", "refused"]) }), req.body);
    res.json(await files.setConsent(req.ctx, parse(uuid, req.params.id), b.value));
  }));
  app.post("/api/patients/:id/phone-code", auth("records.photos.view"), wrap(async (req, res) => {
    res.status(201).json(await files.phoneCode(req.ctx, parse(uuid, req.params.id), parse(z.object({ area: key }), req.body).area));
  }));
  app.get("/api/phone-codes/:id", auth("records.photos.view"), wrap(async (req, res) => res.json(await files.phoneState(req.ctx, parse(uuid, req.params.id)))));

  // The clinic phone's camera page: no sign-in, the one-time code is the key (it expires in minutes, and on "Done").
  const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
  app.get("/api/capture/:token", wrap(async (req, res) => res.json(await files.captureInfo(parse(token, req.params.token)))));
  app.get("/api/capture/:token/ghost", wrap(async (req, res) => {
    const g = await files.captureGhost(parse(token, req.params.token), parse(key, req.query.area));
    if (!g) return res.status(204).end();
    res.set({ "Content-Type": g.mime, "Cache-Control": "private, no-store" }).end(g.buf);
  }));
  app.post("/api/capture/:token/photos", raw, wrap(async (req, res) => {
    res.status(201).json(await files.captureAdd(parse(token, req.params.token), parse(key, req.query.area), Buffer.isBuffer(req.body) ? req.body : null));
  }));
  app.post("/api/capture/:token/done", wrap(async (req, res) => res.json(await files.captureDone(parse(token, req.params.token)))));

  // ---------------------------------------------------------------- phase C: before and after the visit
  const version = z.number().int();
  app.put("/api/settings/visit", auth("records.settings.edit"), wrap(async (req, res) => {
    const b = parse(z.object({
      coursesOn: z.boolean(), courseAreaRequired: z.boolean(), courseDefaults: z.array(z.object({ serviceId: uuid, sessions: z.number().int().min(1).max(50), weeks: z.number().int().min(0).max(52) })).max(100),
      rxOn: z.boolean(), rxValidDays: z.number().int().min(1).max(365), rxPaper: z.enum(["A5", "A4"]),
      rxFavourites: z.array(z.object({ name: z.string().trim().min(1).max(120), how: text(200).nullish(), days: z.number().int().min(1).max(365).nullish(), qty: text(40).nullish() })).max(60),
      formsOn: z.boolean(), formLinkHours: z.number().int().min(1).max(168),
      formMessageEn: z.string().trim().min(1).max(400).refine((x) => x.includes("{link}")), formMessageAr: z.string().trim().min(1).max(400).refine((x) => x.includes("{link}")),
      summaryModel: z.enum(["off", "claude-haiku-5-5", "claude-sonnet-5-5"]), summaryDaily: z.number().int().min(1).max(200),
    }), req.body);
    res.json(await svc.updateVisitSettings(req.ctx, b));
  }));

  // Treatment courses
  app.get("/api/patients/:id/courses", auth("records.courses.view"), wrap(async (req, res) => res.json(await courses.list(req.ctx, parse(uuid, req.params.id)))));
  app.post("/api/patients/:id/courses", auth("records.courses.edit"), wrap(async (req, res) => {
    const b = parse(z.object({ serviceId: uuid, sessions: z.number().int().min(1).max(50), everyWeeks: z.number().int().min(0).max(52),
      areas: z.array(z.string().min(1).max(40)).max(20).optional(), note: text(120).nullish(), startsOn: day.optional() }), req.body);
    res.status(201).json(await courses.start(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.patch("/api/courses/:id", auth("records.courses.edit"), wrap(async (req, res) => {
    const b = parse(z.object({ sessions: z.number().int().min(1).max(50).optional(), everyWeeks: z.number().int().min(0).max(52).optional(),
      areas: z.array(z.string().min(1).max(40)).max(20).optional(), note: text(120).nullish(), expectedVersion: version }), req.body);
    res.json(await courses.update(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.post("/api/courses/:id/end", auth("records.courses.edit"), wrap(async (req, res) => {
    res.json(await courses.end(req.ctx, parse(uuid, req.params.id), parse(z.object({ reason: z.string().trim().min(1).max(300), expectedVersion: version }), req.body)));
  }));

  // Prescriptions (print only)
  const rxItems = z.array(z.object({ name: z.string().trim().min(1).max(120), how: text(200).nullish(), days: z.number().int().min(1).max(365).nullish(),
    qty: text(40).nullish() })).min(1).max(20);
  app.get("/api/patients/:id/prescriptions", auth(CHART), wrap(async (req, res) => res.json(await rx.list(req.ctx, parse(uuid, req.params.id)))));
  app.post("/api/patients/:id/prescriptions", auth("records.rx.write"), wrap(async (req, res) => {
    const b = parse(z.object({ items: rxItems, language: z.enum(["en", "ar"]), validDays: z.number().int().min(1).max(365).optional(), appointmentId: uuid.nullish() }), req.body);
    res.status(201).json(await rx.create(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.patch("/api/prescriptions/:id", auth("records.rx.write"), wrap(async (req, res) => {
    const b = parse(z.object({ items: rxItems, language: z.enum(["en", "ar"]), validDays: z.number().int().min(1).max(365), expectedVersion: version }), req.body);
    res.json(await rx.update(req.ctx, parse(uuid, req.params.id), b));
  }));
  app.post("/api/prescriptions/:id/print", auth("records.rx.write"), wrap(async (req, res) => {
    res.json(await rx.print(req.ctx, parse(uuid, req.params.id), parse(z.object({ expectedVersion: version }), req.body)));
  }));
  app.post("/api/prescriptions/:id/error", auth("records.rx.write"), wrap(async (req, res) => {
    res.json(await rx.markError(req.ctx, parse(uuid, req.params.id), parse(z.object({ reason: z.string().trim().min(1).max(300), expectedVersion: version }), req.body)));
  }));

  // Forms before the visit
  const named60 = z.object({ en: z.string().trim().min(1).max(60), ar: z.string().trim().min(1).max(60) });
  const formBody = z.object({
    titleEn: z.string().trim().min(1).max(80), titleAr: z.string().trim().min(1).max(80),
    questions: z.array(z.object({ key, en: z.string().trim().min(1).max(300), ar: z.string().trim().min(1).max(300),
      kind: z.enum(["yesno", "yesno_details", "choice", "text", "date"]), required: z.boolean().optional(), options: z.array(named60).max(12).optional(),
      goesTo: z.union([z.enum(["allergy", "medicine", "condition"]), z.string().regex(/^field:[a-z][a-z0-9_]{0,39}$/)]).nullish() })).max(40),
    consent: z.boolean(), agreeEn: text(1000).nullish(), agreeAr: text(1000).nullish(), firstVisitOnly: z.boolean(), serviceIds: z.array(uuid).max(100),
    minutes: z.number().int().min(1).max(30), hidden: z.boolean().optional(), sort: z.number().int().min(0).max(1000).optional(),
  });
  app.get("/api/forms", auth("records.settings.view"), wrap(async (req, res) => res.json(await forms.templates(req.ctx))));
  app.post("/api/forms", auth("records.settings.edit"), wrap(async (req, res) => res.status(201).json(await forms.saveTemplate(req.ctx, null, parse(formBody, req.body)))));
  app.put("/api/forms/:id", auth("records.settings.edit"), wrap(async (req, res) => {
    res.json(await forms.saveTemplate(req.ctx, parse(uuid, req.params.id), parse(formBody.extend({ expectedVersion: version }), req.body)));
  }));
  app.get("/api/patients/:id/forms", auth(CHART, DETAILS), wrap(async (req, res) => res.json(await forms.forPatient(req.ctx, parse(uuid, req.params.id)))));
  app.post("/api/appointments/:id/form-link", auth("records.forms.send"), wrap(async (req, res) => res.status(201).json(await forms.makeLink(req.ctx, parse(uuid, req.params.id)))));
  app.post("/api/form-responses/:id/fields/:key", auth(WRITE), wrap(async (req, res) => {
    const b = parse(z.object({ value: text(200).nullable() }), req.body);
    res.json(await forms.field(req.ctx, parse(uuid, req.params.id), parse(key, req.params.key), b.value));
  }));
  app.post("/api/form-responses/:id/refresh", auth(WRITE), wrap(async (req, res) => res.json(await forms.refresh(req.ctx, parse(uuid, req.params.id)))));
  // The patient's phone: no sign-in, the private link is the key (it works for that booking only, until some hours after it).
  app.get("/api/f/:token", wrap(async (req, res) => res.json(await forms.open(parse(token, req.params.token)))));
  app.post("/api/f/:token/forms/:formId", wrap(async (req, res) => {
    const b = parse(z.object({ answers: z.record(z.string(), z.object({ value: text(300), details: text(300).optional() })),
      signature: z.string().max(200000).optional(), signedName: text(120).optional(), language: z.enum(["en", "ar"]) }), req.body);
    res.status(201).json(await forms.submit(parse(token, req.params.token), parse(uuid, req.params.formId), b));
  }));
  app.post("/api/f/:token/copy/:responseId", express.raw({ type: () => true, limit: "6mb" }), wrap(async (req, res) => {
    res.status(201).json(await forms.copy(parse(token, req.params.token), parse(uuid, req.params.responseId), Buffer.isBuffer(req.body) ? req.body : null));
  }));

  // The AI summary before the visit
  app.get("/api/patients/:id/summary", auth(CHART), wrap(async (req, res) => res.json(await summary.get(req.ctx, parse(uuid, req.params.id)))));
  app.post("/api/patients/:id/summary", auth(CHART), wrap(async (req, res) => {
    const b = parse(z.object({ lang: z.enum(["en", "ar"]).optional() }), req.body);
    res.json(await summary.make(req.ctx, parse(uuid, req.params.id), b.lang));
  }));

  // ---------------------------------------------------------------- backups (one VPS serves every clinic)
  app.get("/api/backups", auth("records.backups.view"), wrap(async (req, res) => {
    res.json(backups ? { ...(await backups.status()), canEdit: req.session.permissions.includes("records.backups.edit") } : { configured: false });
  }));
  app.put("/api/backups/settings", auth("records.backups.edit"), wrap(async (req, res) => {
    if (!backups) throw new HttpError(409, "backups_not_set_up");
    const b = parse(z.object({ runAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().min(1).max(60),
      keepDaily: z.number().int().min(1).max(365), keepMonthly: z.number().int().min(0).max(120), restoreWeekday: z.number().int().min(0).max(6),
      alertEmails: z.string().max(500).nullish() }), req.body);
    try { new Intl.DateTimeFormat("en", { timeZone: b.timezone }); } catch { throw new HttpError(400, "invalid_input"); }
    res.json(await backups.updateSettings(req.ctx, b));
  }));
  app.post("/api/backups/run", auth("records.backups.edit"), wrap(async (req, res) => {
    if (!backups?.status || !(await backups.status()).configured) throw new HttpError(409, "backups_not_set_up");
    res.json(await backups.run("manual"));
  }));

  // ---------------------------------------------------------------- the pages
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.endsWith(".html")) res.set("Cache-Control", "no-store"); } }));
    app.get(/^\/(?!api\/|auth\/).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "file_too_large" });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "invalid_input" });
    if (err?.code === "22P02" || err?.code === "22007" || err?.code === "22008") return res.status(400).json({ error: "invalid_input" });
    if (err?.code === "42501") return res.status(409).json({ error: "entry_locked" });     // the database's own guard on a locked entry
    console.error(`[${req.ctxBase?.requestId}]`, err);
    res.status(500).json({ error: "server_error", requestId: req.ctxBase?.requestId });
  });
  return app;
}
