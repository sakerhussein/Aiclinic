// The online booking page: book.limitsiz.si/<clinic> (Choose it yourself) and /<clinic>/manage#<token> (the private link).
// Everything it may show, every limit and its texts come from the clinic's Settings > Online booking, through the public server.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { TEXT, type Lang, type Tx } from "./text";

// ---------------------------------------------------------------- types and the server
type Service = { id: string; name_en: string; name_ar: string; duration_minutes: number; price_jod: string | null; price_is_from: boolean };
type Doctor = { id: string; name_en: string; name_ar: string; title_en: string | null; title_ar: string | null; service_ids: string[] };
type Info = {
  clinic: { slug: string; nameEn: string; nameAr: string; phone: string | null; addressEn: string | null; addressAr: string | null; timezone: string; defaultLanguage: Lang };
  services: Service[]; doctors: Doctor[];
  options: { allowAnyDoctor: boolean; allowForOther: boolean; offerReminders: boolean; daysPerPage: number; windowDays: number; countryCode: string;
             introEn: string | null; introAr: string | null; doneNoteEn: string | null; doneNoteAr: string | null; privacyUrl: string };
};
type Summary = {
  id: string; startsAt: string; endsAt: string; status: string; shownStatus?: string; name: string | null; waitingForCheck: boolean;
  service: { id: string; nameEn: string; nameAr: string; durationMinutes: number };
  doctor: { id: string; nameEn: string; nameAr: string; titleEn: string | null; titleAr: string | null };
  clinic: { slug: string; nameEn: string; nameAr: string; phone: string | null; addressEn: string | null; addressAr: string | null; timezone: string;
            doneNoteEn: string | null; doneNoteAr: string | null; daysPerPage: number; windowDays: number };
  canCancel: boolean; canReschedule: boolean; tooLateToChange: boolean; changeNoticeMinutes?: number; manageToken?: string;
};
type Slot = { doctorId: string; startsAt: string };
class Fail extends Error { constructor(public status: number, public code: string) { super(code); } }

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Fail(0, "server_error"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Fail(r.status, j.error || "server_error");
  return j as T;
}
function message(e: unknown, x: Tx) {
  const c = e instanceof Fail ? e.code : "server_error";
  return ({ slot_taken: x.slotTaken, too_many_requests: x.tooMany, invalid_phone: x.invalidPhone, invalid_input: x.invalidInput,
            link_not_found: x.linkNotFound, clinic_not_found: x.clinicNotFound } as Record<string, string>)[c] ?? x.serverError;
}

// ---------------------------------------------------------------- dates in the clinic's time zone
const loc = (l: Lang) => (l === "ar" ? "ar-JO-u-nu-latn" : "en-GB");
const dayKey = (iso: string | Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const hm = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const longDate = (iso: string, tz: string, l: Lang) => new Intl.DateTimeFormat(loc(l), { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const dayParts = (d: string, l: Lang) => {
  const at = new Date(d + "T12:00:00Z");
  return { wd: new Intl.DateTimeFormat(loc(l), { timeZone: "UTC", weekday: "short" }).format(at), n: new Intl.DateTimeFormat(loc(l), { timeZone: "UTC", day: "numeric" }).format(at),
           month: new Intl.DateTimeFormat(loc(l), { timeZone: "UTC", month: "long", year: "numeric" }).format(at) };
};
function spell(m: number, x: Tx) {
  if (m >= 1440 && m % 1440 === 0) { const d = m / 1440; return `${d} ${d === 1 ? x.day : x.days}`; }
  if (m >= 60 && m % 60 === 0) { const h = m / 60; return `${h} ${h === 1 ? x.hour : x.hours}`; }
  return `${m} ${x.minutes}`;
}

// "Add to calendar": a small .ics file made here, nothing sent anywhere.
// The calendar entry carries the private link, so a patient who saved the appointment always finds it again.
function icsHref(s: Summary, l: Lang, x: Tx, link: string) {
  const z = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (v: string) => v.replace(/[\\,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  // Lines longer than 75 bytes are folded (RFC 5545); 60 characters keeps Arabic under the limit too.
  const fold = (line: string) => { const out = []; for (let i = 0; i < line.length; i += 60) out.push((i ? " " : "") + line.slice(i, i + 60)); return out.join("\r\n"); };
  const clinic = l === "ar" ? s.clinic.nameAr : s.clinic.nameEn, svc = l === "ar" ? s.service.nameAr : s.service.nameEn;
  const doctor = l === "ar" ? s.doctor.nameAr : s.doctor.nameEn;
  const where = (l === "ar" ? s.clinic.addressAr : s.clinic.addressEn) || clinic;
  const note = [doctor, x.calLink.replace("{link}", link), s.clinic.phone ? `${x.callClinic}: ${s.clinic.phone}` : ""].filter(Boolean).join("\n");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Limitsiz//Online booking//EN", "BEGIN:VEVENT", `UID:${s.id}@limitsiz`, `DTSTAMP:${z(new Date().toISOString())}`,
    `DTSTART:${z(s.startsAt)}`, `DTEND:${z(s.endsAt)}`, `SUMMARY:${esc(`${svc} · ${clinic}`)}`, `LOCATION:${esc(where)}`,
    `DESCRIPTION:${esc(note)}`, `URL:${link}`, "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n");
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(body);
}

// "Save the link": the phone's own share menu (WhatsApp, messages, notes, email); WhatsApp where there is none (computers).
function ShareLink({ s, x, lang, link }: { s: Summary; x: Tx; lang: Lang; link: string }) {
  const [copied, setCopied] = useState(false);
  const clinic = lang === "ar" ? s.clinic.nameAr : s.clinic.nameEn;
  const when = `${longDate(s.startsAt, s.clinic.timezone, lang)}${lang === "ar" ? "، " : ", "}${hm(s.startsAt, s.clinic.timezone)}`;
  const text = x.shareText.replace("{clinic}", clinic).replace("{when}", when);
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: clinic, text, url: link }); return; } catch (e) { if ((e as Error).name === "AbortError") return; } }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}`, "_blank", "noopener");
  };
  return (
    <div className="bk-field">{x.privateLink}
      <button type="button" className="bk-btn wa" onClick={() => void share()}>{x.saveLink}</button>
      <div className="bk-link"><span className="mono">{link.replace(/^https?:\/\//, "")}</span>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? x.copied : x.copy}</button></div>
      <small>{x.privateHint}</small>
    </div>
  );
}

// ---------------------------------------------------------------- language
function useLang(fallback?: Lang) {
  const stored = (() => { try { const v = localStorage.getItem("lc_book_lang"); return v === "ar" || v === "en" ? v : null; } catch { return null; } })();
  const [lang, setL] = useState<Lang>(stored ?? fallback ?? "ar");
  useEffect(() => { if (!stored && fallback) setL(fallback); }, [fallback]);            // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"; }, [lang]);
  const setLang = (l: Lang) => { setL(l); try { localStorage.setItem("lc_book_lang", l); } catch { /* storage blocked */ } };
  return { lang, setLang, x: TEXT[lang] };
}

const Mark = () => (
  <svg width="28" height="14" viewBox="0 0 40 20" aria-hidden="true"><path d="M20 10 C16.6 5.5 13.2 2 8.8 2 A8 8 0 0 0 8.8 18 C13.2 18 16.6 14.5 20 10 C23.4 5.5 26.8 2 31.2 2 A8 8 0 0 1 38.4 12.9" fill="none" stroke="#2EE6B5" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="33.6" cy="17.2" r="1.8" fill="#2EE6B5" /></svg>
);
function Shell({ name, place, lang, setLang, x, privacyUrl, children }: { name: string; place?: string | null; lang: Lang; setLang: (l: Lang) => void; x: Tx; privacyUrl?: string; children: ReactNode }) {
  return (
    <main className="bk">
      <header className="bk-head">
        <div className="bk-logo"><Mark /></div>
        <div className="bk-name"><b>{name}</b>{place && <span>{place}</span>}</div>
        <button type="button" className="bk-lang" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{x.langSwitch}</button>
      </header>
      {children}
      <footer className="bk-foot">{x.bookedBy} <b className="bk-brand">Limitsiz</b>{privacyUrl && <> · <a href={privacyUrl} target="_blank" rel="noopener noreferrer">{x.privacy}</a></>}</footer>
    </main>
  );
}
const Steps = ({ n }: { n: number }) => <div className="bk-steps" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? "on" : ""} />)}</div>;
const Banner = ({ kind, children }: { kind: "warn" | "bad" | "ok" | "info"; children: ReactNode }) => <div className={`bk-banner ${kind}`} role={kind === "bad" ? "alert" : "status"}>{children}</div>;
const Phone = ({ n }: { n: string }) => <a className="mono" href={`tel:${n.replace(/[^\d+]/g, "")}`} dir="ltr">{n}</a>;

// ---------------------------------------------------------------- the day strip and free times (booking and changing)
function DayTimes({ x, lang, tz, perPage, windowDays, load, chosen, onChoose }: {
  x: Tx; lang: Lang; tz: string; perPage: number; windowDays: number; load: (from: string, days: number) => Promise<Slot[]>; chosen: Slot | null; onChoose: (s: Slot) => void;
}) {
  const today = dayKey(new Date(), tz);
  const [start, setStart] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setSlots(null); setErr("");
    load(start, perPage).then((s) => {
      if (!live) return;
      setSlots(s);
      setDay((d) => (d && s.some((v) => dayKey(v.startsAt, tz) === d) ? d : s.length ? dayKey(s[0].startsAt, tz) : null));
    }).catch((e) => live && (setErr(message(e, x)), setSlots([])));
    return () => { live = false; };
  }, [start, perPage, load, tz]);                                          // eslint-disable-line react-hooks/exhaustive-deps
  const days = Array.from({ length: perPage }, (_, i) => addDays(start, i));
  const last = addDays(today, windowDays);
  const byDay = (d: string) => (slots ?? []).filter((s) => dayKey(s.startsAt, tz) === d);
  // One time per start: with "any doctor" several doctors may be free at once; the server picks one.
  const times = day ? byDay(day).filter((s, i, a) => a.findIndex((o) => o.startsAt === s.startsAt) === i) : [];
  return (
    <div className="bk-stack">
      <div className="bk-nav">
        <button type="button" disabled={start <= today} onClick={() => setStart(addDays(start, -perPage) < today ? today : addDays(start, -perPage))}><span className="flip">‹</span> {x.earlier}</button>
        <b>{dayParts(day ?? start, lang).month}</b>
        <button type="button" disabled={addDays(start, perPage) > last} onClick={() => setStart(addDays(start, perPage))}>{x.later} <span className="flip">›</span></button>
      </div>
      <div className="bk-days" style={{ gridTemplateColumns: `repeat(${Math.min(perPage, 7)}, 1fr)` }}>
        {days.map((d) => { const p = dayParts(d, lang), has = byDay(d).length > 0;
          return <button type="button" key={d} disabled={!has} className={d === day ? "on" : ""} onClick={() => setDay(d)} aria-pressed={d === day}>{p.wd}<b>{p.n}</b></button>; })}
      </div>
      {err && <Banner kind="bad">{err}</Banner>}
      {slots === null ? <p className="bk-hint">…</p> : !slots.length ? <p className="bk-hint">{x.noTimesPage}</p> : (
        <>
          {day && <p className="bk-hint">{longDate(day + "T12:00:00Z", "UTC", lang)}</p>}
          {times.length ? <div className="bk-times">{times.map((s) => (
            <button type="button" key={s.startsAt} className={chosen?.startsAt === s.startsAt ? "on" : ""} aria-pressed={chosen?.startsAt === s.startsAt} onClick={() => onChoose(s)}>{hm(s.startsAt, tz)}</button>
          ))}</div> : <p className="bk-hint">{x.noTimesDay}</p>}
        </>
      )}
    </div>
  );
}

function SummaryCard({ s, x, lang, withName }: { s: Summary; x: Tx; lang: Lang; withName?: boolean }) {
  const tz = s.clinic.timezone;
  return (
    <div className="bk-card">
      <div className="bk-sum"><span>{x.service}</span><b>{lang === "ar" ? s.service.nameAr : s.service.nameEn}</b></div>
      <div className="bk-sum"><span>{x.doctor}</span><b>{lang === "ar" ? s.doctor.nameAr : s.doctor.nameEn}</b></div>
      <div className="bk-sum"><span>{x.when}</span><b>{longDate(s.startsAt, tz, lang)}{lang === "ar" ? "، " : ", "}<span className="mono">{hm(s.startsAt, tz)}</span></b></div>
      {withName && s.name && <div className="bk-sum"><span>{x.name}</span><b>{s.name}</b></div>}
      {!withName && (() => { const st = s.shownStatus ?? s.status; return <div className="bk-sum"><span>{x.status}</span><b><span className={`bk-pill ${st === "cancelled" || st === "voided" ? "bad" : st === "confirmed" ? "ok" : st === "waiting" ? "warn" : ""}`}>{x.statuses[st] ?? st}</span></b></div>; })()}
    </div>
  );
}

// ---------------------------------------------------------------- booking: Choose it yourself
export function BookPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState("");
  const { lang, setLang, x } = useLang(info?.clinic.defaultLanguage);
  useEffect(() => { call<Info>("GET", `/api/c/${slug}`).then(setInfo).catch((e) => setMissing(e instanceof Fail ? e.code : "server_error")); }, [slug]);
  const from = useMemo(() => { const f = new URLSearchParams(location.search).get("from"); return f && /^[a-z0-9_-]{1,20}$/.test(f) ? f : null; }, []);

  const [step, setStep] = useState<"start" | "service" | "time" | "details" | "done">("start");
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState<string | "any" | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [f, setF] = useState({ name: "", phone: "", forOther: false, reminders: false, agree: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ code: string; text: string } | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const loadSlots = useCallback((start: string, days: number) => call<Slot[]>("GET",
    `/api/c/${slug}/slots?service=${serviceId}${doctorId && doctorId !== "any" ? `&doctor=${doctorId}` : ""}&date=${start}&days=${days}`), [slug, serviceId, doctorId]);

  if (!info) {
    const msg = missing === "clinic_not_found" ? x.clinicNotFound : missing ? x.serverError : "";
    return <Shell name="Limitsiz" lang={lang} setLang={setLang} x={x}>{msg ? <Banner kind="warn">{msg}</Banner> : <p className="bk-hint">…</p>}</Shell>;
  }
  const c = info.clinic, o = info.options, tz = c.timezone;
  const nm = (v: { name_en: string; name_ar: string }) => (lang === "ar" ? v.name_ar : v.name_en);
  const service = info.services.find((s) => s.id === serviceId) ?? null;
  const docs = info.doctors.filter((d) => serviceId && d.service_ids.includes(serviceId));
  const doctorOf = (id: string) => info.doctors.find((d) => d.id === id);
  const shell = (body: ReactNode) => <Shell name={lang === "ar" ? c.nameAr : c.nameEn} place={lang === "ar" ? c.addressAr : c.addressEn} lang={lang} setLang={setLang} x={x} privacyUrl={o.privacyUrl}>{body}</Shell>;
  const callBox = c.phone && <Banner kind="info">{x.preferCall} <Phone n={c.phone} /></Banner>;

  if (step === "start") return shell(<>
    <h1 className="bk-title">{x.title}</h1>
    <p className="bk-hint">{(lang === "ar" ? o.introAr : o.introEn) || x.introDefault}</p>
    <button type="button" className="bk-choice on" onClick={() => setStep("service")}>
      <span className="bk-ic"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></span>
      <span><b>{x.chooseYourself}</b><small>{x.chooseYourselfSub}</small></span><span className="bk-end flip">›</span>
    </button>
    <div className="bk-choice off" aria-disabled="true">
      <span className="bk-ic"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg></span>
      <span><b>{x.assistant}</b><small>{x.assistantSub}</small></span><span className="bk-end bk-pill">{x.soon}</span>
    </div>
    {callBox}
  </>);

  if (step === "service") return shell(<>
    <Steps n={1} />
    <h2 className="bk-title sm">{x.whatFor}</h2>
    <div className="bk-stack">{info.services.map((s) => (
      <button type="button" key={s.id} className={`bk-choice${serviceId === s.id ? " on" : ""}`} aria-pressed={serviceId === s.id}
        onClick={() => { setServiceId(s.id); setSlot(null); if (doctorId && doctorId !== "any" && !doctorOf(doctorId)?.service_ids.includes(s.id)) setDoctorId(null); }}>
        <span><b>{nm(s)}</b><small>{s.duration_minutes} {x.min}{s.price_jod ? ` · ${s.price_is_from ? x.from + " " : ""}${Number(s.price_jod)} ${x.jod}` : ""}</small></span>
        {serviceId === s.id && <span className="bk-end bk-tick">✓</span>}
      </button>))}
    </div>
    {serviceId && <>
      <h2 className="bk-title sm">{x.whichDoctor}</h2>
      <div className="bk-stack">
        {o.allowAnyDoctor && docs.length > 1 && (
          <button type="button" className={`bk-choice${doctorId === "any" ? " on" : ""}`} aria-pressed={doctorId === "any"} onClick={() => { setDoctorId("any"); setSlot(null); }}>
            <span><b>{x.anyDoctor}</b><small>{x.anyDoctorSub}</small></span>{doctorId === "any" && <span className="bk-end bk-tick">✓</span>}
          </button>)}
        {docs.map((d) => (
          <button type="button" key={d.id} className={`bk-choice${doctorId === d.id ? " on" : ""}`} aria-pressed={doctorId === d.id} onClick={() => { setDoctorId(d.id); setSlot(null); }}>
            <span><b>{nm(d)}</b>{(lang === "ar" ? d.title_ar : d.title_en) && <small>{lang === "ar" ? d.title_ar : d.title_en}</small>}</span>{doctorId === d.id && <span className="bk-end bk-tick">✓</span>}
          </button>))}
      </div>
    </>}
    <div className="bk-row">
      <button type="button" className="bk-btn ghost" onClick={() => setStep("start")}>{x.back}</button>
      <button type="button" className="bk-btn ink" disabled={!serviceId || !doctorId} onClick={() => setStep("time")}>{x.next}</button>
    </div>
  </>);

  if (step === "time") return shell(<>
    <Steps n={2} />
    <h2 className="bk-title sm">{x.chooseDayTime}</h2>
    {service && <p className="bk-hint">{nm(service)} · {service.duration_minutes} {x.min}</p>}
    {err?.code === "slot_taken" && <Banner kind="warn">{err.text}</Banner>}
    <DayTimes x={x} lang={lang} tz={tz} perPage={o.daysPerPage} windowDays={o.windowDays} load={loadSlots} chosen={slot} onChoose={(s) => { setSlot(s); setErr(null); }} />
    <div className="bk-row">
      <button type="button" className="bk-btn ghost" onClick={() => setStep("service")}>{x.back}</button>
      <button type="button" className="bk-btn ink" disabled={!slot} onClick={() => setStep("details")}>{x.next}</button>
    </div>
  </>);

  if (step === "details" && slot && service) {
    const submit = async (e: React.FormEvent) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try {
        const r = await call<Summary>("POST", `/api/c/${slug}/book`, { serviceId, doctorId: doctorId === "any" ? null : doctorId, startsAt: slot.startsAt, name: f.name,
          phone: f.phone, language: lang, reminders: o.offerReminders && f.reminders, forOther: o.allowForOther && f.forOther, from, agree: true, website: f.website || undefined });
        setDone(r); setStep("done");
      } catch (e2) {
        const code = e2 instanceof Fail ? e2.code : "server_error";
        if (code === "slot_taken") { setSlot(null); setErr({ code, text: x.slotTaken }); setStep("time"); }
        else setErr({ code, text: message(e2, x) });
      } finally { setBusy(false); }
    };
    const refused = err?.code === "phone_not_accepted";
    return shell(<form className="bk-stack" onSubmit={submit}>
      <Steps n={3} />
      <h2 className="bk-title sm">{x.yourDetails}</h2>
      {refused && <Banner kind="bad"><b>{x.phoneRefused}</b><br />{x.phoneRefused2}{c.phone && <> <Phone n={c.phone} /></>}</Banner>}
      {err && !refused && <Banner kind="bad">{err.text}</Banner>}
      <label className="bk-field">{f.forOther ? x.forOtherName : x.fullName}<input autoComplete="name" required minLength={2} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="bk-field">{x.mobile}
        <span className="bk-tel" dir="ltr"><span className="mono">+{o.countryCode}</span><input className="mono" type="tel" inputMode="tel" autoComplete="tel" required minLength={6} maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></span>
        <small>{x.mobileHint}</small>
      </label>
      {/* Hidden from people; bots fill it in. */}
      <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
      {o.allowForOther && <label className="bk-check"><input type="checkbox" checked={f.forOther} onChange={(e) => setF({ ...f, forOther: e.target.checked })} /><span>{x.forOther}</span></label>}
      {o.offerReminders && <label className="bk-check"><input type="checkbox" checked={f.reminders} onChange={(e) => setF({ ...f, reminders: e.target.checked })} /><span>{x.reminders}</span></label>}
      <label className="bk-check"><input type="checkbox" required checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} />
        <span>{x.agree1}<a href={o.privacyUrl} target="_blank" rel="noopener noreferrer">{x.privacy}</a>{x.agree2}</span></label>
      <div className="bk-card soft">
        <div className="bk-sum"><span>{nm(service)}</span><b>{doctorId === "any" ? x.anyDoctor : nm(doctorOf(String(doctorId))!)}</b></div>
        <div className="bk-sum"><span>{longDate(slot.startsAt, tz, lang)}</span><b className="mono">{hm(slot.startsAt, tz)}</b></div>
      </div>
      <div className="bk-row">
        <button type="button" className="bk-btn ghost" onClick={() => { setErr(null); setStep("time"); }}>{x.back}</button>
        <button className="bk-btn accent" disabled={busy || !f.agree}>{busy ? x.booking : x.bookThis}</button>
      </div>
    </form>);
  }

  if (step === "done" && done) {
    const link = `${location.origin}/${slug}/manage#${done.manageToken}`;
    const shownPhone = f.phone.trim().startsWith("0") ? `+${o.countryCode} ${f.phone.trim().slice(1)}` : f.phone.trim();
    const note = lang === "ar" ? done.clinic.doneNoteAr : done.clinic.doneNoteEn;
    return shell(<>
      <Steps n={4} />
      <div className="bk-done"><span className="bk-ok">✓</span><h2 className="bk-title sm">{x.doneTitle}</h2></div>
      {done.waitingForCheck && <Banner kind="warn">{x.waiting.replace("{phone}", "⁦" + shownPhone + "⁩")}</Banner>}
      <SummaryCard s={done} x={x} lang={lang} withName />
      {note && <p className="bk-note">{note}</p>}
      <ShareLink s={done} x={x} lang={lang} link={link} />
      <a className="bk-btn outline" href={icsHref(done, lang, x, link)} download="appointment.ics">{x.addCal}</a>
      <p className="bk-hint">{x.calHint}</p>
    </>);
  }
  return shell(<button type="button" className="bk-btn ink" onClick={() => setStep("start")}>{x.back}</button>);
}

// ---------------------------------------------------------------- the private link: see, change, cancel
export function ManagePage({ slug }: { slug: string }) {
  const token = useMemo(() => location.hash.replace(/^#/, ""), []);
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const { lang, setLang, x } = useLang();
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  // Kept as what to say, not the words, so it follows the language button.
  const [note, setNote] = useState<{ ok: boolean; say: (x: Tx) => string } | null>(null);
  useEffect(() => {
    if (!token) { setErr("link_not_found"); return; }
    const load = () => call<Summary>("POST", `/api/c/${slug}/manage`, { token }).then(setS).catch((e) => setErr(e instanceof Fail ? e.code : "server_error"));
    void load();
    // Coming back to the page shows the clinic's latest answer (confirmed, moved, cancelled) without a reload.
    const back = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [slug, token]);
  const loadSlots = useCallback((from: string) => call<Slot[]>("POST", `/api/c/${slug}/manage/slots`, { token, date: from }), [slug, token]);
  if (!s) return <Shell name="Limitsiz" lang={lang} setLang={setLang} x={x}>{err ? <Banner kind="warn">{message(new Fail(404, err), x)}</Banner> : <p className="bk-hint">…</p>}</Shell>;
  const c = s.clinic;
  const act = async (fn: () => Promise<Summary>, done: "moved" | null) => {
    setBusy(true); setNote(null);
    try { setS(await fn()); setMode("view"); setSlot(null); setNote(done ? { ok: true, say: (t) => t[done] } : null); }
    catch (e) { setNote({ ok: false, say: (t) => message(e, t) }); if (e instanceof Fail && e.code === "slot_taken") setSlot(null); }
    finally { setBusy(false); }
  };
  const active = s.status === "booked" || s.status === "confirmed";
  return (
    <Shell name={lang === "ar" ? c.nameAr : c.nameEn} place={lang === "ar" ? c.addressAr : c.addressEn} lang={lang} setLang={setLang} x={x}>
      <h1 className="bk-title sm">{x.yourAppt}</h1>
      <SummaryCard s={s} x={x} lang={lang} />
      {s.shownStatus === "waiting" && <Banner kind="warn">{x.waitingShort}</Banner>}
      {note && <Banner kind={note.ok ? "ok" : "warn"}>{note.say(x)}</Banner>}
      {!active && <Banner kind="warn">{x.cancelled}</Banner>}
      {s.tooLateToChange && <>
        <Banner kind="warn">{x.tooLate} {c.phone && <Phone n={c.phone} />}</Banner>
        {c.phone && <a className="bk-btn ink" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{x.callClinic}</a>}
      </>}
      {mode === "view" && <>
        {s.canReschedule && <button type="button" className="bk-btn ink" onClick={() => { setMode("move"); setNote(null); }}>{x.changeTime}</button>}
        {s.canCancel && <button type="button" className="bk-btn danger" onClick={() => { setMode("cancel"); setNote(null); }}>{x.cancelBooking}</button>}
        {(s.canCancel || s.canReschedule) && s.changeNoticeMinutes ? <p className="bk-hint">{x.changeUntil.replace("{t}", spell(s.changeNoticeMinutes, x))}</p> : null}
      </>}
      {mode === "move" && <>
        <h2 className="bk-title sm">{x.pickNew}</h2>
        <DayTimes x={x} lang={lang} tz={c.timezone} perPage={c.daysPerPage} windowDays={c.windowDays} load={loadSlots} chosen={slot} onChoose={setSlot} />
        <div className="bk-row">
          <button type="button" className="bk-btn ghost" onClick={() => setMode("view")}>{x.back}</button>
          <button type="button" className="bk-btn accent" disabled={!slot || busy || slot.startsAt === s.startsAt}
            onClick={() => void act(() => call<Summary>("POST", `/api/c/${slug}/manage/reschedule`, { token, startsAt: slot!.startsAt }), "moved")}>{x.saveNew}</button>
        </div>
      </>}
      {mode === "cancel" && <div className="bk-card stack">
        <b>{x.confirmCancel}</b>
        <div className="bk-row">
          <button type="button" className="bk-btn ghost" onClick={() => setMode("view")}>{x.keep}</button>
          <button type="button" className="bk-btn danger" disabled={busy} onClick={() => void act(() => call<Summary>("POST", `/api/c/${slug}/manage/cancel`, { token }), null)}>{x.yesCancel}</button>
        </div>
      </div>}
      {active && <a className="bk-btn outline" href={icsHref(s, lang, x, location.href)} download="appointment.ics">{x.addCal}</a>}
      {active && <ShareLink s={s} x={x} lang={lang} link={location.href} />}
    </Shell>
  );
}
