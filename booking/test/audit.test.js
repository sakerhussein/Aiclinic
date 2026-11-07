import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";
import { csvCell } from "../server/audit.js";

let t, ids, P, adm, sec;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  adm = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  sec = (await t.login(P.secretary)).b;
});

const at = (hhmm, day = "2026-11-11") => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const book = (b, over = {}) => b.post("/api/appointments", { serviceId: ids.services[0].id, doctorId: ids.lina, startsAt: at("10:00"), source: "phone",
  newPatient: { fullName: "Huda Log", phone: "0791234567" }, ...over });
const events = async (q = "") => (await adm.get(`/api/audit${q}`)).json.rows;
const raw = (path, cookie) => fetch(t.base + path, { headers: { cookie } });

test("only people with the permission can open the audit log, export or verify", async () => {
  for (const u of [P.secretary, P.readonly, P.doctor]) {
    const b = (await t.login(u)).b;
    assert.equal((await b.get("/api/audit")).status, 403);
    assert.equal((await b.get("/api/audit/status")).status, 403);
    assert.equal((await b.get("/api/audit/export")).status, 403);
    assert.equal((await b.post("/api/audit/verify")).status, 403);
  }
  assert.equal((await t.bookingJar().get("/api/audit")).status, 401);
  assert.equal((await adm.get("/api/audit")).status, 200);
});

test("the log shows who did what, the change, why, from where, and which patient", async () => {
  const a = (await book(sec)).json;
  await sec.post(`/api/appointments/${a.id}/status`, { status: "cancelled", reason: "patient called", expectedVersion: a.row_version });
  const rows = await events("?type=bookings");
  const c = rows.find((r) => r.action === "cancelled");
  assert.equal(c.actor_label, "Sara Secretary");
  assert.equal(c.actor_type, "user");
  assert.equal(c.reason, "patient called");
  assert.equal(c.subject, "Huda Log");
  assert.equal(c.before.status, "booked");
  assert.equal(c.after.status, "cancelled");
  assert.ok(c.changed_fields.includes("status"));
  assert.equal(c.ip, "127.0.0.1");
  assert.ok(rows[0].seq > rows.at(-1).seq, "newest first");
});

test("filters: type, person, dates, search", async () => {
  await book(sec);
  await adm.patch("/api/settings/rules/staff", { minNoticeMinutes: 0, windowDays: 90, changeNoticeMinutes: 0 });
  const set = await events("?type=settings");
  assert.ok(set.some((r) => r.entity === "booking_rules" && r.actor_label === "Layla Admin"));
  assert.ok(set.every((r) => !["appointment", "patient", "session"].includes(r.entity)));
  assert.ok((await events("?type=patients")).some((r) => r.subject === "Huda Log"));
  assert.ok((await events(`?actor=${P.secretary.id}`)).every((r) => r.actor_label === "Sara Secretary"));
  assert.ok((await events("?q=huda")).length >= 1);
  assert.equal((await events("?q=nothing-matches-this")).length, 0);
  assert.equal((await events("?q=100%25")).length, 0, "a percent sign is searched for, not a wildcard");
  const facets = (await adm.get("/api/audit/facets")).json;
  assert.ok(facets.actors.some((a) => a.label === "Sara Secretary"));
  // Today at the clinic (Amman), as the page filters by: between 00:00 and 03:00 there it is still yesterday in UTC.
  const real = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman" }).format(new Date());
  assert.ok((await events(`?from=${real}&to=${real}`)).length >= 1, "entries are stamped by the database clock");
  assert.equal((await events("?to=2000-01-01")).length, 0);
  assert.equal((await adm.get("/api/audit?from=not-a-date")).status, 400);
  assert.equal((await adm.get("/api/audit?type=nonsense")).status, 400);
});

test("paging walks back through the log with no gaps", async () => {
  for (let i = 0; i < 110; i++) await t.pool.query("select audit.log($1,'patient','x','updated')", [t.clinicA]);
  const p1 = (await adm.get("/api/audit")).json;
  assert.equal(p1.rows.length, 100);
  assert.ok(p1.nextBefore);
  const p2 = (await adm.get(`/api/audit?before=${p1.nextBefore}`)).json;
  assert.equal(Number(p2.rows[0].seq), Number(p1.nextBefore) - 1);
});

test("an administrator sees only their own clinic's log", async () => {
  await book(sec);
  const other = await t.makeUser({ email: "boss@other.jo", name: "Other Boss", role: "clinic_admin", clinic: t.clinicB, mfa: true });
  const b = (await t.login(other, { mfa: other.secret })).b;
  const rows = (await b.get("/api/audit")).json.rows;
  assert.ok(!rows.some((r) => r.actor_label === "Sara Secretary" || r.subject === "Huda Log"));
  assert.ok(!rows.some((r) => JSON.stringify(r).includes("Huda")));
  assert.equal((await b.get(`/api/audit?q=huda`)).json.rows.length, 0);
});

test("security events of the clinic's staff reach its log, with whose access changed", async () => {
  await t.browser().post("/api/login", { email: P.secretary.email, password: "wrong wrong wrong" });
  await t.signIn(P.readonly);
  await adm.post("/api/mfa/verify", {});
  const acc = (await t.signIn(P.admin)).b; await acc.post("/api/mfa/verify", { code: t.code(P.admin.secret) });
  await acc.post("/api/confirm-password", { password: P.admin.password });
  await acc.patch(`/api/users/${P.secretary2.id}`, { roleKey: "readonly" });
  await acc.post(`/api/users/${P.secretary2.id}/status`, { status: "disabled" });
  t.advance(11); await sec.get("/api/me").catch(() => {});
  await acc.post("/api/unlock", { password: P.admin.password });
  const adm2 = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  const rows = (await adm2.get("/api/audit?type=security")).json.rows;
  const by = (a) => rows.find((r) => r.action === a);
  assert.ok(by("login_failed"), "a failed sign-in of our secretary");
  assert.equal(by("login_failed").after.why, "wrong_password");
  assert.ok(by("login"));
  assert.equal(by("role_changed").subject, "Reem Secretary", "whose role changed");
  assert.equal(by("user_disabled").subject, "Reem Secretary");
  assert.ok(rows.some((r) => r.action === "lock" && r.after?.why === "idle"), "the automatic lock");
});

test("names from Accounts are limited to the asking session's clinic", async () => {
  const token = decodeURIComponent(sec.cookie.split("=")[1]);
  const secret = "x".repeat(40);
  const ask = (ids2, s = secret) => fetch(`${t.accountsBase}/people`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: "booking", secret: s, token, ids: ids2 }) });
  const r = await (await ask([P.secretary.id, P.other.id])).json();
  assert.deepEqual(Object.keys(r), [P.secretary.id], "a person of another clinic is not named");
  assert.equal((await ask([P.secretary.id], "wrong")).status, 401);
});

test("verify says intact, and catches tampering with the exact entry", async () => {
  await book(sec);
  const ok = (await adm.post("/api/audit/verify")).json;
  assert.equal(ok.ok, true);
  assert.ok(ok.checked > 0 && ok.head.hash.length === 64);
  const s = (await adm.get("/api/audit/status")).json;
  assert.equal(s.lastCheck.ok, true);
  assert.equal(s.lastCheck.by, "Layla Admin");
  assert.equal(s.retentionMonths, null);
  assert.ok(s.entries >= ok.checked);

  const target = (await t.owner.query("select seq, reason from audit.events where chain_key = $1 order by seq desc limit 1 offset 2", [t.clinicA])).rows[0];
  await t.owner.query("alter table audit.events disable trigger events_no_update_delete");
  try {
    await t.owner.query("update audit.events set reason = 'changed by an attacker' where chain_key = $1 and seq = $2", [t.clinicA, target.seq]);
    const bad = (await adm.post("/api/audit/verify")).json;
    assert.deepEqual([bad.ok, bad.brokenSeq], [false, Number(target.seq)]);
    assert.equal((await adm.get("/api/audit/status")).json.lastCheck.ok, false);
    await t.owner.query("update audit.events set reason = $3 where chain_key = $1 and seq = $2", [t.clinicA, target.seq, target.reason]);
  } finally { await t.owner.query("alter table audit.events enable trigger events_no_update_delete"); }
  assert.equal((await adm.post("/api/audit/verify")).json.ok, true);
});

test("CSV export: all columns, Arabic-safe, formula-safe, filtered, and itself recorded", async () => {
  await t.owner.query("update accounts.users set full_name = '=HYPERLINK(1)' where id = $1", [P.secretary2.id]);
  const evil = (await t.login({ ...P.secretary2 })).b;
  await book(evil, { newPatient: { fullName: "هدى, \"Quote\"", phone: "0791234599" } });
  const r = await raw("/api/audit/export?type=bookings", adm.cookie);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/csv/);
  assert.match(r.headers.get("content-disposition"), /attachment; filename="limitsiz-audit-/);
  const body = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...body.subarray(0, 3)], [0xef, 0xbb, 0xbf], "the byte-order mark Excel needs for Arabic");
  const text = body.toString("utf8");
  assert.ok(text.includes("seq,time_utc,who_type"));
  assert.ok(text.includes("'=HYPERLINK(1)"), "a formula in a name is neutralised");
  assert.ok(!/,=HYPERLINK/.test(text));
  const sEx = (await events("?type=audit")).find((x) => x.action === "exported");
  assert.equal(sEx.actor_label, "Layla Admin");
  assert.equal(sEx.after.filters.type, "bookings");
});

test("viewing is recorded, but paging and filtering do not flood the log", async () => {
  await events(); await events("?type=bookings"); await events("?q=x");
  const mine = (rows) => rows.filter((r) => r.action === "viewed" && r.actor_id === P.admin.id);   // the log keeps earlier tests' entries
  assert.equal(mine(await events("?type=audit")).length, 1);
  t.advance(16);
  const again = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  await again.get("/api/audit");
  assert.equal(mine((await again.get("/api/audit?type=audit")).json.rows).length, 2);
});

test("the audit login cannot change anything, and a csv cell helper handles every case", async () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), "\"a,b\"");
  assert.equal(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(csvCell("+962790000000"), "'+962790000000");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell({ a: 1 }), "\"{\"\"a\"\":1}\"");
});
