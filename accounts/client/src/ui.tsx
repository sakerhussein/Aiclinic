import { useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ApiError, post } from "./api";
import { useI18n } from "./i18n";
import { useSession } from "./session";

export function LangButton() {
  const { lang, setLang, t } = useI18n();
  return <div className="langbar"><button type="button" className="langbtn" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{t("langSwitch")}</button></div>;
}

export function Brand() {
  const { t } = useI18n();
  return <span className="brand"><img src="/logo/limitsiz-mark-ink.svg" alt="" width="30" height="16" />{t("brand")}</span>;
}

// A centered card on the dark background: every sign-in step uses it.
export function CardPage({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="stage">
      <LangButton />
      <main className="card">
        <Brand />
        <h1 className="display">{title}</h1>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </main>
    </div>
  );
}

export function Field({ label, hint, ...p }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className="field">{label}<input {...p} />{hint && <span className="hint">{hint}</span>}</label>;
}

export const Banner = ({ kind = "bad", children }: { kind?: "bad" | "ok" | "warn"; children: ReactNode }) => <div className={`banner ${kind}`} role={kind === "bad" ? "alert" : "status"}>{children}</div>;

// Runs an action with a busy flag and a translated error message.
export function useAction() {
  const { error } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setErr("");
    try { return await fn(); }
    catch (e) {
      if (e instanceof ApiError) setErr(error(e.code, e.data.reason as string | undefined)); else setErr(error("server_error"));
      return undefined;
    } finally { setBusy(false); }
  }
  const submit = (fn: () => Promise<unknown>) => (e: FormEvent) => { e.preventDefault(); void run(fn); };
  return { busy, err, setErr, run, submit };
}

// The bar of the signed-in pages.
export function AppBar() {
  const { t } = useI18n();
  const { me, signOut, refresh } = useSession();
  const nav = useNavigate();
  if (!me) return null;
  const canUsers = me.permissions.includes("accounts.users.view");
  return (
    <header className="bar">
      <div className="wrap">
        <Link to="/" className="brand"><img src="/logo/limitsiz-mark.svg" alt="" width="30" height="16" />{t("brand")}</Link>
        <nav aria-label="Main">
          <NavLink to="/" end>{t("appsTitle")}</NavLink>
          {canUsers && <NavLink to="/users">{t("users")}</NavLink>}
          <NavLink to="/account">{t("account")}</NavLink>
        </nav>
        <span className="grow" />
        <LangInline />
        <button className="linkbtn" onClick={async () => { await post("/api/lock").catch(() => {}); await refresh(); nav("/unlock"); }}>{t("lock")}</button>
        <button className="linkbtn" onClick={async () => { await post("/api/switch").catch(() => {}); window.location.assign("/signin"); }}>{t("switchUser")}</button>
        <button className="linkbtn" onClick={async () => { await signOut(); nav("/signin"); }}>{t("signOut")}</button>
      </div>
    </header>
  );
}

function LangInline() {
  const { lang, setLang, t } = useI18n();
  return <button className="linkbtn" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{t("langSwitch")}</button>;
}
