import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
        </nav>
        <span className="grow" />
        <LangInline />
        <UserMenu name={me.user.name} email={me.user.email} items={[
          { label: t("account"), onClick: () => nav("/account") },
          { label: t("lock"), onClick: async () => { await post("/api/lock").catch(() => {}); await refresh(); nav("/unlock"); } },
          { label: t("switchUser"), onClick: async () => { await post("/api/switch").catch(() => {}); window.location.assign("/signin"); } },
          { label: t("signOut"), onClick: async () => { await signOut(); nav("/signin"); } },
        ]} />
      </div>
    </header>
  );
}

function LangInline() {
  const { lang, setLang, t } = useI18n();
  return <button className="linkbtn" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{t("langSwitch")}</button>;
}

// The person's name opens a small menu (design: one tidy bar instead of loose buttons).
export function UserMenu({ name, email, items }: { name: string; email?: string; items: ({ label: string; onClick?: () => void; href?: string })[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  // On a phone the button can sit at either edge, so the menu would open off the screen: measure it and move it back inside.
  const list = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const r = list.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth, gap = 8;
    setShift(r.left < gap ? gap - r.left : r.right > vw - gap ? vw - gap - r.right : 0);
  }, [open]);
  return (
    <div className="um" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{name} <span aria-hidden="true">▾</span></button>
      {open && (
        <div className="um-list" role="menu" ref={list} style={shift ? { transform: `translateX(${shift}px)` } : undefined}>
          {email && <span className="who mono">{email}</span>}
          {items.map((i) => i.href
            ? <a key={i.label} role="menuitem" href={i.href}>{i.label}</a>
            : <button key={i.label} role="menuitem" type="button" onClick={() => { setOpen(false); i.onClick?.(); }}>{i.label}</button>)}
        </div>
      )}
    </div>
  );
}
