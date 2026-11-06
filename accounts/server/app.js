// HTTP layer of Accounts. All logic lives in core.js.
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, parseCookies, cookieString, parse, z, limiter, unauthorized, denied } from "./http.js";
import { randomToken } from "./crypto.js";

const email = z.string().trim().toLowerCase().email().max(200);
const uuid = z.string().uuid();
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "dist");

// Request limits per 15 minutes (per hour for forgot-by-email). Sign-ins from one clinic share an address, so they are generous;
// the real protection is the per-account lock after 5 wrong passwords.
export const DEFAULT_LIMITS = { login: 60, forgotIp: 5, forgotMail: 3, accept: 30, token: 600 };

export function createApp({ core, config, now = () => Date.now(), limits = {} }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy === "false" ? false : Number.isNaN(Number(config.trustProxy)) ? config.trustProxy : Number(config.trustProxy));

  const loginLimit = limiter({ max: L.login, windowMs: 15 * 60_000, now });
  const forgotIp = limiter({ max: L.forgotIp, windowMs: 15 * 60_000, now });
  const forgotMail = limiter({ max: L.forgotMail, windowMs: 60 * 60_000, now });
  const acceptLimit = limiter({ max: L.accept, windowMs: 15 * 60_000, now });
  const codeLimit = limiter({ max: L.token, windowMs: 15 * 60_000, now });
  const tooMany = () => new HttpError(429, "too_many_requests");

  // ---- headers and basic hygiene
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
      ...(config.secureCookies ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    });
    if (req.path.startsWith("/api") || req.path === "/authorize") res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "20kb" }));

  // Services call these three with their secret, not with a cookie, so there is no cookie to forge.
  const SERVER_TO_SERVER = new Set(["/token", "/introspect", "/app-logout", "/people"]);
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !SERVER_TO_SERVER.has(req.path)) {
      if (req.get("origin") !== config.origin) return next(new HttpError(403, "bad_origin"));   // CSRF: only our own pages
    }
    req.ctx = { ip: req.ip, ua: (req.get("user-agent") || "").slice(0, 300), requestId: randomToken(8) };
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const setCookie = (res, token) => res.append("Set-Cookie", cookieString(config.cookieName, token, { secure: config.secureCookies }));
  const clearCookie = (res) => res.append("Set-Cookie", cookieString(config.cookieName, "", { secure: config.secureCookies, maxAgeSeconds: 0 }));

  // Loads req.session (any state) from the cookie; `only` limits which states may continue.
  const session = (only) => wrap(async (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[config.cookieName];
    const s = await core.loadSession(token);
    if (!s) { clearCookie(res); throw unauthorized("not_signed_in"); }
    req.session = s;
    if (only && !only.includes(s.state)) throw new HttpError(409, s.state);
    next();
  });
  const OK = ["ok"];

  const publicSession = async (s) => ({
    state: s.state, user: s.user,
    clinic: s.memberships.find((m) => m.clinic_id === s.clinic_id)?.clinic_id ? await core.describe(s).then((d) => d.clinic) : null,
    clinics: s.memberships.filter((m) => m.clinic_id).map((m) => ({ id: m.clinic_id, nameEn: m.clinic_name_en, nameAr: m.clinic_name_ar, role: m.role_key })),
    role: s.memberships.find((m) => m.clinic_id === s.clinic_id)?.role_key ?? null,
    permissions: s.state === "ok" ? await core.permissionsFor(s) : [],
    security: { lockMinutes: s.security.lockMinutes, idleMinutes: s.security.idleMinutes },
  });

  // ---------------------------------------------------------------- health
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/health/db", wrap(async (req, res) => {
    try { await core.pool.query("select 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  }));

  // ---------------------------------------------------------------- sign-in and session
  app.post("/api/login", wrap(async (req, res) => {
    if (!loginLimit(req.ip)) throw tooMany();
    const b = parse(z.object({ email: z.string().max(200), password: z.string().min(1).max(200) }), req.body);
    const { token, session: s } = await core.login(b.email, b.password, req.ctx);
    setCookie(res, token);
    res.json(await publicSession(s));
  }));
  app.get("/api/me", session(), wrap(async (req, res) => res.json(await publicSession(req.session))));
  app.patch("/api/me", session(OK), wrap(async (req, res) => {
    const b = parse(z.object({ fullName: z.string().trim().min(1).max(120).optional(), language: z.enum(["ar", "en"]).optional() }), req.body);
    await core.updateProfile(req.session, b, req.ctx);
    res.json({ ok: true });
  }));
  app.post("/api/logout", session(), wrap(async (req, res) => { await core.logout(req.session, req.ctx); clearCookie(res); res.json({ ok: true }); }));
  app.post("/api/switch", session(), wrap(async (req, res) => { await core.logout(req.session, req.ctx, "switch_user"); clearCookie(res); res.json({ ok: true }); }));
  app.post("/api/clinic", session(["choose_clinic", "ok"]), wrap(async (req, res) => {
    const b = parse(z.object({ clinicId: uuid }), req.body);
    await core.chooseClinic(req.session, b.clinicId);
    res.json(await publicSession(await core.loadSession(parseCookies(req.headers.cookie)[config.cookieName])));
  }));
  // The page sends this while the person types or moves the mouse; it is what "idle" is measured from.
  app.post("/api/activity", session(), wrap(async (req, res) => {
    const s = await core.loadSession(parseCookies(req.headers.cookie)[config.cookieName], { touch: true });
    res.json({ state: s?.state ?? "signed_out" });
  }));
  app.post("/api/lock", session(OK), wrap(async (req, res) => { await core.lock(req.session, req.ctx); res.json({ ok: true }); }));
  app.post("/api/unlock", session(["locked"]), wrap(async (req, res) => {
    if (!loginLimit(`u:${req.session.user_id}`)) throw tooMany();
    const b = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    await core.unlock(req.session, b.password, req.ctx);
    res.json({ ok: true });
  }));
  app.post("/api/confirm-password", session(OK), wrap(async (req, res) => {
    if (!loginLimit(`c:${req.session.user_id}`)) throw tooMany();
    await core.confirmPassword(req.session, parse(z.object({ password: z.string().min(1).max(200) }), req.body).password);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- two-step
  app.post("/api/mfa/setup", session(["ok", "mfa_setup_required"]), wrap(async (req, res) => res.json(await core.mfaSetup(req.session, req.ctx))));
  app.post("/api/mfa/enable", session(["ok", "mfa_setup_required"]), wrap(async (req, res) => {
    const b = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
    res.json(await core.mfaEnable(req.session, b.code, req.ctx));
  }));
  app.post("/api/mfa/verify", session(["mfa_required"]), wrap(async (req, res) => {
    if (!loginLimit(`m:${req.session.user_id}`)) throw tooMany();
    const b = parse(z.object({ code: z.string().regex(/^\d{6}$/).optional(), recovery: z.string().max(40).optional() }).refine((x) => x.code || x.recovery), req.body);
    await core.mfaVerify(req.session, b, req.ctx);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- passwords
  app.post("/api/password/forgot", wrap(async (req, res) => {
    const b = parse(z.object({ email }), req.body);
    if (!forgotIp(req.ip) || !forgotMail(b.email)) throw tooMany();
    await core.forgotPassword(b.email, req.ctx);
    res.json({ ok: true });                                   // the same answer whether or not the email exists
  }));
  app.post("/api/password/reset", wrap(async (req, res) => {
    if (!acceptLimit(req.ip)) throw tooMany();
    const b = parse(z.object({ token: z.string().max(100), password: z.string().max(200) }), req.body);
    await core.resetPassword(b.token, b.password, req.ctx);
    res.json({ ok: true });
  }));
  app.post("/api/password/change", session(OK), wrap(async (req, res) => {
    if (!loginLimit(`p:${req.session.user_id}`)) throw tooMany();
    const b = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), req.body);
    await core.changePassword(req.session, b.current, b.next, req.ctx);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- invitations
  app.get("/api/invites/:token", wrap(async (req, res) => {
    if (!acceptLimit(req.ip)) throw tooMany();
    res.json(await core.inviteInfo(req.params.token));
  }));
  app.post("/api/invites/accept", wrap(async (req, res) => {
    if (!acceptLimit(req.ip)) throw tooMany();
    const b = parse(z.object({ token: z.string().max(100), password: z.string().max(200), fullName: z.string().trim().min(1).max(120).optional() }), req.body);
    await core.acceptInvite(b.token, b, req.ctx);
    res.status(201).json({ ok: true });
  }));
  app.post("/api/invites", session(OK), wrap(async (req, res) => {
    const b = parse(z.object({
      email, fullName: z.string().trim().min(1).max(120), clinicId: uuid.nullish(), roleKey: z.string().max(40),
      doctorId: uuid.nullish(), canManageBookings: z.boolean().optional(),
    }), req.body);
    const clinicId = b.clinicId === undefined ? req.session.clinic_id : b.clinicId;
    res.status(201).json(await core.createInvite(req.session, { ...b, clinicId }, req.ctx));
  }));

  // ---------------------------------------------------------------- users and sessions (administration)
  const clinicOf = (req) => req.query.clinic ? String(req.query.clinic) : req.session.clinic_id;
  app.get("/api/users", session(OK), wrap(async (req, res) => res.json(await core.listUsers(req.session, clinicOf(req)))));
  app.get("/api/doctors", session(OK), wrap(async (req, res) => res.json(await core.listDoctors(req.session, clinicOf(req)))));
  app.patch("/api/users/:id", session(OK), wrap(async (req, res) => {
    const b = parse(z.object({ roleKey: z.string().max(40).optional(), doctorId: uuid.nullable().optional(), canManageBookings: z.boolean().optional(), active: z.boolean().optional() }), req.body);
    await core.updateMembership(req.session, parse(uuid, req.params.id), clinicOf(req), b, req.ctx);
    res.json({ ok: true });
  }));
  app.post("/api/users/:id/status", session(OK), wrap(async (req, res) => {
    const b = parse(z.object({ status: z.enum(["active", "disabled"]) }), req.body);
    await core.setUserStatus(req.session, parse(uuid, req.params.id), clinicOf(req), b.status, req.ctx);
    res.json({ ok: true });
  }));
  app.post("/api/users/:id/revoke-sessions", session(OK), wrap(async (req, res) =>
    res.json({ revoked: await core.revokeUserSessions(req.session, parse(uuid, req.params.id), clinicOf(req), req.ctx) })));
  app.post("/api/users/:id/send-reset", session(OK), wrap(async (req, res) => {
    const link = await core.adminSendReset(req.session, parse(uuid, req.params.id), clinicOf(req), req.ctx);
    res.json({ ok: true, ...(link ? { link } : {}) });
  }));
  app.get("/api/sessions/mine", session(OK), wrap(async (req, res) => res.json(await core.mySessions(req.session))));
  app.delete("/api/sessions/:id", session(OK), wrap(async (req, res) => { await core.revokeMine(req.session, parse(uuid, req.params.id)); res.json({ ok: true }); }));
  app.get("/api/sessions", session(OK), wrap(async (req, res) => res.json(await core.allSessions(req.session, clinicOf(req)))));

  // The launcher: the services this person may open.
  app.get("/api/apps", session(OK), wrap(async (req, res) => {
    const perms = await core.permissionsFor(req.session);
    const { rows } = await core.pool.query("select key, name_en, name_ar, url from accounts.apps where key <> 'accounts' order by key");
    res.json(rows.filter((a) => perms.some((p) => p.startsWith(`${a.key}.`))));
  }));

  // ---------------------------------------------------------------- single sign-on
  app.get("/authorize", wrap(async (req, res) => {
    const q = parse(z.object({ client: z.string().max(40), redirect_uri: z.string().max(500), state: z.string().max(200) }), req.query);
    const token = parseCookies(req.headers.cookie)[config.cookieName];
    const s = await core.loadSession(token);
    if (!s || s.state !== "ok") {                           // sign in first, then come back here
      return res.redirect(302, `${config.siteUrl}/signin?next=${encodeURIComponent(req.originalUrl)}`);
    }
    let code;
    try { code = await core.startAuthorize(s, q.client, q.redirect_uri); }
    catch (e) {
      if (e instanceof HttpError && e.code === "no_access_to_service") return res.redirect(302, `${config.siteUrl}/no-access?client=${encodeURIComponent(q.client)}`);
      throw e;
    }
    const back = new URL(q.redirect_uri);
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.state);
    res.redirect(302, back.toString());
  }));
  app.post("/token", wrap(async (req, res) => {
    if (!codeLimit(req.ip)) throw tooMany();
    const b = parse(z.object({ client: z.string().max(40), secret: z.string().max(200), code: z.string().max(100), redirect_uri: z.string().max(500) }), req.body);
    res.json(await core.exchangeCode({ client: b.client, secret: b.secret, code: b.code, redirectUri: b.redirect_uri }));
  }));
  app.post("/introspect", wrap(async (req, res) => {
    const b = parse(z.object({ client: z.string().max(40), secret: z.string().max(200), token: z.string().max(100), touch: z.boolean().optional() }), req.body);
    res.json(await core.introspect(b));
  }));
  app.post("/people", wrap(async (req, res) => {
    const b = parse(z.object({ client: z.string().max(40), secret: z.string().max(200), token: z.string().max(100), ids: z.array(uuid).max(200) }), req.body);
    res.json(await core.peopleNames(b));
  }));
  app.post("/app-logout", wrap(async (req, res) => {
    const b = parse(z.object({ client: z.string().max(40), secret: z.string().max(200), token: z.string().max(100) }), req.body);
    await core.appLogout(b);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- the pages (built React app), when present
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.endsWith(".html")) res.set("Cache-Control", "no-store"); } }));
    app.get(/^\/(?!api\/|authorize|token|introspect|app-logout|people).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  // ---------------------------------------------------------------- errors
  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") return res.status(400).json({ error: "invalid_input" });
    console.error(`[${req.ctx?.requestId}]`, err);
    res.status(500).json({ error: "server_error", requestId: req.ctx?.requestId });
  });

  return app;
}
