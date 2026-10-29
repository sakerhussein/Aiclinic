// Limitsiz Clinic: Node.js (Express) server.
// - Serves the built React site from client/dist (after `npm run build`).
// - Exposes POST /api/leads, which validates a demo request and saves it to Supabase.

import express from "express";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

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

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

// Returns { honeypot: true } for bots, { error } for bad input, or { row } for valid data.
function validateLead(body) {
  const b = body && typeof body === "object" ? body : {};
  if (b.website) return { honeypot: true };

  const name = clean(b.name, 200);
  const email = clean(b.email, 320);
  if (!name) return { error: "Name is required." };
  if (!EMAIL_RE.test(email)) return { error: "A valid email is required." };

  return {
    row: {
      name,
      clinic: clean(b.clinic, 200) || null,
      email,
      phone: clean(b.phone, 40) || null,
      message: clean(b.message, 2000) || null,
      language: b.language === "ar" ? "ar" : "en",
      source: "website",
      page: clean(b.page, 100) || null,
    },
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/leads", leadLimiter, async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: "Lead storage is not configured." });
  }

  const result = validateLead(req.body);
  if (result.honeypot) return res.status(201).json({ ok: true });
  if (result.error) return res.status(400).json({ error: result.error });

  try {
    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(LEADS_TABLE)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        // Return nothing: the public role cannot read rows back.
        Prefer: "return=minimal",
      },
      body: JSON.stringify(result.row),
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      console.error("Supabase insert failed:", upstream.status, await upstream.text());
      return res.status(502).json({ error: "Could not save your request." });
    }
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("Lead request error:", err);
    return res.status(502).json({ error: "Could not save your request." });
  }
});

// Unknown API paths return JSON, not the website.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Serve the built React site and fall back to index.html for client-side routes.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: "index.html", maxAge: "1h" }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
} else {
  console.warn("client/dist not found. Run `npm run build` to serve the website here.");
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is missing. Demo requests will not be saved.");
}

app.listen(PORT, () => {
  console.log(`Limitsiz Clinic server running on http://localhost:${PORT}`);
});
