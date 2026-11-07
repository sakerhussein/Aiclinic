// HTTP layer of the online booking page (book.limitsiz.si/<clinic>). No cookies, no sign-in. Limits per connection come from each
// clinic's Settings > Online booking, so a clinic can tighten them without a code change.
import express from "express";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, parse, z } from "./http.js";

const uuid = z.guid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slugRe = /^[a-z0-9-]{1,60}$/;
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "dist-public");

// Fixed-window counters whose maximum is given on each call (it is the clinic's setting).
export function counters(now = Date.now) {
  const hits = new Map();
  const hit = (key, max, windowMs) => {
    const t = now();
    let h = hits.get(key);
    if (!h || h.resetAt <= t) { h = { count: 0, resetAt: t + windowMs }; hits.set(key, h); }
    h.count += 1;
    if (hits.size > 20000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    return h.count <= max;
  };
  hit.clear = () => hits.clear();
  return hit;
}

export function createPublicApp({ svc, config, now = Date.now }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy === "false" ? false : Number(config.trustProxy) || config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
      ...(config.secure ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "8kb" }));
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin") !== config.origin) return next(new HttpError(403, "bad_origin"));
    req.ctx = { ip: req.ip, ua: (req.get("user-agent") || "").slice(0, 300), requestId: crypto.randomBytes(8).toString("base64url") };
    next();
  });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---- the clinic's limits, read from its settings (kept for a short while so every request is not a query)
  const cache = new Map();
  async function limitsOf(slug) {
    const c = cache.get(slug);
    if (c && c.until > now()) return c.v;
    const v = await svc.limits(slug);
    cache.set(slug, { v, until: now() + 30_000 });
    if (cache.size > 2000) cache.clear();
    return v;
  }
  const count = counters(now);
  const KIND = {
    lookup: { field: "lookups_per_ip_per_minute", windowMs: 60_000 },
    book: { field: "bookings_per_ip_per_day", windowMs: 86_400_000 },
    manage: { field: "manage_per_ip_per_hour", windowMs: 3_600_000 },
  };
  const slugOf = (req) => { if (!slugRe.test(req.params.slug)) throw new HttpError(404, "clinic_not_found"); return req.params.slug; };
  const limit = (kind) => wrap(async (req, res, next) => {
    const slug = slugOf(req), l = await limitsOf(slug);
    if (!l) throw new HttpError(404, "clinic_not_found");
    const k = KIND[kind];
    if (!count(`${kind}|${slug}|${req.ip}`, l[k.field], k.windowMs)) throw new HttpError(429, "too_many_requests");
    next();
  });

  app.get("/api/health", (req, res) => res.json({ ok: true }));
  // For the deploy and uptime checks: 200 when the database answers to the public_app login.
  app.get("/api/health/db", wrap(async (req, res) => {
    try { await svc.ping(); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  }));

  app.get("/api/c/:slug", limit("lookup"), wrap(async (req, res) => res.json(await svc.info(slugOf(req)))));
  app.get("/api/c/:slug/slots", limit("lookup"), wrap(async (req, res) => {
    const q = parse(z.object({ service: uuid, doctor: uuid.optional(), date: day, days: z.coerce.number().int().min(1).max(31).optional() }), req.query);
    res.json(await svc.slots(slugOf(req), { serviceId: q.service, doctorId: q.doctor, from: q.date, days: q.days }));
  }));
  app.post("/api/c/:slug/book", limit("book"), wrap(async (req, res) => {
    const b = parse(z.object({
      serviceId: uuid, doctorId: uuid.nullish(), startsAt: z.string().max(40),
      name: z.string().trim().min(2).max(120), phone: z.string().trim().min(6).max(30),
      language: z.enum(["ar", "en"]), reminders: z.boolean().optional(), forOther: z.boolean().optional(),
      from: z.string().regex(/^[a-z0-9_-]{1,20}$/).nullish().catch(null),
      agree: z.literal(true), website: z.string().max(200).optional(),
    }), req.body);
    if (b.website) return res.status(201).json({ ok: true });          // hidden field filled in: a bot. Looks like success, does nothing.
    res.status(201).json(await svc.book(slugOf(req), req.ctx, b));
  }));

  // ---- the private change-or-cancel link. The token travels in the body, never in an address that could end up in a log.
  const tok = { token: z.string().max(60) };
  app.post("/api/c/:slug/manage", limit("manage"), wrap(async (req, res) => res.json(await svc.manage(slugOf(req), parse(z.object(tok), req.body).token))));
  app.post("/api/c/:slug/manage/slots", limit("manage"), wrap(async (req, res) => {
    const b = parse(z.object({ ...tok, date: day }), req.body);
    res.json(await svc.manageSlots(slugOf(req), b.token, b.date));
  }));
  app.post("/api/c/:slug/manage/cancel", limit("manage"), wrap(async (req, res) => {
    const b = parse(z.object({ ...tok, reason: z.string().trim().max(300).optional() }), req.body);
    res.json(await svc.cancel(slugOf(req), b.token, { ...req.ctx, reason: b.reason }));
  }));
  app.post("/api/c/:slug/manage/reschedule", limit("manage"), wrap(async (req, res) => {
    const b = parse(z.object({ ...tok, startsAt: z.string().max(40) }), req.body);
    res.json(await svc.reschedule(slugOf(req), b.token, b.startsAt, req.ctx));
  }));

  // ---- the page (its own small build, not the staff app)
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.endsWith(".html")) res.set("Cache-Control", "no-store"); } }));
    app.get(/^\/[a-z0-9-]{1,60}(\/manage)?\/?$/, (req, res) => res.sendFile(path.join(dist, "book.html")));
  }

  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") return res.status(400).json({ error: "invalid_input" });
    if (err?.code === "22P02" || err?.code === "22007") return res.status(400).json({ error: "invalid_input" });
    console.error(`[${req.ctx?.requestId}]`, err);
    res.status(500).json({ error: "server_error", requestId: req.ctx?.requestId });
  });
  app.locals.forget = () => { cache.clear(); count.clear(); };     // tests: start each case with fresh limits
  return app;
}
