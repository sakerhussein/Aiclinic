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

// human: the human check (server/human-check.js), or null when the Cloudflare keys are not set: then nothing is checked anywhere.
export function createPublicApp({ svc, config, now = Date.now, human = null }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy === "false" ? false : Number(config.trustProxy) || config.trustProxy);

  // With the human check set up, Cloudflare's script and its box (an iframe) may load; nothing else changes.
  const CF = "https://challenges.cloudflare.com";
  const csp = () => "default-src 'self'; " + (human?.siteKey ? `script-src 'self' ${CF}; frame-src ${CF}; ` : "")
    + "img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": csp(),
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
    find: { field: "find_per_ip_per_hour", windowMs: 3_600_000 },
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

  // ---- the human check (design: booking/design/human-check.html). Runs after the limit per connection and the hidden field, so
  // a flood or a simple bot never reaches Cloudflare, and before anything is looked up or saved, so a failure saves nothing and
  // never depends on the phone number. Answers null (not asked: off, keys not set, or this form not chosen), "passed" or
  // "skipped" (Cloudflare couldn't be reached and the clinic lets bookings through, within its hourly allowance).
  const skips = counters(now);
  const asks = (l, form) => !!(human?.siteKey && l?.human_check && l.human_check_forms?.includes(form));
  async function humanGate(req, form, token) {
    const slug = slugOf(req), l = await limitsOf(slug);
    if (!asks(l, form)) return null;
    const r = await human.check(token, { action: form, hostname: new URL(config.siteUrl).hostname, ip: req.ip });
    if (r === "passed") return "passed";
    if (r === "failed") throw new HttpError(403, "human_check_failed");
    if (l.human_check_down === "let_through" && skips(`skip|${slug}`, l.human_check_skip_per_hour, 3_600_000)) {
      console.warn(`[${req.ctx.requestId}] human check skipped: Cloudflare could not be reached (${slug}, ${form})`);
      return "skipped";
    }
    throw new HttpError(503, "human_check_unavailable");
  }
  const human_ = z.string().max(2048).optional();      // Cloudflare's token (its tokens are at most 2048 characters)

  app.get("/api/c/:slug", limit("lookup"), wrap(async (req, res) => {
    const i = await svc.info(slugOf(req)), h = i.options.humanCheck;
    // The page gets the site key (public) and the forms to check, never the secret.
    i.options.humanCheck = human?.siteKey && h?.on ? { siteKey: human.siteKey, forms: h.forms } : null;
    res.json(i);
  }));
  app.get("/api/c/:slug/slots", limit("lookup"), wrap(async (req, res) => {
    const q = parse(z.object({ service: uuid, doctor: uuid.optional(), date: day, days: z.coerce.number().int().min(1).max(31).optional(),
      visit: z.enum(["in_clinic", "online"]).optional() }), req.query);
    res.json(await svc.slots(slugOf(req), { serviceId: q.service, doctorId: q.doctor, from: q.date, days: q.days, visit: q.visit }));
  }));
  app.post("/api/c/:slug/book", limit("book"), wrap(async (req, res) => {
    const b = parse(z.object({
      serviceId: uuid, doctorId: uuid.nullish(), startsAt: z.string().max(40),
      name: z.string().trim().min(2).max(120), phone: z.string().trim().min(6).max(30),
      language: z.enum(["ar", "en"]), reminders: z.boolean().optional(), forOther: z.boolean().optional(),
      from: z.string().regex(/^[a-z0-9_-]{1,20}$/).nullish().catch(null),
      agree: z.literal(true), website: z.string().max(200).optional(), human: human_,
      // Online visits: the visit type, the patient's choice of video or audio (when it is theirs), how the Join link reaches them, the consent.
      visitType: z.enum(["in_clinic", "online"]).optional(), onlineMode: z.enum(["video", "audio"]).optional(),
      linkChannel: z.enum(["whatsapp", "email"]).optional(), email: z.string().trim().toLowerCase().email().max(120).optional(), onlineConsent: z.boolean().optional(),
    }), req.body);
    if (b.website) return res.status(201).json({ ok: true });          // hidden field filled in: a bot. Looks like success, does nothing.
    const humanCheck = await humanGate(req, "book", b.human);
    res.status(201).json(await svc.book(slugOf(req), req.ctx, { ...b, human: undefined, humanCheck }));
  }));
  // "Find my booking": always the same answer, whether or not the number has a booking.
  app.post("/api/c/:slug/find", limit("find"), wrap(async (req, res) => {
    const b = parse(z.object({ phone: z.string().trim().min(6).max(30), website: z.string().max(200).optional(), human: human_ }), req.body);
    if (b.website) return res.status(202).json({ ok: true });
    await humanGate(req, "find", b.human);
    res.status(202).json(await svc.find(slugOf(req), req.ctx, b.phone));
  }));

  // ---- "Talk to the assistant". The name and number go only to /book and /callback, never with a chat message.
  const chatIdOf = (req) => parse(uuid, req.params.chatId);
  app.post("/api/c/:slug/chat", limit("lookup"), wrap(async (req, res) => {
    const b = parse(z.object({ human: human_ }), req.body ?? {});
    await humanGate(req, "chat_start", b.human);
    res.status(201).json(await svc.chatStart(slugOf(req), req.ctx));
  }));
  app.post("/api/c/:slug/chat/:chatId/message", limit("lookup"), wrap(async (req, res) => {
    const b = parse(z.object({ text: z.string().trim().min(1).max(1000), language: z.enum(["ar", "en"]).optional() }), req.body);
    res.json(await svc.chatMessage(slugOf(req), chatIdOf(req), b.text, b.language));
  }));
  app.post("/api/c/:slug/chat/:chatId/book", limit("book"), wrap(async (req, res) => {
    const b = parse(z.object({
      name: z.string().trim().min(2).max(120), phone: z.string().trim().min(6).max(30), language: z.enum(["ar", "en"]),
      agree: z.literal(true), website: z.string().max(200).optional(), human: human_,
      // an online visit proposed by the assistant: the card's consent tick and choices (the visit type comes from the proposal)
      onlineMode: z.enum(["video", "audio"]).optional(), linkChannel: z.enum(["whatsapp", "email"]).optional(),
      email: z.string().trim().toLowerCase().email().max(120).optional(), onlineConsent: z.boolean().optional(),
    }), req.body);
    if (b.website) return res.status(201).json({ ok: true });
    const humanCheck = await humanGate(req, "chat_book", b.human);
    res.status(201).json(await svc.chatBook(slugOf(req), chatIdOf(req), req.ctx, { ...b, human: undefined, humanCheck }));
  }));
  app.post("/api/c/:slug/chat/:chatId/callback", limit("book"), wrap(async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(6).max(30), website: z.string().max(200).optional(),
      human: human_ }), req.body);
    if (b.website) return res.status(201).json({ ok: true });
    const humanCheck = await humanGate(req, "callback", b.human);
    res.status(201).json(await svc.chatCallback(slugOf(req), chatIdOf(req), req.ctx, { ...b, human: undefined, humanCheck }));
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

  // ---- "Join the visit": book.limitsiz.si/<clinic>/j#<token>. The token travels in the body, as above.
  app.post("/api/c/:slug/join", limit("manage"), wrap(async (req, res) => res.json(await svc.join(slugOf(req), parse(z.object(tok), req.body).token))));

  // ---- "Add to calendar" for Apple Calendar and other calendars. An iPhone adds an .ics file only when it comes from a server as
  // text/calendar; a file made inside the page does nothing there. The page sends the entry it made, with the token (in the body,
  // as above); once the token is checked, the entry is kept in this process's memory for two minutes under a random address, which
  // the phone then opens. Nothing is written anywhere, and the address can't see or change the booking.
  const held = new Map();
  const HOLD_MS = 120_000;
  app.post("/api/c/:slug/manage/ics", limit("manage"), wrap(async (req, res) => {
    const b = parse(z.object({ ...tok, ics: z.string().max(6000) }), req.body);
    const s = await svc.manage(slugOf(req), b.token);
    if (!b.ics.startsWith("BEGIN:VCALENDAR\r\n") || !b.ics.endsWith("END:VCALENDAR") || !b.ics.includes(`\r\nUID:${s.id}@limitsiz\r\n`)) {
      throw new HttpError(400, "invalid_value");
    }
    const t = now();
    for (const [k, v] of held) if (v.until <= t) held.delete(k);
    if (held.size >= 5000) throw new HttpError(429, "too_many_requests");
    const id = crypto.randomBytes(18).toString("base64url");
    held.set(id, { body: b.ics, until: t + HOLD_MS });
    res.status(201).json({ url: `/api/ics/${id}.ics` });
  }));
  // Not one-time: the phone may open it twice (a preview, then "Add"). It ends after the two minutes.
  app.get(/^\/api\/ics\/([A-Za-z0-9_-]{24})\.ics$/, (req, res) => {
    const h = held.get(req.params[0]);
    if (!h || h.until <= now()) return res.status(404).json({ error: "not_found" });
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="appointment.ics"' }).send(h.body);
  });

  // ---- the page (its own small build, not the staff app)
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.endsWith(".html")) res.set("Cache-Control", "no-store"); } }));
    app.get(/^\/[a-z0-9-]{1,60}(\/manage|\/find|\/chat|\/j)?\/?$/, (req, res) => res.sendFile(path.join(dist, "book.html")));
  }

  app.use((req, res) => res.status(404).json({ error: "not_found" }));
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") return res.status(400).json({ error: "invalid_input" });
    if (err?.code === "22P02" || err?.code === "22007") return res.status(400).json({ error: "invalid_input" });
    console.error(`[${req.ctx?.requestId}]`, err);
    res.status(500).json({ error: "server_error", requestId: req.ctx?.requestId });
  });
  app.locals.forget = () => { cache.clear(); count.clear(); skips.clear(); };     // tests: start each case with fresh limits
  return app;
}
