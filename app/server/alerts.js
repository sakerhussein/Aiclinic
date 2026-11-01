// Lead alerts: an email (and optionally a WhatsApp message) for every new request.
// Everything is configured in .env. A channel without settings is simply skipped,
// and an alert that fails is logged but never blocks the visitor's request.

import nodemailer from "nodemailer";

const env = (key) => (process.env[key] || "").trim();

const SMTP = {
  host: env("SMTP_HOST"),
  port: Number(env("SMTP_PORT")) || 465,
  user: env("SMTP_USER"),
  pass: env("SMTP_PASS"),
};
const EMAIL_TO = env("ALERT_EMAIL_TO");
const EMAIL_FROM = env("ALERT_EMAIL_FROM") || SMTP.user;

// Optional WhatsApp alert through CallMeBot (free; see README for the one-time setup).
const WA_PHONE = env("CALLMEBOT_PHONE");
const WA_KEY = env("CALLMEBOT_APIKEY");

// A login is optional: some mail relays (for example one on the same server) do not need it.
const emailReady = Boolean(SMTP.host && EMAIL_TO && EMAIL_FROM);
const whatsappReady = Boolean(WA_PHONE && WA_KEY);

const transporter = emailReady
  ? nodemailer.createTransport({
      host: SMTP.host,
      port: SMTP.port,
      secure: SMTP.port === 465,
      auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
  : null;

export function alertStatus() {
  return { email: emailReady, whatsapp: whatsappReady };
}

const LABELS = {
  interest: { clinic: "AI agents for my clinic", consulting: "AI consulting & implementation" },
  package: { starter: "Starter", pro: "Professional", enterprise: "Enterprise" },
  focus: {
    missed_calls: "Missed calls",
    scheduling: "Scheduling",
    documentation: "Documentation",
    reports: "Reports",
    finance: "Finance",
  },
};

function describe(row) {
  const lines = [
    ["Name", row.name],
    [row.interest === "consulting" ? "Organization" : "Clinic", row.clinic],
    ["Email", row.email],
    ["Phone / WhatsApp", row.phone],
    ["Interested in", LABELS.interest[row.interest] || row.interest],
    ["Fix first", LABELS.focus[row.focus] || row.focus],
    ["Clinic size", row.clinic_size && `${row.clinic_size} doctor(s)`],
    ["Specialties", Array.isArray(row.specialties) ? row.specialties.join(", ") : row.specialties],
    ["Package", LABELS.package[row.package] || row.package],
    ["Language", row.language === "ar" ? "Arabic" : "English"],
    ["Message", row.message],
  ];
  return lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
}

function whatsappLink(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "").replace(/^00/, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : "";
}

async function sendEmail(row, saved) {
  if (!transporter) return false;
  const who = row.clinic ? `${row.name} (${row.clinic})` : row.name;
  const subject = saved
    ? `New ${row.interest === "consulting" ? "consulting" : "assessment"} request: ${who}`
    : `ACTION NEEDED, not saved in the database: request from ${who}`;
  const reply = whatsappLink(row.phone);
  const text = [
    saved
      ? "A new request came in on limitsiz.si."
      : "A new request came in on limitsiz.si, but it could NOT be saved in Supabase. This email is the only copy, so keep it.",
    "",
    describe(row),
    "",
    reply ? `Reply on WhatsApp: ${reply}` : "",
    row.email ? `Or reply to this email to write to ${row.email}.` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO,
    replyTo: row.email || undefined,
    subject,
    text,
  });
  return true;
}

async function sendWhatsApp(row, saved) {
  if (!whatsappReady) return false;
  // Keep the WhatsApp message short: the full details are in the email and the database.
  const contact = row.phone || row.email || "";
  const text = `${saved ? "New" : "NOT SAVED, new"} Limitsiz request: ${row.name}${row.clinic ? ` (${row.clinic})` : ""}, ${
    LABELS.interest[row.interest] || row.interest
  }. Contact: ${contact}`;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(WA_PHONE)}&text=${encodeURIComponent(
    text
  )}&apikey=${encodeURIComponent(WA_KEY)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`CallMeBot answered ${res.status}`);
  return true;
}

// Sends every configured alert. Returns which ones went out; never throws.
export async function sendLeadAlerts(row, saved) {
  const [email, whatsapp] = await Promise.all([
    sendEmail(row, saved).catch((err) => {
      console.error("Lead email alert failed:", err.message);
      return false;
    }),
    sendWhatsApp(row, saved).catch((err) => {
      console.error("Lead WhatsApp alert failed:", err.message);
      return false;
    }),
  ]);
  return { email, whatsapp, any: email || whatsapp };
}

// Lets you check the email settings from the server: `npm run test:alert`.
export async function sendTestAlert() {
  if (!transporter) throw new Error("Email alerts are not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO).");
  await transporter.verify();
  const sample = {
    name: "Test request",
    clinic: "Limitsiz test",
    email: "",
    phone: "",
    interest: "clinic",
    language: "en",
    message: "This is a test of the lead alert. No action needed.",
  };
  return sendLeadAlerts(sample, true);
}
