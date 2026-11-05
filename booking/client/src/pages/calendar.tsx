import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { get, type Appt } from "../api";
import { addDays, fmtDay, hm, localToIso, minutesOfDay, todayIn, weekdayOf } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";

const PX = 1.3;            // pixels per minute
const SNAP = 15;

// Day view: one column per doctor, hatched where the doctor does not work. Refreshes every 20 seconds.
export function Calendar() {
  const { t, lang, d } = useI18n();
  const { look, me, can } = useApp();
  const tz = look.clinic.timezone;
  const nav = useNavigate();
  const [q, setQ] = useSearchParams();
  const day = q.get("date") || todayIn(tz);
  const mine = me.role === "doctor" && me.doctorId;
  const doctors = useMemo(() => look.doctors.filter((x) => !mine || x.id === me.doctorId), [look, mine, me.doctorId]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const load = useCallback(() => { get(`/api/appointments?from=${day}&to=${day}`).then(setAppts).catch(() => {}); }, [day]);
  useEffect(() => { load(); const i = window.setInterval(() => { if (!document.hidden) load(); }, 20_000); return () => window.clearInterval(i); }, [load]);

  const wd = weekdayOf(day);
  const shifts = (docId: string) => look.doctors.find((x) => x.id === docId)!.hours.filter((h) => h.weekday === wd).map((h) => [toMin(h.start), toMin(h.end)] as const);
  const all = doctors.flatMap((x) => shifts(x.id));
  const from = all.length ? Math.floor(Math.min(...all.map((s) => s[0])) / 60) * 60 - 60 : 8 * 60;
  const to = all.length ? Math.ceil(Math.max(...all.map((s) => s[1])) / 60) * 60 + 60 : 18 * 60;
  const height = (to - from) * PX;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const set = (date: string) => setQ({ date });

  function onGrid(e: React.MouseEvent<HTMLDivElement>, docId: string) {
    if (!can("booking.appointments.create")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = Math.round((from + (e.clientY - rect.top) / PX) / SNAP) * SNAP;
    nav(`/new?doctor=${docId}&start=${encodeURIComponent(localToIso(day, Math.floor(min / 60), min % 60, tz))}`);
  }

  return (
    <main className="wrap page">
      <div className="row between">
        <div className="row">
          <button className="btn btn-outline btn-sm" onClick={() => set(addDays(day, -1))} aria-label={t("prev")}>{lang === "ar" ? "›" : "‹"}</button>
          <button className="btn btn-outline btn-sm" onClick={() => set(todayIn(tz))}>{t("today")}</button>
          <button className="btn btn-outline btn-sm" onClick={() => set(addDays(day, 1))} aria-label={t("next")}>{lang === "ar" ? "‹" : "›"}</button>
          <input type="date" className="dateinput" value={day} onChange={(e) => e.target.value && set(e.target.value)} />
          <h1 className="display h1small">{fmtDay(day, lang)}</h1>
        </div>
        {can("booking.appointments.create") && <Link className="btn btn-accent btn-sm" to={`/new?date=${day}`}>{t("newBooking")}</Link>}
      </div>

      <div className="cal" style={{ ["--cols" as string]: doctors.length }}>
        <div className="cal-head"><span className="cal-gutter" />{doctors.map((x) => <b key={x.id}>{lang === "ar" ? x.name_ar : x.name_en}</b>)}</div>
        <div className="cal-body" style={{ height }}>
          <div className="cal-gutter">{hours.map((m) => <span key={m} style={{ top: (m - from) * PX }}>{String(Math.floor(m / 60) % 24).padStart(2, "0")}:00</span>)}</div>
          {doctors.map((doc) => {
            const sh = shifts(doc.id);
            return (
              <div key={doc.id} className="cal-col" onClick={(e) => e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("cal-off") || (e.target as HTMLElement).classList.contains("cal-line") ? onGrid(e, doc.id) : undefined}>
                {hours.map((m) => <i key={m} className="cal-line" style={{ top: (m - from) * PX }} />)}
                {offRanges(from, to, sh).map(([a, b]) => <i key={a} className="cal-off" style={{ top: (a - from) * PX, height: (b - a) * PX }} />)}
                {appts.filter((a) => a.doctor_id === doc.id && a.status !== "cancelled").map((a) => {
                  const s = minutesOfDay(a.starts_at, tz), h = Math.max(a.duration_minutes, 15);
                  return (
                    <Link key={a.id} to={`/bookings/${a.id}`} className={`cal-card st-${a.status} src-${a.source}`} style={{ top: (s - from) * PX, height: h * PX - 2 }}>
                      <b>{hm(a.starts_at, tz)} {a.patient_name || a.patient_phone || "?"}</b>
                      <span>{lang === "ar" ? a.service_name_ar : a.service_name_en}</span>
                      <em>{d.sources[a.source] ?? a.source}</em>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {appts.some((a) => a.status === "cancelled") && <p className="hint">{appts.filter((a) => a.status === "cancelled").length} · {d.statuses.cancelled}</p>}
    </main>
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
