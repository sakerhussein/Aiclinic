import { useState, type FormEvent, type ReactNode } from "react";
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
          <a className="linkbtn" href={me.accountsUrl}>{me.user.name}</a>
          <button className="linkbtn" onClick={async () => { const r = await post("/api/logout").catch(() => null); window.location.assign(r?.next || me.accountsUrl); }}>{t("switchUser")}</button>
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
