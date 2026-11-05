import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../api";
import { fmtDateTime } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, useAction } from "../ui";

type Row = { seq: string; at: string; actor_type: string; actor_id: string | null; actor_label: string | null; db_role: string; ip: string | null; user_agent: string | null; request_id: string | null;
  entity: string; entity_id: string | null; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; changed_fields: string[] | null; reason: string | null; subject: string | null };
type Status = { entries: number; lastCheck: { at: string; by: string; ok: boolean } | null; retentionMonths: number | null };
type Verify = { ok: boolean; checked: number; brokenSeq: number | null };
type Facets = { actors: { id: string; label: string; type: string }[]; types: string[] };

const EN = {
  title: "Audit log", intact: "Chain intact", broken: "Chain broken", notChecked: "Not checked yet", entries: "entries", lastCheck: "last checked", retention: "retention", forever: "kept for ever", months: "months", years: "years", year: "year",
  brokenBody: "Entry {seq} does not match its hash: it was changed or removed outside the system. Keep a copy of the log and contact Limitsiz.",
  verify: "Verify now", exportCsv: "Export CSV", from: "From", to: "To", user: "User", type: "Type", search: "Search", all: "All", more: "Load more", none: "No entries match.",
  time: "Time", who: "Who", action: "Action", what: "What", change: "Change", where: "From", reason: "reason", details: "Details",
  whoDetail: "Who", database: "Database login", browser: "Browser", request: "Request", seq: "Entry", before: "Before", after: "After", unavailable: "The audit log is not connected on this server.",
  types: { bookings: "Bookings", patients: "Patients", settings: "Settings", security: "Security", audit: "Audit log" } as Record<string, string>,
  actors: { agent: "WhatsApp assistant", system: "Nightly check", database: "Direct database access" } as Record<string, string>,
  entities: { appointment: "Booking", patient: "Patient", session: "Session", user: "User", membership: "User access", invite: "Invitation", clinic: "Clinic profile", doctor: "Doctor", service: "Service", clinic_hours: "Opening hours", doctor_hours: "Doctor's hours", time_off: "Closure or leave", doctor_service: "Doctor's services", booking_rules: "Booking rules", clinic_settings: "Clinic settings", clinic_faq: "Assistant answer", audit: "Audit log" } as Record<string, string>,
  actions: { created: "created", updated: "changed", deleted: "removed", status_changed: "status changed", rescheduled: "moved or edited", cancelled: "cancelled", voided: "voided", restored: "restored",
    role_changed: "role changed", permissions_changed: "permissions changed", access_removed: "access removed", access_restored: "access restored", login: "signed in", login_failed: "failed sign-in", logout: "signed out", switch_user: "switched user", signed_out_idle: "signed out (idle)",
    lock: "screen locked", unlock: "screen unlocked", unlock_failed: "failed unlock", mfa_ok: "two-step passed", mfa_failed: "two-step failed", two_step_on: "two-step on", two_step_off: "two-step off", invite_created: "invited", password_changed: "password changed", password_reset: "password reset",
    reset_link_sent: "reset link sent", sessions_revoked: "signed out everywhere", user_disabled: "user disabled", user_enabled: "user enabled", viewed: "log viewed", exported: "log exported", integrity_checked: "integrity checked", retention_purged: "old entries removed" } as Record<string, string>,
  fields: { status: "status", starts_at: "time", doctor_id: "doctor", service_id: "service", patient_id: "patient", internal_note: "note", full_name: "name", phone_e164: "phone", whatsapp_reminders: "WhatsApp reminders", preferred_language: "language", role_key: "role", can_manage_bookings: "can manage bookings", active: "active", name_en: "name", name_ar: "Arabic name", slot_minutes: "interval", buffer_minutes: "buffer", duration_minutes: "duration", price_jod: "price", min_notice_minutes: "notice", window_days: "days ahead", change_notice_minutes: "change notice", max_upcoming: "most upcoming", outside_hours: "outside hours", lock_after_minutes: "lock after", idle_timeout_minutes: "sign out after", require_2fa_all: "two-step for everyone", assistant_enabled: "assistant", reminders_enabled: "reminders", audit_retention_months: "audit retention", conversation_visibility: "conversations" } as Record<string, string>,
  why: { idle: "idle", wrong_password: "wrong password", unknown_user: "unknown email", account_locked: "account locked", locked_after_failures: "locked after 5 tries", no_access: "no access", status_disabled: "user disabled" } as Record<string, string>,
  yes: "yes", no: "no", rows: "rows", result: { ok: "intact", bad: "broken" },
};
const AR: typeof EN = {
  title: "سجل التدقيق", intact: "السلسلة سليمة", broken: "السلسلة معطوبة", notChecked: "لم يُفحص بعد", entries: "سجلاً", lastCheck: "آخر فحص", retention: "الاحتفاظ", forever: "دائماً", months: "شهراً", years: "سنوات", year: "سنة",
  brokenBody: "السجل {seq} لا يطابق بصمته: تم تغييره أو حذفه خارج النظام. احتفظ بنسخة من السجل وتواصل مع Limitsiz.",
  verify: "فحص الآن", exportCsv: "تصدير CSV", from: "من", to: "إلى", user: "المستخدم", type: "النوع", search: "بحث", all: "الكل", more: "تحميل المزيد", none: "لا توجد سجلات مطابقة.",
  time: "الوقت", who: "من", action: "الإجراء", what: "ماذا", change: "التغيير", where: "من أين", reason: "السبب", details: "التفاصيل",
  whoDetail: "من", database: "حساب قاعدة البيانات", browser: "المتصفح", request: "الطلب", seq: "السجل", before: "قبل", after: "بعد", unavailable: "سجل التدقيق غير متصل على هذا الخادم.",
  types: { bookings: "الحجوزات", patients: "المرضى", settings: "الإعدادات", security: "الأمان", audit: "سجل التدقيق" },
  actors: { agent: "مساعد واتساب", system: "الفحص الليلي", database: "وصول مباشر لقاعدة البيانات" },
  entities: { appointment: "حجز", patient: "مريض", session: "جلسة", user: "مستخدم", membership: "صلاحيات المستخدم", invite: "دعوة", clinic: "ملف العيادة", doctor: "طبيب", service: "خدمة", clinic_hours: "ساعات الدوام", doctor_hours: "ساعات الطبيب", time_off: "إغلاق أو إجازة", doctor_service: "خدمات الطبيب", booking_rules: "قواعد الحجز", clinic_settings: "إعدادات العيادة", clinic_faq: "إجابة المساعد", audit: "سجل التدقيق" },
  actions: { created: "إنشاء", updated: "تعديل", deleted: "حذف", status_changed: "تغيير الحالة", rescheduled: "نقل أو تعديل", cancelled: "إلغاء", voided: "إبطال", restored: "استعادة",
    role_changed: "تغيير الدور", permissions_changed: "تغيير الصلاحيات", access_removed: "إزالة الوصول", access_restored: "إعادة الوصول", login: "تسجيل دخول", login_failed: "فشل الدخول", logout: "تسجيل خروج", switch_user: "تبديل المستخدم", signed_out_idle: "خروج لعدم النشاط",
    lock: "قفل الشاشة", unlock: "فتح الشاشة", unlock_failed: "فشل فتح القفل", mfa_ok: "نجاح التحقق بخطوتين", mfa_failed: "فشل التحقق بخطوتين", two_step_on: "تفعيل الخطوتين", two_step_off: "إيقاف الخطوتين", invite_created: "دعوة", password_changed: "تغيير كلمة المرور", password_reset: "إعادة تعيين كلمة المرور",
    reset_link_sent: "إرسال رابط إعادة التعيين", sessions_revoked: "خروج من كل مكان", user_disabled: "تعطيل مستخدم", user_enabled: "تفعيل مستخدم", viewed: "عرض السجل", exported: "تصدير السجل", integrity_checked: "فحص السلامة", retention_purged: "حذف السجلات القديمة" },
  fields: { status: "الحالة", starts_at: "الوقت", doctor_id: "الطبيب", service_id: "الخدمة", patient_id: "المريض", internal_note: "الملاحظة", full_name: "الاسم", phone_e164: "الهاتف", whatsapp_reminders: "تذكيرات واتساب", preferred_language: "اللغة", role_key: "الدور", can_manage_bookings: "إدارة الحجوزات", active: "نشط", name_en: "الاسم", name_ar: "الاسم العربي", slot_minutes: "الفاصل", buffer_minutes: "الفاصل بعد الموعد", duration_minutes: "المدة", price_jod: "السعر", min_notice_minutes: "أقل مدة", window_days: "أيام مقدماً", change_notice_minutes: "مهلة التغيير", max_upcoming: "أقصى حجوزات", outside_hours: "خارج الساعات", lock_after_minutes: "القفل بعد", idle_timeout_minutes: "الخروج بعد", require_2fa_all: "الخطوتان للجميع", assistant_enabled: "المساعد", reminders_enabled: "التذكيرات", audit_retention_months: "الاحتفاظ بالسجل", conversation_visibility: "المحادثات" },
  why: { idle: "عدم النشاط", wrong_password: "كلمة مرور خاطئة", unknown_user: "بريد غير معروف", account_locked: "الحساب مقفل", locked_after_failures: "قُفل بعد 5 محاولات", no_access: "لا صلاحية", status_disabled: "مستخدم معطّل" },
  yes: "نعم", no: "لا", rows: "صف", result: { ok: "سليمة", bad: "معطوبة" },
};

const HIDDEN = new Set(["updated_by", "created_by", "voided_by", "voided_at", "ends_at", "updated_at", "row_version", "void_reason", "cancel_reason", "confirmed_at"]);
const browser = (ua: string | null) => { const u = ua || ""; return /Edg\//.test(u) ? "Edge" : /Chrome\//.test(u) ? "Chrome" : /Firefox\//.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : u ? u.slice(0, 18) : ""; };
const ACTION_KIND: Record<string, string> = { login_failed: "bad", unlock_failed: "bad", mfa_failed: "bad", voided: "bad", cancelled: "bad", access_removed: "bad", user_disabled: "bad", role_changed: "warn", permissions_changed: "warn", exported: "warn", status_changed: "ok", created: "ok", login: "ok" };

export function AuditLog() {
  const { lang, d } = useI18n();
  const T = lang === "ar" ? AR : EN;
  const { look, can } = useApp();
  const tz = look.clinic.timezone;
  const [f, setF] = useState({ from: "", to: "", actor: "", type: "", q: "" });
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [check, setCheck] = useState<Verify | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const a = useAction();
  const params = useMemo(() => { const p = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); }); return p; }, [f]);
  const loadStatus = useCallback(() => a.run(async () => setStatus(await get<Status>("/api/audit/status"))), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(() => a.run(async () => {
    const r = await get<{ rows: Row[]; nextBefore: string | null }>(`/api/audit?${params}`);
    setRows(r.rows); setNext(r.nextBefore); setLoaded(true);
  }), [params]);                                                                                                       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadStatus(); get<Facets>("/api/audit/facets").then(setFacets).catch(() => {}); }, [loadStatus]);
  useEffect(() => { const h = window.setTimeout(() => setF((x) => (x.q === q ? x : { ...x, q })), 300); return () => window.clearTimeout(h); }, [q]);

  const name = (id: unknown, list: { id: string; name_en: string; name_ar: string }[]) => { const x = list.find((y) => y.id === id); return x ? (lang === "ar" ? x.name_ar : x.name_en) : null; };
  function value(field: string, v: unknown): string {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "boolean") return v ? T.yes : T.no;
    if (field === "status") return d.statuses[String(v)] ?? String(v);
    if (field === "starts_at") return fmtDateTime(String(v), tz, lang);
    if (field === "doctor_id") return name(v, look.doctors) ?? "—";
    if (field === "service_id") return name(v, look.services) ?? "—";
    if (field === "role_key") return d.roles[String(v)] ?? String(v);
    if (Array.isArray(v)) return v.join(", ");
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  function Change({ r }: { r: Row }) {
    const fields = (r.changed_fields ?? []).filter((x) => !HIDDEN.has(x)).slice(0, 3);
    const why = r.after?.why ? T.why[String(r.after.why)] ?? String(r.after.why) : null;
    return (
      <>
        {fields.map((x) => <div key={x}>{T.fields[x] ?? x}: <del>{value(x, r.before?.[x])}</del> → <ins>{value(x, r.after?.[x])}</ins></div>)}
        {r.reason && <div>{T.reason}: <ins>{r.reason}</ins></div>}
        {why && <div>{why}</div>}
        {r.action === "created" && r.after?.status != null && <div>{value("status", r.after.status)}</div>}
        {r.action === "integrity_checked" && <div>{r.after?.ok ? T.result.ok : T.result.bad}</div>}
        {r.action === "exported" && <div>{String(r.after?.rows)} {T.rows}</div>}
        {r.action === "retention_purged" && <div>{String(r.after?.removed)} {T.rows}</div>}
      </>
    );
  }
  const What = ({ r }: { r: Row }) => {
    const label = T.entities[r.entity] ?? r.entity;
    const text = r.subject ? `${label} · ${r.subject}` : label;
    if (r.entity === "appointment" && r.entity_id && r.action !== "deleted") return <Link to={`/bookings/${r.entity_id}`}>{text}</Link>;
    if (r.entity === "patient" && r.entity_id && r.action !== "deleted") return <Link to={`/patients/${r.entity_id}`}>{text}</Link>;
    return <>{text}</>;
  };
  const Who = ({ r }: { r: Row }) => (r.actor_type === "user" ? <>{r.actor_label}</>
    : <span className={`pill ${r.actor_type === "database" ? "bad" : r.actor_id === "nightly" ? "" : "warn"}`}>{r.actor_type === "system" && r.actor_id !== "nightly" ? r.actor_label : T.actors[r.actor_type] ?? r.actor_type}</span>);

  const unavailable = a.err?.code === "audit_unavailable";
  const retention = !status ? "" : status.retentionMonths == null ? T.forever : status.retentionMonths % 12 ? `${status.retentionMonths} ${T.months}` : `${status.retentionMonths / 12} ${status.retentionMonths === 12 ? T.year : T.years}`;
  const last = check ? { ok: check.ok } : status?.lastCheck ?? null;
  return (
    <main className="wrap page">
      <h1 className="display">{T.title}</h1>
      {unavailable ? <Banner kind="warn">{T.unavailable}</Banner> : <>
        <div className={`integrity ${last ? (last.ok ? "good" : "bad") : ""}`}>
          <strong>{last ? (last.ok ? `✓ ${T.intact}` : `✕ ${T.broken}`) : T.notChecked}</strong>
          {status && <span>{status.entries.toLocaleString("en")} {T.entries}{status.lastCheck ? ` · ${T.lastCheck} ${fmtDateTime(status.lastCheck.at, tz, lang)}` : ""} · {T.retention}: {retention}</span>}
          <span className="grow" />
          <button className="btn btn-outline btn-sm" disabled={a.busy} onClick={() => void a.run(async () => { setCheck(await post<Verify>("/api/audit/verify")); await loadStatus(); await load(); })}>{T.verify}</button>
          {can("booking.audit.export") && <a className="btn btn-outline btn-sm" href={`/api/audit/export?${params}`} onClick={() => window.setTimeout(() => void load(), 1200)}>{T.exportCsv}</a>}
        </div>
        {check && !check.ok && <Banner>{T.brokenBody.replace("{seq}", String(check.brokenSeq))}</Banner>}
        {a.err && <Banner>{a.message}</Banner>}
        <section className="panel">
          <div className="filters">
            <label className="field">{T.from}<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className="field">{T.to}<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            <label className="field">{T.user}<select value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })}><option value="">{T.all}</option>{facets?.actors.map((x) => <option key={x.id} value={x.id}>{x.type === "user" ? x.label : T.actors[x.type] ?? x.label}</option>)}</select></label>
            <label className="field">{T.type}<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">{T.all}</option>{facets?.types.map((x) => <option key={x} value={x}>{T.types[x]}</option>)}</select></label>
            <label className="field">{T.search}<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </div>
          <div className="tablewrap"><table className="auditt">
            <thead><tr><th>{T.time}</th><th>{T.who}</th><th>{T.action}</th><th>{T.what}</th><th>{T.change}</th><th>{T.where}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <Fragment key={r.seq}>
                <tr className="clickrow" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) setOpen(open === r.seq ? null : r.seq); }}>
                  <td className="nowrap">{fmtDateTime(r.at, tz, lang)}</td>
                  <td><Who r={r} /></td>
                  <td><span className={`pill ${ACTION_KIND[r.action] ?? ""}`}>{T.actions[r.action] ?? r.action.replace(/_/g, " ")}</span></td>
                  <td><What r={r} /></td>
                  <td className="diff"><Change r={r} /></td>
                  <td><bdi dir="ltr" className="mono hint">{r.ip || ""}{r.ip && browser(r.user_agent) ? " · " : ""}{browser(r.user_agent)}</bdi></td>
                </tr>
                {open === r.seq && (
                  <tr className="detailrow"><td colSpan={6}>
                    <dl className="facts">
                      <dt>{T.seq}</dt><dd className="mono">{r.seq}</dd>
                      <dt>{T.whoDetail}</dt><dd>{r.actor_label || "—"} <span className="hint">({r.actor_type})</span></dd>
                      <dt>{T.database}</dt><dd className="mono">{r.db_role}</dd>
                      {r.user_agent && <><dt>{T.browser}</dt><dd className="mono wrapany">{r.user_agent}</dd></>}
                      {r.request_id && <><dt>{T.request}</dt><dd className="mono">{r.request_id}</dd></>}
                    </dl>
                    <div className="grid2 top">
                      {r.before && <div><b>{T.before}</b><pre dir="ltr">{JSON.stringify(r.before, null, 2)}</pre></div>}
                      {r.after && <div><b>{T.after}</b><pre dir="ltr">{JSON.stringify(r.after, null, 2)}</pre></div>}
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody>
          </table></div>
          {loaded && rows.length === 0 && <p className="hint">{T.none}</p>}
          {next && <div className="row"><button className="btn btn-outline btn-sm" disabled={a.busy} onClick={() => void a.run(async () => {
            const r = await get<{ rows: Row[]; nextBefore: string | null }>(`/api/audit?${params}&before=${next}`);
            setRows([...rows, ...r.rows]); setNext(r.nextBefore);
          })}>{T.more}</button></div>}
        </section>
      </>}
    </main>
  );
}
