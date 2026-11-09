// Test harness: a fresh database with all migrations on the throwaway Postgres, the Accounts app connected as the real
// least-privilege login (accounts_app), and a controllable clock. Never points at a real project.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createCore } from "../server/core.js";
import { createApp } from "../server/app.js";
import { sha256, totp } from "../server/crypto.js";
import { hashPassword } from "../server/passwords.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ADMIN_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:test@localhost:54329/postgres";
const DB = "accounts_test";
export const SITE = "http://localhost:3003";
export const MFA_KEY = Buffer.alloc(32, 7).toString("base64");
export const GOOD = "correct horse battery";          // 12+ characters, not common

export async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB} encoding 'UTF8' template template0`);
  await admin.end();
  const url = (user, pass) => { const u = new URL(ADMIN_URL); u.pathname = `/${DB}`; u.username = user; u.password = pass; return u.toString(); };

  const owner = new pg.Client({ connectionString: url("postgres", "test") });
  await owner.connect();
  const migrations = path.join(ROOT, "db", "migrations");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) await owner.query(fs.readFileSync(path.join(migrations, f), "utf8"));
  await owner.query(fs.readFileSync(path.join(ROOT, "agent", "supabase", "seed_demo_clinic.sql"), "utf8"));
  await owner.query("alter role accounts_app password 'test'");
  await owner.query("update accounts.apps set redirect_uris = array['https://booking.limitsiz.si/auth/callback'], secret_hash = $1 where key = 'booking'", [sha256("booking-secret")]);
  const clinicA = (await owner.query("select id from clinics where slug = 'demo-derma'")).rows[0].id;
  const clinicB = (await owner.query("insert into clinics (slug, name_en, name_ar) values ('other', 'Other Clinic', 'عيادة أخرى') returning id")).rows[0].id;
  const doctorA = (await owner.query("select id from doctors where clinic_id = $1 limit 1", [clinicA])).rows[0].id;

  const pool = new pg.Pool({ connectionString: url("accounts_app", "test"), max: 6 });
  const clock = { t: Date.parse("2026-11-10T09:00:00Z") };
  const now = () => new Date(clock.t);
  const mails = [];
  const mail = {
    invite: async (m) => mails.push({ kind: "invite", ...m }),
    reset: async (m) => mails.push({ kind: "reset", ...m }),
    twoStepReset: async (m) => mails.push({ kind: "two_step_reset", ...m }),
  };
  const config = { siteUrl: SITE, origin: SITE, mfaKey: MFA_KEY, secureCookies: false, cookieName: "lc_session", trustProxy: "false", exposeLinks: true };
  const core = createCore({ pool, config, mail, now });
  // Limits are huge here (all tests share one address and one frozen clock); the limiter has its own test.
  const BIG = { login: 1e6, forgotIp: 1e6, forgotMail: 1e6, accept: 1e6, token: 1e6 };
  const servers = [];
  async function serve(limits = BIG) {
    const app = createApp({ core, config, now: () => clock.t, limits });
    const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  }
  const base = await serve();

  async function reset() {                                    // clean slate between tests, as the owner
    await owner.query(`delete from accounts.sso_codes; delete from accounts.app_sessions; delete from accounts.sessions;
      delete from accounts.invites; delete from accounts.password_resets; delete from accounts.recovery_codes;
      delete from accounts.memberships; delete from accounts.users;`);
    clock.t = Date.parse("2026-11-10T09:00:00Z");
    mails.length = 0;
  }

  // A browser: keeps the cookie, sends the Origin header like a page of ours would.
  function browser({ origin = SITE, at = base } = {}) {
    let cookie = "";
    const call = async (method, url, body, extra = {}) => {
      const res = await fetch(at + url, {
        method, redirect: "manual",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(";"); const [k, v] = pair.split("=");
        if (/Max-Age=0/i.test(sc)) cookie = ""; else cookie = `${k}=${v}`;
      }
      let json = null; try { json = await res.json(); } catch { /* redirects have no body */ }
      return { status: res.status, json, location: res.headers.get("location") };
    };
    return { call, get: (u) => call("GET", u), post: (u, b = {}) => call("POST", u, b), patch: (u, b) => call("PATCH", u, b), del: (u) => call("DELETE", u),
             get cookie() { return cookie; } };
  }

  // Creates an active user with a membership directly (as the owner), the way the first-admin script would.
  async function makeUser({ email, name = "Test User", role = "secretary", clinic = clinicA, doctor = null, canManage = false, password = GOOD, mfa = false }) {
    const u = (await owner.query("insert into accounts.users (email, password_hash, full_name, status) values ($1,$2,$3,'active') returning id",
      [email, await hashPassword(password), name])).rows[0].id;
    await owner.query("insert into accounts.memberships (user_id, clinic_id, role_key, doctor_id, can_manage_bookings) values ($1,$2,$3,$4,$5)",
      [u, role === "platform_admin" ? null : clinic, role, doctor, canManage]);
    if (mfa) {
      const { newTotpSecret, encrypt } = await import("../server/crypto.js");
      const secret = newTotpSecret();
      await owner.query("update accounts.users set mfa_enabled = true, mfa_secret_enc = $2 where id = $1", [u, encrypt(secret, MFA_KEY)]);
      return { id: u, email, password, secret };
    }
    return { id: u, email, password };
  }
  async function signIn(user, { origin } = {}) {
    const b = browser({ origin });
    const r = await b.post("/api/login", { email: user.email, password: user.password });
    return { b, r };
  }
  const code = (secret) => totp(secret, clock.t);
  const advance = (minutes) => { clock.t += minutes * 60_000; };

  return { owner, pool, core, base, browser, makeUser, signIn, code, advance, clock, mails, reset, clinicA, clinicB, doctorA,
    serve, async close() { servers.forEach((s) => s.close()); await pool.end(); await owner.end(); } };
}
