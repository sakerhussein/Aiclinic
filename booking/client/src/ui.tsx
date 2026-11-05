import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ApiError, post } from "./api";
import { useI18n } from "./i18n";
import { useApp } from "./session";

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { me, can } = useApp();
  const clinic = lang === "ar" ? me.clinic.nameAr : me.clinic.nameEn;
  return (
    <>
      <header className="bar">
        <div className="wrap">
          <Link to="/" className="brand"><img src="/logo/limitsiz-mark.svg" alt="" width="30" height="16" />{t("brand")} · {t("product")}</Link>
          <nav aria-label="Main">
            <NavLink to="/" end>{me.role === "doctor" ? t("mySchedule") : t("calendar")}</NavLink>
            {can("booking.appointments.view") && <NavLink to="/bookings">{t("bookings")}</NavLink>}
            {can("booking.patients.view") && <NavLink to="/patients">{t("patients")}</NavLink>}
          </nav>
          <span className="grow" />
          <span className="clinic">{clinic}</span>
          <button className="linkbtn" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{t("langSwitch")}</button>
          <UserMenu name={me.user.name} email={me.user.email} items={[
            { label: t("accounts"), href: me.accountsUrl },
            { label: t("switchUser"), onClick: async () => { const r = await post("/api/logout").catch(() => null); window.location.assign(r?.next || me.accountsUrl); } },
          ]} />
        </div>
      </header>
      <Outlet />
    </>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field">{label}{children}{hint && <span className="hint">{hint}</span>}</label>;
}
export const Banner = ({ kind = "bad", children }: { kind?: "bad" | "ok" | "warn"; children: ReactNode }) => <div className={`banner ${kind}`} role={kind === "bad" ? "alert" : "status"}>{children}</div>;

export function useAction() {
  const { error } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setErr(null);
    try { return await fn(); } catch (e) { setErr(e instanceof ApiError ? e : new ApiError(500, "server_error")); return undefined; } finally { setBusy(false); }
  }
  const submit = (fn: () => Promise<unknown>) => (e: FormEvent) => { e.preventDefault(); void run(fn); };
  return { busy, err, message: err ? error(err.code) : "", run, submit, clear: () => setErr(null) };
}

export const StatusPill = ({ status }: { status: string }) => {
  const { d } = useI18n();
  const kind = { confirmed: "ok", completed: "ok", booked: "", no_show: "warn", cancelled: "bad", voided: "bad" }[status] ?? "";
  return <span className={`pill ${kind}`}>{d.statuses[status] ?? status}</span>;
};

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
  return (
    <div className="um" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{name} <span aria-hidden="true">▾</span></button>
      {open && (
        <div className="um-list" role="menu">
          {email && <span className="who mono">{email}</span>}
          {items.map((i) => i.href
            ? <a key={i.label} role="menuitem" href={i.href}>{i.label}</a>
            : <button key={i.label} role="menuitem" type="button" onClick={() => { setOpen(false); i.onClick?.(); }}>{i.label}</button>)}
        </div>
      )}
    </div>
  );
}
