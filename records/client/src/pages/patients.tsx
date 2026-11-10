import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ageOf, get, type PatientRow, type TodayRow } from "../api";
import { fmtDateTime, hm } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";

// "Today's patients": the doctor's bookings for today, with how many alerts each chart has (design screen 1).
export function Today() {
  const { t, lang, d } = useI18n();
  const { me, look } = useApp();
  const [rows, setRows] = useState<TodayRow[] | null>(null);
  useEffect(() => { get<TodayRow[]>("/api/today").then(setRows).catch(() => setRows([])); }, []);
  const tz = look.clinic.timezone;
  return (
    <main className="wrap page">
      <h1 className="display">{t("today")}</h1>
      <section className="panel">
        {rows && !rows.length ? <p className="hint">{me.doctorId ? t("noToday") : t("noTodayAll")}</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>{t("time")}</th><th>{t("name")}</th><th>{t("file")}</th><th>{t("visit")}</th>{!me.doctorId && <th>{t("doctor")}</th>}<th>{t("alerts")}</th></tr></thead>
            <tbody>{(rows ?? []).map((r) => {
              const age = ageOf(r.birth_date);
              return (
                <tr key={r.id}>
                  <td className="mono">{hm(r.starts_at, tz)}</td>
                  <td><Link to={`/patients/${r.patient_id}`}>{r.full_name || "—"}</Link>{age !== null && <span className="hint"> · {t("years", { n: age })}</span>}</td>
                  <td className="mono">{r.file_no || "—"}</td>
                  <td>{lang === "ar" ? r.service_ar : r.service_en} <span className="hint">· {d.statuses[r.status] ?? r.status}</span></td>
                  {!me.doctorId && <td>{lang === "ar" ? r.doctor_ar : r.doctor_en}</td>}
                  <td>{r.alerts ? <span className="pill bad">{r.alerts}</span> : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </main>
  );
}

export function PatientList() {
  const { t, lang } = useI18n();
  const { look } = useApp();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PatientRow[] | null>(null);
  useEffect(() => {
    const h = window.setTimeout(() => get<PatientRow[]>(`/api/patients?q=${encodeURIComponent(q)}`).then(setRows).catch(() => setRows([])), 200);
    return () => window.clearTimeout(h);
  }, [q]);
  const tz = look.clinic.timezone;
  return (
    <main className="wrap page">
      <h1 className="display">{t("patients")}</h1>
      <section className="panel">
        <input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search")} />
        {rows && !rows.length ? <p className="hint">{t("noPatients")}</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>{t("name")}</th><th>{t("file")}</th><th>{t("phone")}</th><th>{t("age")}</th><th>{t("lastVisit")}</th><th>{t("nextVisit")}</th></tr></thead>
            <tbody>{(rows ?? []).map((p) => (
              <tr key={p.id}>
                <td><Link to={`/patients/${p.id}`}>{p.full_name || "—"}</Link></td>
                <td className="mono">{p.file_no || "—"}</td>
                <td><bdi dir="ltr" className="mono">{p.phone_e164 || "—"}</bdi></td>
                <td>{ageOf(p.birth_date) ?? "—"}</td>
                <td>{p.last_visit ? fmtDateTime(p.last_visit, tz, lang) : "—"}</td>
                <td>{p.next_visit ? fmtDateTime(p.next_visit, tz, lang) : "—"}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </main>
  );
}
