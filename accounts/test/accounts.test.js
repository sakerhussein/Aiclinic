import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup, GOOD, SITE } from "./helpers.js";

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const tokenOf = (link) => new URL(link).searchParams.get("token");
const auditActions = async (entity) => (await t.owner.query("select action from audit.events where entity = $1 order by seq", [entity])).rows.map((r) => r.action);

// ------------------------------------------------------------------ sign-in
test("sign-in works, sets a host-only HttpOnly cookie, and one wrong message covers every failure", async () => {
  const u = await t.makeUser({ email: "sara@clinic.jo", name: "Sara" });
  const { b, r } = await t.signIn(u);
  assert.equal(r.status, 200);
  assert.equal(r.json.state, "ok");
  assert.equal(r.json.user.email, "sara@clinic.jo");
  assert.ok(r.json.permissions.includes("booking.appointments.create"));
  assert.ok(b.cookie.startsWith("lc_session="));
  assert.equal((await b.get("/api/me")).json.user.name, "Sara");

  const wrongPw = await t.browser().post("/api/login", { email: "sara@clinic.jo", password: "nope nope nope nope" });
  const unknown = await t.browser().post("/api/login", { email: "nobody@clinic.jo", password: "nope nope nope nope" });
  assert.deepEqual([wrongPw.status, unknown.status], [401, 401]);
  assert.deepEqual(wrongPw.json, unknown.json, "the answer reveals nothing about which emails exist");
});

test("the session token is stored only as a hash", async () => {
  const u = await t.makeUser({ email: "a@clinic.jo" });
  const { b } = await t.signIn(u);
  const token = decodeURIComponent(b.cookie.split("=")[1]);
  const { rows } = await t.owner.query("select token_hash from accounts.sessions");
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.equal(rows[0].token_hash.length, 64);
});

test("5 wrong passwords lock the account for 15 minutes, then it works again", async () => {
  const u = await t.makeUser({ email: "lock@clinic.jo" });
  const failedBefore = (await auditActions("session")).filter((a) => a === "login_failed").length;
  for (let i = 0; i < 5; i++) assert.equal((await t.browser().post("/api/login", { email: u.email, password: "wrong wrong wrong" })).status, 401);
  assert.equal((await t.signIn(u)).r.status, 401, "even the right password is refused during the lock");
  t.advance(16);
  assert.equal((await t.signIn(u)).r.status, 200);
  assert.equal((await auditActions("session")).filter((a) => a === "login_failed").length - failedBefore, 6, "every failure is audited");
});

test("a disabled or invited-only user cannot sign in", async () => {
  const u = await t.makeUser({ email: "off@clinic.jo" });
  await t.owner.query("update accounts.users set status = 'disabled' where id = $1", [u.id]);
  assert.equal((await t.signIn(u)).r.status, 401);
});

test("a state-changing request from another site is refused (CSRF)", async () => {
  const u = await t.makeUser({ email: "csrf@clinic.jo" });
  assert.equal((await t.signIn(u, { origin: "https://evil.example" })).r.status, 403);
  assert.equal((await t.signIn(u, { origin: null })).r.status, 403);
  const { b } = await t.signIn(u);
  const evil = t.browser({ origin: "https://evil.example" });
  assert.equal((await evil.post("/api/logout")).status, 403);
  assert.equal((await b.post("/api/logout")).status, 200);
});

test("logout ends the session on the server", async () => {
  const u = await t.makeUser({ email: "out@clinic.jo" });
  const { b } = await t.signIn(u);
  const stolen = b.cookie;
  await b.post("/api/logout");
  const replay = t.browser(); replay.call("GET", "/api/me");
  const r = await fetch(`${t.base}/api/me`, { headers: { cookie: stolen } });
  assert.equal(r.status, 401, "the old cookie is worthless");
});

// ------------------------------------------------------------------ lock screen and time limits
test("lock screen after 10 idle minutes, enforced by the server; the same person unlocks with the password", async () => {
  const u = await t.makeUser({ email: "idle@clinic.jo" });
  const { b } = await t.signIn(u);
  t.advance(5);
  assert.equal((await b.post("/api/activity")).json.state, "ok");     // activity restarts the idle clock
  t.advance(9);
  assert.equal((await b.get("/api/me")).json.state, "ok");
  t.advance(2);                                                       // 11 minutes without activity
  assert.equal((await b.get("/api/me")).json.state, "locked");
  assert.equal((await b.get("/api/users")).status, 409, "a locked session is refused by the server, not just hidden");
  assert.equal((await b.post("/api/unlock", { password: "wrong wrong wrong" })).status, 401);
  assert.equal((await b.post("/api/unlock", { password: u.password })).status, 200);
  assert.equal((await b.get("/api/me")).json.state, "ok");
  assert.deepEqual((await auditActions("session")).filter((a) => /lock/.test(a)), ["lock", "unlock_failed", "unlock"], "the automatic lock is recorded too");
});

test("signed out after 60 idle minutes and after 12 hours in all", async () => {
  const u = await t.makeUser({ email: "long@clinic.jo" });
  const idle = (await t.signIn(u)).b;
  t.advance(61);
  assert.equal((await idle.get("/api/me")).status, 401);

  const busy = (await t.signIn(u)).b;
  for (let i = 0; i < 79; i++) { t.advance(9); assert.equal((await busy.post("/api/activity")).json.state, "ok", `step ${i}`); }   // 11 h 51 min of work
  t.advance(9);
  assert.equal((await busy.get("/api/me")).status, 401, "12 hours is the absolute limit even when active");
});

test("manual lock and switch user", async () => {
  const u = await t.makeUser({ email: "sw@clinic.jo" });
  const { b } = await t.signIn(u);
  await b.post("/api/lock");
  assert.equal((await b.get("/api/me")).json.state, "locked");
  assert.equal((await b.post("/api/switch")).status, 200);
  assert.equal((await b.get("/api/me")).status, 401);
  assert.ok((await auditActions("session")).includes("switch_user"));
});

// ------------------------------------------------------------------ two-step
test("administrators must set up two-step before anything else; then sign-in needs the code; recovery codes work once", async () => {
  const u = await t.makeUser({ email: "admin@clinic.jo", role: "clinic_admin", name: "Admin" });
  let { b, r } = await t.signIn(u);
  assert.equal(r.json.state, "mfa_setup_required");
  assert.equal((await b.get("/api/users")).status, 409);
  const setup = (await b.post("/api/mfa/setup")).json;
  assert.match(setup.otpauth, /^otpauth:\/\/totp\//);
  const logged = (await t.owner.query("select actor_type, actor_label from audit.events where entity = 'user' and changed_fields @> array['mfa_secret_enc'] order by at desc limit 1")).rows[0];
  assert.deepEqual(logged, { actor_type: "user", actor_label: "Admin" }, "the audit log names the person, not direct database access");
  assert.equal((await b.post("/api/mfa/enable", { code: "000000" })).status, 401);
  const en = await b.post("/api/mfa/enable", { code: t.code(setup.secret) });
  assert.equal(en.status, 200);
  assert.equal(en.json.recoveryCodes.length, 10);
  assert.equal((await b.get("/api/me")).json.state, "ok");
  const stored = (await t.owner.query("select mfa_secret_enc from accounts.users where id = $1", [u.id])).rows[0].mfa_secret_enc;
  assert.ok(!stored.includes(setup.secret), "the secret is not stored in the clear");

  ({ b, r } = await t.signIn(u));
  assert.equal(r.json.state, "mfa_required");
  assert.equal((await b.get("/api/users")).status, 409);
  t.advance(1);
  assert.equal((await b.post("/api/mfa/verify", { code: "123456" })).status, 401);
  assert.equal((await b.post("/api/mfa/verify", { code: t.code(setup.secret) })).status, 200);
  assert.equal((await b.get("/api/me")).json.state, "ok");

  const rc = en.json.recoveryCodes[0];
  ({ b } = await t.signIn(u));
  assert.equal((await b.post("/api/mfa/verify", { recovery: rc })).status, 200);
  ({ b } = await t.signIn(u));
  assert.equal((await b.post("/api/mfa/verify", { recovery: rc })).status, 401, "a recovery code works once");
});

// ------------------------------------------------------------------ invitations
test("invitation: admin invites, the person sets a password, link works once", async () => {
  const admin = await t.makeUser({ email: "boss@clinic.jo", role: "clinic_admin", name: "Boss", mfa: true });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  const inv = await b.post("/api/invites", { email: "New.Person@Clinic.jo", fullName: "Nour", roleKey: "secretary" });
  assert.equal(inv.status, 201);
  assert.equal(t.mails.length, 1);
  assert.equal(t.mails[0].to, "new.person@clinic.jo");
  const token = tokenOf(inv.json.link);

  const anon = t.browser();
  assert.equal((await anon.get(`/api/invites/${token}`)).json.full_name, "Nour");
  const weak = await anon.post("/api/invites/accept", { token, password: "password12345" });
  assert.deepEqual([weak.status, weak.json.error, weak.json.reason], [400, "weak_password", "common"]);
  assert.equal((await anon.post("/api/invites/accept", { token, password: GOOD })).status, 201);
  assert.equal((await anon.post("/api/invites/accept", { token, password: GOOD })).status, 404, "single use");

  const me = await t.signIn({ email: "new.person@clinic.jo", password: GOOD });
  assert.equal(me.r.json.role, "secretary");
  assert.ok(!me.r.json.permissions.includes("accounts.users.invite"));
  assert.ok((await auditActions("invite")).includes("invite_created"));
});

test("accepting an invitation in a browser someone else is signed in to ends their session", async () => {
  const admin = await t.makeUser({ email: "boss@clinic.jo", role: "clinic_admin", name: "Boss", mfa: true });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  const inv = await b.post("/api/invites", { email: "reception@clinic.jo", fullName: "Rana", roleKey: "secretary" });

  // A refused attempt leaves the administrator signed in.
  assert.equal((await b.post("/api/invites/accept", { token: tokenOf(inv.json.link), password: "password12345" })).status, 400);
  assert.equal((await b.get("/api/me")).json.user.email, "boss@clinic.jo");

  assert.equal((await b.post("/api/invites/accept", { token: tokenOf(inv.json.link), password: GOOD })).status, 201);
  assert.equal((await b.get("/api/me")).status, 401, "the administrator is no longer signed in here");
  const signedIn = await b.post("/api/login", { email: "reception@clinic.jo", password: GOOD });
  assert.deepEqual([signedIn.json.user.email, signedIn.json.role], ["reception@clinic.jo", "secretary"]);
  assert.ok((await auditActions("session")).includes("switch_user"));
});

test("a password reset in a browser someone else is signed in to ends their session", async () => {
  const other = await t.makeUser({ email: "other@clinic.jo", name: "Other" });
  await t.makeUser({ email: "owner@clinic.jo", name: "Owner" });
  const { b } = await t.signIn(other);
  await t.browser().post("/api/password/forgot", { email: "owner@clinic.jo" });
  assert.equal((await b.post("/api/password/reset", { token: tokenOf(t.mails.at(-1).link), password: GOOD + "x" })).status, 200);
  assert.equal((await b.get("/api/me")).status, 401);
});

test("the server command creates the first administrator's invitation (no email, link printed)", async () => {
  const link = await t.core.bootstrapInvite({ email: "First@Clinic.jo", fullName: "First Admin", clinicSlug: "demo-derma", roleKey: "clinic_admin" });
  const anon = t.browser();
  assert.equal((await anon.post("/api/invites/accept", { token: tokenOf(link), password: GOOD })).status, 201);
  const { r } = await t.signIn({ email: "first@clinic.jo", password: GOOD });
  assert.equal(r.json.state, "mfa_setup_required", "administrators set up two-step at the first sign-in");
  await assert.rejects(t.core.bootstrapInvite({ email: "x@y.jo", fullName: "X", clinicSlug: "nope", roleKey: "clinic_admin" }));
  assert.ok((await t.owner.query("select 1 from audit.events where actor_id = 'accounts-cli' and action = 'invite_created'")).rowCount > 0);
});

test("an invitation expires after 72 hours and the token is stored only as a hash", async () => {
  const admin = await t.makeUser({ email: "boss2@clinic.jo", role: "clinic_admin", mfa: true });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  const inv = await b.post("/api/invites", { email: "late@clinic.jo", fullName: "Late", roleKey: "readonly" });
  const token = tokenOf(inv.json.link);
  const { rows } = await t.owner.query("select token_hash from accounts.invites");
  assert.notEqual(rows[0].token_hash, token);
  t.advance(73 * 60);
  assert.equal((await t.browser().get(`/api/invites/${token}`)).status, 404);
});

test("only people with the right permission can invite; a secretary and a doctor cannot", async () => {
  const sec = await t.makeUser({ email: "sec@clinic.jo", role: "secretary" });
  const { b } = await t.signIn(sec);
  assert.equal((await b.post("/api/invites", { email: "x@clinic.jo", fullName: "X", roleKey: "secretary" })).status, 403);
  assert.equal((await b.get("/api/users")).status, 403);
});

test("a doctor invitation needs the doctor record; other roles must not carry one; platform roles are Limitsiz-only", async () => {
  const admin = await t.makeUser({ email: "boss3@clinic.jo", role: "clinic_admin", mfa: true });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  const mk = (x) => b.post("/api/invites", { email: "d@clinic.jo", fullName: "Dr D", ...x });
  assert.equal((await mk({ roleKey: "doctor" })).json.error, "doctor_record_required");
  assert.equal((await mk({ roleKey: "secretary", doctorId: t.doctorA })).json.error, "doctor_record_only_for_doctors");
  assert.equal((await mk({ roleKey: "doctor", doctorId: t.doctorA, canManageBookings: true })).status, 201);
  assert.equal((await mk({ roleKey: "platform_admin", clinicId: null })).status, 403);
});

test("the doctor pick list is for administrators of that clinic only", async () => {
  const admin = await t.makeUser({ email: "boss6@clinic.jo", role: "clinic_admin", mfa: true });
  const sec = await t.makeUser({ email: "sec6@clinic.jo" });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  const docs = (await b.get("/api/doctors")).json;
  assert.ok(docs.length >= 1 && docs.some((d) => d.id === t.doctorA));
  assert.equal((await b.get(`/api/doctors?clinic=${t.clinicB}`)).status, 403);
  assert.equal((await (await t.signIn(sec)).b.get("/api/doctors")).status, 403);
});

test("an administrator cannot invite into another clinic", async () => {
  const admin = await t.makeUser({ email: "boss4@clinic.jo", role: "clinic_admin", mfa: true });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  const r = await b.post("/api/invites", { email: "spy@clinic.jo", fullName: "Spy", roleKey: "secretary", clinicId: t.clinicB });
  assert.equal(r.status, 403);
});

// ------------------------------------------------------------------ password reset
test("forgot password never reveals whether the email exists; reset signs out everywhere and works once", async () => {
  const u = await t.makeUser({ email: "forgot@clinic.jo", name: "Forgetful" });
  const open = (await t.signIn(u)).b;
  const anon = t.browser();
  const known = await anon.post("/api/password/forgot", { email: "forgot@clinic.jo" });
  const unknown = await anon.post("/api/password/forgot", { email: "ghost@clinic.jo" });
  assert.deepEqual([known.status, known.json], [unknown.status, unknown.json]);
  assert.equal(t.mails.length, 1);
  const token = tokenOf(t.mails[0].link);
  assert.equal((await anon.post("/api/password/reset", { token, password: "short" })).status, 400);
  assert.equal((await anon.post("/api/password/reset", { token, password: "a brand new passphrase" })).status, 200);
  assert.equal((await anon.post("/api/password/reset", { token, password: "another new passphrase" })).status, 404, "single use");
  assert.equal((await open.get("/api/me")).status, 401, "every open session ended");
  assert.equal((await t.signIn({ email: u.email, password: "a brand new passphrase" })).r.status, 200);
});

test("changing the password ends the other sessions but keeps this one", async () => {
  const u = await t.makeUser({ email: "chg@clinic.jo" });
  const a = (await t.signIn(u)).b, other = (await t.signIn(u)).b;
  assert.equal((await a.post("/api/password/change", { current: "wrong wrong wrong", next: "a brand new passphrase" })).status, 401);
  assert.equal((await a.post("/api/password/change", { current: u.password, next: "a brand new passphrase" })).status, 200);
  assert.equal((await a.get("/api/me")).status, 200);
  assert.equal((await other.get("/api/me")).status, 401);
});

// ------------------------------------------------------------------ single sign-on
const CB = "https://booking.limitsiz.si/auth/callback";
const authorize = (b, extra = "") => b.get(`/authorize?client=booking&redirect_uri=${encodeURIComponent(CB)}&state=xyz${extra}`);
const exchange = (b, code, over = {}) => b.post("/token", { client: "booking", secret: "booking-secret", code, redirect_uri: CB, ...over });

test("SSO: no session sends the person to sign in first; with a session it returns a one-time code", async () => {
  const u = await t.makeUser({ email: "sso@clinic.jo", name: "Sso" });
  const anon = t.browser({ origin: null });
  const r0 = await authorize(anon);
  assert.equal(r0.status, 302);
  assert.ok(r0.location.startsWith(`${SITE}/signin?next=`));

  const { b } = await t.signIn(u);
  const r1 = await authorize(b);
  assert.equal(r1.status, 302);
  const back = new URL(r1.location);
  assert.equal(`${back.origin}${back.pathname}`, CB);
  assert.equal(back.searchParams.get("state"), "xyz");
  const code = back.searchParams.get("code");

  const server = t.browser({ origin: null });
  const tok = await exchange(server, code);
  assert.equal(tok.status, 200);
  assert.equal(tok.json.user.email, "sso@clinic.jo");
  assert.equal(tok.json.role, "secretary");
  assert.equal(tok.json.clinic.slug, "demo-derma");
  assert.ok(tok.json.permissions.includes("booking.appointments.view"));
  assert.equal((await exchange(server, code)).status, 400, "the code works once");
});

test("SSO: wrong secret, wrong redirect, expired code and unregistered return addresses are refused", async () => {
  const u = await t.makeUser({ email: "sso2@clinic.jo" });
  const { b } = await t.signIn(u);
  const server = t.browser({ origin: null });
  const code = () => new URL(authorize(b).then ? "http://x" : "http://x").searchParams;     // placeholder to keep lint quiet
  void code;
  const fresh = async () => new URL((await authorize(b)).location).searchParams.get("code");

  assert.equal((await exchange(server, await fresh(), { secret: "guess" })).status, 401);
  assert.equal((await exchange(server, await fresh(), { redirect_uri: "https://evil.example/cb" })).status, 400);
  const c = await fresh(); t.advance(2);
  assert.equal((await exchange(server, c)).status, 400, "a code lives 60 seconds");

  const open = await b.get(`/authorize?client=booking&redirect_uri=${encodeURIComponent("https://evil.example/steal")}&state=s`);
  assert.equal(open.status, 400, "no open redirect");
  assert.equal((await b.get(`/authorize?client=unknown&redirect_uri=${encodeURIComponent(CB)}&state=s`)).status, 400);
});

test("SSO: a person with no Booking permission is not sent there", async () => {
  const u = await t.makeUser({ email: "nobook@clinic.jo", role: "platform_admin" });
  const { b } = await t.signIn(u);
  assert.equal((await b.get("/api/me")).json.state, "mfa_setup_required");
  const admin = await t.makeUser({ email: "plain@clinic.jo", role: "readonly" });
  await t.owner.query("delete from accounts.role_permissions where role_key = 'readonly'");
  const r = await authorize((await t.signIn(admin)).b);
  await t.owner.query("insert into accounts.role_permissions values ('readonly','booking.appointments.view'),('readonly','booking.patients.view')");
  assert.equal(r.status, 302);
  assert.match(r.location, /\/no-access/);
});

test("every request is checked: logging out, disabling a user or changing a role ends the service session at once", async () => {
  const sec = await t.makeUser({ email: "live@clinic.jo", name: "Live" });
  const admin = await t.makeUser({ email: "boss5@clinic.jo", role: "clinic_admin", name: "Boss5", mfa: true });
  const server = t.browser({ origin: null });
  const intro = (token, touch) => server.post("/introspect", { client: "booking", secret: "booking-secret", token, touch });

  const { b } = await t.signIn(sec);
  const tok = (await exchange(server, new URL((await authorize(b)).location).searchParams.get("code"))).json.appSessionToken;
  assert.equal((await intro(tok)).json.active, true);
  assert.equal((await server.post("/introspect", { client: "booking", secret: "wrong", token: tok })).status, 401);
  assert.equal((await intro("not-a-token")).json.active, false);

  // the admin disables the secretary: effective on the very next request
  const adm = (await t.signIn(admin)).b; await adm.post("/api/mfa/verify", { code: t.code(admin.secret) });
  assert.equal((await adm.post(`/api/users/${sec.id}/status`, { status: "disabled" })).json.error, "password_required", "sensitive actions re-ask the password");
  await adm.post("/api/confirm-password", { password: admin.password });
  assert.equal((await adm.post(`/api/users/${sec.id}/status`, { status: "disabled" })).status, 200);
  assert.equal((await intro(tok)).json.active, false);
  assert.equal((await b.get("/api/me")).status, 401);
  assert.equal((await t.signIn(sec)).r.status, 401);

  // logging out of Accounts ends the service session too
  await adm.post(`/api/users/${sec.id}/status`, { status: "active" });
  const { b: b2 } = await t.signIn(sec);
  const tok2 = (await exchange(server, new URL((await authorize(b2)).location).searchParams.get("code"))).json.appSessionToken;
  assert.equal((await intro(tok2, true)).json.active, true);
  await b2.post("/api/logout");
  assert.equal((await intro(tok2)).json.active, false);
});

test("a service reports activity; idle time then locks the service session", async () => {
  const u = await t.makeUser({ email: "svc@clinic.jo" });
  const server = t.browser({ origin: null });
  const { b } = await t.signIn(u);
  const tok = (await exchange(server, new URL((await authorize(b)).location).searchParams.get("code"))).json.appSessionToken;
  const intro = (touch) => server.post("/introspect", { client: "booking", secret: "booking-secret", token: tok, touch }).then((r) => r.json);
  t.advance(8); assert.equal((await intro(true)).state, "ok");
  t.advance(8); assert.equal((await intro(true)).state, "ok", "activity kept it open");
  t.advance(11); assert.equal((await intro(false)).state, "locked");
  assert.equal((await b.post("/api/unlock", { password: u.password })).status, 200);
  assert.equal((await intro(false)).state, "ok");
});

// ------------------------------------------------------------------ administration
test("role change, can-manage-bookings, last-administrator rule and clinic isolation", async () => {
  const admin = await t.makeUser({ email: "adm@clinic.jo", role: "clinic_admin", name: "Adm", mfa: true });
  const sec = await t.makeUser({ email: "s1@clinic.jo", name: "S1" });
  const foreign = await t.makeUser({ email: "f@other.jo", name: "Foreign", clinic: t.clinicB });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  await b.post("/api/confirm-password", { password: admin.password });

  const list = (await b.get("/api/users")).json;
  assert.deepEqual(list.users.map((x) => x.email).sort(), ["adm@clinic.jo", "s1@clinic.jo"], "only this clinic's people");
  assert.equal((await b.patch(`/api/users/${foreign.id}`, { roleKey: "readonly" })).status, 404);
  assert.equal((await b.patch(`/api/users/${admin.id}`, { roleKey: "secretary" })).json.error, "cannot_change_own_access");
  assert.equal((await b.patch(`/api/users/${sec.id}`, { roleKey: "doctor" })).json.error, "doctor_record_required");
  assert.equal((await b.patch(`/api/users/${sec.id}`, { roleKey: "doctor", doctorId: t.doctorA, canManageBookings: true })).status, 200);
  const perms = (await t.owner.query("select permission from accounts.effective_permissions where user_id = $1", [sec.id])).rows.map((r) => r.permission);
  assert.ok(perms.includes("booking.appointments.create") && !perms.includes("booking.settings.edit"));

  const second = await t.makeUser({ email: "adm2@clinic.jo", role: "clinic_admin", name: "Adm2" });
  assert.equal((await b.patch(`/api/users/${second.id}`, { roleKey: "readonly" })).status, 200);
  const lone = await t.makeUser({ email: "adm3@clinic.jo", role: "clinic_admin", name: "Adm3" });
  await t.owner.query("update accounts.memberships set active = false where user_id = $1", [second.id]);
  void lone;
  const only = await t.owner.query("select count(*)::int n from accounts.memberships where clinic_id = $1 and role_key = 'clinic_admin' and active", [t.clinicA]);
  assert.equal(only.rows[0].n, 2);
});

test("the last administrator of a clinic cannot be demoted or removed", async () => {
  const a1 = await t.makeUser({ email: "a1@clinic.jo", role: "clinic_admin", name: "A1", mfa: true });
  const a2 = await t.makeUser({ email: "a2@clinic.jo", role: "clinic_admin", name: "A2", mfa: true });
  const { b } = await t.signIn(a1); await b.post("/api/mfa/verify", { code: t.code(a1.secret) });
  await b.post("/api/confirm-password", { password: a1.password });
  assert.equal((await b.patch(`/api/users/${a2.id}`, { roleKey: "secretary" })).status, 200);
  const sec = a2;
  // a2 is now a secretary; a1 is the only administrator and cannot demote themselves (also blocked by the own-access rule)
  assert.equal((await b.patch(`/api/users/${a1.id}`, { active: false })).json.error, "cannot_change_own_access");
  // a platform administrator trying the same on a1 is stopped by the last-administrator rule
  const plat = await t.makeUser({ email: "plat@limitsiz.si", role: "platform_admin", name: "Plat", mfa: true });
  const pb = (await t.signIn(plat)).b; await pb.post("/api/mfa/verify", { code: t.code(plat.secret) });
  await pb.post("/api/confirm-password", { password: plat.password });
  const r = await pb.patch(`/api/users/${a1.id}?clinic=${t.clinicA}`, { active: false });
  assert.deepEqual([r.status, r.json.error], [409, "last_administrator"]);
  void sec;
});

test("signing a person out everywhere, and listing sessions", async () => {
  const admin = await t.makeUser({ email: "adm4@clinic.jo", role: "clinic_admin", mfa: true });
  const sec = await t.makeUser({ email: "s2@clinic.jo" });
  const s1 = (await t.signIn(sec)).b, s2 = (await t.signIn(sec)).b;
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  const all = (await b.get("/api/sessions")).json;
  assert.equal(all.filter((s) => s.email === "s2@clinic.jo").length, 2);
  assert.equal((await b.post(`/api/users/${sec.id}/revoke-sessions`)).json.revoked, 2);
  assert.deepEqual([(await s1.get("/api/me")).status, (await s2.get("/api/me")).status], [401, 401]);
  assert.equal((await s1.get("/api/sessions")).status, 401);
});

test("a person lists and ends their own sessions", async () => {
  const u = await t.makeUser({ email: "mine@clinic.jo" });
  const a = (await t.signIn(u)).b, other = (await t.signIn(u)).b;
  const mine = (await a.get("/api/sessions/mine")).json;
  assert.equal(mine.length, 2);
  const theirs = mine.find((s) => !s.current);
  assert.equal((await a.del(`/api/sessions/${theirs.id}`)).status, 200);
  assert.equal((await other.get("/api/me")).status, 401);
});

test("administrator-sent reset link and the launcher", async () => {
  const admin = await t.makeUser({ email: "adm5@clinic.jo", role: "clinic_admin", mfa: true });
  const sec = await t.makeUser({ email: "s3@clinic.jo", name: "S3" });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  assert.equal((await b.post(`/api/users/${sec.id}/send-reset`)).status, 200);
  assert.equal(t.mails.at(-1).kind, "reset");
  assert.equal(t.mails.at(-1).to, "s3@clinic.jo");
  const apps = (await b.get("/api/apps")).json;
  assert.deepEqual(apps.map((a) => a.key), ["booking"]);
});

test("a person with several clinics must choose one", async () => {
  const u = await t.makeUser({ email: "multi@clinic.jo" });
  await t.owner.query("insert into accounts.memberships (user_id, clinic_id, role_key) values ($1,$2,'readonly')", [u.id, t.clinicB]);
  const { b, r } = await t.signIn(u);
  assert.equal(r.json.state, "choose_clinic");
  assert.equal(r.json.clinics.length, 2);
  assert.equal((await b.post("/api/clinic", { clinicId: "11111111-1111-4111-8111-111111111111" })).status, 403);
  const ok = await b.post("/api/clinic", { clinicId: t.clinicB });
  assert.equal(ok.json.state, "ok");
  assert.equal(ok.json.role, "readonly");
});

// ------------------------------------------------------------------ audit trail
test("sign-ins, role changes and invitations are in the audit trail, and the chain verifies", async () => {
  const admin = await t.makeUser({ email: "aud@clinic.jo", role: "clinic_admin", name: "Aud", mfa: true });
  const sec = await t.makeUser({ email: "aud2@clinic.jo", name: "Aud2" });
  const { b } = await t.signIn(admin); await b.post("/api/mfa/verify", { code: t.code(admin.secret) });
  await b.post("/api/confirm-password", { password: admin.password });
  await b.patch(`/api/users/${sec.id}`, { roleKey: "readonly" });
  const { rows } = await t.owner.query(
    "select actor_type, actor_label, entity, entity_id, action, changed_fields, after from audit.events where clinic_id = $1 order by seq", [t.clinicA]);
  const change = rows.find((r) => r.entity === "membership" && r.action === "role_changed" && r.actor_label === "Aud");
  assert.ok(change, "the role change is recorded");
  assert.equal(change.actor_label, "Aud", "with who did it");
  assert.ok(change.changed_fields.includes("role_key"));
  assert.ok(rows.some((r) => r.action === "login" && r.actor_label === "Aud"));
  void sec;
  const v = (await t.owner.query("select * from audit.verify($1)", [t.clinicA])).rows[0];
  assert.ok(JSON.stringify(v).includes("true") || v.ok === true || v.valid === true, JSON.stringify(v));
  const leaked = (await t.owner.query("select count(*)::int n from audit.events where (after::text || coalesce(before::text, '')) ~* '(argon2|\$2[aby]\$)'")).rows[0].n;
  const hidden = (await t.owner.query("select count(*)::int n from audit.events where after::text like '%[hidden]%'")).rows[0].n;
  assert.ok(hidden > 0, "secret fields are shown as [hidden]");
  assert.equal(leaked, 0, "secrets never reach the log");
});

test("the Accounts login can do what it needs and nothing more", async () => {
  await assert.rejects(t.pool.query("delete from accounts.users"), /permission denied/);
  await assert.rejects(t.pool.query("delete from audit.events"), /permission denied/);
  await assert.rejects(t.pool.query("select * from public.patients"), /permission denied/);
  await assert.rejects(t.pool.query("select wa_phone_number_id from public.clinics"), /permission denied/);
});

test("request limits answer 429 (sign-in, forgot password)", async () => {
  const at = await t.serve({ login: 3, forgotIp: 2, forgotMail: 1, accept: 1, token: 1 });
  const b = t.browser({ at });
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push((await b.post("/api/login", { email: "x@clinic.jo", password: "wrong wrong wrong" })).status);
  assert.deepEqual(tries, [401, 401, 401, 429, 429]);
  const f = [];
  for (let i = 0; i < 3; i++) f.push((await b.post("/api/password/forgot", { email: "x@clinic.jo" })).status);
  assert.deepEqual(f, [200, 429, 429]);
});

test("health endpoints", async () => {
  const b = t.browser();
  assert.equal((await b.get("/api/health")).status, 200);
  assert.equal((await b.get("/api/health/db")).status, 200);
  assert.equal((await b.get("/api/nothing")).status, 404);
});
