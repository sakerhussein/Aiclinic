import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { get, post, type Me } from "../api";
import { useI18n } from "../i18n";
import { useSession } from "../session";
import { Banner, CardPage, Field, useAction } from "../ui";

// Where to go after signing in: back to the service that sent the person here (/authorize?…), or the launcher.
export function useContinue() {
  const [q] = useSearchParams();
  const nav = useNavigate();
  const next = q.get("next");
  return (me: Me | null) => {
    if (!me) return;
    const route: Record<string, string> = { locked: "/unlock", mfa_required: "/mfa", mfa_setup_required: "/mfa/setup", choose_clinic: "/choose-clinic" };
    const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
    if (me.state === "ok") { if (next && next.startsWith("/authorize?")) window.location.assign(next); else nav("/", { replace: true }); }
    else if (route[me.state]) nav(route[me.state] + suffix, { replace: true });
  };
}

export function SignIn() {
  const { t } = useI18n();
  const { setMe } = useSession();
  const go = useContinue();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const a = useAction();
  return (
    <CardPage title={t("signInTitle")} sub={t("signInSub")}>
      <form className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }} onSubmit={a.submit(async () => {
        const me = await post<Me>("/api/login", { email, password }); setMe(me); go(me);
      })}>
        <Field label={t("email")} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Field label={t("password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {a.err && <Banner>{a.err}</Banner>}
        <button className="btn btn-accent btn-block" disabled={a.busy}>{a.busy ? t("working") : t("signIn")}</button>
      </form>
      <p className="sub"><Link to="/forgot">{t("forgot")}</Link></p>
      <p className="sub">{t("noSignup")}</p>
    </CardPage>
  );
}

export function Forgot() {
  const { t } = useI18n();
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false);
  const a = useAction();
  return (
    <CardPage title={t("forgotTitle")} sub={t("forgotSub")}>
      {sent ? <Banner kind="ok">{t("forgotDone")}</Banner> : (
        <form className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }} onSubmit={a.submit(async () => { await post("/api/password/forgot", { email }); setSent(true); })}>
          <Field label={t("email")} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          {a.err && <Banner>{a.err}</Banner>}
          <button className="btn btn-accent btn-block" disabled={a.busy}>{t("sendLink")}</button>
        </form>
      )}
      <p className="sub"><Link to="/signin">{t("backToSignIn")}</Link></p>
    </CardPage>
  );
}

export function Reset() {
  const { t } = useI18n();
  const [q] = useSearchParams();
  const [pw, setPw] = useState(""); const [done, setDone] = useState(false);
  const a = useAction();
  return (
    <CardPage title={t("resetTitle")}>
      {done ? <><Banner kind="ok">{t("resetDone")}</Banner><Link className="btn btn-accent btn-block" to="/signin">{t("signIn")}</Link></> : (
        <form className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }} onSubmit={a.submit(async () => { await post("/api/password/reset", { token: q.get("token"), password: pw }); setDone(true); })}>
          <Field label={t("newPassword")} hint={t("passwordHint")} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={12} autoFocus />
          {a.err && <Banner>{a.err}</Banner>}
          <button className="btn btn-accent btn-block" disabled={a.busy}>{t("savePassword")}</button>
        </form>
      )}
    </CardPage>
  );
}

export function Accept() {
  const { t, dict, lang } = useI18n();
  const [q] = useSearchParams();
  const token = q.get("token") || "";
  const [info, setInfo] = useState<{ full_name: string; email: string; role_key: string; clinic_name_en: string | null; clinic_name_ar: string | null; has_account: boolean } | null>(null);
  const [bad, setBad] = useState(false);
  const [pw, setPw] = useState(""); const [name, setName] = useState(""); const [done, setDone] = useState(false);
  const a = useAction();
  useEffect(() => { get(`/api/invites/${encodeURIComponent(token)}`).then((i) => { setInfo(i); setName(i.full_name); }).catch(() => setBad(true)); }, [token]);
  if (bad) return <CardPage title={t("acceptTitle")}><Banner>{dict.errors.invite_invalid}</Banner></CardPage>;
  if (!info) return <CardPage title={t("acceptTitle")}><p className="sub">{t("working")}</p></CardPage>;
  const clinic = (lang === "ar" ? info.clinic_name_ar : info.clinic_name_en) || t("brand");
  return (
    <CardPage title={t("acceptTitle")} sub={t("acceptSub", { clinic, role: dict.roles[info.role_key] || info.role_key })}>
      {done ? <><Banner kind="ok">{t("acceptDone")}</Banner><Link className="btn btn-accent btn-block" to="/signin">{t("signIn")}</Link></> : (
        <form className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }} onSubmit={a.submit(async () => { await post("/api/invites/accept", { token, password: pw, fullName: info.has_account ? undefined : name }); setDone(true); })}>
          <p className="mono sub">{info.email}</p>
          {info.has_account ? <p className="hint">{t("existingAccount")}</p> : <Field label={t("yourName")} value={name} onChange={(e) => setName(e.target.value)} required />}
          <Field label={info.has_account ? t("currentPassword") : t("newPassword")} hint={info.has_account ? undefined : t("passwordHint")} type="password" autoComplete={info.has_account ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} required minLength={info.has_account ? 1 : 12} />
          {a.err && <Banner>{a.err}</Banner>}
          <button className="btn btn-accent btn-block" disabled={a.busy}>{t("createAccount")}</button>
        </form>
      )}
    </CardPage>
  );
}

// Second step of sign-in.
export function Mfa() {
  const { t } = useI18n();
  const { setMe, signOut } = useSession();
  const go = useContinue();
  const nav = useNavigate();
  const [code, setCode] = useState(""); const [recovery, setRecovery] = useState(false);
  const a = useAction();
  return (
    <CardPage title={t("mfaTitle")} sub={t("mfaSub")}>
      <form className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }} onSubmit={a.submit(async () => {
        await post("/api/mfa/verify", recovery ? { recovery: code } : { code });
        const me = await get<Me>("/api/me"); setMe(me); go(me);
      })}>
        <Field label={recovery ? t("recoveryCode") : t("code")} value={code} onChange={(e) => setCode(e.target.value)} inputMode={recovery ? "text" : "numeric"} autoComplete="one-time-code" required autoFocus />
        {a.err && <Banner>{a.err}</Banner>}
        <button className="btn btn-accent btn-block" disabled={a.busy}>{t("verify")}</button>
      </form>
      <p className="sub"><button className="link" type="button" onClick={() => { setRecovery(!recovery); setCode(""); }}>{recovery ? t("useApp") : t("useRecovery")}</button></p>
      <p className="sub"><button className="link" type="button" onClick={async () => { await signOut(); nav("/signin"); }}>{t("cancel")}</button></p>
    </CardPage>
  );
}

export function MfaSetup() {
  const { t } = useI18n();
  const { setMe } = useSession();
  const go = useContinue();
  const [secret, setSecret] = useState(""); const [qr, setQr] = useState("");
  const [code, setCode] = useState(""); const [codes, setCodes] = useState<string[] | null>(null);
  const a = useAction();
  useEffect(() => {
    post<{ secret: string; otpauth: string }>("/api/mfa/setup").then(async (r) => { setSecret(r.secret); setQr(await QRCode.toDataURL(r.otpauth, { margin: 1, width: 200 })); }).catch(() => {});
  }, []);
  if (codes) return (
    <CardPage title={t("recoveryTitle")} sub={t("recoverySub")}>
      <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <button className="btn btn-outline btn-block" type="button" onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))}>{t("copyAll")}</button>
      <button className="btn btn-accent btn-block" type="button" onClick={async () => { const me = await get<Me>("/api/me"); setMe(me); go(me); }}>{t("recoverySaved")}</button>
    </CardPage>
  );
  return (
    <CardPage title={t("mfaSetupTitle")} sub={t("mfaSetupSub")}>
      {qr && <img className="qr" src={qr} alt="" />}
      {secret && <><p className="hint">{t("secretKey")}</p><p className="secret">{secret}</p></>}
      <form className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }} onSubmit={a.submit(async () => { const r = await post<{ recoveryCodes: string[] }>("/api/mfa/enable", { code }); setCodes(r.recoveryCodes); })}>
        <Field label={t("code")} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
        {a.err && <Banner>{a.err}</Banner>}
        <button className="btn btn-accent btn-block" disabled={a.busy}>{t("turnOn")}</button>
      </form>
    </CardPage>
  );
}

// The lock screen: the same person types the password; anyone else switches user.
export function Unlock() {
  const { t } = useI18n();
  const { me, setMe, refresh } = useSession();
  const go = useContinue();
  const [pw, setPw] = useState("");
  const a = useAction();
  return (
    <CardPage title={t("lockedTitle")} sub={t("lockedSub", { name: me?.user.name || "" })}>
      <form className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }} onSubmit={a.submit(async () => {
        await post("/api/unlock", { password: pw }); const m = await refresh(); setMe(m); setPw(""); go(m);
      })}>
        <Field label={t("password")} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
        {a.err && <Banner>{a.err}</Banner>}
        <button className="btn btn-accent btn-block" disabled={a.busy}>{t("unlock")}</button>
      </form>
      <p className="sub"><button className="link" type="button" onClick={async () => { await post("/api/switch").catch(() => {}); window.location.assign("/signin"); }}>{t("notYou")}</button></p>
    </CardPage>
  );
}

export function ChooseClinic() {
  const { t, lang, dict } = useI18n();
  const { me, setMe } = useSession();
  const go = useContinue();
  const a = useAction();
  return (
    <CardPage title={t("chooseTitle")} sub={t("chooseSub")}>
      {a.err && <Banner>{a.err}</Banner>}
      {me?.clinics.map((c) => (
        <button key={c.id} className="btn btn-outline btn-block" disabled={a.busy} onClick={() => void a.run(async () => { const m = await post<Me>("/api/clinic", { clinicId: c.id }); setMe(m); go(m); })}>
          {lang === "ar" ? c.nameAr : c.nameEn} · {dict.roles[c.role] || c.role}
        </button>
      ))}
    </CardPage>
  );
}
