// HTTP layer of Booking. Sign-in is Accounts' (single sign-on); every request is checked with Accounts.
import express from "express";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, parseCookies, cookieString, parse, z, denied, bad } from "./http.js";

const uuid = z.string().uuid();
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
  app.get("/api/slots", auth("booking.appointments.view"), wrap(async (req, res) => {
    const q = parse(z.object({ service: uuid, doctor: uuid.optional(), date: day, days: z.coerce.number().int().min(1).max(31).optional() }), req.query);
    res.json(await svc.slots(req.ctx, { serviceId: q.service, doctorId: q.doctor, from: q.date, days: q.days }));
  }));

  // ---------------------------------------------------------------- appointments
  app.get("/api/appointments", auth("booking.appointments.view"), wrap(async (req, res) => {
    const q = parse(z.object({
      from: day.optional(), to: day.optional(), doctor: uuid.optional(), patient: uuid.optional(), q: z.string().max(80).optional(),
      status: z.enum(["booked", "confirmed", "cancelled", "completed", "no_show", "voided"]).optional(),
      source: z.enum(["whatsapp", "phone", "walkin", "staff", "web"]).optional(), voided: z.enum(["1"]).optional(),
    }), req.query);
    res.json(await svc.listAppointments(req.ctx, { from: q.from, to: q.to, doctorId: q.doctor, patientId: q.patient, q: q.q, status: q.status, source: q.source, includeVoided: !!q.voided }));
  }));
  app.get("/api/appointments/:id", auth("booking.appointments.view"), wrap(async (req, res) => res.json(await svc.getAppointment(req.ctx, parse(uuid, req.params.id)))));
  app.get("/api/appointments/:id/history", auth("booking.appointments.view"), wrap(async (req, res) => res.json(await svc.history(req.ctx, parse(uuid, req.params.id)))));

  const newPatient = z.object({ fullName: z.string().trim().min(1).max(120), phone: z.string().max(30).nullish(), language: z.enum(["ar", "en"]).nullish(), whatsappReminders: z.boolean().optional() });
  app.post("/api/appointments", auth("booking.appointments.create"), wrap(async (req, res) => {
    const b = parse(z.object({
      serviceId: uuid, doctorId: z.union([uuid, z.literal("any")]), startsAt: z.string().max(40), source: z.enum(["phone", "walkin"]),
      patientId: uuid.optional(), newPatient: newPatient.optional(), internalNote: z.string().max(500).nullish(), override: z.boolean().optional(),
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
  app.post("/api/appointments/:id/restore", auth("booking.appointments.restore"), wrap(async (req, res) => {
    const b = parse(z.object({ expectedVersion: z.number().int() }), req.body);
    res.json(await svc.restore(req.ctx, parse(uuid, req.params.id), b));
  }));

  // ---------------------------------------------------------------- patients
  app.get("/api/patients", auth("booking.patients.view"), wrap(async (req, res) => res.json(await svc.searchPatients(req.ctx, String(req.query.q ?? "").slice(0, 80)))));
  app.get("/api/patients/:id", auth("booking.patients.view"), wrap(async (req, res) => res.json(await svc.getPatient(req.ctx, parse(uuid, req.params.id)))));
  app.post("/api/patients", auth("booking.patients.edit"), wrap(async (req, res) => res.status(201).json(await svc.createPatient(req.ctx, parse(newPatient, req.body)))));
  app.patch("/api/patients/:id", auth("booking.patients.edit"), wrap(async (req, res) => {
    const b = parse(newPatient.partial(), req.body);
    res.json(await svc.updatePatient(req.ctx, parse(uuid, req.params.id), b));
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
  void bad;
  return app;
}
