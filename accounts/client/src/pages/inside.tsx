import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, del, get, patch, post } from "../api";
import { useI18n } from "../i18n";
import { useSession } from "../session";
import { AppBar, Banner, CardPage, Field, useAction } from "../ui";

export function Launcher() {
  const { t, dict } = useI18n();
  const { me } = useSession();
  const [apps, setApps] = useState<{ key: string; name_en: string; name_ar: string; url: string }[] | null>(null);
  useEffect(() => { get("/api/apps").then(setApps).catch(() => setApps([])); }, []);
  return (
    <>
      <AppBar />
      <main className="wrap page">
        <h1 className="display">{t("hello", { name: me?.user.name || "" })}</h1>
        <RecoveryReminder />
        {apps && apps.length === 0 && <Banner kind="warn">{t("noApps")}</Banner>}
        <div className="apps">
          {apps?.map((a) => (
            <a key={a.key} className="app" href={a.url}>
              <b>{dict.apps[a.key] || a.name_en}</b>
              <span className="hint">{dict.appDesc[a.key]}</span>
              <span className="pill ok" style={{ alignSelf: "flex-start" }}>{t("openApp")}</span>
            </a>
          ))}
        </div>
      </main>
    </>
  );
}

// Shown while the recovery codes left are at or below the clinic's setting (design screen 2), until new ones are made.
function RecoveryReminder() {
  const { t } = useI18n();
  const { me } = useSession();
  const r = me?.recovery;
  if (!r || r.left > r.warnAt) return null;
  return (
    <div className={`banner ${r.left === 0 ? "bad" : "warn"} row`} role="status" style={{ justifyContent: "space-between" }}>
      <span><b>{r.left === 0 ? t("noneLeft") : t("lowLeft", { n: r.left })}</b> {t("lowHint")}</span>
      <Link className="btn btn-ink btn-sm" to="/two-step/codes">{t("makeCodes")}</Link>
    </div>
  );
}

export function NoAccess() {
  const { t } = useI18n();
  return <CardPage title={t("noAccessTitle")} sub={t("noAccessSub")}><Link className="btn btn-outline btn-block" to="/">{t("appsTitle")}</Link></CardPage>;
}

type Sess = { id: string; created_at: string; last_activity_at: string; ip: string | null; user_agent: string | null; current: boolean };

export function Account() {
  const { t, lang, setLang } = useI18n();
  const { me, refresh } = useSession();
  const [name, setName] = useState(me?.user.name || "");
  const [pick, setPick] = useState<"ar" | "en">(lang);   // chosen in the box; applied only when Save is pressed
  const [cur, setCur] = useState(""); const [next, setNext] = useState("");
  const [okProfile, setOkProfile] = useState(""); const [okPw, setOkPw] = useState("");   // each message shows in its own section
  const [sessions, setSessions] = useState<Sess[]>([]);
  const prof = useAction(); const pw = useAction();
  const load = useCallback(() => { get("/api/sessions/mine").then(setSessions).catch(() => {}); }, []);
  useEffect(load, [load]);
  const when = (s: string) => new Date(s).toLocaleString(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB");
  const device = (ua: string | null) => (ua || "").replace(/\(.*?\)/g, "").slice(0, 60) || "-";
  return (
    <>
      <AppBar />
      <main className="wrap page">
        <h1 className="display">{t("accountTitle")}</h1>
        <section className="panel">
          <p className="mono">{me?.user.email}</p>
          <form className="row" style={{ alignItems: "flex-end" }} onSubmit={prof.submit(async () => {
            await patch("/api/me", { fullName: name, language: pick }); setLang(pick); await refresh(); setOkPw(""); setOkProfile(t("saved"));
          })}>
            <div style={{ flex: "1 1 220px" }}><Field label={t("name")} value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <label className="field" style={{ flex: "0 0 160px" }}>{t("language")}
              <select value={pick} onChange={(e) => setPick(e.target.value as "ar" | "en")}><option value="ar">العربية</option><option value="en">English</option></select>
            </label>
            <button className="btn btn-ink" disabled={prof.busy}>{t("save")}</button>
          </form>
          {prof.err && <Banner>{prof.err}</Banner>}
          {okProfile && <Banner kind="ok">{okProfile}</Banner>}
        </section>
        <section className="panel">
          <h2>{t("twoStep")}</h2>
          <div className="row">
            <span className={`pill ${me?.user.mfaEnabled ? "ok" : "warn"}`}>{me?.user.mfaEnabled ? t("on") : t("off")}</span>
            {me?.recovery && <span className={`pill ${me.recovery.left === 0 ? "bad" : me.recovery.left <= me.recovery.warnAt ? "warn" : ""}`}>{t("codesLeft", { n: me.recovery.left })}</span>}
            {!me?.user.mfaEnabled && <Link className="btn btn-outline btn-sm" to="/mfa/setup">{t("setUp")}</Link>}
          </div>
          {me?.user.mfaEnabled && <>
            <div className="row">
              <Link className="btn btn-outline btn-sm" to="/two-step/codes">{t("makeNewCodes")}</Link>
              <Link className="btn btn-outline btn-sm" to="/two-step/move">{t("moveToPhone")}</Link>
            </div>
            <p className="hint">{t("twoStepHint")}</p>
          </>}
        </section>
        <section className="panel">
          <h2>{t("changePassword")}</h2>
          <form className="row" style={{ alignItems: "flex-end" }} onSubmit={pw.submit(async () => {
            await post("/api/password/change", { current: cur, next }); setCur(""); setNext(""); setOkProfile(""); setOkPw(t("changed")); load();
          })}>
            <div style={{ flex: "1 1 200px" }}><Field label={t("currentPassword")} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>
            <div style={{ flex: "1 1 200px" }}><Field label={t("newPassword")} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} /></div>
            <button className="btn btn-ink" disabled={pw.busy}>{t("savePassword")}</button>
          </form>
          <p className="hint">{t("passwordHint")}</p>
          {pw.err && <Banner>{pw.err}</Banner>}
          {okPw && <Banner kind="ok">{okPw}</Banner>}
        </section>
        <section className="panel">
          <h2>{t("mySessions")}</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>{t("device")}</th><th>{t("lastActive")}</th><th /></tr></thead>
            <tbody>{sessions.map((s) => (
              <tr key={s.id}>
                <td>{device(s.user_agent)} <span className="mono hint">{s.ip}</span></td>
                <td>{when(s.last_activity_at)}</td>
                <td>{s.current ? <span className="pill ok">{t("thisSession")}</span> : <button className="btn btn-outline btn-sm" onClick={async () => { await del(`/api/sessions/${s.id}`); load(); }}>{t("endSession")}</button>}</td>
              </tr>))}</tbody>
          </table></div>
        </section>
      </main>
    </>
  );
}

type U = { id: string; email: string; full_name: string; status: string; mfa_enabled: boolean; codes_left: number | null; last_login_at: string | null; role_key: string; doctor_id: string | null; can_manage_bookings: boolean; active: boolean; open_sessions: number };
type Inv = { id: string; email: string; full_name: string; role_key: string; expires_at: string };
type Doc = { id: string; name_en: string; name_ar: string };

export function Users() {
  const { t, lang, dict } = useI18n();
  const { me } = useSession();
  const [data, setData] = useState<{ users: U[]; invites: Inv[] } | null>(null);
  const [doctors, setDoctors] = useState<Doc[]>([]);
  const [note, setNote] = useState("");
  const [ask, setAsk] = useState<null | (() => Promise<void>)>(null);          // retried after the password is confirmed
  const [resetting, setResetting] = useState<U | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", roleKey: "secretary", doctorId: "", canManageBookings: false });
  const act = useAction();
  const canInvite = !!me?.permissions.includes("accounts.users.invite");
  const canEdit = !!me?.permissions.includes("accounts.users.edit_role");
  const canDisable = !!me?.permissions.includes("accounts.users.disable");
  const canRevoke = !!me?.permissions.includes("accounts.users.revoke_sessions");
  const canResetTwoStep = !!me?.permissions.includes("accounts.users.reset_two_step");
  const warnAt = me?.security.recoveryWarnAt ?? 0;

  const load = useCallback(() => {
    get("/api/users").then(setData).catch(() => {});
    if (me?.permissions.includes("accounts.users.invite")) get("/api/doctors").then(setDoctors).catch(() => {});
  }, [me]);
  useEffect(load, [load]);

  // Sensitive changes re-ask the password when the last check was over 10 minutes ago, then repeat the change.
  async function sensitive<T>(fn: () => Promise<T>, done?: (r: T) => string) {
    try { const r = await fn(); setNote(done ? done(r) : ""); load(); }
    catch (e) {
      if (e instanceof ApiError && e.code === "password_required") setAsk(() => () => sensitive(fn, done));
      else await act.run(async () => { throw e; });
    }
  }
  const when = (s: string | null) => (s ? new Date(s).toLocaleString(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB") : t("never"));
  const docName = (d: Doc) => (lang === "ar" ? d.name_ar : d.name_en);
  const roleOptions = ["clinic_admin", "secretary", "doctor", "readonly"];

  return (
    <>
      <AppBar />
      <main className="wrap page">
        <h1 className="display">{t("usersTitle")}</h1>
        {act.err && <Banner>{act.err}</Banner>}
        {note && <Banner kind="ok">{note}</Banner>}
        <section className="panel">
          <div className="tablewrap"><table>
            <thead><tr><th>{t("name")}</th><th>{t("role")}</th><th>{t("twoStepCol")}</th><th>{t("lastSignIn")}</th><th>{t("sessionsCol")}</th><th /></tr></thead>
            <tbody>
              {data?.users.map((u) => {
                const self = u.id === me?.user.id;
                return (
                  <tr key={u.id}>
                    <td><b>{u.full_name}</b><br /><span className="mono hint">{u.email}</span></td>
                    <td>
                      {canEdit && !self ? (
                        <select value={u.role_key} onChange={(e) => void sensitive(() => patch(`/api/users/${u.id}`, { roleKey: e.target.value, ...(e.target.value === "doctor" ? { doctorId: u.doctor_id || doctors[0]?.id } : {}) }))}>
                          {roleOptions.map((r) => <option key={r} value={r}>{dict.roles[r]}</option>)}
                        </select>
                      ) : dict.roles[u.role_key]}
                      {u.role_key === "doctor" && canEdit && !self && (
                        <label className="hint" style={{ display: "block" }}><input type="checkbox" checked={u.can_manage_bookings} onChange={(e) => void sensitive(() => patch(`/api/users/${u.id}`, { canManageBookings: e.target.checked }))} /> {t("canManage")}</label>
                      )}
                    </td>
                    <td><div className="row" style={{ gap: 4 }}>
                      <span className={`pill ${u.mfa_enabled ? "ok" : "warn"}`}>{u.mfa_enabled ? t("on") : t("off")}</span>
                      {u.codes_left !== null && u.codes_left <= warnAt && <span className={`pill ${u.codes_left === 0 ? "bad" : "warn"}`}>{t("leftPill", { n: u.codes_left })}</span>}
                    </div></td>
                    <td>{when(u.last_login_at)}</td>
                    <td>{u.open_sessions}</td>
                    <td><div className="actions">
                      <span className={`pill ${u.status === "active" ? "ok" : "bad"}`}>{u.status === "active" ? t("active") : t("disabled")}</span>
                      {!self && canDisable && <button className="btn btn-outline btn-sm" onClick={() => void sensitive(() => post(`/api/users/${u.id}/status`, { status: u.status === "active" ? "disabled" : "active" }))}>{u.status === "active" ? t("disable") : t("enable")}</button>}
                      {!self && canRevoke && u.open_sessions > 0 && <button className="btn btn-outline btn-sm" onClick={() => void act.run(async () => { const r = await post(`/api/users/${u.id}/revoke-sessions`); setNote(t("signedOutN", { n: r.revoked })); load(); })}>{t("signOutEverywhere")}</button>}
                      {!self && canEdit && <button className="btn btn-outline btn-sm" onClick={() => void act.run(async () => { const r = await post(`/api/users/${u.id}/send-reset`); setNote(t("resetSent") + (r.link ? ` ${r.link}` : "")); })}>{t("sendReset")}</button>}
                      {!self && canResetTwoStep && u.mfa_enabled && <button className="btn btn-outline btn-sm btn-warnline" onClick={() => setResetting(u)}>{t("resetTwoStep")}</button>}
                    </div></td>
                  </tr>
                );
              })}
              {data?.invites.map((i) => (
                <tr key={i.id}><td><b>{i.full_name}</b><br /><span className="mono hint">{i.email}</span></td><td>{dict.roles[i.role_key]}</td><td /><td /><td /><td><span className="pill warn">{t("pending")}</span></td></tr>
              ))}
            </tbody>
          </table></div>
        </section>

        {canInvite && (
          <section className="panel">
            <h2>{t("invite")}</h2>
            <form className="row" style={{ alignItems: "flex-end" }} onSubmit={act.submit(async () => {
              const r = await post("/api/invites", { email: form.email, fullName: form.fullName, roleKey: form.roleKey,
                doctorId: form.roleKey === "doctor" ? form.doctorId || undefined : undefined, canManageBookings: form.roleKey === "doctor" && form.canManageBookings });
              setNote(t("inviteSent") + (r.link ? ` ${t("inviteLink")} ${r.link}` : "")); setForm({ ...form, fullName: "", email: "" }); load();
            })}>
              <div style={{ flex: "1 1 180px" }}><Field label={t("fullName")} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
              <div style={{ flex: "1 1 220px" }}><Field label={t("email")} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <label className="field" style={{ flex: "0 0 200px" }}>{t("role")}
                <select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>{roleOptions.map((r) => <option key={r} value={r}>{dict.roles[r]}</option>)}</select>
              </label>
              {form.roleKey === "doctor" && (
                <label className="field" style={{ flex: "0 0 200px" }}>{t("doctorRecord")}
                  <select value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })} required><option value="" />{doctors.map((d) => <option key={d.id} value={d.id}>{docName(d)}</option>)}</select>
                </label>
              )}
              {form.roleKey === "doctor" && <label className="hint"><input type="checkbox" checked={form.canManageBookings} onChange={(e) => setForm({ ...form, canManageBookings: e.target.checked })} /> {t("canManage")}</label>}
              <button className="btn btn-accent" disabled={act.busy}>{t("sendInvite")}</button>
            </form>
          </section>
        )}
      </main>
      {resetting && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="card">
            <h1 className="display">{t("resetAsk", { name: resetting.full_name })}</h1>
            <p className="sub">{t("resetBody")}</p>
            <p className="hint" style={{ textAlign: "center" }}>{t("resetCheck")}</p>
            <button className="btn btn-danger btn-block" onClick={() => { const u = resetting; setResetting(null);
              void sensitive(() => post<{ sessionsEnded: number }>(`/api/users/${u.id}/reset-two-step`), (r) => t("resetDoneN", { name: u.full_name, n: r.sessionsEnded })); }}>{t("resetTwoStep")}</button>
            <button className="btn btn-outline btn-block" onClick={() => setResetting(null)}>{t("cancel")}</button>
          </div>
        </div>
      )}
      {ask && <ConfirmPassword onDone={async () => { const retry = ask; setAsk(null); await retry(); }} onCancel={() => setAsk(null)} />}
    </>
  );
}

function ConfirmPassword({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const [pw, setPw] = useState("");
  const a = useAction();
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <form className="card" onSubmit={a.submit(async () => { await post("/api/confirm-password", { password: pw }); await onDone(); })}>
        <h1 className="display">{t("confirmTitle")}</h1>
        <p className="sub">{t("confirmSub")}</p>
        <Field label={t("password")} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
        {a.err && <Banner>{a.err}</Banner>}
        <button className="btn btn-accent btn-block" disabled={a.busy}>{t("confirm")}</button>
        <button className="btn btn-outline btn-block" type="button" onClick={onCancel}>{t("cancel")}</button>
      </form>
    </div>
  );
}
