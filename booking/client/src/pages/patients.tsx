import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, patch, post, type Appt, type Patient } from "../api";
import { fmtDateTime } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, ExportButton, Field, SendLinkButton, StatusPill, useAction } from "../ui";

export function PatientList() {
  const { t, lang } = useI18n();
  const { look, can, me } = useApp();
  const [q, setQ] = useState(""); const [rows, setRows] = useState<Patient[]>([]);
  useEffect(() => { const h = window.setTimeout(() => get<Patient[]>(`/api/patients?q=${encodeURIComponent(q)}`).then(setRows).catch(() => {}), 200); return () => window.clearTimeout(h); }, [q]);
  return (
    <main className="wrap page">
      <div className="row between"><h1 className="display">{t("patients")}</h1><div className="row"><ExportButton url={`/api/export/patients?q=${encodeURIComponent(q)}`} />{can("booking.patients.edit") && me.role !== "doctor" && <Link className="btn btn-accent btn-sm" to="/patients/new">{t("newPatientTitle")}</Link>}</div></div>
      <section className="panel">
        <input placeholder={t("pickPatient")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tablewrap"><table>
          <thead><tr><th>{t("name")}</th><th>{t("phone")}</th><th>{t("reminders")}</th><th>{t("lastVisit")}</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}><td><Link to={`/patients/${p.id}`}>{p.full_name || "—"}</Link></td><td><bdi dir="ltr" className="mono">{p.phone_e164 || "—"}</bdi></td>
              <td>{p.whatsapp_reminders ? "✓" : "—"}</td><td>{p.last_visit ? fmtDateTime(p.last_visit, look.clinic.timezone, lang) : "—"}</td></tr>))}</tbody>
        </table></div>
      </section>
    </main>
  );
}

export function PatientPage() {
  const { t, lang, d } = useI18n();
  const { look, can } = useApp();
  const { id } = useParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const [f, setF] = useState({ fullName: "", phone: "", language: "ar" as "ar" | "en", whatsappReminders: false });
  const [appts, setAppts] = useState<Appt[]>([]);
  const [saved, setSaved] = useState(false);
  const [missing, setMissing] = useState(false);
  const a = useAction();
  const load = useCallback(() => {
    if (isNew) return;
    get<{ patient: Patient; appointments: Appt[] }>(`/api/patients/${id}`).then(({ patient: p, appointments }) => {
      setF({ fullName: p.full_name || "", phone: p.phone_e164 || "", language: p.preferred_language || "ar", whatsappReminders: p.whatsapp_reminders }); setAppts(appointments);
    }).catch(() => setMissing(true));
  }, [id, isNew]);
  useEffect(load, [load]);
  const canEdit = can("booking.patients.edit");
  const dup = a.err?.code === "patient_exists" ? String(a.err.data.patientId || "") : "";
  if (missing) return <main className="wrap page"><Banner kind="warn">{t("notAvailable")}</Banner></main>;
  return (
    <main className="wrap page">
      <h1 className="display">{isNew ? t("newPatientTitle") : t("editPatient")}</h1>
      <form className="panel stack" onSubmit={a.submit(async () => {
        const body = { fullName: f.fullName, phone: f.phone || null, language: f.language, whatsappReminders: f.whatsappReminders };
        if (isNew) { const p = await post<Patient>("/api/patients", body); nav(`/patients/${p.id}`); } else { await patch(`/api/patients/${id}`, body); setSaved(true); load(); }
      })}>
        <Field label={t("fullName")}><input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required disabled={!canEdit} /></Field>
        <Field label={t("phoneOptional")} hint={!f.phone ? t("noPhone") : undefined}><input className="mono" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t("language")}><select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as "ar" | "en" })} disabled={!canEdit}><option value="ar">العربية</option><option value="en">English</option></select></Field>
        <label className="check"><input type="checkbox" disabled={!f.phone || !canEdit} checked={f.whatsappReminders && !!f.phone} onChange={(e) => setF({ ...f, whatsappReminders: e.target.checked })} /> <span>{t("reminders")}<br /><small className="hint">{t("reminderHint")}</small></span></label>
        {a.err && <Banner>{a.message} {dup && <Link to={`/patients/${dup}`}>→</Link>}</Banner>}
        {saved && <Banner kind="ok">{t("saved")}</Banner>}
        {canEdit && <div className="row"><button className="btn btn-accent" disabled={a.busy}>{t("save")}</button></div>}
      </form>
      {!isNew && (
        <section className="panel">
          <div className="row between"><h2>{t("patientBookings")}</h2><div className="row"><SendLinkButton phone={f.phone} language={f.language} />{can("booking.appointments.create") && <Link className="btn btn-outline btn-sm" to={`/new?patient=${id}`}>{t("newBooking")}</Link>}</div></div>
          <div className="tablewrap"><table><tbody>{appts.map((x) => (
            <tr key={x.id}><td><Link to={`/bookings/${x.id}`}>{fmtDateTime(x.starts_at, look.clinic.timezone, lang)}</Link></td>
              <td>{lang === "ar" ? x.service_name_ar : x.service_name_en}</td><td>{lang === "ar" ? x.doctor_name_ar : x.doctor_name_en}</td>
              <td>{d.sources[x.source] ?? x.source}</td><td><StatusPill status={x.status} /></td></tr>))}</tbody></table></div>
        </section>
      )}
    </main>
  );
}
