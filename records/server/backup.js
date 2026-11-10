// The nightly backup on the VPS disk (design: booking/design/records-phase-b.html, screen 7). Runs inside the Records service.
// Every night at Settings' time: each new photo or document is copied from the bucket, and a dump of the record tables is written,
// each encrypted (AES-256-GCM) with the key made on the VPS (never shown). Files never change, so each is copied once.
// Dumps are kept for Settings' days and months. On the restore-check day a sample of files is decrypted and compared with the
// fingerprints in the database, so we know a copy can be read, not just that it ran. A failed night is retried, and emailed.
// `node server/backup.js run` runs it once by hand (the setup script does, to test it).
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const MAGIC = Buffer.from("LCB1");
export const dateIn = (d, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const minutesIn = (d, tz) => { const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).split(":").map(Number); return h * 60 + m; };
const weekdayIn = (d, tz) => new Date(dateIn(d, tz) + "T12:00:00Z").getUTCDay();
// The tables of the record (all clinics). The audit trail has its own nightly job and email in Booking.
const TABLES = ["record_settings", "patient_details", "chart_entries", "chart_answers", "insurance_companies", "record_files", "record_openings"];

export function encrypt(key, plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
export function decrypt(key, data) {
  if (!data.subarray(0, 4).equals(MAGIC)) throw new Error("not a backup file");
  const d = crypto.createDecipheriv("aes-256-gcm", key, data.subarray(4, 16));
  d.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([d.update(data.subarray(32)), d.final()]);
}
export const fingerprint = (key) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);

export function createBackups({ pool, storage, config, now = () => new Date(), log = console.log, sendMail }) {
  const dir = config.backup?.dir;
  const send = sendMail ?? (() => {
    const s = config.smtp;
    const t = s ? nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: s.user ? { user: s.user, pass: s.pass } : undefined }) : null;
    return async (to, subject, text) => { if (!t || !to) { log(`[backup email not sent: SMTP or the alert address is not set] ${subject}`); return false; } await t.sendMail({ from: s.from, to, subject, text }); return true; };
  })();
  let key = null;
  async function keyOf() {
    if (key) return key;
    const k = await fs.readFile(config.backup.keyFile);
    if (k.length !== 32) throw new Error("the backup key file must hold 32 bytes");
    return (key = k);
  }
  const settings = async () => (await pool.query("select * from backup_settings")).rows[0];

  async function freeGb() {
    const s = await fs.statfs(dir);
    return (s.bavail * s.bsize) / 1024 ** 3;
  }

  // One run: copy the new files, write the dump, keep what Settings says, and on the check day check a sample.
  async function run(kind = "nightly") {
    if (!dir) throw new Error("backups are not set up on this server (BACKUP_DIR)");
    const st = await settings();
    const runId = (await pool.query("insert into backup_runs (kind, started_at) values ($1, $2) returning id", [kind, now()])).rows[0].id;
    let files = 0, bytes = 0, checked = null;
    try {
      const k = await keyOf();
      if ((await freeGb()) < st.min_free_gb) throw new Error(`less than ${st.min_free_gb} GB would be left on the VPS disk`);
      await fs.mkdir(path.join(dir, "files"), { recursive: true });
      await fs.mkdir(path.join(dir, "db"), { recursive: true });
      const todo = (await pool.query("select id, storage_path from record_files where backed_up_at is null order by created_at limit 5000")).rows;
      for (const f of todo) {
        const enc = encrypt(k, await storage.get(f.storage_path));
        const to = path.join(dir, "files", `${f.storage_path}.enc`);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.writeFile(to + ".part", enc);
        await fs.rename(to + ".part", to);
        await pool.query("update record_files set backed_up_at = $2 where id = $1", [f.id, now()]);
        files += 1; bytes += enc.length;
      }
      const dump = {};
      for (const t of TABLES) dump[t] = (await pool.query(`select * from ${t}`)).rows;
      const stamp = dateIn(now(), st.timezone);
      const enc = encrypt(k, Buffer.from(JSON.stringify({ at: now().toISOString(), tables: dump })));
      await fs.writeFile(path.join(dir, "db", `${stamp}.json.enc`), enc);
      bytes += enc.length;
      await prune(st);
      if (weekdayIn(now(), st.timezone) === st.restore_weekday) checked = await restoreCheck(st);
      await pool.query("update backup_runs set finished_at = $2, state = 'done', files = $3, bytes = $4, restore_checked = $5 where id = $1",
        [runId, now(), files, bytes, checked]);
      return { state: "done", files, bytes, restoreChecked: checked };
    } catch (e) {
      const message = String(e.message || e).slice(0, 900);
      await pool.query("update backup_runs set finished_at = $2, state = 'failed', files = $3, bytes = $4, message = $5 where id = $1", [runId, now(), files, bytes, message]);
      const sent = await send(st.alert_emails, `Limitsiz Records: the ${kind} backup failed`,
        `The ${kind} backup of the patient records on the VPS failed at ${now().toISOString()}.\n\n${message}\n\n${kind === "nightly" ? `It will be tried again in ${st.retry_minutes} minutes.` : "It will be tried again tomorrow night."}\nRecords › Settings › Backups shows the last nights.`).catch(() => false);
      await pool.query("update backup_runs set alerted = $2 where id = $1", [runId, !!sent]);
      log(`backup ${kind} failed: ${message}`);
      return { state: "failed", message };
    }
  }

  // Daily dumps for keep_daily days; besides those, the first dump of each month for keep_monthly months.
  async function prune(st) {
    const names = (await fs.readdir(path.join(dir, "db"))).filter((n) => /^\d{4}-\d{2}-\d{2}\.json\.enc$/.test(n)).sort().reverse();
    const today = dateIn(now(), st.timezone);
    const dayMs = 86400000;
    const firstOfMonth = new Map();
    for (const n of [...names].sort()) if (!firstOfMonth.has(n.slice(0, 7))) firstOfMonth.set(n.slice(0, 7), n);
    const months = [...firstOfMonth.values()].sort().reverse().slice(0, st.keep_monthly);
    for (const n of names) {
      const age = (Date.parse(today) - Date.parse(n.slice(0, 10))) / dayMs;
      if (age < st.keep_daily || months.includes(n)) continue;
      await fs.rm(path.join(dir, "db", n), { force: true });
    }
  }

  // Decrypt a sample of the copied files and the newest dump; compare each file with the fingerprint in the database.
  async function restoreCheck(st) {
    const k = await keyOf();
    const sample = (await pool.query("select storage_path, sha256 from record_files where backed_up_at is not null order by random() limit $1", [st.restore_sample])).rows;
    let ok = 0;
    for (const f of sample) {
      const plain = decrypt(k, await fs.readFile(path.join(dir, "files", `${f.storage_path}.enc`)));
      if (crypto.createHash("sha256").update(plain).digest("hex") !== f.sha256) throw new Error(`restore check: ${f.storage_path} does not match`);
      ok += 1;
    }
    const newest = (await fs.readdir(path.join(dir, "db"))).filter((n) => n.endsWith(".json.enc")).sort().pop();
    if (newest) JSON.parse(decrypt(k, await fs.readFile(path.join(dir, "db", newest))).toString());
    return ok;
  }

  // Called every minute: the nightly run once a day at Settings' time, and one retry after a failure.
  async function tick() {
    if (!dir) return null;
    const st = await settings();
    const today = dateIn(now(), st.timezone);
    const [h, m] = String(st.run_at).split(":").map(Number);
    if (minutesIn(now(), st.timezone) < h * 60 + m) return null;
    const runs = (await pool.query(`select kind, state, finished_at from backup_runs where kind in ('nightly', 'retry') and started_at > $1::timestamptz - interval '36 hours'
                                     order by started_at desc`, [now()])).rows.filter((r) => dateIn(new Date(r.finished_at ?? now()), st.timezone) === today);
    if (runs.some((r) => r.state === "running")) return null;
    if (!runs.length) return run("nightly");
    const last = runs[0];
    if (last.state === "failed" && last.kind === "nightly" && now() - new Date(last.finished_at) >= st.retry_minutes * 60000) return run("retry");
    return null;
  }

  async function status() {
    const st = await settings();
    const runs = (await pool.query("select id, kind, started_at, finished_at, state, files, bytes, restore_checked, message from backup_runs order by started_at desc limit 14")).rows;
    const lastDone = (await pool.query("select finished_at, files, restore_checked from backup_runs where state = 'done' order by finished_at desc limit 1")).rows[0] ?? null;
    const lastCheck = (await pool.query("select finished_at, restore_checked from backup_runs where state = 'done' and restore_checked is not null order by finished_at desc limit 1")).rows[0] ?? null;
    const counts = (await pool.query("select count(*)::int as files, count(*) filter (where backed_up_at is not null)::int as copied, coalesce(sum(size_bytes), 0)::bigint as bytes from record_files")).rows[0];
    let disk = null, key = null;
    if (dir) {
      try { disk = { freeGb: Math.round((await freeGb()) * 10) / 10 }; } catch { disk = null; }
      try { key = fingerprint(await keyOf()); } catch { key = null; }
    }
    return { configured: !!dir, settings: st, runs, lastDone, lastCheck, files: counts.files, copied: counts.copied, bytes: Number(counts.bytes), disk, keyFingerprint: key };
  }

  async function updateSettings(ctx, b) {
    const r = await pool.query(
      `update backup_settings set run_at = $1, timezone = $2, keep_daily = $3, keep_monthly = $4, restore_weekday = $5, alert_emails = $6, updated_by_name = $7 returning *`,
      [b.runAt, b.timezone, b.keepDaily, b.keepMonthly, b.restoreWeekday, b.alertEmails?.trim() || null, ctx.user.name]);
    return r.rows[0];
  }

  let timer = null;
  return {
    run, tick, status, updateSettings, restoreCheck,
    start() { if (!dir || timer) return; timer = setInterval(() => { tick().catch((e) => log("backup tick failed:", e.message)); }, 60_000); timer.unref?.(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

// node server/backup.js run: one backup now (the setup script runs it to test everything).
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "run") {
  const { loadConfig } = await import("./config.js");
  const { createStorage } = await import("./storage.js");
  const pg = (await import("pg")).default;
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2, ssl: config.databaseUrl?.includes("localhost") ? false : { rejectUnauthorized: false } });
  const b = createBackups({ pool, storage: createStorage(config.storage), config });
  const r = await b.run("manual");
  console.log(JSON.stringify(r));
  if (process.argv[3] === "--check") console.log(JSON.stringify({ restoreChecked: await b.restoreCheck(await (await pool.query("select * from backup_settings")).rows[0]) }));
  await pool.end();
  process.exit(r.state === "done" ? 0 : 1);
}
