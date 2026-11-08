import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { Link, useSearchParams } from "react-router-dom";
import { del, get, patch, post, put } from "../api";
import { addDays, fmtDateTime, fmtShortDate, dayOf, localToIso, todayIn } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, Field, useAction } from "../ui";
import { DESIGNS } from "./print";
import { useS, duration } from "./settings-text";

// The brochure colours on offer: the brand mint first (the band and step numbers); the clinic picks one. Names in settings-text.
const SWATCHES = ["#2EE6B5", "#0B7A64", "#3B6FD8", "#C2417A", "#0A0F14"];

type Period = { weekday: number; start: string; end: string };
type Doctor = { id: string; name_en: string; name_ar: string; title_en: string | null; title_ar: string | null; gender: "f" | "m" | null; active: boolean;
  slot_minutes: number | null; buffer_minutes: number; service_ids: string[]; hours: Period[]; scribe_enabled: boolean };
type ScribeSection = { key: string; en: string; ar: string; hint?: string };
type Scribe = { enabled: boolean; note_language: "en" | "ar"; consent_en: string; consent_ar: string; sections: ScribeSection[]; max_recording_minutes: number;
  transcript_keep_days: number; notes_per_doctor_per_day: number; speech_service: string; draft_model: string };
type Service = { id: string; name_en: string; name_ar: string; description_en: string | null; description_ar: string | null; duration_minutes: number; price_jod: string | null; price_is_from: boolean; active: boolean };
type TimeOff = { id: string; doctor_id: string | null; starts_at: string; ends_at: string; reason: string | null };
type Faq = { id: string; topic: string; question_en: string; question_ar: string; answer_en: string; answer_ar: string };
type Rule = { audience: "patient" | "staff"; min_notice_minutes: number; window_days: number; change_notice_minutes: number; max_upcoming: number | null; outside_hours: string; walkin_back_minutes: number; require_cancel_reason: boolean };
type General = { idle_timeout_minutes: number; lock_after_minutes: number; require_2fa_all: boolean; conversation_visibility: string; audit_retention_months: number | null;
  reminders_enabled: boolean; reminder_offsets_minutes: number[]; quiet_start: string; quiet_end: string; assistant_enabled: boolean;
  after_hours_message_en: string | null; after_hours_message_ar: string | null; handoff_alert_emails: string[] };
type Profile = { name_en: string; name_ar: string; phone: string | null; address_en: string | null; address_ar: string | null; maps_url: string | null; timezone: string; default_language: "ar" | "en"; week_start: number; slot_step_minutes: number };
type Outside = { id: string; starts_at: string; patient_name: string | null; patient_phone: string | null; doctor_name_en: string; doctor_name_ar: string };
type Online = { enabled: boolean; staff_check: boolean; show_prices: boolean; allow_any_doctor: boolean; allow_cancel: boolean; allow_reschedule: boolean; allow_for_other: boolean;
  offer_reminders: boolean; default_country_code: string; max_unchecked_per_phone: number; bookings_per_phone_per_day: number; bookings_per_ip_per_day: number;
  lookups_per_ip_per_minute: number; manage_per_ip_per_hour: number; days_per_page: number; intro_en: string | null; intro_ar: string | null;
  done_note_en: string | null; done_note_ar: string | null; share_message_en: string; share_message_ar: string; privacy_url: string;
  find_enabled: boolean; find_per_phone_per_day: number; find_per_ip_per_hour: number; find_message_en: string; find_message_ar: string; whatsapp_connected: boolean;
  chat_enabled: boolean; chat_messages_per_chat: number; chat_chats_per_ip_per_day: number; chat_messages_per_clinic_per_day: number; chat_keep_days: number;
  brochure_colour: string; brochure_card_languages: "ar_en" | "ar" | "en"; brochure_show_ai: boolean };
type OnlineLink = { enabled: boolean; url?: string; qrUrl?: string };
type Data = { profile: Profile; hours: Period[]; closures: TimeOff[]; doctors: Doctor[]; services: Service[]; faqs: Faq[]; rules: Rule[]; general: General; outside: Outside[];
  online: Online; onlineLink: OnlineLink; scribe: Scribe;
  options: { slotMinutes: number[]; bufferMinutes: number[]; idleMinutes: number[]; lockMinutes: number[]; reminderMinutes: number[] } };

const TABS = ["profile", "hours", "doctors", "services", "rules", "online", "scribe", "reminders", "assistant", "security", "audit"] as const;
type Tab = (typeof TABS)[number];

export function Settings() {
  const s = useS();
  const { can } = useApp();
  const [q] = useSearchParams();                              // ?tab=audit: the way back from the audit log
  const [tab, setTab] = useState<Tab>(TABS.find((k) => k === q.get("tab")) ?? "profile");
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(() => get<Data>("/api/settings").then(setData).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  const canEdit = can("booking.settings.edit");
  if (!data) return null;
  const P = { data, reload: load };
  return (
    <main className="wrap page">
      <h1 className="display">{s.title}</h1>
      {!canEdit && <Banner kind="warn">{s.readOnly}</Banner>}
      <div className="setwrap">
        <nav className="settabs" aria-label={s.title}>
          {TABS.map((k) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{s.tabs[k]}{k === "scribe" && <span className="newtag">{s.newTag}</span>}</button>)}
        </nav>
        <div className="setbody">
          <OutsideList rows={data.outside} />
          {tab === "profile" && <ProfileTab {...P} />}
          {tab === "hours" && <HoursTab {...P} />}
          {tab === "doctors" && <DoctorsTab {...P} />}
          {tab === "services" && <ServicesTab {...P} />}
          {tab === "rules" && <RulesTab {...P} />}
          {tab === "online" && <OnlineTab {...P} />}
          {tab === "scribe" && <ScribeTab {...P} />}
          {tab === "reminders" && <RemindersTab {...P} />}
          {tab === "assistant" && <AssistantTab {...P} />}
          {tab === "security" && <SecurityTab {...P} />}
          {tab === "audit" && <AuditTab {...P} />}
        </div>
      </div>
    </main>
  );
}
type P = { data: Data; reload: () => Promise<unknown> };

// "3 bookings are outside the new hours": nothing is moved or cancelled, staff contact these patients.
function OutsideList({ rows }: { rows: Outside[] }) {
  const s = useS();
  const { lang } = useI18n();
  const { look } = useApp();
  if (!rows.length) return null;
  return (
    <Banner kind="warn">
      <b>{s.outsideTitle.replace("{n}", String(rows.length))}</b> {s.outsideBody}
      <ul className="tight">{rows.slice(0, 8).map((r) => <li key={r.id}><Link to={`/bookings/${r.id}`}>{fmtDateTime(r.starts_at, look.clinic.timezone, lang)}</Link> · {r.patient_name || r.patient_phone} · {lang === "ar" ? r.doctor_name_ar : r.doctor_name_en}</li>)}</ul>
    </Banner>
  );
}

function SForm({ children, ...p }: React.FormHTMLAttributes<HTMLFormElement>) {
  const { can } = useApp();
  return <form {...p}><fieldset className="plain" disabled={!can("booking.settings.edit")}>{children}</fieldset></form>;
}

function Saver({ a, ok, label }: { a: ReturnType<typeof useAction>; ok: boolean; label?: string }) {
  const { t } = useI18n(); const { can } = useApp();
  return (
    <>
      {can("booking.settings.edit") && <div className="row"><button className="btn btn-accent" disabled={a.busy}>{label || t("save")}</button></div>}
      {a.err && <Banner>{a.message}</Banner>}
      {ok && !a.err && <Banner kind="ok">{t("saved")}</Banner>}
    </>
  );
}
function useSave(reload: () => Promise<unknown>) {
  const a = useAction();
  const [ok, setOk] = useState(false);
  const submit = (fn: () => Promise<unknown>) => a.submit(async () => { setOk(false); await fn(); await reload(); setOk(true); });
  return { a, ok, submit };
}
const Pick = ({ value, onChange, options }: { value: string | number; onChange: (v: string) => void; options: [string | number, string][] }) => (
  <select value={String(value)} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}</select>
);
// A pick list, plus the current value when it is a custom one set earlier.
const withCurrent = (list: number[], cur: number | null | undefined) => (cur == null || list.includes(cur) ? list : [...list, cur].sort((x, y) => x - y));
const Check = ({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) => (
  <label className="check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> <span>{children}</span></label>
);

function ProfileTab({ data, reload }: P) {
  const s = useS(); const { t } = useI18n();
  const p = data.profile;
  const [f, setF] = useState({ nameEn: p.name_en, nameAr: p.name_ar, phone: p.phone || "", addressEn: p.address_en || "", addressAr: p.address_ar || "", mapsUrl: p.maps_url || "",
    timezone: p.timezone, defaultLanguage: p.default_language as string, weekStart: p.week_start, slotStepMinutes: p.slot_step_minutes });
  const { a, ok, submit } = useSave(reload);
  const inp = (k: keyof typeof f) => ({ value: String(f[k]), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <div className="stack">
      <SForm className="panel stack" onSubmit={submit(() => patch("/api/settings/profile", f))}>
        <h2>{s.tabs.profile}</h2>
        <div className="grid2">
          <Field label={s.nameEn}><input {...inp("nameEn")} required /></Field>
          <Field label={s.nameAr}><input {...inp("nameAr")} required /></Field>
          <Field label={t("phone")}><input className="mono" {...inp("phone")} /></Field>
          <Field label={s.maps}><input {...inp("mapsUrl")} type="url" /></Field>
          <Field label={s.addressEn}><input {...inp("addressEn")} /></Field>
          <Field label={s.addressAr}><input {...inp("addressAr")} /></Field>
          <Field label={s.timezone}><input className="mono" {...inp("timezone")} required /></Field>
          <Field label={s.defaultLanguage}><Pick value={f.defaultLanguage} onChange={(v) => setF({ ...f, defaultLanguage: v })} options={[["ar", "العربية"], ["en", "English"]]} /></Field>
          <Field label={s.weekStart}><Pick value={f.weekStart} onChange={(v) => setF({ ...f, weekStart: Number(v) })} options={[[6, s.days[6]], [0, s.days[0]], [1, s.days[1]]]} /></Field>
          <Field label={s.clinicInterval} hint={s.clinicIntervalHint}><Pick value={f.slotStepMinutes} onChange={(v) => setF({ ...f, slotStepMinutes: Number(v) })} options={data.options.slotMinutes.map((m) => [m, duration(m, s)])} /></Field>
        </div>
        <Saver a={a} ok={ok} />
      </SForm>
      <FaqPanel data={data} reload={reload} />
    </div>
  );
}

function FaqPanel({ data, reload }: P) {
  const s = useS(); const { can } = useApp(); const canEdit = can("booking.settings.edit");
  const blank = { topic: "", questionEn: "", questionAr: "", answerEn: "", answerAr: "" };
  const [f, setF] = useState(blank);
  const { a, ok, submit } = useSave(reload);
  const inp = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }), required: true });
  return (
    <section className="panel stack">
      <h2>{s.faqTitle}</h2>
      <p className="hint">{s.faqHint}</p>
      {data.faqs.map((q) => (
        <div key={q.id} className="faqrow">
          <div><b>{q.question_en}</b> / <b>{q.question_ar}</b><br /><span className="hint">{q.answer_en} / {q.answer_ar}</span></div>
          {canEdit && <button type="button" className="link" onClick={() => void a.run(async () => { await del(`/api/settings/faqs/${q.id}`); await reload(); })}>{s.remove}</button>}
        </div>
      ))}
      <SForm className="stack" onSubmit={submit(async () => { await post("/api/settings/faqs", f); setF(blank); })}>
        <div className="grid2">
          <Field label={s.topic}><input {...inp("topic")} /></Field><span />
          <Field label={s.questionEn}><input {...inp("questionEn")} /></Field>
          <Field label={s.questionAr}><input {...inp("questionAr")} /></Field>
          <Field label={s.answerEn}><input {...inp("answerEn")} /></Field>
          <Field label={s.answerAr}><input {...inp("answerAr")} /></Field>
        </div>
        <Saver a={a} ok={ok} label={s.add} />
      </SForm>
    </section>
  );
}

// One row per day, several periods a day (split shifts); no periods = closed.
function WeekEditor({ value, onChange, weekStart }: { value: Period[]; onChange: (p: Period[]) => void; weekStart: number }) {
  const s = useS();
  const days = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const setRow = (i: number, patchRow: Partial<Period>) => onChange(value.map((p, n) => (n === i ? { ...p, ...patchRow } : p)));
  return (
    <div className="week">
      {days.map((d) => {
        const rows = value.map((p, i) => ({ p, i })).filter((x) => x.p.weekday === d);
        return (
          <div className="weekrow" key={d}>
            <b>{s.days[d]}</b>
            <div className="periods">
              {rows.length === 0 && <span className="hint">{s.closed}</span>}
              {rows.map(({ p, i }) => (
                <span className="period" key={i}>
                  <input type="time" value={p.start} onChange={(e) => setRow(i, { start: e.target.value })} required aria-label={s.from} />
                  <span>–</span>
                  <input type="time" value={p.end} onChange={(e) => setRow(i, { end: e.target.value })} required aria-label={s.to} />
                  <button type="button" className="link" onClick={() => onChange(value.filter((_, n) => n !== i))} aria-label={s.remove}>×</button>
                </span>
              ))}
              <button type="button" className="link" onClick={() => onChange([...value, { weekday: d, start: "09:00", end: "17:00" }])}>{s.addPeriod}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimeOffPanel({ title, rows, doctorId, reload }: { title: string; rows: TimeOff[]; doctorId: string | null; reload: () => Promise<unknown> }) {
  const s = useS(); const { lang } = useI18n(); const { look, can } = useApp();
  const canEdit = can("booking.settings.edit");
  const tz = look.clinic.timezone;
  const [f, setF] = useState({ from: todayIn(tz), to: todayIn(tz), reason: "" });
  const { a, ok, submit } = useSave(reload);
  return (
    <section className="panel stack">
      <h2>{title}</h2>
      {rows.length === 0 && <p className="hint">{s.none}</p>}
      {rows.map((r) => (
        <div key={r.id} className="faqrow">
          <span>{fmtShortDate(dayOf(r.starts_at, tz), lang)} – {fmtShortDate(dayOf(new Date(Date.parse(r.ends_at) - 1).toISOString(), tz), lang)}{r.reason ? ` · ${r.reason}` : ""}</span>
          {canEdit && <button type="button" className="link" onClick={() => void a.run(async () => { await del(`/api/settings/time-off/${r.id}`); await reload(); })}>{s.remove}</button>}
        </div>
      ))}
      <SForm className="grid3" onSubmit={submit(async () => {
        await post("/api/settings/time-off", { doctorId, startsAt: localToIso(f.from, 0, 0, tz), endsAt: localToIso(addDays(f.to, 1), 0, 0, tz), reason: f.reason });
        setF({ ...f, reason: "" });
      })}>
        <Field label={s.from}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} required /></Field>
        <Field label={s.to}><input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} required /></Field>
        <Field label={s.reasonName}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={120} /></Field>
        <div className="full"><Saver a={a} ok={ok} label={s.add} /></div>
      </SForm>
    </section>
  );
}

function HoursTab({ data, reload }: P) {
  const s = useS();
  const [hours, setHours] = useState<Period[]>(data.hours.map(({ weekday, start, end }) => ({ weekday, start, end })));
  const { a, ok, submit } = useSave(reload);
  return (
    <div className="stack">
      <SForm className="panel stack" onSubmit={submit(() => put("/api/settings/hours", { periods: hours }))}>
        <h2>{s.openingHours}</h2>
        <p className="hint">{data.hours.length ? s.openingHint : s.openingNotSet}</p>
        <WeekEditor value={hours} onChange={setHours} weekStart={data.profile.week_start} />
        <Saver a={a} ok={ok} />
      </SForm>
      <TimeOffPanel title={s.closures} rows={data.closures.filter((c) => !c.doctor_id)} doctorId={null} reload={reload} />
    </div>
  );
}

function DoctorsTab({ data, reload }: P) {
  const s = useS(); const { lang } = useI18n(); const { can } = useApp();
  const [id, setId] = useState<string>(data.doctors[0]?.id || "new");
  const doc = data.doctors.find((d) => d.id === id);
  return (
    <div className="stack">
      <div className="chips">
        {data.doctors.map((d) => <button type="button" key={d.id} className={`chip ${d.id === id ? "on" : ""}`} onClick={() => setId(d.id)}>{lang === "ar" ? d.name_ar : d.name_en}{!d.active ? ` (${s.inactive})` : ""}</button>)}
        {can("booking.settings.edit") && <button type="button" className={`chip ${id === "new" ? "on" : ""}`} onClick={() => setId("new")}>{s.newDoctor}</button>}
      </div>
      {doc ? <DoctorEditor key={doc.id} doc={doc} data={data} reload={reload} /> : <DoctorForm data={data} reload={reload} onCreated={setId} />}
    </div>
  );
}

function DoctorForm({ doc, data, reload, onCreated }: { doc?: Doctor; onCreated?: (id: string) => void } & P) {
  const s = useS();
  const [f, setF] = useState({ nameEn: doc?.name_en || "", nameAr: doc?.name_ar || "", titleEn: doc?.title_en || "", titleAr: doc?.title_ar || "", gender: doc?.gender || "",
    slotMinutes: doc?.slot_minutes ?? null as number | null, bufferMinutes: doc?.buffer_minutes ?? 0, active: doc?.active ?? true });
  const { a, ok, submit } = useSave(reload);
  const inp = (k: "nameEn" | "nameAr" | "titleEn" | "titleAr") => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <SForm className="panel stack" onSubmit={submit(async () => {
      const body = { ...f, gender: f.gender || null };
      if (doc) await patch(`/api/settings/doctors/${doc.id}`, body);
      else { const r = await post<{ id: string }>("/api/settings/doctors", body); await reload(); onCreated?.(r.id); }
    })}>
      <h2>{doc ? s.doctorDetails : s.newDoctor}</h2>
      <div className="grid2">
        <Field label={s.nameEn}><input {...inp("nameEn")} required /></Field>
        <Field label={s.nameAr}><input {...inp("nameAr")} required /></Field>
        <Field label={s.titleEn}><input {...inp("titleEn")} /></Field>
        <Field label={s.titleAr}><input {...inp("titleAr")} /></Field>
        <Field label={s.gender}><Pick value={f.gender} onChange={(v) => setF({ ...f, gender: v })} options={[["", "—"], ["f", s.female], ["m", s.male]]} /></Field>
        <Field label={s.interval} hint={s.intervalHint}><Pick value={f.slotMinutes ?? ""} onChange={(v) => setF({ ...f, slotMinutes: v ? Number(v) : null })}
          options={[["", `${s.clinicDefault} (${duration(data.profile.slot_step_minutes, s)})`], ...data.options.slotMinutes.map((m) => [m, duration(m, s)] as [number, string])]} /></Field>
        <Field label={s.buffer}><Pick value={f.bufferMinutes} onChange={(v) => setF({ ...f, bufferMinutes: Number(v) })} options={data.options.bufferMinutes.map((m) => [m, m ? duration(m, s) : s.noneOption])} /></Field>
      </div>
      {doc && <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>{s.active}</Check>}
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

function DoctorEditor({ doc, data, reload }: { doc: Doctor } & P) {
  const s = useS(); const { lang } = useI18n();
  const [hours, setHours] = useState<Period[]>(doc.hours);
  const [svc, setSvc] = useState<string[]>(doc.service_ids);
  const h = useSave(reload), v = useSave(reload);
  return (
    <div className="stack">
      <DoctorForm doc={doc} data={data} reload={reload} />
      <SForm className="panel stack" onSubmit={h.submit(() => put(`/api/settings/doctors/${doc.id}/hours`, { periods: hours }))}>
        <h2>{s.doctorHours}</h2>
        {data.hours.length > 0 && <p className="hint">{s.doctorHoursHint}</p>}
        <WeekEditor value={hours} onChange={setHours} weekStart={data.profile.week_start} />
        <Saver a={h.a} ok={h.ok} />
      </SForm>
      <SForm className="panel stack" onSubmit={v.submit(() => put(`/api/settings/doctors/${doc.id}/services`, { serviceIds: svc }))}>
        <h2>{s.doctorServices}</h2>
        {data.services.filter((x) => x.active).map((x) => (
          <Check key={x.id} checked={svc.includes(x.id)} onChange={(c) => setSvc(c ? [...svc, x.id] : svc.filter((y) => y !== x.id))}>{lang === "ar" ? x.name_ar : x.name_en}</Check>
        ))}
        <Saver a={v.a} ok={v.ok} />
      </SForm>
      <TimeOffPanel title={s.leave} rows={data.closures.filter((c) => c.doctor_id === doc.id)} doctorId={doc.id} reload={reload} />
    </div>
  );
}

function ServicesTab({ data, reload }: P) {
  const s = useS(); const { lang, t } = useI18n(); const { can } = useApp();
  const [id, setId] = useState<string | null>(null);
  const cur = data.services.find((x) => x.id === id);
  return (
    <div className="stack">
      <section className="panel">
        <div className="row between"><h2>{s.tabs.services}</h2>{can("booking.settings.edit") && <button type="button" className="btn btn-outline btn-sm" onClick={() => setId("new")}>{s.newService}</button>}</div>
        <div className="tablewrap"><table>
          <thead><tr><th>{t("service")}</th><th>{t("duration")}</th><th>{t("price")}</th><th /></tr></thead>
          <tbody>{data.services.map((x) => (
            <tr key={x.id}>
              <td>{lang === "ar" ? x.name_ar : x.name_en}{!x.active && <span className="pill warn"> {s.inactive}</span>}</td>
              <td>{duration(x.duration_minutes, s)}</td>
              <td>{x.price_jod ? `${x.price_is_from ? s.fromPrice + " " : ""}${x.price_jod} ${t("jod")}` : "—"}</td>
              <td><button type="button" className="link" onClick={() => setId(x.id)}>{t("edit")}</button></td>
            </tr>))}</tbody>
        </table></div>
      </section>
      {id && <ServiceForm key={id} service={cur} reload={reload} onDone={() => setId(null)} />}
    </div>
  );
}

function ServiceForm({ service: x, reload, onDone }: { service?: Service; reload: () => Promise<unknown>; onDone: () => void }) {
  const s = useS(); const { t } = useI18n();
  const [f, setF] = useState({ nameEn: x?.name_en || "", nameAr: x?.name_ar || "", descriptionEn: x?.description_en || "", descriptionAr: x?.description_ar || "",
    durationMinutes: x?.duration_minutes ?? 20, priceJod: x?.price_jod ?? "", priceIsFrom: x?.price_is_from ?? false, active: x?.active ?? true });
  const { a, ok, submit } = useSave(reload);
  const inp = (k: "nameEn" | "nameAr" | "descriptionEn" | "descriptionAr") => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <SForm className="panel stack" onSubmit={submit(async () => {
      const body = { ...f, priceJod: f.priceJod === "" ? null : Number(f.priceJod) };
      if (x) await patch(`/api/settings/services/${x.id}`, body); else { await post("/api/settings/services", body); onDone(); }
    })}>
      <h2>{x ? t("edit") : s.newService}</h2>
      <div className="grid2">
        <Field label={s.nameEn}><input {...inp("nameEn")} required /></Field>
        <Field label={s.nameAr}><input {...inp("nameAr")} required /></Field>
        <Field label={s.descEn}><input {...inp("descriptionEn")} /></Field>
        <Field label={s.descAr}><input {...inp("descriptionAr")} /></Field>
        <Field label={`${t("duration")} (${t("min")})`}><input type="number" min={5} max={480} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} required /></Field>
        <Field label={`${t("price")} (${t("jod")})`}><input type="number" min={0} step="0.5" value={f.priceJod} onChange={(e) => setF({ ...f, priceJod: e.target.value })} /></Field>
      </div>
      <Check checked={f.priceIsFrom} onChange={(v) => setF({ ...f, priceIsFrom: v })}>{s.priceFrom}</Check>
      {x && <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })}>{s.active}</Check>}
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

function RuleForm({ rule, reload }: { rule: Rule; reload: () => Promise<unknown> }) {
  const s = useS();
  const staff = rule.audience === "staff";
  const [f, setF] = useState({ minNoticeMinutes: rule.min_notice_minutes, windowDays: rule.window_days, changeNoticeMinutes: rule.change_notice_minutes, maxUpcoming: rule.max_upcoming,
    outsideHours: rule.outside_hours, walkinBackMinutes: rule.walkin_back_minutes, requireCancelReason: rule.require_cancel_reason });
  const { a, ok, submit } = useSave(reload);
  const mins = (list: number[], cur: number) => withCurrent(list, cur).map((m) => [m, m ? duration(m, s) : s.noneOption] as [number, string]);
  return (
    <SForm className="panel stack" onSubmit={submit(() => patch(`/api/settings/rules/${rule.audience}`, staff ? f : { minNoticeMinutes: f.minNoticeMinutes, windowDays: f.windowDays, changeNoticeMinutes: f.changeNoticeMinutes, maxUpcoming: f.maxUpcoming }))}>
      <h2>{staff ? s.rulesStaff : s.rulesPatient}</h2>
      <p className="hint">{staff ? s.rulesStaffHint : s.rulesPatientHint}</p>
      <Field label={s.minNotice}><Pick value={f.minNoticeMinutes} onChange={(v) => setF({ ...f, minNoticeMinutes: Number(v) })} options={mins([0, 30, 60, 120, 240, 720, 1440], f.minNoticeMinutes)} /></Field>
      <Field label={s.window}><Pick value={f.windowDays} onChange={(v) => setF({ ...f, windowDays: Number(v) })} options={withCurrent([7, 14, 30, 60, 90, 365], f.windowDays).map((d) => [d, `${d} ${s.daysUnit}`])} /></Field>
      <Field label={s.changeNotice}><Pick value={f.changeNoticeMinutes} onChange={(v) => setF({ ...f, changeNoticeMinutes: Number(v) })} options={mins([0, 60, 120, 240, 720, 1440], f.changeNoticeMinutes)} /></Field>
      <Field label={s.maxUpcoming} hint={staff ? s.maxUpcomingStaffHint : undefined}><Pick value={f.maxUpcoming ?? ""} onChange={(v) => setF({ ...f, maxUpcoming: v ? Number(v) : null })}
        options={[["", s.noLimit], ...withCurrent([1, 2, 3, 5, 10], f.maxUpcoming).map((n) => [n, String(n)] as [number, string])]} /></Field>
      {staff && <>
        <Field label={s.outsideHours}><Pick value={f.outsideHours} onChange={(v) => setF({ ...f, outsideHours: v })} options={[["warn", s.ohWarn], ["allow", s.ohAllow], ["block", s.ohBlock]]} /></Field>
        <Field label={s.walkinBack}><Pick value={f.walkinBackMinutes} onChange={(v) => setF({ ...f, walkinBackMinutes: Number(v) })} options={mins([0, 30, 60, 120, 240], f.walkinBackMinutes)} /></Field>
        <Check checked={f.requireCancelReason} onChange={(v) => setF({ ...f, requireCancelReason: v })}>{s.requireReason}</Check>
      </>}
      <Saver a={a} ok={ok} />
    </SForm>
  );
}
function RulesTab({ data, reload }: P) {
  const s = useS();
  return (
    <div className="stack">
      <Banner kind="warn">{s.neverOverlap}</Banner>
      <div className="grid2">{["patient", "staff"].map((k) => <RuleForm key={k} rule={data.rules.find((r) => r.audience === k)!} reload={reload} />)}</div>
    </div>
  );
}

// These pages share one settings row, so each saves the whole row with its own fields changed.
function useGeneral({ data, reload }: P) {
  const g = data.general;
  const [f, setF] = useState({ idleTimeoutMinutes: g.idle_timeout_minutes, lockAfterMinutes: g.lock_after_minutes, require2faAll: g.require_2fa_all, conversationVisibility: g.conversation_visibility,
    auditRetentionMonths: g.audit_retention_months, remindersEnabled: g.reminders_enabled, reminderOffsetsMinutes: g.reminder_offsets_minutes, quietStart: g.quiet_start, quietEnd: g.quiet_end,
    assistantEnabled: g.assistant_enabled, afterHoursMessageEn: g.after_hours_message_en || "", afterHoursMessageAr: g.after_hours_message_ar || "", handoffAlertEmails: g.handoff_alert_emails });
  const save = useSave(reload);
  return { f, setF, ...save, onSubmit: save.submit(() => patch("/api/settings/general", f)) };
}

function RemindersTab(p: P) {
  const s = useS();
  const { f, setF, a, ok, onSubmit } = useGeneral(p);
  const [first, second] = f.reminderOffsetsMinutes;
  const opts = p.data.options.reminderMinutes.map((m) => [m, s.before.replace("{t}", duration(m, s))] as [number, string]);
  const set = (x?: number, y?: number) => setF({ ...f, reminderOffsetsMinutes: [x, y].filter((v): v is number => !!v) });
  return (
    <SForm className="panel stack" onSubmit={onSubmit}>
      <h2>{s.tabs.reminders}</h2>
      <Check checked={f.remindersEnabled} onChange={(v) => setF({ ...f, remindersEnabled: v })}>{s.remindersOn}</Check>
      <div className="grid2">
        <Field label={s.reminder1}><Pick value={first ?? ""} onChange={(v) => set(v ? Number(v) : undefined, second)} options={[["", s.noReminder], ...opts]} /></Field>
        <Field label={s.reminder2}><Pick value={second ?? ""} onChange={(v) => set(first, v ? Number(v) : undefined)} options={[["", s.noReminder], ...opts]} /></Field>
        <Field label={s.quietFrom}><input type="time" value={f.quietStart} onChange={(e) => setF({ ...f, quietStart: e.target.value })} required /></Field>
        <Field label={s.quietTo}><input type="time" value={f.quietEnd} onChange={(e) => setF({ ...f, quietEnd: e.target.value })} required /></Field>
      </div>
      <p className="hint">{s.quietHint}</p>
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

function AssistantTab(p: P) {
  const s = useS();
  const { f, setF, a, ok, onSubmit } = useGeneral(p);
  return (
    <SForm className="panel stack" onSubmit={onSubmit}>
      <h2>{s.tabs.assistant}</h2>
      <Check checked={f.assistantEnabled} onChange={(v) => setF({ ...f, assistantEnabled: v })}>{s.assistantOn}</Check>
      <Field label={s.afterEn} hint={s.afterHint}><input value={f.afterHoursMessageEn} maxLength={500} onChange={(e) => setF({ ...f, afterHoursMessageEn: e.target.value })} /></Field>
      <Field label={s.afterAr}><input value={f.afterHoursMessageAr} maxLength={500} onChange={(e) => setF({ ...f, afterHoursMessageAr: e.target.value })} /></Field>
      <Field label={s.alertEmails} hint={s.alertHint}><input value={f.handoffAlertEmails.join(", ")} onChange={(e) => setF({ ...f, handoffAlertEmails: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>
      <Field label={s.visibility} hint={s.visibilityHint}><Pick value={f.conversationVisibility} onChange={(v) => setF({ ...f, conversationVisibility: v })} options={[["none", s.visNone], ["handoff", s.visHandoff], ["all", s.visAll]]} /></Field>
      {f.conversationVisibility === "all" && <Banner kind="warn">{s.visAllWarn}</Banner>}
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

function SecurityTab(p: P) {
  const s = useS();
  const { f, setF, a, ok, onSubmit } = useGeneral(p);
  return (
    <SForm className="panel stack" onSubmit={onSubmit}>
      <h2>{s.tabs.security}</h2>
      <div className="grid2">
        <Field label={s.lockAfter} hint={s.lockHint}><Pick value={f.lockAfterMinutes} onChange={(v) => setF({ ...f, lockAfterMinutes: Number(v) })} options={withCurrent(p.data.options.lockMinutes, f.lockAfterMinutes).map((m) => [m, m ? duration(m, s) : s.offOption])} /></Field>
        <Field label={s.idleAfter}><Pick value={f.idleTimeoutMinutes} onChange={(v) => setF({ ...f, idleTimeoutMinutes: Number(v) })} options={withCurrent(p.data.options.idleMinutes, f.idleTimeoutMinutes).map((m) => [m, duration(m, s)])} /></Field>
      </div>
      <Check checked={f.require2faAll} onChange={(v) => setF({ ...f, require2faAll: v })}>{s.twoStepAll}</Check>
      <p className="hint">{s.twoStepHint}</p>
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

// Settings > AI Scribe (design: booking/design/ai-scribe.html screen 7). Off by default. Every text, limit and section is here.
function ScribeTab({ data, reload }: P) {
  const s = useS();
  const x = s.scribe;
  const { lang } = useI18n();
  const o = data.scribe;
  const active = data.doctors.filter((d) => d.active);
  const [f, setF] = useState({
    enabled: o.enabled, noteLanguage: o.note_language, consentEn: o.consent_en, consentAr: o.consent_ar,
    sections: o.sections.map((z) => ({ ...z, hint: z.hint ?? "" })),
    maxRecordingMinutes: o.max_recording_minutes, transcriptKeepDays: o.transcript_keep_days, notesPerDoctorPerDay: o.notes_per_doctor_per_day,
    speechService: o.speech_service, draftModel: o.draft_model,
    doctors: active.map((d) => ({ id: d.id, scribeEnabled: d.scribe_enabled })),
  });
  const { a, ok, submit } = useSave(reload);
  const setSec = (i: number, p: Partial<ScribeSection>) => setF({ ...f, sections: f.sections.map((z, j) => (j === i ? { ...z, ...p } : z)) });
  const move = (i: number, by: number) => { const l = [...f.sections]; const [it] = l.splice(i, 1); l.splice(i + by, 0, it); setF({ ...f, sections: l }); };
  const num = (k: "maxRecordingMinutes" | "transcriptKeepDays" | "notesPerDoctorPerDay", label: string, hint: string, min: number, max: number) => (
    <Field label={label} hint={hint}><input type="number" min={min} max={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} required /></Field>);
  return (
    <SForm className="stack" onSubmit={submit(() => patch("/api/settings/scribe", f))}>
      <section className="panel stack">
        <div className="row between"><h2>{s.tabs.scribe}</h2><span className={`pill ${o.enabled ? "ok" : ""}`}>{o.enabled ? x.on : x.off}</span></div>
        <Check checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })}>{x.enabled}<br /><small className="hint">{x.enabledHint}</small></Check>
        <h3>{x.doctorsTitle}</h3>
        {active.length ? f.doctors.map((d) => {
          const doc = active.find((z) => z.id === d.id)!;
          return <Check key={d.id} checked={d.scribeEnabled} onChange={(v) => setF({ ...f, doctors: f.doctors.map((z) => (z.id === d.id ? { ...z, scribeEnabled: v } : z)) })}>{lang === "ar" ? doc.name_ar : doc.name_en}</Check>;
        }) : <p className="hint">{x.noDoctors}</p>}
        <Field label={x.language} hint={x.languageHint}>
          <select value={f.noteLanguage} onChange={(e) => setF({ ...f, noteLanguage: e.target.value as "en" | "ar" })}><option value="en">{x.english}</option><option value="ar">{x.arabic}</option></select>
        </Field>
      </section>
      <section className="panel stack">
        <h2>{x.consentTitle}</h2>
        <Field label={x.consentAr}><textarea dir="rtl" lang="ar" rows={3} maxLength={1000} required value={f.consentAr} onChange={(e) => setF({ ...f, consentAr: e.target.value })} /></Field>
        <Field label={x.consentEn}><textarea dir="ltr" lang="en" rows={3} maxLength={1000} required value={f.consentEn} onChange={(e) => setF({ ...f, consentEn: e.target.value })} /></Field>
        <p className="hint">{x.consentHint}</p>
      </section>
      <section className="panel stack">
        <h2>{x.sectionsTitle}</h2>
        <p className="hint">{x.sectionsHint}</p>
        <ol className="sec-list">
          {f.sections.map((z, i) => (
            <li key={z.key} className="sec-item">
              <div className="grid2">
                <Field label={x.nameEn}><input dir="ltr" lang="en" maxLength={80} required value={z.en} onChange={(e) => setSec(i, { en: e.target.value })} /></Field>
                <Field label={x.nameAr}><input dir="rtl" lang="ar" maxLength={80} required value={z.ar} onChange={(e) => setSec(i, { ar: e.target.value })} /></Field>
              </div>
              <Field label={x.hint}><input dir="ltr" lang="en" maxLength={200} value={z.hint} onChange={(e) => setSec(i, { hint: e.target.value })} /></Field>
              <div className="row">
                <button type="button" className="btn btn-ghost btn-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${x.up}: ${lang === "ar" ? z.ar : z.en}`}>↑</button>
                <button type="button" className="btn btn-ghost btn-xs" disabled={i === f.sections.length - 1} onClick={() => move(i, 1)} aria-label={`${x.down}: ${lang === "ar" ? z.ar : z.en}`}>↓</button>
                <button type="button" className="btn btn-outline btn-xs" disabled={f.sections.length <= 1} onClick={() => setF({ ...f, sections: f.sections.filter((_, j) => j !== i) })}>{x.remove}</button>
              </div>
            </li>
          ))}
        </ol>
        <div><button type="button" className="btn btn-ghost btn-xs" disabled={f.sections.length >= 12}
          onClick={() => setF({ ...f, sections: [...f.sections, { key: `s_${Date.now().toString(36)}`, en: x.newEn, ar: x.newAr, hint: "" }] })}>{x.addSection}</button></div>
      </section>
      <section className="panel stack">
        <h2>{x.limitsTitle}</h2>
        <div className="grid2">
          {num("maxRecordingMinutes", x.maxMinutes, x.maxMinutesHint, 5, 120)}
          {num("transcriptKeepDays", x.keepDays, x.keepDaysHint, 1, 365)}
          {num("notesPerDoctorPerDay", x.perDay, x.perDayHint, 1, 500)}
        </div>
        <p className="hint">{x.audioAlways}</p>
      </section>
      <section className="panel stack">
        <h2>{x.servicesTitle}</h2>
        <Field label={x.speech} hint={x.speechHint}><select value={f.speechService} onChange={(e) => setF({ ...f, speechService: e.target.value })}><option value="stand_in">{x.standIn}</option></select></Field>
        <Field label={x.model} hint={x.modelHint}>
          <select value={f.draftModel} onChange={(e) => setF({ ...f, draftModel: e.target.value })}><option value="claude-opus-5-5">{x.opus}</option><option value="claude-sonnet-5-5">{x.sonnet}</option><option value="claude-haiku-5-5">{x.haiku}</option></select>
        </Field>
      </section>
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

// Settings > Online booking: the public page's switch, what patients may do, its limits and its texts. All in one row (online_booking).
function OnlineTab({ data, reload }: P) {
  const s = useS();
  const o = data.online, link = data.onlineLink;
  const [f, setF] = useState({ enabled: o.enabled, staffCheck: o.staff_check, showPrices: o.show_prices, allowAnyDoctor: o.allow_any_doctor, allowCancel: o.allow_cancel,
    allowReschedule: o.allow_reschedule, allowForOther: o.allow_for_other, offerReminders: o.offer_reminders, defaultCountryCode: o.default_country_code,
    maxUncheckedPerPhone: o.max_unchecked_per_phone, bookingsPerPhonePerDay: o.bookings_per_phone_per_day, bookingsPerIpPerDay: o.bookings_per_ip_per_day,
    lookupsPerIpPerMinute: o.lookups_per_ip_per_minute, managePerIpPerHour: o.manage_per_ip_per_hour, daysPerPage: o.days_per_page,
    introEn: o.intro_en || "", introAr: o.intro_ar || "", doneNoteEn: o.done_note_en || "", doneNoteAr: o.done_note_ar || "",
    shareMessageEn: o.share_message_en, shareMessageAr: o.share_message_ar, privacyUrl: o.privacy_url,
    findEnabled: o.find_enabled, findPerPhonePerDay: o.find_per_phone_per_day, findPerIpPerHour: o.find_per_ip_per_hour,
    findMessageEn: o.find_message_en, findMessageAr: o.find_message_ar,
    chatEnabled: o.chat_enabled, chatMessagesPerChat: o.chat_messages_per_chat, chatChatsPerIpPerDay: o.chat_chats_per_ip_per_day,
    chatMessagesPerClinicPerDay: o.chat_messages_per_clinic_per_day, chatKeepDays: o.chat_keep_days,
    brochureColour: o.brochure_colour, brochureCardLanguages: o.brochure_card_languages, brochureShowAi: o.brochure_show_ai });
  type K = keyof typeof f;
  const { a, ok, submit } = useSave(reload);
  const sw = (k: K, label: string, hint?: string) => (
    <Check checked={!!f[k]} onChange={(v) => setF({ ...f, [k]: v })}>{label}{hint && <><br /><small className="hint">{hint}</small></>}</Check>);
  const num = (k: K, label: string, hint: string, min: number, max: number) => (
    <Field label={label} hint={hint}><input type="number" min={min} max={max} value={Number(f[k])} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} required /></Field>);
  const txt = (k: K, label: string, dir: "rtl" | "ltr", required = false, hint?: string) => (
    <Field label={label} hint={hint}><textarea dir={dir} rows={2} maxLength={500} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={required} /></Field>);
  return (
    <SForm className="stack" onSubmit={submit(() => patch("/api/settings/online", f))}>
      <section className="panel stack">
        <div className="row between"><h2>{s.tabs.online}</h2><span className={`pill ${o.enabled ? "ok" : ""}`}>{o.enabled ? s.onlineOn : s.onlineOff}</span></div>
        <LinkBox link={link} />
        {sw("enabled", s.onlineEnabled, s.onlineEnabledHint)}
      </section>
      <section className="panel stack">
        <h2>{s.brochures}</h2>
        <p className="hint">{s.brochuresHint}</p>
        {/* Each opens at its real size, with the clinic's QR tagged ?from=<design>; the browser's own "Save as PDF" makes the file. */}
        <div className="brochures">
          {DESIGNS.map((d) => (
            <div key={d} className="brochure">
              <span className="size mono">{s.brochureSizes[d]}</span>
              <b>{s.brochureNames[d]}</b>
              <span className="hint mono">?from={d}</span>
              {link.url
                ? <a className="btn btn-ink btn-sm" href={`/print/${d}`} target="_blank" rel="noopener">{s.brochureOpen}</a>
                : <span className="hint">{s.linkNotSet}</span>}
            </div>
          ))}
        </div>
        <Field label={s.brochureColour} hint={s.brochureColourHint}>
          <div className="swatches" role="radiogroup" aria-label={s.brochureColour}>
            {SWATCHES.map((c) => <button key={c} type="button" role="radio" aria-checked={f.brochureColour.toLowerCase() === c.toLowerCase()} aria-label={s.swatchNames[c] ?? c} title={s.swatchNames[c] ?? c}
              className={`swatch${f.brochureColour.toLowerCase() === c.toLowerCase() ? " on" : ""}`} style={{ background: c }} onClick={() => setF({ ...f, brochureColour: c })} />)}
          </div>
        </Field>
        <Field label={s.brochureLangs} hint={s.brochureLangsHint}>
          <select value={f.brochureCardLanguages} onChange={(e) => setF({ ...f, brochureCardLanguages: e.target.value as typeof f.brochureCardLanguages })}>
            <option value="ar_en">{s.langsArEn}</option><option value="ar">{s.langsAr}</option><option value="en">{s.langsEn}</option>
          </select>
        </Field>
        {sw("brochureShowAi", s.brochureAi, s.brochureAiHint)}
        <p className="hint">{s.brochureSaveFirst}</p>
      </section>
      <section className="panel stack">
        <h2>{s.whatPatients}</h2>
        {sw("staffCheck", s.staffCheck, s.staffCheckHint)}
        {sw("showPrices", s.showPrices, s.showPricesHint)}
        {sw("allowAnyDoctor", s.allowAny)}
        {sw("allowCancel", s.allowCancel, s.allowCancelHint)}
        {sw("allowReschedule", s.allowReschedule, s.allowRescheduleHint)}
        {sw("allowForOther", s.allowForOther, s.allowForOtherHint)}
        {sw("offerReminders", s.offerReminders)}
        <Field label={s.countryCode} hint={s.countryCodeHint}><input className="mono" dir="ltr" inputMode="numeric" pattern="[1-9][0-9]{0,3}" style={{ maxWidth: 140 }} required
          value={f.defaultCountryCode} onChange={(e) => setF({ ...f, defaultCountryCode: e.target.value.replace(/\D/g, "") })} /></Field>
        <p className="hint">{s.sharedRules}</p>
      </section>
      <section className="panel stack">
        <h2>{s.limits}</h2>
        <div className="grid2">
          {num("maxUncheckedPerPhone", s.maxUnchecked, s.maxUncheckedHint, 1, 20)}
          {num("bookingsPerPhonePerDay", s.perPhoneDay, s.perPhoneDayHint, 1, 50)}
          {num("bookingsPerIpPerDay", s.perIpDay, s.perIpDayHint, 1, 200)}
          {num("lookupsPerIpPerMinute", s.lookupsPerMin, s.lookupsPerMinHint, 5, 1000)}
          {num("managePerIpPerHour", s.managePerHour, s.managePerHourHint, 5, 1000)}
          {num("daysPerPage", s.daysPerPage, s.daysPerPageHint, 1, 31)}
        </div>
      </section>
      <section className="panel stack">
        <h2>{s.texts}</h2>
        <p className="hint">{s.textsHint}</p>
        <div className="grid2">
          {txt("introAr", s.introAr, "rtl")}{txt("introEn", s.introEn, "ltr")}
          {txt("doneNoteAr", s.doneAr, "rtl")}{txt("doneNoteEn", s.doneEn, "ltr")}
          {txt("shareMessageAr", s.shareAr, "rtl", true, s.shareHint)}{txt("shareMessageEn", s.shareEn, "ltr", true)}
        </div>
        <Field label={s.privacyUrl} hint={s.privacyUrlHint}><input type="url" dir="ltr" className="mono" pattern="https://.*" maxLength={300} required value={f.privacyUrl} onChange={(e) => setF({ ...f, privacyUrl: e.target.value })} /></Field>
      </section>
      <section className="panel stack">
        <div className="row between"><h2>{s.findTitle}</h2>
          <span className={`pill ${o.whatsapp_connected ? "ok" : "warn"}`}>{o.whatsapp_connected ? s.waConnected : s.waNotConnected}</span></div>
        {/* It sends by WhatsApp, so it can be switched on only once the clinic's WhatsApp number is connected. */}
        <Check checked={f.findEnabled} disabled={!o.whatsapp_connected && !f.findEnabled} onChange={(v) => setF({ ...f, findEnabled: v })}>
          {s.findOn}<br /><small className="hint">{s.findOnHint}</small></Check>
        {!o.whatsapp_connected && <p className="warntext">{s.findNeedsWa}</p>}
        <div className="grid2">
          {num("findPerPhonePerDay", s.findPerPhone, s.findPerPhoneHint, 1, 20)}
          {num("findPerIpPerHour", s.findPerIp, s.findPerIpHint, 1, 200)}
        </div>
        <div className="grid2">
          <Field label={s.findMsgAr} hint={s.findMsgHint}><textarea dir="rtl" rows={3} maxLength={600} required value={f.findMessageAr} onChange={(e) => setF({ ...f, findMessageAr: e.target.value })} /></Field>
          <Field label={s.findMsgEn}><textarea dir="ltr" rows={3} maxLength={600} required value={f.findMessageEn} onChange={(e) => setF({ ...f, findMessageEn: e.target.value })} /></Field>
        </div>
      </section>
      <section className="panel stack">
        <div className="row between"><h2>{s.chatTitle}</h2><span className={`pill ${o.chat_enabled ? "ok" : ""}`}>{o.chat_enabled ? s.onlineOn : s.onlineOff}</span></div>
        {sw("chatEnabled", s.chatOn, s.chatOnHint)}
        <div className="grid2">
          {num("chatMessagesPerChat", s.chatPerChat, s.chatPerChatHint, 5, 200)}
          {num("chatChatsPerIpPerDay", s.chatPerIp, s.chatPerIpHint, 1, 100)}
          {num("chatMessagesPerClinicPerDay", s.chatPerClinic, s.chatPerClinicHint, 10, 100000)}
          {num("chatKeepDays", s.chatKeep, s.chatKeepHint, 1, 365)}
        </div>
        <p className="hint">{s.chatCallbacks}</p>
        <Check checked={false} disabled onChange={() => {}}>{s.chatVoice}<br /><small className="hint">{s.chatVoiceHint}</small></Check>
      </section>
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

// The link, with Copy, a QR code drawn in the browser (nothing is sent elsewhere) and a PNG download for printing.
function LinkBox({ link }: { link: OnlineLink }) {
  const s = useS();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (link.qrUrl && canvas.current) void QRCode.toCanvas(canvas.current, link.qrUrl, { width: 264, margin: 1, errorCorrectionLevel: "M" }); }, [link.qrUrl]);
  if (!link.url) return <Banner kind="warn">{s.linkNotSet}</Banner>;
  const shown = link.url.replace(/^https?:\/\//, "");
  const png = () => { const el = document.createElement("a"); el.href = canvas.current!.toDataURL("image/png"); el.download = `booking-qr-${shown.split("/").pop()}.png`; el.click(); };
  return (
    <div className="qrbox">
      <div className="stack grow" style={{ minWidth: 0 }}>
        <b>{s.linkTitle}</b><span className="hint">{s.linkHint}</span>
        <div className="linkbox">{shown}</div>
        <div className="row">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void navigator.clipboard?.writeText(link.url!).then(() => setCopied(true))}>{copied ? s.copied : s.copyLink}</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={png}>{s.downloadQr}</button>
          <a className="btn btn-outline btn-sm" href={link.url} target="_blank" rel="noopener">{s.openPage}</a>
        </div>
      </div>
      <canvas ref={canvas} aria-label="QR" />
    </div>
  );
}

function AuditTab(p: P) {
  const s = useS();
  const { can } = useApp();
  const { f, setF, a, ok, onSubmit } = useGeneral(p);
  return (
    <SForm className="panel stack" onSubmit={onSubmit}>
      <h2>{s.tabs.audit}</h2>
      {can("booking.audit.view") && <p className="row"><span className="grow">{s.auditLogHint}</span><Link className="btn btn-outline btn-sm" to="/audit">{s.openAuditLog}</Link></p>}
      <Field label={s.retention} hint={s.retentionHint}><Pick value={f.auditRetentionMonths ?? ""} onChange={(v) => setF({ ...f, auditRetentionMonths: v ? Number(v) : null })}
        options={[["", s.keepForever], ...withCurrent([12, 24, 60, 84, 120], f.auditRetentionMonths).map((m) => [m, m % 12 ? `${m} ${s.monthsUnit}` : `${m / 12} ${m === 12 ? s.yearUnit : s.yearsUnit}`] as [number, string])]} /></Field>
      <Saver a={a} ok={ok} />
    </SForm>
  );
}
