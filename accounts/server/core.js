// The Accounts logic: sign-in, sessions, lock screen, two-step, invitations, resets, single sign-on, user administration.
// No HTTP in here; routes (app.js) call these functions. Time always comes from deps.now() so tests control the clock.
import { randomToken, sha256, safeEqual, newTotpSecret, verifyTotp, encrypt, decrypt, newRecoveryCode } from "./crypto.js";
import { hashPassword, verifyPassword, passwordProblem, DUMMY_HASH } from "./passwords.js";
import { HttpError, bad, denied, unauthorized, notFound } from "./http.js";

const MIN = 60_000;
export const LIMITS = {
  sessionMs: 12 * 60 * MIN,          // absolute
  inviteMs: 72 * 60 * MIN,
  resetMs: 60 * MIN,
  codeMs: 60_000,
  maxFailures: 5,
  lockoutMs: 15 * MIN,
  recentPasswordMs: 10 * MIN,
};
const MFA_ROLES = new Set(["clinic_admin", "platform_admin"]);
export const normEmail = (e) => String(e || "").trim().toLowerCase();

export function createCore({ pool, config, mail, now = () => new Date(), security }) {
  // Lock and idle times come from the clinic's Settings (phase B); until then the defaults of the design.
  const getSecurity = security || (async () => ({ lockMinutes: 10, idleMinutes: 60, requireMfaAll: false }));

  // ---------------------------------------------------------------- helpers
  // One transaction whose changes are audited with the given actor (audit.set_actor is transaction-local).
  async function tx(actor, fn) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select audit.set_actor($1,$2,$3,$4,$5,$6,$7,$8)",
        [actor.type || "system", actor.id || "accounts", actor.label || "Accounts", actor.ip || null, actor.ua || null,
         actor.requestId || null, actor.reason || null, actor.clinic || null]);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }
  const userActor = (u, ctx, clinic) => ({ type: "user", id: u.id, label: u.name || u.full_name, ip: ctx?.ip, ua: ctx?.ua, requestId: ctx?.requestId, clinic: clinic ?? null });
  const sysActor = (label, ctx) => ({ type: "system", id: "accounts", label, ip: ctx?.ip, ua: ctx?.ua, requestId: ctx?.requestId });

  // A named event in the audit trail (sign-ins, locks, ...). `actor` is {type,id,label}.
  async function audit(clinic, entity, entityId, action, { after, reason, actor, ctx } = {}) {
    await pool.query("select audit.log($1,$2,$3,$4,null,$5::jsonb,null,$6,$7,$8,$9,$10,$11,$12)",
      [clinic ?? null, entity, String(entityId ?? ""), action, after ? JSON.stringify(after) : null, reason ?? null,
       actor?.type ?? "system", actor?.id ?? "accounts", actor?.label ?? "Accounts", ctx?.ip ?? null, ctx?.ua ?? null, ctx?.requestId ?? null]);
  }
  const who = (u) => ({ type: "user", id: u.id, label: u.name || u.full_name });

  async function memberships(userId) {
    const { rows } = await pool.query(
      `select m.id, m.clinic_id, m.role_key, m.doctor_id, m.can_manage_bookings, r.scope,
              c.slug as clinic_slug, c.name_en as clinic_name_en, c.name_ar as clinic_name_ar
         from accounts.memberships m
         join accounts.roles r on r.key = m.role_key
         left join public.clinics c on c.id = m.clinic_id
        where m.user_id = $1 and m.active and (m.clinic_id is null or c.active)
        order by c.name_en nulls first`, [userId]);
    return rows;
  }
  async function permissionsOf(userId, clinicId) {
    const { rows } = await pool.query(
      "select permission from accounts.effective_permissions where user_id = $1 and clinic_id is not distinct from $2", [userId, clinicId ?? null]);
    return rows.map((r) => r.permission).sort();
  }

  // ---------------------------------------------------------------- sessions
  async function createSession(user, clinicId, ctx) {
    const token = randomToken();
    const t = now();
    const { rows } = await pool.query(
      `insert into accounts.sessions (user_id, token_hash, clinic_id, created_at, last_activity_at, expires_at, ip, user_agent)
       values ($1,$2,$3,$4,$4,$5,$6,$7) returning id`,
      [user.id, sha256(token), clinicId ?? null, t, new Date(t.getTime() + LIMITS.sessionMs), ctx?.ip ?? null, (ctx?.ua || "").slice(0, 300)]);
    return { token, id: rows[0].id };
  }

  async function revoke(sessionId, reason) {
    await pool.query("update accounts.sessions set revoked_at = $2, revoked_reason = $3 where id = $1 and revoked_at is null", [sessionId, now(), reason]);
  }

  // Looks a session up and works out its state:
  //   ok | locked | mfa_required | mfa_setup_required | choose_clinic     (null when there is no usable session)
  // An idle session past the sign-out time is ended here; one past the lock time is locked here.
  async function loadByHash(tokenHash, { touch = false } = {}) {
    const { rows } = await pool.query(
      `select s.id, s.user_id, s.clinic_id, s.created_at, s.last_activity_at, s.expires_at, s.locked_at, s.mfa_at, s.revoked_at,
              u.email, u.full_name, u.language, u.status, u.mfa_enabled
         from accounts.sessions s join accounts.users u on u.id = s.user_id where s.token_hash = $1`, [tokenHash]);
    const s = rows[0];
    const t = now();
    if (!s || s.revoked_at || s.status !== "active" || s.expires_at <= t) return null;
    const sec = await getSecurity(s.clinic_id);
    const idleMs = t - s.last_activity_at;
    if (sec.idleMinutes && idleMs > sec.idleMinutes * MIN) { await revoke(s.id, "idle"); return null; }
    let lockedAt = s.locked_at;
    if (!lockedAt && sec.lockMinutes && idleMs > sec.lockMinutes * MIN) {
      lockedAt = t;
      await pool.query("update accounts.sessions set locked_at = $2 where id = $1", [s.id, t]);
    }
    const ms = await memberships(s.user_id);
    const needsMfa = ms.some((m) => MFA_ROLES.has(m.role_key)) || sec.requireMfaAll;
    let state = "ok";
    if (lockedAt) state = "locked";
    else if (s.mfa_enabled && !s.mfa_at) state = "mfa_required";
    else if (needsMfa && !s.mfa_enabled) state = "mfa_setup_required";
    else if (!ms.length) state = "no_access";
    else if (!s.clinic_id && ms.length > 1 && !ms.some((m) => m.scope === "platform")) state = "choose_clinic";
    if (touch && state === "ok") await pool.query("update accounts.sessions set last_activity_at = $2 where id = $1", [s.id, t]);
    return { ...s, locked_at: lockedAt, state, memberships: ms, security: sec,
             user: { id: s.user_id, email: s.email, name: s.full_name, language: s.language, mfaEnabled: s.mfa_enabled } };
  }
  const loadSession = (token, opts) => (token ? loadByHash(sha256(token), opts) : null);

  // ---------------------------------------------------------------- sign-in
  async function login(email, password, ctx) {
    email = normEmail(email);
    const { rows } = await pool.query("select * from accounts.users where email = $1", [email]);
    const u = rows[0];
    const fail = async (why) => {
      await audit(null, "session", u?.id ?? "unknown", "login_failed", {
        after: { why, ...(u ? {} : { email_tried: email.slice(0, 80) }) }, ctx, actor: u ? who(u) : { type: "system", id: "accounts", label: "Unknown email" } });
      throw new HttpError(401, "invalid_credentials");
    };
    if (!u || u.status !== "active" || !u.password_hash) { await verifyPassword(DUMMY_HASH, password); return fail(u ? `status_${u.status}` : "unknown_user"); }
    if (u.locked_until && u.locked_until > now()) { await verifyPassword(DUMMY_HASH, password); return fail("account_locked"); }
    if (!(await verifyPassword(u.password_hash, password))) {
      const failed = u.failed_logins + 1;
      const lock = failed >= LIMITS.maxFailures;
      await tx(sysActor("Sign-in", ctx), (c) => c.query(
        "update accounts.users set failed_logins = $2, locked_until = $3 where id = $1",
        [u.id, lock ? 0 : failed, lock ? new Date(now().getTime() + LIMITS.lockoutMs) : null]));
      return fail(lock ? "locked_after_failures" : "wrong_password");
    }
    const ms = await memberships(u.id);
    if (!ms.length) return fail("no_access");
    await tx(sysActor("Sign-in", ctx), (c) => c.query(
      "update accounts.users set failed_logins = 0, locked_until = null, last_login_at = $2 where id = $1", [u.id, now()]));
    const clinicId = ms.length === 1 ? ms[0].clinic_id : null;     // several clinics: the person picks one
    const { token, id } = await createSession(u, clinicId, ctx);
    await audit(clinicId, "session", id, "login", { actor: who(u), ctx });
    return { token, session: await loadSession(token) };
  }

  async function logout(session, ctx, reason = "sign_out") {
    await revoke(session.id, reason);
    await audit(session.clinic_id, "session", session.id, reason === "switch_user" ? "switch_user" : "logout", { actor: who(session.user), ctx });
  }

  async function chooseClinic(session, clinicId) {
    if (!session.memberships.some((m) => m.clinic_id === clinicId)) throw denied("no_membership");
    await pool.query("update accounts.sessions set clinic_id = $2 where id = $1", [session.id, clinicId]);
  }

  // ---------------------------------------------------------------- lock screen
  async function lock(session, ctx) {
    await pool.query("update accounts.sessions set locked_at = $2 where id = $1 and locked_at is null", [session.id, now()]);
    await audit(session.clinic_id, "session", session.id, "lock", { actor: who(session.user), ctx });
  }
  // Same person only; a different person must "switch user" (sign in again).
  async function unlock(session, password, ctx) {
    const { rows } = await pool.query("select password_hash from accounts.users where id = $1", [session.user_id]);
    if (!(await verifyPassword(rows[0].password_hash, password))) {
      await audit(session.clinic_id, "session", session.id, "unlock_failed", { actor: who(session.user), ctx });
      throw new HttpError(401, "invalid_credentials");
    }
    await pool.query("update accounts.sessions set locked_at = null, last_activity_at = $2 where id = $1", [session.id, now()]);
    await audit(session.clinic_id, "session", session.id, "unlock", { actor: who(session.user), ctx });
    recentPassword.set(session.id, now().getTime());
  }

  // Sensitive actions re-ask the password when it was last checked over 10 minutes ago.
  const recentPassword = new Map();
  async function confirmPassword(session, password) {
    const { rows } = await pool.query("select password_hash from accounts.users where id = $1", [session.user_id]);
    if (!(await verifyPassword(rows[0].password_hash, password))) throw new HttpError(401, "invalid_credentials");
    recentPassword.set(session.id, now().getTime());
  }
  function requireRecentPassword(session) {
    const at = recentPassword.get(session.id);
    if (!at || now().getTime() - at > LIMITS.recentPasswordMs) throw new HttpError(403, "password_required");
  }

  // ---------------------------------------------------------------- two-step (TOTP)
  async function mfaSetup(session) {
    if (session.user.mfaEnabled) throw bad("already_enabled");
    const secret = newTotpSecret();
    await pool.query("update accounts.users set mfa_secret_enc = $2 where id = $1", [session.user_id, encrypt(secret, config.mfaKey)]);
    const issuer = "Limitsiz Clinic";
    return { secret, otpauth: `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(session.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30` };
  }
  async function userSecret(userId) {
    const { rows } = await pool.query("select mfa_secret_enc from accounts.users where id = $1", [userId]);
    return rows[0]?.mfa_secret_enc ? decrypt(rows[0].mfa_secret_enc, config.mfaKey) : null;
  }
  async function mfaEnable(session, code, ctx) {
    const secret = await userSecret(session.user_id);
    if (!secret || session.user.mfaEnabled) throw bad("not_in_setup");
    if (verifyTotp(secret, code, now().getTime()) === null) throw new HttpError(401, "invalid_code");
    const codes = Array.from({ length: 10 }, newRecoveryCode);
    await tx(userActor(session.user, ctx, session.clinic_id), async (c) => {
      await c.query("update accounts.users set mfa_enabled = true where id = $1", [session.user_id]);
      await c.query("delete from accounts.recovery_codes where user_id = $1", [session.user_id]);
      for (const rc of codes) await c.query("insert into accounts.recovery_codes (user_id, code_hash) values ($1,$2)", [session.user_id, sha256(rc)]);
      await c.query("update accounts.sessions set mfa_at = $2 where id = $1", [session.id, now()]);
    });
    return { recoveryCodes: codes };
  }
  // Second step of a sign-in: an app code or one recovery code.
  async function mfaVerify(session, { code, recovery }, ctx) {
    let ok = false;
    const how = recovery ? "recovery" : "app";
    if (recovery) {
      const r = await pool.query("update accounts.recovery_codes set used_at = $3 where user_id = $1 and code_hash = $2 and used_at is null returning id",
        [session.user_id, sha256(String(recovery).trim().toLowerCase()), now()]);
      ok = r.rowCount === 1;
    } else {
      const secret = await userSecret(session.user_id);
      ok = !!secret && verifyTotp(secret, code, now().getTime()) !== null;
    }
    if (!ok) {
      await audit(session.clinic_id, "session", session.id, "mfa_failed", { actor: who(session.user), ctx });
      throw new HttpError(401, "invalid_code");
    }
    await pool.query("update accounts.sessions set mfa_at = $2 where id = $1", [session.id, now()]);
    await audit(session.clinic_id, "session", session.id, "mfa_ok", { after: { how }, actor: who(session.user), ctx });
  }

  // ---------------------------------------------------------------- permissions
  const permissionsFor = (session) => permissionsOf(session.user_id, session.clinic_id);
  // Does the signed-in user hold `perm` for `clinicId`? Platform administrators hold accounts.* rights over every clinic.
  async function can(session, perm, clinicId) {
    if (session.state !== "ok") return false;
    if ((await permissionsOf(session.user_id, clinicId)).includes(perm)) return true;
    return perm.startsWith("accounts.users.") && (await permissionsOf(session.user_id, null)).includes(perm);
  }
  async function need(session, perm, clinicId) {
    if (!(await can(session, perm, clinicId))) throw denied("forbidden");
  }

  // ---------------------------------------------------------------- invitations
  async function createInvite(session, { email, fullName, clinicId, roleKey, doctorId, canManageBookings }, ctx) {
    email = normEmail(email);
    const { rows: rr } = await pool.query("select scope from accounts.roles where key = $1", [roleKey]);
    if (!rr[0]) throw bad("unknown_role");
    if (rr[0].scope === "platform") {
      if (clinicId) throw bad("platform_role_has_no_clinic");
      if (!(await permissionsOf(session.user_id, null)).includes("platform.clinics.manage")) throw denied();
    } else {
      if (!clinicId) throw bad("clinic_required");
      await need(session, "accounts.users.invite", clinicId);
    }
    if (roleKey === "doctor" && !doctorId) throw bad("doctor_record_required");
    if (roleKey !== "doctor" && doctorId) throw bad("doctor_record_only_for_doctors");
    const { rows: ex } = await pool.query(
      `select 1 from accounts.users u join accounts.memberships m on m.user_id = u.id
        where u.email = $1 and m.active and m.clinic_id is not distinct from $2`, [email, clinicId ?? null]);
    if (ex.length) throw new HttpError(409, "already_member");
    const token = randomToken();
    const id = await tx(userActor(session.user, ctx, clinicId), async (c) => {
      // A new invitation replaces any open one for the same person and clinic.
      await c.query("update accounts.invites set expires_at = $3 where email = $1 and clinic_id is not distinct from $2 and accepted_at is null and expires_at > $3",
        [email, clinicId ?? null, now()]);
      const r = await c.query(
        `insert into accounts.invites (email, full_name, clinic_id, role_key, doctor_id, can_manage_bookings, token_hash, expires_at, invited_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [email, fullName.trim(), clinicId ?? null, roleKey, doctorId ?? null, !!canManageBookings && roleKey === "doctor",
         sha256(token), new Date(now().getTime() + LIMITS.inviteMs), session.user_id]);
      return r.rows[0].id;
    });
    await audit(clinicId, "invite", id, "invite_created", { after: { email, roleKey, doctorId: doctorId ?? null, canManageBookings: !!canManageBookings }, actor: who(session.user), ctx });
    const link = `${config.siteUrl}/accept?token=${token}`;
    await mail.invite({ to: email, name: fullName, link, inviter: session.user.name });
    return { id, expiresInHours: 72, ...(config.exposeLinks ? { link } : {}) };
  }

  // For the Limitsiz owner on the server (no signed-in person yet): the first administrator of a clinic, or a Limitsiz administrator.
  // Returns the link; nothing is emailed. Run with: node server/cli.js invite ...
  async function bootstrapInvite({ email, fullName, clinicSlug, roleKey }) {
    email = normEmail(email);
    let clinicId = null;
    if (roleKey !== "platform_admin") {
      const { rows } = await pool.query("select id from public.clinics where slug = $1", [clinicSlug]);
      if (!rows[0]) throw bad("unknown_clinic");
      clinicId = rows[0].id;
    }
    const { rows: rr } = await pool.query("select scope from accounts.roles where key = $1", [roleKey]);
    if (!rr[0]) throw bad("unknown_role");
    if (roleKey === "doctor") throw bad("use_the_clinic_administrator_to_invite_doctors");
    const token = randomToken();
    await tx({ type: "system", id: "accounts-cli", label: "Limitsiz owner (server command)", clinic: clinicId }, (c) => c.query(
      `insert into accounts.invites (email, full_name, clinic_id, role_key, token_hash, expires_at) values ($1,$2,$3,$4,$5,$6)`,
      [email, fullName.trim(), clinicId, roleKey, sha256(token), new Date(now().getTime() + LIMITS.inviteMs)]));
    await audit(clinicId, "invite", email, "invite_created", { after: { email, roleKey, by: "server command" }, actor: { type: "system", id: "accounts-cli", label: "Limitsiz owner (server command)" } });
    return `${config.siteUrl}/accept?token=${token}`;
  }

  async function inviteInfo(token) {
    const { rows } = await pool.query(
      `select i.email, i.full_name, i.role_key, c.name_en as clinic_name_en, c.name_ar as clinic_name_ar,
              exists(select 1 from accounts.users u where u.email = i.email) as has_account
         from accounts.invites i left join public.clinics c on c.id = i.clinic_id
        where i.token_hash = $1 and i.accepted_at is null and i.expires_at > $2`, [sha256(token || ""), now()]);
    if (!rows[0]) throw notFound("invite_invalid");
    return rows[0];
  }

  async function acceptInvite(token, { password, fullName }, ctx) {
    const { rows } = await pool.query(
      "select * from accounts.invites where token_hash = $1 and accepted_at is null and expires_at > $2", [sha256(token || ""), now()]);
    const inv = rows[0];
    if (!inv) throw notFound("invite_invalid");
    const { rows: ur } = await pool.query("select * from accounts.users where email = $1", [inv.email]);
    let userId = ur[0]?.id;
    if (ur[0]) {                                   // an existing person joining another clinic proves who they are
      if (ur[0].status !== "active" || !(await verifyPassword(ur[0].password_hash, password))) throw new HttpError(401, "invalid_credentials");
    } else {
      const problem = passwordProblem(password, { email: inv.email, name: fullName || inv.full_name });
      if (problem) throw bad("weak_password", { reason: problem });
    }
    const hash = ur[0] ? null : await hashPassword(password);
    const actor = { type: "system", id: "accounts", label: `Invitation accepted by ${inv.email}`, ip: ctx?.ip, ua: ctx?.ua, requestId: ctx?.requestId, clinic: inv.clinic_id };
    await tx(actor, async (c) => {
      const used = await c.query("update accounts.invites set accepted_at = $2 where id = $1 and accepted_at is null returning id", [inv.id, now()]);
      if (!used.rowCount) throw notFound("invite_invalid");
      if (!userId) {
        const r = await c.query(
          "insert into accounts.users (email, password_hash, full_name, status, created_by) values ($1,$2,$3,'active',$4) returning id",
          [inv.email, hash, (fullName || inv.full_name).trim(), inv.invited_by]);
        userId = r.rows[0].id;
      }
      await c.query(
        `insert into accounts.memberships (user_id, clinic_id, role_key, doctor_id, can_manage_bookings, granted_by)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (user_id, coalesce(clinic_id, '00000000-0000-0000-0000-000000000000'::uuid))
         do update set role_key = excluded.role_key, doctor_id = excluded.doctor_id, can_manage_bookings = excluded.can_manage_bookings, active = true`,
        [userId, inv.clinic_id, inv.role_key, inv.doctor_id, inv.can_manage_bookings, inv.invited_by]);
    });
    return { userId };
  }

  // ---------------------------------------------------------------- password reset
  async function forgotPassword(email, ctx) {
    email = normEmail(email);
    const { rows } = await pool.query("select id, full_name, language from accounts.users where email = $1 and status = 'active'", [email]);
    if (rows[0]) await sendReset(rows[0], email, ctx, null);      // the caller answers the same either way
  }
  async function sendReset(u, email, ctx, by) {
    const token = randomToken();
    await pool.query("insert into accounts.password_resets (user_id, token_hash, expires_at) values ($1,$2,$3)",
      [u.id, sha256(token), new Date(now().getTime() + LIMITS.resetMs)]);
    await audit(null, "user", u.id, "reset_link_sent", { actor: by ? who(by.user) : { type: "system", id: "accounts", label: "Password reset" }, ctx });
    const link = `${config.siteUrl}/reset?token=${token}`;
    await mail.reset({ to: email, name: u.full_name, link, language: u.language });
    return config.exposeLinks ? link : undefined;
  }
  async function resetPassword(token, password, ctx) {
    const { rows } = await pool.query(
      `select r.id, r.user_id, u.email, u.full_name from accounts.password_resets r join accounts.users u on u.id = r.user_id
        where r.token_hash = $1 and r.used_at is null and r.expires_at > $2 and u.status = 'active'`, [sha256(token || ""), now()]);
    const r = rows[0];
    if (!r) throw notFound("reset_invalid");
    const problem = passwordProblem(password, { email: r.email, name: r.full_name });
    if (problem) throw bad("weak_password", { reason: problem });
    const hash = await hashPassword(password);
    await tx({ type: "system", id: "accounts", label: "Password reset", ip: ctx?.ip, ua: ctx?.ua }, async (c) => {
      const used = await c.query("update accounts.password_resets set used_at = $2 where id = $1 and used_at is null returning id", [r.id, now()]);
      if (!used.rowCount) throw notFound("reset_invalid");
      await c.query("update accounts.users set password_hash = $2, failed_logins = 0, locked_until = null where id = $1", [r.user_id, hash]);
      await c.query("update accounts.sessions set revoked_at = $2, revoked_reason = 'password_reset' where user_id = $1 and revoked_at is null", [r.user_id, now()]);
    });
    await audit(null, "user", r.user_id, "password_reset", { actor: { type: "user", id: r.user_id, label: r.full_name }, ctx });
  }
  async function changePassword(session, current, next, ctx) {
    const { rows } = await pool.query("select password_hash, email, full_name from accounts.users where id = $1", [session.user_id]);
    if (!(await verifyPassword(rows[0].password_hash, current))) throw new HttpError(401, "invalid_credentials");
    const problem = passwordProblem(next, { email: rows[0].email, name: rows[0].full_name });
    if (problem) throw bad("weak_password", { reason: problem });
    const hash = await hashPassword(next);
    await tx(userActor(session.user, ctx, session.clinic_id), async (c) => {
      await c.query("update accounts.users set password_hash = $2 where id = $1", [session.user_id, hash]);
      await c.query("update accounts.sessions set revoked_at = $3, revoked_reason = 'password_changed' where user_id = $1 and id <> $2 and revoked_at is null",
        [session.user_id, session.id, now()]);
    });
    await audit(session.clinic_id, "user", session.user_id, "password_changed", { actor: who(session.user), ctx });
  }

  // ---------------------------------------------------------------- single sign-on
  async function appByKey(key) {
    const { rows } = await pool.query("select * from accounts.apps where key = $1", [key]);
    return rows[0] || null;
  }
  // The redirect back must be exactly one of the service's registered addresses.
  async function startAuthorize(session, clientKey, redirectUri) {
    const app = await appByKey(clientKey);
    if (!app || !app.redirect_uris.includes(redirectUri)) throw bad("bad_client");
    if (session.state !== "ok") throw new HttpError(409, session.state);
    const perms = await permissionsFor(session);
    if (!perms.some((p) => p.startsWith(`${clientKey}.`))) throw denied("no_access_to_service");
    const code = randomToken();
    await pool.query("insert into accounts.sso_codes (code_hash, session_id, app_key, redirect_uri, expires_at) values ($1,$2,$3,$4,$5)",
      [sha256(code), session.id, clientKey, redirectUri, new Date(now().getTime() + LIMITS.codeMs)]);
    return code;
  }
  async function clientAuth(clientKey, secret) {
    const app = await appByKey(clientKey);
    if (!app?.secret_hash || !secret || !safeEqual(app.secret_hash, sha256(secret))) throw unauthorized("bad_client");
    return app;
  }
  async function describe(s) {
    const m = s.memberships.find((x) => x.clinic_id === s.clinic_id) || null;
    return {
      user: s.user, state: s.state, sessionExpiresAt: s.expires_at,
      clinic: m?.clinic_id ? { id: m.clinic_id, slug: m.clinic_slug, nameEn: m.clinic_name_en, nameAr: m.clinic_name_ar } : null,
      role: m?.role_key ?? null, doctorId: m?.doctor_id ?? null,
      permissions: await permissionsOf(s.user_id, s.clinic_id),
      security: s.security,
    };
  }
  // Server to server: the service trades the one-time code for the person, their clinic, role and permissions.
  async function exchangeCode({ client, secret, code, redirectUri }) {
    await clientAuth(client, secret);
    const { rows } = await pool.query(
      `update accounts.sso_codes set used_at = $2 where code_hash = $1 and used_at is null and expires_at > $2 and app_key = $3 and redirect_uri = $4
       returning session_id`, [sha256(code || ""), now(), client, redirectUri]);
    if (!rows[0]) throw new HttpError(400, "invalid_code");
    const { rows: sr } = await pool.query("select token_hash from accounts.sessions where id = $1", [rows[0].session_id]);
    const live = sr[0] && (await loadByHash(sr[0].token_hash));
    if (!live || live.state !== "ok") throw new HttpError(400, "invalid_code");
    const token = randomToken();
    await pool.query("insert into accounts.app_sessions (session_id, app_key, token_hash) values ($1,$2,$3)", [live.id, client, sha256(token)]);
    return { appSessionToken: token, ...(await describe(live)) };
  }
  // A service asks about one of its own sessions on every request; `touch` records that the person was active.
  async function introspect({ client, secret, token, touch }) {
    await clientAuth(client, secret);
    const { rows } = await pool.query(
      `select a.id, s.token_hash from accounts.app_sessions a join accounts.sessions s on s.id = a.session_id
        where a.token_hash = $1 and a.app_key = $2 and a.revoked_at is null`, [sha256(token || ""), client]);
    if (!rows[0]) return { active: false };
    const live = await loadByHash(rows[0].token_hash, { touch: !!touch });
    if (!live) return { active: false };
    await pool.query("update accounts.app_sessions set last_seen_at = $2 where id = $1", [rows[0].id, now()]);
    return { active: true, ...(await describe(live)) };
  }
  async function appLogout({ client, secret, token }) {
    await clientAuth(client, secret);
    await pool.query("update accounts.app_sessions set revoked_at = $3 where token_hash = $1 and app_key = $2", [sha256(token || ""), client, now()]);
  }

  // ---------------------------------------------------------------- users (administration)
  async function listUsers(session, clinicId) {
    await need(session, "accounts.users.view", clinicId);
    const { rows } = await pool.query(
      `select u.id, u.email, u.full_name, u.status, u.mfa_enabled, u.last_login_at, m.role_key, m.doctor_id,
              m.can_manage_bookings, m.active,
              (select count(*)::int from accounts.sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > $2) as open_sessions
         from accounts.memberships m join accounts.users u on u.id = m.user_id
        where m.clinic_id is not distinct from $1 order by u.full_name`, [clinicId ?? null, now()]);
    const { rows: inv } = await pool.query(
      "select id, email, full_name, role_key, expires_at from accounts.invites where clinic_id is not distinct from $1 and accepted_at is null and expires_at > $2 order by created_at desc",
      [clinicId ?? null, now()]);
    return { users: rows, invites: inv };
  }
  // Doctor records of the clinic, for the "which doctor is this login" pick list.
  async function listDoctors(session, clinicId) {
    await need(session, "accounts.users.invite", clinicId);
    const { rows } = await pool.query("select id, name_en, name_ar from public.doctors where clinic_id = $1 and active order by name_en", [clinicId]);
    return rows;
  }
  async function membershipOf(userId, clinicId) {
    const { rows } = await pool.query("select * from accounts.memberships where user_id = $1 and clinic_id is not distinct from $2", [userId, clinicId ?? null]);
    if (!rows[0]) throw notFound("user_not_found");
    return rows[0];
  }
  // Change the role, the doctor record, "can also manage bookings", or switch the membership off.
  // The last administrator of a clinic cannot be removed, and nobody changes their own access.
  async function updateMembership(session, userId, clinicId, patch, ctx) {
    await need(session, "accounts.users.edit_role", clinicId);
    requireRecentPassword(session);
    const m = await membershipOf(userId, clinicId);
    const next = { role_key: patch.roleKey ?? m.role_key, doctor_id: patch.doctorId === undefined ? m.doctor_id : patch.doctorId,
                   can_manage_bookings: patch.canManageBookings ?? m.can_manage_bookings, active: patch.active ?? m.active };
    const { rows: rr } = await pool.query("select scope from accounts.roles where key = $1", [next.role_key]);
    if (!rr[0] || (rr[0].scope === "platform") !== (clinicId == null)) throw bad("unknown_role");
    if (next.role_key === "doctor" && !next.doctor_id) throw bad("doctor_record_required");
    if (next.role_key !== "doctor") { next.doctor_id = null; next.can_manage_bookings = false; }
    if (userId === session.user_id && (!next.active || next.role_key !== m.role_key)) throw new HttpError(409, "cannot_change_own_access");
    if (clinicId && m.role_key === "clinic_admin" && m.active && (next.role_key !== "clinic_admin" || !next.active)) {
      const { rows } = await pool.query("select count(*)::int n from accounts.memberships where clinic_id = $1 and role_key = 'clinic_admin' and active and id <> $2", [clinicId, m.id]);
      if (rows[0].n === 0) throw new HttpError(409, "last_administrator");
    }
    await tx(userActor(session.user, ctx, clinicId), async (c) => {
      await c.query("update accounts.memberships set role_key=$2, doctor_id=$3, can_manage_bookings=$4, active=$5 where id = $1",
        [m.id, next.role_key, next.doctor_id, next.can_manage_bookings, next.active]);
      if (!next.active || next.role_key !== m.role_key)    // access changed: end their sessions at once
        await c.query("update accounts.sessions set revoked_at = $2, revoked_reason = 'access_changed' where user_id = $1 and revoked_at is null", [userId, now()]);
    });
  }
  async function setUserStatus(session, userId, clinicId, status, ctx) {
    await need(session, "accounts.users.disable", clinicId);
    requireRecentPassword(session);
    if (userId === session.user_id) throw new HttpError(409, "cannot_change_own_access");
    await membershipOf(userId, clinicId);
    if (!["active", "disabled"].includes(status)) throw bad("invalid_status");
    await tx(userActor(session.user, ctx, clinicId), async (c) => {
      const r = await c.query("update accounts.users set status = $2 where id = $1 and status in ('active','disabled') returning id", [userId, status]);
      if (!r.rowCount) throw bad("not_active_yet");
      if (status === "disabled") await c.query("update accounts.sessions set revoked_at = $2, revoked_reason = 'disabled' where user_id = $1 and revoked_at is null", [userId, now()]);
    });
  }
  async function revokeUserSessions(session, userId, clinicId, ctx) {
    await need(session, "accounts.users.revoke_sessions", clinicId);
    await membershipOf(userId, clinicId);
    const r = await pool.query("update accounts.sessions set revoked_at = $2, revoked_reason = 'revoked_by_admin' where user_id = $1 and revoked_at is null", [userId, now()]);
    await audit(clinicId, "user", userId, "sessions_revoked", { after: { count: r.rowCount }, actor: who(session.user), ctx });
    return r.rowCount;
  }
  async function adminSendReset(session, userId, clinicId, ctx) {
    await need(session, "accounts.users.edit_role", clinicId);
    await membershipOf(userId, clinicId);
    const { rows } = await pool.query("select id, email, full_name, language from accounts.users where id = $1 and status = 'active'", [userId]);
    if (!rows[0]) throw bad("not_active_yet");
    return sendReset(rows[0], rows[0].email, ctx, session);
  }
  async function mySessions(session) {
    const { rows } = await pool.query(
      `select id, created_at, last_activity_at, ip, user_agent, id = $2 as current from accounts.sessions
        where user_id = $1 and revoked_at is null and expires_at > $3 order by last_activity_at desc`, [session.user_id, session.id, now()]);
    return rows;
  }
  async function allSessions(session, clinicId) {
    await need(session, "accounts.users.view", clinicId);
    const { rows } = await pool.query(
      `select s.id, s.user_id, u.full_name, u.email, s.created_at, s.last_activity_at, s.locked_at, s.ip, s.user_agent
         from accounts.sessions s join accounts.users u on u.id = s.user_id
         join accounts.memberships m on m.user_id = u.id and m.clinic_id is not distinct from $1
        where s.revoked_at is null and s.expires_at > $2 order by s.last_activity_at desc`, [clinicId ?? null, now()]);
    return rows;
  }
  async function revokeMine(session, sessionId) {
    const r = await pool.query("update accounts.sessions set revoked_at = $3, revoked_reason = 'revoked_by_user' where id = $1 and user_id = $2 and revoked_at is null", [sessionId, session.user_id, now()]);
    if (!r.rowCount) throw notFound();
  }
  async function updateProfile(session, { fullName, language }, ctx) {
    await tx(userActor(session.user, ctx, session.clinic_id), (c) => c.query(
      "update accounts.users set full_name = coalesce($2, full_name), language = coalesce($3, language) where id = $1", [session.user_id, fullName ?? null, language ?? null]));
  }

  return {
    pool, tx, audit, login, logout, chooseClinic, loadSession, lock, unlock, confirmPassword, requireRecentPassword,
    mfaSetup, mfaEnable, mfaVerify, permissionsFor, can, need, createInvite, bootstrapInvite, inviteInfo, acceptInvite,
    forgotPassword, resetPassword, changePassword, startAuthorize, exchangeCode, introspect, appLogout, describe,
    listUsers, listDoctors, updateMembership, setUserStatus, revokeUserSessions, adminSendReset, mySessions, allSessions, revokeMine, updateProfile,
  };
}
