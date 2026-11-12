// Online visits on the booking page and the visit note (design: booking/design/online-visits.html, screens 8, 10 and the printed slip).
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useNavigate } from "react-router-dom";
import { get, post, type Appt } from "../api";
import { addDays, dayOf, fmtDateTime, fmtShortDate, hm, todayIn } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, useAction } from "../ui";
import { Cam } from "./form";
import { fill, useOV } from "./online-text";

type Sent = { id: string; channel: string; sent_to: string | null; sent_at: string; sent_by_name: string | null; first_opened_at: string | null; opens: number; stopped_at: string | null };
type SendResult = { channel: string; url: string; message: string; phone?: string | null; sentTo?: string; language: "ar" | "en";
  slip?: { opensMinutes: number; size: "a6" | "a5"; languages: "patient" | "ar_en"; clinicPhone: string | null; howToEn: string; howToAr: string } };

// ---------------------------------------------------------------- the online part of the booking page
export function OnlineBox({ a, onChange }: { a: Appt; onChange: (a: Appt) => void }) {
  const t = useOV(); const { lang } = useI18n();
  const { look, me, can } = useApp();
  const tz = look.clinic.timezone;
  const on = look.online;
  const [sent, setSent] = useState<Sent[]>([]);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState("");
  const [slip, setSlip] = useState<SendResult | null>(null);
  const act = useAction();
  const loadSent = () => get<Sent[]>(`/api/appointments/${a.id}/join-links`).then(setSent).catch(() => {});
  useEffect(() => { void loadSent(); }, [a.id, a.row_version]);                // eslint-disable-line react-hooks/exhaustive-deps
  if (a.visit_type !== "online") return null;
  const active = a.status === "booked" || a.status === "confirmed";
  const mayEdit = can("booking.appointments.edit");
  const theDoctor = me.doctorId === a.doctor_id || me.role === "clinic_admin";
  const chans = (on?.channels ?? []).filter((c) => c !== "sms");
  const send = (channel: string) => act.run(async () => {
    setMenu(false); setNote("");
    const r = await post<SendResult>(`/api/appointments/${a.id}/join-link`, { channel });
    if (channel === "whatsapp") {
      const digits = (r.phone || "").replace(/\D/g, "");
      if (digits) window.open(`https://wa.me/${digits}?text=${encodeURIComponent(r.message)}`, "_blank", "noopener");
      else { await navigator.clipboard?.writeText(r.message); setNote(t.copied); }
    } else if (channel === "copy") { await navigator.clipboard?.writeText(r.url); setNote(t.copied); }
    else if (channel === "email") setNote(fill(t.emailSent, { email: r.sentTo ?? "" }));
    else if (channel === "print") setSlip(r);
    await loadSent();
  });
  const name = (c: string) => t.chName[c] ?? c;
  return (
    <section className="panel stack">
      <div className="row between"><h2><Cam size={16} /> {t.pill}</h2><span className="pill vt">{t.modeShort[a.online_mode ?? "audio"]}</span></div>
      <p className="hint">{fill(t.visitLine, { mode: t.modeShort[a.online_mode ?? "audio"] })}
        {a.online_consent_at ? ` · ${fill(t.consentAt, { when: fmtDateTime(a.online_consent_at, tz, lang) })}` : ""}</p>
      {a.status === "confirmed" && sent.length === 0 && a.link_channel !== "email" && <Banner kind="warn">{t.sendAfterConfirm}</Banner>}
      <div>
        <b className="lbl">{t.sentTitle}</b>
        {sent.length === 0 ? <p className="hint">{t.notSent}</p> : (
          <ul className="sentlog">{sent.map((x) => (
            <li key={x.id}><b>{x.channel === "copy" ? t.copy : name(x.channel)}</b>
              <span className="hint">{fmtDateTime(x.sent_at, tz, lang)}{x.sent_to ? ` · ${x.sent_to}` : ""}{x.sent_by_name ? ` · ${x.sent_by_name}` : ""}</span>
              <span className="hint">· {x.stopped_at ? t.stopped : x.first_opened_at ? fill(t.opened, { when: fmtDateTime(x.first_opened_at, tz, lang) }) : t.notOpened}</span></li>))}</ul>)}
      </div>
      {active && <div className="row">
        {theDoctor && a.join_url && <a className="btn btn-accent btn-sm" href={a.join_url} target="_blank" rel="noopener noreferrer"><Cam size={16} /> {t.start}</a>}
        {mayEdit && <div className="sendmenu">
          <button type="button" className="btn btn-wa btn-sm" aria-haspopup="menu" aria-expanded={menu} disabled={act.busy} onClick={() => setMenu(!menu)}>{t.sendMenu} ▾</button>
          {menu && <div className="um-list" role="menu">
            {chans.includes("whatsapp") && <button type="button" role="menuitem" onClick={() => void send("whatsapp")}>{t.sendWa}</button>}
            <button type="button" role="menuitem" disabled>{t.sendSms} <small>{t.notSetUp}</small></button>
            {chans.includes("email") && <button type="button" role="menuitem" disabled={!a.link_email && !a.patient_email} onClick={() => void send("email")}>
              {t.sendEmail} <small className="mono">{a.link_email || a.patient_email || t.noEmail}</small></button>}
            {chans.includes("print") && <button type="button" role="menuitem" onClick={() => void send("print")}>{t.sendPrint}</button>}
            <button type="button" role="menuitem" onClick={() => void send("copy")}>{t.copy}</button>
          </div>}
        </div>}
        {mayEdit && <label className="check" style={{ alignItems: "center" }}>
          <input type="checkbox" style={{ marginTop: 0 }} checked={!!a.identity_checked_at} disabled={act.busy}
            onChange={(e) => void act.run(async () => onChange(await post<Appt>(`/api/appointments/${a.id}/identity`, { checked: e.target.checked, expectedVersion: a.row_version })))} />
          <span>{t.identity}</span></label>}
      </div>}
      {a.identity_checked_at && <p className="hint">{fill(t.identityBy, { name: a.identity_checked_by_name ?? "", when: fmtDateTime(a.identity_checked_at, tz, lang) })}</p>}
      {note && <Banner kind="ok">{note}</Banner>}
      {act.err && <Banner>{act.message}</Banner>}
      {slip && <Slip r={slip} a={a} onClose={() => setSlip(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------- "Book the next visit" (completed bookings and signed notes)
export function NextVisitBox({ id, appt }: { id: string; appt?: Appt }) {
  const t = useOV(); const { lang } = useI18n();
  const { look, can } = useApp();
  const nav = useNavigate();
  const tz = look.clinic.timezone;
  const on = look.online?.enabled ? look.online : null;
  const [a, setA] = useState<Appt | null>(appt ?? null);
  useEffect(() => { if (appt) setA(appt); else get<Appt>(`/api/appointments/${id}`).then(setA).catch(() => {}); }, [id, appt]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [daysN, setDaysN] = useState<number | null>(null);
  const [mode, setMode] = useState<string>("");
  const act = useAction();
  if (!a || !can("booking.appointments.create")) return null;
  const canOnline = !!on && !!a.service_online && !!a.doctor_online;
  const isOnline = online ?? (canOnline && !!a.next_online && !a.next_online_used_by);
  const choices = on?.nextVisitDays?.length ? on.nextVisitDays : [7, 14, 30];
  const label = (n: number) => (n === 7 ? t.in7 : n === 14 ? t.in14 : n === 30 ? t.in30 : fill(t.inDays, { n }));
  const shownMode = mode || a.next_online_mode || on?.mode || "audio";
  const base = dayOf(a.starts_at, tz) > todayIn(tz) ? dayOf(a.starts_at, tz) : todayIn(tz);
  const tick = (checked: boolean) => act.run(async () => {
    const r = await post<Appt>(`/api/appointments/${a.id}/next-online`, { on: checked, mode: checked ? shownMode : null, expectedVersion: a.row_version });
    setA(r); setOnline(checked);
  });
  const go = () => {
    const q = new URLSearchParams({ patient: a.patient_id, doctor: a.doctor_id, service: a.service_id });
    if (daysN) q.set("date", addDays(base, daysN));
    if (isOnline) { q.set("online", "1"); if (shownMode !== "patient") q.set("mode", shownMode); }
    nav(`/new?${q}`, { state: { from: `/bookings/${a.id}` } });
  };
  return (
    <div className="nextbox">
      <b>{t.nextTitle}</b>
      <div className="row">
        {canOnline && <div className="seg" role="radiogroup">
          <button type="button" role="radio" aria-checked={!isOnline} className={!isOnline ? "on" : ""} onClick={() => setOnline(false)}>{t.atClinic}</button>
          <button type="button" role="radio" aria-checked={isOnline} className={isOnline ? "on" : ""} onClick={() => setOnline(true)}>{t.online}</button></div>}
        <div className="chips" style={{ margin: 0 }}>
          {choices.map((n) => <button key={n} type="button" className={`chip ${daysN === n ? "on" : ""}`} onClick={() => setDaysN(n)}>{label(n)}</button>)}
          <button type="button" className={`chip ${daysN === null ? "on" : ""}`} onClick={() => setDaysN(null)}>{t.otherDate}</button>
        </div>
      </div>
      {canOnline && isOnline && can("booking.appointments.edit") && <>
        <label className="check"><input type="checkbox" checked={!!a.next_online && !a.next_online_used_by} disabled={act.busy || !!a.next_online_used_by} onChange={(e) => void tick(e.target.checked)} />
          <span><b>{t.nextOnline}</b> {t.thisTimeOnly}<br /><small className="hint">{t.nextHint}</small></span></label>
        <div className="row" style={{ paddingInlineStart: 30 }}><b className="lbl">{t.modeField}</b>
          <div className="seg" role="radiogroup">{(["video", "audio", "patient"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={shownMode === m} className={shownMode === m ? "on" : ""} disabled={act.busy}
              onClick={() => { setMode(m); if (a.next_online && !a.next_online_used_by) void act.run(async () => setA(await post<Appt>(`/api/appointments/${a.id}/next-online`, { on: true, mode: m, expectedVersion: a.row_version }))); }}>
              {t.modeShort[m]}</button>))}</div></div>
      </>}
      {a.next_online && a.next_online_by_name && a.next_online_at && !a.next_online_used_by &&
        <p className="hint">{fill(t.nextSet, { name: a.next_online_by_name, when: fmtShortDate(dayOf(a.next_online_at, tz), lang) })}</p>}
      {a.next_online_used_by && a.next_online_used_at && <p className="hint">{fill(t.nextUsed, { when: fmtDateTime(a.next_online_used_at, tz, lang) })}</p>}
      <div className="row"><button type="button" className="btn btn-accent btn-sm" onClick={go}>{t.choose}</button></div>
      {act.err && <Banner>{act.message}</Banner>}
    </div>
  );
}

// ---------------------------------------------------------------- the printed slip with a QR code (made in the browser)
function Slip({ r, a, onClose }: { r: SendResult; a: Appt; onClose: () => void }) {
  const { look, me } = useApp();
  const tz = look.clinic.timezone;
  const t = useOV();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (canvas.current) void QRCode.toCanvas(canvas.current, r.url, { width: 220, margin: 1, errorCorrectionLevel: "M" }); }, [r.url]);
  const langs: ("ar" | "en")[] = r.slip?.languages === "ar_en" ? ["ar", "en"] : [r.language];
  const when = (l: "ar" | "en") => `${new Intl.DateTimeFormat(l === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(a.starts_at))} · ${hm(a.starts_at, tz)}`;
  return (
    <div className="modal slipmodal" role="dialog" aria-modal="true">
      <div className="slipwrap">
        <div className={`slip ${r.slip?.size === "a5" ? "a5" : ""}`}>
          <div className="top"><img src="/logo/limitsiz-mark-ink.svg" alt="" width="28" height="14" /><b>{langs.map((l) => (l === "ar" ? me.clinic.nameAr : me.clinic.nameEn)).join(" · ")}</b></div>
          {langs.map((l) => <SlipText key={l} l={l} a={a} when={when(l)} r={r} />)}
          <div className="qrz"><canvas ref={canvas} /><span className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{r.url.replace(/^https?:\/\//, "").replace(/#.*/, "")}</span></div>
          <div className="foot"><span>{langs.map((l) => (l === "ar" ? "ليست للطوارئ" : "Not for emergencies")).join(" · ")}</span>{r.slip?.clinicPhone && <span className="mono">{r.slip.clinicPhone}</span>}</div>
        </div>
        <div className="row noprint" style={{ justifyContent: "center", marginTop: 12 }}>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => window.print()}>{t.printIt}</button>
          <button type="button" className="btn btn-outline btn-sm" style={{ background: "#fff" }} onClick={onClose}>{t.backToBooking}</button>
        </div>
      </div>
    </div>
  );
}
function SlipText({ l, a, when, r }: { l: "ar" | "en"; a: Appt; when: string; r: SendResult }) {
  const T = l === "ar"
    ? { title: "زيارتك أونلاين", scan: `امسح الرمز بكاميرا هاتفك من قبل الموعد بـ${r.slip?.opensMinutes ?? 10} دقيقة. يفتح زيارتك على Microsoft Teams.`, s1: "نزّل تطبيق Microsoft Teams المجاني الآن.", s2: "«الانضمام كضيف»، اكتب اسمك، وانتظر الطبيب." }
    : { title: "Your online visit", scan: `Scan with your phone's camera from ${r.slip?.opensMinutes ?? 10} minutes before. It opens your visit on Microsoft Teams.`, s1: "Install the free Microsoft Teams app now.", s2: "“Join as a guest”, type your name, wait for the doctor." };
  return (
    <div dir={l === "ar" ? "rtl" : "ltr"} lang={l} className="sliptext">
      <h3>{T.title}</h3>
      <div><b>{l === "ar" ? a.doctor_name_ar : a.doctor_name_en}</b> · {when}</div>
      <p>{T.scan}</p>
      <ol><li>{T.s1}</li><li>{T.s2}</li></ol>
    </div>
  );
}
