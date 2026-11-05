// The nightly audit job (design §7.3, §7.4): for every clinic and the platform, check the chain, remove what retention allows,
// and email the newest hashes to the owner. That email is the proof kept outside the system, so keep it.
// Runs inside the Booking service. `npm run nightly` runs it once by hand.
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import pg from "pg";
import { loadConfig } from "./config.js";

const PLATFORM = "Limitsiz (platform)";

export const dateIn = (d, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const hourIn = (d, tz) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d));

export function createMailer(config, { log = console.log } = {}) {
  const s = config.smtp;
  const transport = s ? nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: s.user ? { user: s.user, pass: s.pass } : undefined }) : null;
  return async ({ subject, text }) => {
    if (!transport || !config.anchorEmail) { log(`[nightly audit email not sent: SMTP or AUDIT_ANCHOR_EMAIL is not set] ${subject}`); return false; }
    await transport.sendMail({ from: s.from, to: config.anchorEmail, subject, text });
    return true;
  };
}

// One run. The database decides the rest (audit.nightly) and refuses to repeat a date, so a restart cannot run it twice.
export async function runNightly({ pool, send, runDate }) {
  const { rows: clinics } = await pool.query("select id, name_en from clinics order by name_en");
  const results = [];
  for (const c of [...clinics, { id: null, name_en: PLATFORM }]) {
    const { rows } = await pool.query("select * from audit.nightly($1, $2)", [c.id, runDate]);
    results.push({ clinic: c.name_en, ...rows[0] });
  }
  const fresh = results.filter((r) => !r.already);
  if (!fresh.length) return { results, emailed: false };

  const bad = fresh.filter((r) => !r.ok || !r.anchor_ok);
  const lines = fresh.map((r) => {
    const state = r.ok && r.anchor_ok ? "intact" : !r.ok ? `BROKEN at entry ${r.broken_seq}` : "ENTRIES MISSING from the end of the chain";
    const purged = Number(r.removed) ? `, ${r.removed} old entries removed` : "";
    return `${r.clinic}: ${state} (${r.checked} entries checked${purged})\n  newest entry ${r.head_seq}, hash ${r.head_hash}`;
  });
  const subject = bad.length ? `ALERT: audit log problem at ${bad.map((r) => r.clinic).join(", ")} (${runDate})` : `Limitsiz Clinic audit anchor ${runDate}: all intact`;
  const text = `${bad.length ? "An audit chain failed its check. Nothing was removed from it. Keep a copy of the data and look into this now.\n\n" : ""}${lines.join("\n\n")}\n\n` +
    "Keep this email. These hashes prove what the audit log looked like tonight, from outside the system.\n";
  const emailed = await send({ subject, text });
  return { results, emailed, alert: bad.length > 0 };
}

// Checks every 10 minutes whether tonight's run is due, so a service that was down at 02:00 catches up when it comes back.
export function startNightly({ pool, send, tz, hour, now = () => new Date(), log = console, every = 600_000 }) {
  let done = null, running = false;
  const tick = async () => {
    const t = now(), day = dateIn(t, tz);
    if (running || done === day || hourIn(t, tz) < hour) return;
    running = true;
    try {
      const r = await runNightly({ pool, send, runDate: day });
      done = day;
      log.log(`Nightly audit job ${day}: ${r.results.filter((x) => !x.already).length} chains checked${r.alert ? ", ALERT sent" : ""}`);
    } catch (e) { log.error("Nightly audit job failed; it runs again in 10 minutes:", e.message); } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), every);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}

// `npm run nightly`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2, ssl: config.databaseUrl?.includes("localhost") ? false : { rejectUnauthorized: false } });
  const r = await runNightly({ pool, send: createMailer(config), runDate: dateIn(new Date(), config.nightlyTz) });
  console.log(r.results.map((x) => `${x.clinic}: ${x.already ? "already ran today" : x.ok && x.anchor_ok ? "intact" : "PROBLEM"}`).join("\n"));
  await pool.end();
}
