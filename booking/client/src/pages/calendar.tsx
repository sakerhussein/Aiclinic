import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { get, type Appt, type Block } from "../api";
import { addDays, dayOf, fmtDay, fromHere, hm, localToIso, minutesOfDay, todayIn, weekdayOf } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { useN } from "./notes-text";

const PX = 1.3;            // pixels per minute (day view)
const WPX = 0.8;           // pixels per minute (week view)
const SNAP = 15;
type View = "day" | "week";

// The calendar (design: booking/design/week-view.html). Day view: one column per doctor. Week view: one doctor's week, days across
// (on a phone, a list day by day). Both hatched where the doctor does not work, refreshed every 20 seconds, with the "today" line.
export function Calendar() {
  const { t, lang } = useI18n();
  const { look, me, can } = useApp();
  const tz = look.clinic.timezone;
  const here = fromHere(useLocation());             // a booking opened from here comes back to this day or week
  const [q, setQ] = useSearchParams();
  const day = q.get("date") || todayIn(tz);
  const mine = me.role === "doctor" && me.doctorId;
  const doctors = useMemo(() => look.doctors.filter((x) => !mine || x.id === me.doctorId), [look, mine, me.doctorId]);
  const view: View = q.get("view") === "week" || q.get("view") === "day" ? (q.get("view") as View) : remembered();
  const weekDoc = doctors.find((x) => x.id === q.get("doc"))?.id ?? doctors[0]?.id ?? "";
  const go = (p: { date?: string; view?: View; doc?: string }) => {
    const next = { date: p.date ?? day, view: p.view ?? view, doc: p.doc ?? weekDoc };
    if (p.view) remember(p.view);
    setQ({ date: next.date, ...(next.view === "week" ? { view: "week", doc: next.doc } : {}) });
  };
  const ws = look.clinic.week_start ?? 6;
  const start = view === "week" ? addDays(day, -((weekdayOf(day) - ws + 7) % 7)) : day;
  const step = view === "week" ? 7 : 1;

  return (
    <main className="wrap page">
      <div className="row between">
        <div className="row">
          {/* Arrows point outwards in both languages (in Arabic the earlier day is on the right); dir="ltr" stops the browser mirroring them. */}
          <button className="btn btn-outline btn-sm" onClick={() => go({ date: addDays(day, -step) })} aria-label={view === "week" ? t("prevWeek") : t("prev")}><span dir="ltr">{lang === "ar" ? "›" : "‹"}</span></button>
          <button className="btn btn-outline btn-sm" onClick={() => go({ date: todayIn(tz) })}>{view === "week" ? t("thisWeek") : t("today")}</button>
          <button className="btn btn-outline btn-sm" onClick={() => go({ date: addDays(day, step) })} aria-label={view === "week" ? t("nextWeek") : t("next")}><span dir="ltr">{lang === "ar" ? "‹" : "›"}</span></button>
          <input type="date" className="dateinput" value={day} onChange={(e) => e.target.value && go({ date: e.target.value })} />
          <h1 className="display h1small">{view === "week" ? weekTitle(start, lang) : fmtDay(day, lang)}</h1>
        </div>
        <div className="row">
          <div className="seg" role="tablist" aria-label={t("calView")}>
            {(["day", "week"] as View[]).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => go({ view: v })}>{v === "day" ? t("dayView") : t("weekView")}</button>)}
          </div>
          {view === "week" && doctors.length > 1 && (
            <select className="dateinput" value={weekDoc} onChange={(e) => go({ doc: e.target.value })} aria-label={t("doctor")}>
              {doctors.map((x) => <option key={x.id} value={x.id}>{lang === "ar" ? x.name_ar : x.name_en}</option>)}
            </select>
          )}
          {can("booking.appointments.create") && <Link className="btn btn-accent btn-sm" to={`/new?date=${day}`} state={here}>{t("newBooking")}</Link>}
        </div>
      </div>
      <TodayLine />
      {view === "day" ? <DayGrid day={day} doctors={doctors} /> : weekDoc && <WeekGrid start={start} docId={weekDoc} onDay={(d) => go({ date: d, view: "day" })} />}
    </main>
  );
}

function remembered(): View {
  try { return localStorage.getItem("lc_cal_view") === "week" ? "week" : "day"; } catch { return "day"; }
}
function remember(v: View) { try { localStorage.setItem("lc_cal_view", v); } catch { /* storage blocked */ } }

const fmtDayHead = (d: string, lang: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
function weekTitle(start: string, lang: string) {
  const loc = lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", end = addDays(start, 6);
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { ...o, timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
  return `${f(start, start.slice(0, 7) === end.slice(0, 7) ? { day: "numeric" } : { day: "numeric", month: "long" })} – ${f(end, { day: "numeric", month: "long", year: "numeric" })}`;
}

// A doctor's working periods on a weekday, inside the clinic's opening hours when those are set (in minutes of the day).
function useShifts() {
  const { look } = useApp();
  return useCallback((docId: string, wd: number) => {
    const own = look.doctors.find((x) => x.id === docId)?.hours.filter((h) => h.weekday === wd).map((h) => [toMin(h.start), toMin(h.end)] as const) ?? [];
    if (!look.openingHours.length) return own;         // opening hours not set: the doctor's own hours apply
    const open = look.openingHours.filter((h) => h.weekday === wd).map((h) => [toMin(h.start), toMin(h.end)] as const);
    return own.flatMap(([a, b]) => open.filter(([c, e]) => a < e && c < b).map(([c, e]) => [Math.max(a, c), Math.min(b, e)] as const));
  }, [look]);
}
// Closures and leave on one day, in minutes of that day.
function awayOn(blocks: Block[], docId: string, day: string, tz: string) {
  return blocks.filter((b) => (!b.doctor_id || b.doctor_id === docId) && dayOf(b.starts_at, tz) <= day && dayOf(new Date(Date.parse(b.ends_at) - 1).toISOString(), tz) >= day).map((b) => ({
    id: b.id, reason: b.reason,
    a: dayOf(b.starts_at, tz) < day ? 0 : minutesOfDay(b.starts_at, tz),
    z: dayOf(new Date(Date.parse(b.ends_at) - 1).toISOString(), tz) > day ? 24 * 60 : minutesOfDay(new Date(Date.parse(b.ends_at) - 1).toISOString(), tz) + 1,
  }));
}
function useData(from: string, to: string) {
  const [appts, setAppts] = useState<Appt[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const load = useCallback(() => {
    get<Appt[]>(`/api/appointments?from=${from}&to=${to}`).then(setAppts).catch(() => {});
    get<Block[]>(`/api/time-off?date=${from}${to !== from ? `&to=${to}` : ""}`).then(setBlocks).catch(() => {});
  }, [from, to]);
  useEffect(() => { load(); const i = window.setInterval(() => { if (!document.hidden) load(); }, 20_000); return () => window.clearInterval(i); }, [load]);
  return { appts, blocks };
}

// ---------------------------------------------------------------- the "today" line
type Line = { date: string; booked: number; notChecked: number; completed: number; noShow: number; nextFree: string | null };
function TodayLine() {
  const { t } = useI18n();
  const { look } = useApp();
  const [l, setL] = useState<Line | null>(null);
  useEffect(() => {
    const load = () => get<Line>("/api/today-line").then(setL).catch(() => {});
    load(); const i = window.setInterval(() => { if (!document.hidden) load(); }, 60_000); return () => window.clearInterval(i);
  }, []);
  if (!l) return null;
  const list = (extra: string) => `/bookings?from=${l.date}&to=${l.date}${extra}`;
  return (
    <div className="todayline">
      <b>{t("tlToday")}</b>
      {l.booked > 0 && <Link to={list("")}>{t("tlBooked", { n: l.booked })}</Link>}
      {l.notChecked > 0 && <Link className="tl-warn" to={list("&unchecked=1")}>{t("tlNotChecked", { n: l.notChecked })}</Link>}
      {l.completed > 0 && <Link to={list("&status=completed")}>{t("tlCompleted", { n: l.completed })}</Link>}
      {l.noShow > 0 && <Link className="tl-warn" to={list("&status=no_show")}>{t("tlNoShow", { n: l.noShow })}</Link>}
      <span className="hint">{l.nextFree ? t("tlNextFree", { t: hm(l.nextFree, look.clinic.timezone) }) : t("tlNoFree")}</span>
    </div>
  );
}

// ---------------------------------------------------------------- day view: one column per doctor
function DayGrid({ day, doctors }: { day: string; doctors: { id: string; name_en: string; name_ar: string }[] }) {
  const { lang, d } = useI18n();
  const { look, can } = useApp();
  const nt = useN();
  const tz = look.clinic.timezone;
  const nav = useNavigate();
  const here = fromHere(useLocation());
  const { appts, blocks } = useData(day, day);
  const shiftsOf = useShifts();
  const wd = weekdayOf(day);
  const all = doctors.flatMap((x) => shiftsOf(x.id, wd));
  const from = all.length ? Math.floor(Math.min(...all.map((s) => s[0])) / 60) * 60 - 60 : 8 * 60;
  const to = all.length ? Math.ceil(Math.max(...all.map((s) => s[1])) / 60) * 60 + 60 : 18 * 60;
  const height = (to - from) * PX;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);

  function onGrid(e: React.MouseEvent<HTMLDivElement>, docId: string) {
    if (!can("booking.appointments.create")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = Math.round((from + (e.clientY - rect.top) / PX) / SNAP) * SNAP;
    nav(`/new?doctor=${docId}&start=${encodeURIComponent(localToIso(day, Math.floor(min / 60), min % 60, tz))}`, { state: here });
  }

  return (
    <>
      <div className="cal" style={{ ["--cols" as string]: doctors.length }}>
        <div className="cal-head"><span className="cal-gutter" />{doctors.map((x) => <b key={x.id}>{lang === "ar" ? x.name_ar : x.name_en}</b>)}</div>
        <div className="cal-body" style={{ height }}>
          <div className="cal-gutter">{hours.map((m) => <span key={m} style={{ top: (m - from) * PX }}>{String(Math.floor(m / 60) % 24).padStart(2, "0")}:00</span>)}</div>
          {doctors.map((doc) => {
            const sh = shiftsOf(doc.id, wd);
            return (
              <div key={doc.id} className="cal-col" onClick={(e) => e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("cal-off") || (e.target as HTMLElement).classList.contains("cal-line") ? onGrid(e, doc.id) : undefined}>
                {hours.map((m) => <i key={m} className="cal-line" style={{ top: (m - from) * PX }} />)}
                {offRanges(from, to, sh).map(([a, b]) => <i key={a} className="cal-off" style={{ top: (a - from) * PX, height: (b - a) * PX }} />)}
                {awayOn(blocks, doc.id, day, tz).map((b) => {
                  const top = Math.max(b.a, from), bottom = Math.min(b.z, to);
                  return bottom > top ? <i key={b.id} className="cal-off cal-away" title={b.reason || ""} style={{ top: (top - from) * PX, height: (bottom - top) * PX }}>{b.reason}</i> : null;
                })}
                {appts.filter((a) => a.doctor_id === doc.id && a.status !== "cancelled").map((a) => {
                  const s = minutesOfDay(a.starts_at, tz), h = Math.max(a.duration_minutes, 15);
                  return (
                    <Link key={a.id} to={`/bookings/${a.id}`} state={here} className={`cal-card st-${a.status} src-${a.source}${a.unchecked || a.moved_by_patient ? " unchecked" : ""} ${h * PX >= 58 ? "tall" : "short"}`} style={{ top: (s - from) * PX, height: h * PX - 2 }}>
                      <b>{hm(a.starts_at, tz)} {a.patient_name || a.patient_phone || "?"}</b>
                      <span>{lang === "ar" ? a.service_name_ar : a.service_name_en}</span>
                      <em>{d.sources[a.source] ?? a.source}{a.note_status && <span className={`cal-note n-${a.note_status}`} title={`${nt.noteLine}: ${nt.states[a.note_status] ?? a.note_status}`}> · {nt.states[a.note_status] ?? a.note_status}</span>}</em>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {appts.some((a) => a.status === "cancelled") && <p className="hint">{appts.filter((a) => a.status === "cancelled").length} · {d.statuses.cancelled}</p>}
    </>
  );
}

// ---------------------------------------------------------------- week view: one doctor, days across (a list on a phone)
function WeekGrid({ start, docId, onDay }: { start: string; docId: string; onDay: (day: string) => void }) {
  const { t, lang } = useI18n();
  const { look, can } = useApp();
  const tz = look.clinic.timezone;
  const nav = useNavigate();
  const here = fromHere(useLocation());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const { appts: all, blocks } = useData(days[0], days[6]);
  const appts = all.filter((a) => a.doctor_id === docId && a.status !== "cancelled" && a.status !== "voided");
  const shiftsOf = useShifts();
  const today = todayIn(tz);
  const per = days.map((d) => ({ day: d, shifts: shiftsOf(docId, weekdayOf(d)), list: appts.filter((a) => dayOf(a.starts_at, tz) === d) }));
  const spans = per.flatMap((p) => p.shifts);
  const from = spans.length ? Math.floor(Math.min(...spans.map((s) => s[0])) / 60) * 60 : 8 * 60;
  const to = spans.length ? Math.ceil(Math.max(...spans.map((s) => s[1])) / 60) * 60 : 18 * 60;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const cls = (a: Appt) => `st-${a.status} src-${a.source}${a.unchecked || a.moved_by_patient ? " unchecked" : ""}`;
  const name = (a: Appt) => a.patient_name || a.patient_phone || "?";

  function onGrid(e: React.MouseEvent<HTMLDivElement>, day: string) {
    if (!can("booking.appointments.create")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = Math.round((from + (e.clientY - rect.top) / WPX) / SNAP) * SNAP;
    nav(`/new?doctor=${docId}&start=${encodeURIComponent(localToIso(day, Math.floor(min / 60), min % 60, tz))}`, { state: here });
  }

  return (
    <>
      <div className="cal wk" style={{ ["--cols" as string]: 7 }}>
        <div className="cal-head"><span className="cal-gutter" />
          {per.map((p) => (
            <b key={p.day} className={p.day === today ? "today" : ""}>
              <button type="button" className="linkish" onClick={() => onDay(p.day)}>{fmtDayHead(p.day, lang)}</button>
              <small>{p.shifts.length ? t("nBooked", { n: p.list.length }) : t("closedDay")}</small>
            </b>
          ))}
        </div>
        <div className="cal-body" style={{ height: (to - from) * WPX }}>
          <div className="cal-gutter">{hours.map((m) => <span key={m} style={{ top: (m - from) * WPX }}>{String(Math.floor(m / 60) % 24).padStart(2, "0")}:00</span>)}</div>
          {per.map((p) => (
            <div key={p.day} className={`cal-col${p.day === today ? " today" : ""}`}
              onClick={(e) => e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("cal-off") || (e.target as HTMLElement).classList.contains("cal-line") ? onGrid(e, p.day) : undefined}>
              {hours.map((m) => <i key={m} className="cal-line" style={{ top: (m - from) * WPX }} />)}
              {offRanges(from, to, p.shifts).map(([a, b]) => <i key={a} className="cal-off" style={{ top: (a - from) * WPX, height: (b - a) * WPX }} />)}
              {!p.shifts.length && <em className="wk-closed">{t("closedDay")}</em>}
              {awayOn(blocks, docId, p.day, tz).map((b) => {
                const top = Math.max(b.a, from), bottom = Math.min(b.z, to);
                return bottom > top ? <i key={b.id} className="cal-off cal-away" title={b.reason || ""} style={{ top: (top - from) * WPX, height: (bottom - top) * WPX }}>{b.reason}</i> : null;
              })}
              {p.list.map((a) => {
                const s = minutesOfDay(a.starts_at, tz), h = Math.max(a.duration_minutes, 15);
                return (
                  <Link key={a.id} to={`/bookings/${a.id}`} state={here} className={`cal-card short ${cls(a)}`} style={{ top: (s - from) * WPX, height: h * WPX - 2 }}
                    title={`${hm(a.starts_at, tz)} ${name(a)} · ${lang === "ar" ? a.service_name_ar : a.service_name_en}`}>
                    <b className="mono">{hm(a.starts_at, tz)}</b><span>{name(a)}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="agenda">
        {per.map((p) => (
          <div key={p.day} className={`ag-day${p.day === today ? " today" : ""}`}>
            <div className="row between"><button type="button" className="linkish" onClick={() => onDay(p.day)}><b>{fmtDayHead(p.day, lang)}</b></button>
              <span className="hint">{p.shifts.length ? t("nBooked", { n: p.list.length }) : t("closedDay")}</span></div>
            {p.list.map((a) => (
              <Link key={a.id} to={`/bookings/${a.id}`} state={here} className={`ag-row ${cls(a)}`}>
                <b className="mono">{hm(a.starts_at, tz)}</b><span>{name(a)}</span><span className="hint">{lang === "ar" ? a.service_name_ar : a.service_name_en}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
// The parts of [from,to] that are not inside any shift (drawn hatched).
function offRanges(from: number, to: number, shifts: (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = []; let cur = from;
  for (const [s, e] of [...shifts].sort((a, b) => a[0] - b[0])) { if (s > cur) out.push([cur, s]); cur = Math.max(cur, e); }
  if (cur < to) out.push([cur, to]);
  return out;
}
