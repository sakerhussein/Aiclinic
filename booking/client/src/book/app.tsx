// The online booking page: book.limitsiz.si/<clinic> (Choose it yourself) and /<clinic>/manage#<token> (the private link).
// Everything it may show, every limit and its texts come from the clinic's Settings > Online booking, through the public server.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { TEXT, type Lang, type Tx } from "./text";

// ---------------------------------------------------------------- types and the server
type Service = { id: string; name_en: string; name_ar: string; duration_minutes: number; price_jod: string | null; price_is_from: boolean };
type Doctor = { id: string; name_en: string; name_ar: string; title_en: string | null; title_ar: string | null; service_ids: string[] };
export type Info = {
  clinic: { slug: string; nameEn: string; nameAr: string; phone: string | null; addressEn: string | null; addressAr: string | null; timezone: string; defaultLanguage: Lang };
  services: Service[]; doctors: Doctor[];
  options: { allowAnyDoctor: boolean; allowForOther: boolean; offerReminders: boolean; daysPerPage: number; windowDays: number; countryCode: string;
             introEn: string | null; introAr: string | null; doneNoteEn: string | null; doneNoteAr: string | null; privacyUrl: string; findEnabled?: boolean; chatEnabled?: boolean };
};
export type Summary = {
  id: string; startsAt: string; endsAt: string; status: string; shownStatus?: string; name: string | null; waitingForCheck: boolean;
  service: { id: string; nameEn: string; nameAr: string; durationMinutes: number };
  doctor: { id: string; nameEn: string; nameAr: string; titleEn: string | null; titleAr: string | null };
  clinic: { slug: string; nameEn: string; nameAr: string; phone: string | null; addressEn: string | null; addressAr: string | null; timezone: string;
            doneNoteEn: string | null; doneNoteAr: string | null; daysPerPage: number; windowDays: number };
  canCancel: boolean; canReschedule: boolean; tooLateToChange: boolean; changeNoticeMinutes?: number; manageToken?: string;
};
export type Slot = { doctorId: string; startsAt: string };
export class Fail extends Error { constructor(public status: number, public code: string) { super(code); } }

export async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Fail(0, "server_error"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Fail(r.status, j.error || "server_error");
  return j as T;
}
export function message(e: unknown, x: Tx) {
  const c = e instanceof Fail ? e.code : "server_error";
  return ({ slot_taken: x.slotTaken, too_many_requests: x.tooMany, invalid_phone: x.invalidPhone, invalid_input: x.invalidInput,
            link_not_found: x.linkNotFound, clinic_not_found: x.clinicNotFound, link_replaced: x.linkReplaced,
            find_not_available: x.findNotAvailable } as Record<string, string>)[c] ?? x.serverError;
}

// ---------------------------------------------------------------- dates in the clinic's time zone
const loc = (l: Lang) => (l === "ar" ? "ar-JO-u-nu-latn" : "en-GB");
const dayKey = (iso: string | Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const hm = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export const longDate = (iso: string, tz: string, l: Lang) => new Intl.DateTimeFormat(loc(l), { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
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

// "Add to calendar": the same entry three ways. The calendar entry carries the private link, so a patient who saved the
// appointment always finds it again.
//   Google Calendar and Outlook: a link that opens the patient's calendar with the entry filled in (the details travel in the link,
//   to Google or Microsoft, only when the patient taps it). Google's app can't open .ics files, and most patients here use Android.
//   Apple / other: a small .ics file made here, nothing sent anywhere (Apple Calendar, Outlook on a computer, Samsung Calendar).
function calEvent(s: Summary, l: Lang, x: Tx, link: string) {
  const clinic = l === "ar" ? s.clinic.nameAr : s.clinic.nameEn, svc = l === "ar" ? s.service.nameAr : s.service.nameEn;
  const doctor = l === "ar" ? s.doctor.nameAr : s.doctor.nameEn;
  return {
    title: `${svc} · ${clinic}`,
    where: (l === "ar" ? s.clinic.addressAr : s.clinic.addressEn) || clinic,
    note: [doctor, x.calLink.replace("{link}", link), s.clinic.phone ? `${x.callClinic}: ${s.clinic.phone}` : ""].filter(Boolean).join("\n"),
  };
}
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");   // 20261111T090000Z

export function icsHref(s: Summary, l: Lang, x: Tx, link: string) {
  const e = calEvent(s, l, x, link);
  const esc = (v: string) => v.replace(/[\\,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  // Lines longer than 75 bytes are folded (RFC 5545); 60 characters keeps Arabic under the limit too.
  const fold = (line: string) => { const out = []; for (let i = 0; i < line.length; i += 60) out.push((i ? " " : "") + line.slice(i, i + 60)); return out.join("\r\n"); };
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Limitsiz//Online booking//EN", "BEGIN:VEVENT", `UID:${s.id}@limitsiz`, `DTSTAMP:${utc(new Date().toISOString())}`,
    `DTSTART:${utc(s.startsAt)}`, `DTEND:${utc(s.endsAt)}`, `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.where)}`,
    `DESCRIPTION:${esc(e.note)}`, `URL:${link}`, "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n");
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(body);
}

export function googleHref(s: Summary, l: Lang, x: Tx, link: string) {
  const e = calEvent(s, l, x, link);
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${utc(s.startsAt)}/${utc(s.endsAt)}`, details: e.note, location: e.where });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function outlookHref(s: Summary, l: Lang, x: Tx, link: string) {
  const e = calEvent(s, l, x, link);
  const iso = (v: string) => new Date(v).toISOString().replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: e.title, startdt: iso(s.startsAt), enddt: iso(s.endsAt),
    body: e.note, location: e.where });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
}

// The calendars' marks, drawn small beside their names. Google Calendar and Apple: Simple Icons (CC0); Outlook and "other": drawn here.
const CAL_ICON = {
  google: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z" /></svg>,
  outlook: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="4" width="16" height="16" rx="2" fill="#28A8EA" /><path fill="#0364B8" d="M7 12h16v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" /><rect x="1" y="6" width="12" height="12" rx="2" fill="#0F6CBD" />
    <ellipse cx="7" cy="12" rx="3" ry="3.6" fill="none" stroke="#fff" strokeWidth="1.8" /></svg>,
  apple: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" /></svg>,
  other: <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" /><path d="M12 13.5v4M10 15.5h4" /></svg>,
};

/** "Add to calendar", as four icons (the name shows above an icon under the mouse or the keyboard, and is what screen readers say): Google Calendar and Outlook open the patient's calendar with the entry filled in; Apple Calendar and "other
 *  calendars" take the .ics file. Apple comes first on an iPhone, iPad or Mac. */
export function CalendarButtons({ s, x, lang, link }: { s: Summary; x: Tx; lang: Lang; link: string }) {
  const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const ics = icsHref(s, lang, x, link);
  const btn = (k: keyof typeof CAL_ICON, label: string, href: string, file: boolean) => (
    <a key={k} className="bk-btn ghost bk-calbtn" href={href} aria-label={label} data-tip={label} {...(file ? { download: "appointment.ics" } : { target: "_blank", rel: "noreferrer" })}>
      <span className="bk-calico">{CAL_ICON[k]}</span>
    </a>);
  const google = btn("google", x.calGoogle, googleHref(s, lang, x, link), false);
  const outlook = btn("outlook", x.calOutlook, outlookHref(s, lang, x, link), false);
  const appleBtn = btn("apple", x.calApple, ics, true);
  const other = btn("other", x.calOther, ics, true);
  return (
    <div className="bk-cal" role="group" aria-label={x.addCal}>
      <span className="bk-cal-h">{x.addCal}</span>
      <div className="bk-cal-row">{apple ? [appleBtn, google, outlook, other] : [google, outlook, appleBtn, other]}</div>
    </div>
  );
}

// "Save the link": the phone's own share menu (WhatsApp, messages, notes, email); WhatsApp where there is none (computers).
export function ShareLink({ s, x, lang, link }: { s: Summary; x: Tx; lang: Lang; link: string }) {
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
export function useLang(fallback?: Lang) {
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
export function Shell({ name, place, lang, setLang, x, privacyUrl, children }: { name: string; place?: string | null; lang: Lang; setLang: (l: Lang) => void; x: Tx; privacyUrl?: string; children: ReactNode }) {
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
export const Banner = ({ kind, children }: { kind: "warn" | "bad" | "ok" | "info"; children: ReactNode }) => <div className={`bk-banner ${kind}`} role={kind === "bad" ? "alert" : "status"}>{children}</div>;
export const Phone = ({ n }: { n: string }) => <a className="mono" href={`tel:${n.replace(/[^\d+]/g, "")}`} dir="ltr">{n}</a>;

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
    {o.chatEnabled
      ? <a className="bk-choice" href={`/${slug}/chat`}>
          <span className="bk-ic"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg></span>
          <span><b>{x.assistant}</b><small>{x.chatSub}</small></span><span className="bk-end flip">›</span>
        </a>
      : <div className="bk-choice off" aria-disabled="true">
          <span className="bk-ic"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg></span>
          <span><b>{x.assistant}</b><small>{x.assistantSub}</small></span><span className="bk-end bk-pill">{x.soon}</span>
        </div>}
    {o.findEnabled && <p className="bk-find"><span>{x.alreadyBooked}</span> <a href={`/${slug}/find`}>{x.findLink}</a></p>}
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
      <CalendarButtons s={done} x={x} lang={lang} link={link} />
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
  if (!s) return <Shell name="Limitsiz" lang={lang} setLang={setLang} x={x}>{err ? <>
    <Banner kind="warn">{message(new Fail(404, err), x)}</Banner>
    {/* A link replaced through "Find my booking": the way to the newest one. */}
    {err === "link_replaced" && <a className="bk-btn wa" href={`/${slug}/find`}>{x.findLink}</a>}
  </> : <p className="bk-hint">…</p>}</Shell>;
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
      {active && <CalendarButtons s={s} x={x} lang={lang} link={location.href} />}
      {active && <ShareLink s={s} x={x} lang={lang} link={location.href} />}
    </Shell>
  );
}

// ---------------------------------------------------------------- "Find my booking": a new private link by WhatsApp
// The answer is the same whether the number has a booking or not, so nobody can learn who books at the clinic.
export function FindPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState("");
  const { lang, setLang, x } = useLang(info?.clinic.defaultLanguage);
  useEffect(() => { call<Info>("GET", `/api/c/${slug}`).then(setInfo).catch((e) => setMissing(e instanceof Fail ? e.code : "server_error")); }, [slug]);
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);

  if (!info) {
    const msg = missing === "clinic_not_found" ? x.clinicNotFound : missing ? x.serverError : "";
    return <Shell name="Limitsiz" lang={lang} setLang={setLang} x={x}>{msg ? <Banner kind="warn">{msg}</Banner> : <p className="bk-hint">…</p>}</Shell>;
  }
  const c = info.clinic, o = info.options;
  const call_ = c.phone && <a className="bk-btn ink" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{x.callClinic}</a>;
  const body = !o.findEnabled ? <>
      <h1 className="bk-title sm">{x.findLink}</h1>
      <Banner kind="warn">{x.findNotAvailable}</Banner>
      {call_}
    </> : sent ? <>
      <div className="bk-done"><span className="bk-ok wa" aria-hidden="true">✓</span><h1 className="bk-title sm">{x.sentTitle}</h1></div>
      <Banner kind="info">{x.sentText.replace("{phone}", "⁦" + sent + "⁩")}</Banner>
      <p className="bk-hint">{x.nothingArrived}</p>
      {call_}
      <a className="bk-btn ghost" href={`/${slug}`}>{x.backToBooking}</a>
    </> : <form className="bk-stack" onSubmit={(e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        const shown = phone.trim().startsWith("0") ? `+${o.countryCode} ${phone.trim().slice(1)}` : phone.trim().startsWith("+") ? phone.trim() : `+${o.countryCode} ${phone.trim()}`;
        call<{ ok: boolean }>("POST", `/api/c/${slug}/find`, { phone, website }).then(() => setSent(shown)).catch(setErr).finally(() => setBusy(false));
      }}>
      <h1 className="bk-title sm">{x.findLink}</h1>
      <p className="bk-hint">{x.findHint}</p>
      {err != null && <Banner kind="bad">{message(err, x)}</Banner>}
      <label className="bk-field">{x.mobile}
        <span className="bk-tel" dir="ltr"><span className="mono">+{o.countryCode}</span><input className="mono" type="tel" inputMode="tel" autoComplete="tel" required minLength={6} maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} /></span>
      </label>
      <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      <button className="bk-btn wa" disabled={busy}>{busy ? x.sending : x.sendMyLink}</button>
      <p className="bk-hint">{x.findNote}</p>
      <a className="bk-btn ghost" href={`/${slug}`}>{x.back}</a>
    </form>;
  return <Shell name={lang === "ar" ? c.nameAr : c.nameEn} place={lang === "ar" ? c.addressAr : c.addressEn} lang={lang} setLang={setLang} x={x} privacyUrl={o.privacyUrl}>{body}</Shell>;
}
