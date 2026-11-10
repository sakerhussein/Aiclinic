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
  app.use(express.json({ limit: "40kb" }));
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
                canChart: has("records.chart.read"), canDetails: has("records.details.view") };
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
  app.put("/api/patients/:id/details", auth("records.details.edit"), wrap(async (req, res) => {
    const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const b = parse(z.object({
      fileNo: text(20).nullish(), birthDate: day.nullish(), sex: z.enum(["female", "male"]).nullish(), nationalId: text(20).nullish(),
      insurance: text(120).nullish(), emergencyContact: text(120).nullish(), expectedVersion: z.number().int().nullish(),
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
    const b = parse(z.object({
      doctorsScope: z.enum(["all", "treated"]),
      show: z.object(Object.fromEntries(KINDS.map((k) => [k, z.boolean()]))),
      specialtyFields: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), en: label, ar: label, kind: z.enum(["yesno", "choice", "text"]),
        options: z.array(z.object({ en: z.string().trim().min(1).max(40), ar: z.string().trim().min(1).max(40) })).max(12).optional() })).max(30),
      fileNumbers: z.enum(["auto", "manual"]), nextFileNo: z.number().int().min(1).max(99999999), fileNoDigits: z.number().int().min(3).max(8),
      requiredDetails: z.array(z.enum(["birth_date", "sex", "national_id", "emergency_contact"])).max(4),
    }), req.body);
    res.json(await svc.updateSettings(req.ctx, b));
  }));

  // ---------------------------------------------------------------- the pages
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.endsWith(".html")) res.set("Cache-Control", "no-store"); } }));
    app.get(/^\/(?!api\/|auth\/).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") return res.status(400).json({ error: "invalid_input" });
    if (err?.code === "22P02" || err?.code === "22007" || err?.code === "22008") return res.status(400).json({ error: "invalid_input" });
    if (err?.code === "42501") return res.status(409).json({ error: "entry_locked" });     // the database's own guard on a locked entry
    console.error(`[${req.ctxBase?.requestId}]`, err);
    res.status(500).json({ error: "server_error", requestId: req.ctxBase?.requestId });
  });
  return app;
}
