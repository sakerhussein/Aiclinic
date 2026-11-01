// Limitsiz: Node.js (Express) server.
// - Serves the built React site from client/dist (after `npm run build`), in English (/) and Arabic (/ar),
//   with per-language titles, descriptions and link-preview tags written into the HTML (server/seo.js).
// - Exposes POST /api/leads, which validates an assessment or consulting request, saves it to Supabase
//   and sends an email/WhatsApp alert (server/alerts.js). If saving fails, the alert still carries the lead.
// - Keeps the Supabase project awake with a small daily request, and reports its health at /api/health/db.

import express from "express";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

// Imported after dotenv so they see the .env settings.
const { alertStatus, sendLeadAlerts, sendTestAlert } = await import("./alerts.js");
const { renderPage, robotsTxt, sitemapXml } = await import("./seo.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "client", "dist");

const PORT = Number(process.env.PORT) || 3001;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const LEADS_TABLE = process.env.LEADS_TABLE || "leads";

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));
app.use(express.json({ limit: "20kb" }));

// Limit form submissions per IP to slow down spam.
const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INTERESTS = new Set(["clinic", "consulting"]);
const SIZES = new Set(["1", "2-5", "6-10", "10+"]);
const SPECIALTIES = new Set(["dermatology", "dental", "family", "pediatrics", "physiotherapy", "mental", "other"]);
const PACKAGES = new Set(["starter", "pro", "enterprise"]);
const FOCUS = new Set(["missed_calls", "scheduling", "documentation", "reports", "finance"]);

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function pick(value, allowed) {
  const v = clean(value, 40);
  return allowed.has(v) ? v : null;
}

// Accepts an array (or a single value) and keeps only known, unique specialties.
function pickList(value, allowed) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const out = [];
  for (const item of list.slice(0, 10)) {
    const v = pick(item, allowed);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// Returns { honeypot: true } for bots, { error } for bad input, or { row } for valid data.
function validateLead(body) {
  const b = body && typeof body === "object" ? body : {};
  if (b.website) return { honeypot: true };

  const name = clean(b.name, 200);
  const email = clean(b.email, 320);
  const phone = clean(b.phone, 40);
  if (!name) return { error: "Name is required." };
  if (!email && !phone) return { error: "An email or a phone/WhatsApp number is required." };
  if (email && !EMAIL_RE.test(email)) return { error: "The email address is not valid." };

  const interest = pick(b.interest, INTERESTS) || "clinic";
  const isClinic = interest === "clinic";
  const specialties = isClinic ? pickList(b.specialties ?? b.specialty, SPECIALTIES) : [];

  return {
    row: {
      name,
      clinic: clean(b.clinic, 200) || null,
      email: email || null,
      phone: phone || null,
      message: clean(b.message, 2000) || null,
      language: b.language === "ar" ? "ar" : "en",
      source: "website",
      page: clean(b.page, 100) || null,
      interest,
      clinic_size: isClinic ? pick(b.clinic_size, SIZES) : null,
      specialties: specialties.length ? specialties : null,
      package: isClinic ? pick(b.package, PACKAGES) : null,
      focus: isClinic ? pick(b.focus, FOCUS) : null,
    },
  };
}

async function insertRow(row) {
  return fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(LEADS_TABLE)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      // Return nothing: the public role cannot read rows back.
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
}

// Columns added by supabase/leads_v2.sql and leads_v3.sql.
const NEW_COLUMNS = ["interest", "clinic_size", "specialties", "package", "focus"];

// Saves the lead. If the database has not been updated yet (supabase/leads_v3.sql),
// it retries without the new columns and keeps those details in the message instead.
async function saveLead(row) {
  let res = await insertRow(row);
  if (res.ok) return { ok: true };

  const body = await res.text();
  if (res.status === 400 && body.includes("PGRST204")) {
    console.warn("Some lead columns are missing. Run supabase/leads_v3.sql. Saving without them for now.");
    const base = { ...row };
    const extra = NEW_COLUMNS.filter((c) => row[c] != null)
      .map((c) => `${c}: ${Array.isArray(row[c]) ? row[c].join(", ") : row[c]}`)
      .join("; ");
    NEW_COLUMNS.forEach((c) => delete base[c]);
    base.message = [row.message, extra && `[${extra}]`].filter(Boolean).join("\n").slice(0, 2000);
    res = await insertRow(base);
    if (res.ok) return { ok: true };
    const retryBody = await res.text();
    console.error("Supabase insert failed:", res.status, retryBody);
    return { ok: false, needsEmail: !row.email && retryBody.includes("23502") };
  }

  console.error("Supabase insert failed:", res.status, body);
  // 23502 = NOT NULL violation: the database still requires an email (run leads_v3.sql).
  return { ok: false, needsEmail: !row.email && body.includes("23502") };
}

// A tiny read that touches the database. Used by the health check and the daily keep-awake ping.
// The public key cannot read leads (Row Level Security), so this returns an empty list: that is fine.
async function pingDatabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, reason: "not configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(LEADS_TABLE)}?select=id&limit=1`, {
      headers: { apikey: SUPABASE_KEY },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? { ok: true } : { ok: false, reason: `Supabase answered ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// For an uptime monitor (for example UptimeRobot): 200 when Supabase answers, 503 when it does not
// (paused project, wrong key, network problem), so you are told before a lead is lost.
app.get("/api/health/db", async (_req, res) => {
  const db = await pingDatabase();
  res.status(db.ok ? 200 : 503).json({ ok: db.ok, database: db.ok ? "reachable" : db.reason, alerts: alertStatus() });
});

app.post("/api/leads", leadLimiter, async (req, res) => {
  const alerts = alertStatus();
  if ((!SUPABASE_URL || !SUPABASE_KEY) && !alerts.email && !alerts.whatsapp) {
    return res.status(503).json({ error: "Lead storage is not configured." });
  }

  const result = validateLead(req.body);
  if (result.honeypot) return res.status(201).json({ ok: true });
  if (result.error) return res.status(400).json({ error: result.error });

  let saved = { ok: false };
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      saved = await saveLead(result.row);
    } catch (err) {
      console.error("Lead save error:", err);
    }
  }

  // Alert in every case: a normal alert when saved, an "action needed" alert carrying the full lead when not.
  const sent = await sendLeadAlerts(result.row, saved.ok);

  if (saved.ok) return res.status(201).json({ ok: true });
  if (sent.any) {
    console.error("Lead was NOT saved in Supabase, but the alert with its details was sent.");
    return res.status(201).json({ ok: true });
  }
  if (saved.needsEmail) return res.status(400).json({ error: "Please add an email address." });
  return res.status(502).json({ error: "Could not save your request." });
});

// Unknown API paths return JSON, not the website.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(robotsTxt());
});

app.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml").send(sitemapXml());
});

// Serve the built React site. Every page (/, /ar, /privacy, /ar/terms, …) gets index.html with its own
// language, title, description and preview tags written in by the server.
if (fs.existsSync(DIST_DIR)) {
  const template = fs.readFileSync(path.join(DIST_DIR, "index.html"), "utf8");
  app.use(express.static(DIST_DIR, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.set("Cache-Control", "no-cache").type("html").send(renderPage(template, req.path));
  });
} else {
  console.warn("client/dist not found. Run `npm run build` to serve the website here.");
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is missing. Requests will not be saved.");
}

{
  const a = alertStatus();
  if (!a.email && !a.whatsapp) {
    console.warn("Lead alerts are off: set the SMTP_* and ALERT_EMAIL_TO settings in .env to get an email for every request.");
  }
}

// `node server/index.js --test-alert` sends one test alert and exits (also: `npm run test:alert`).
if (process.argv.includes("--test-alert")) {
  try {
    const sent = await sendTestAlert();
    console.log(`Test alert sent. Email: ${sent.email ? "yes" : "no"}, WhatsApp: ${sent.whatsapp ? "yes" : "no"}`);
    process.exit(0);
  } catch (err) {
    console.error("Test alert failed:", err.message);
    process.exit(1);
  }
}

// Keep the Supabase project awake: free projects pause after about a week without activity,
// and then every form request fails. One small request a day is enough.
const DAY = 24 * 60 * 60 * 1000;
async function keepAwake() {
  const db = await pingDatabase();
  if (db.ok) console.log("Supabase keep-awake ping: OK");
  else console.error(`Supabase keep-awake ping FAILED: ${db.reason}. Check the project in the Supabase dashboard.`);
}
setTimeout(keepAwake, 60 * 1000);
setInterval(keepAwake, DAY);

app.listen(PORT, () => {
  console.log(`Limitsiz server running on http://localhost:${PORT}`);
});
