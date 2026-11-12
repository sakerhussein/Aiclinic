import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, patch, post, type Appt, type Patient } from "../api";
import { dayOf, fmtDateTime, fmtShortDate } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, ExportButton, Field, SendLinkButton, StatusPill, useAction } from "../ui";
import { fill, useN } from "./notes-text";
import { InsuranceLine } from "../insurance";
import { Cam } from "./form";
import { fill as fillOV, useOV } from "./online-text";

type NoteRow = { id: string; appointment_id: string; kind: string; status: string; ai_drafted: boolean; starts_at: string; additions: number;
  doctor_name_en: string; doctor_name_ar: string; service_name_en: string; service_name_ar: string };

// Visit notes on the patient's page (design screen 6): date, doctor, visit and the note's state. Secretaries see this list
// and never the content; the treating doctor opens each note from here.
function PatientNotes({ id }: { id: string }) {
  const n = useN();
  const { lang } = useI18n();
  const { look, can } = useApp();
  const [rows, setRows] = useState<NoteRow[] | null>(null);
  useEffect(() => { get<NoteRow[]>(`/api/patients/${id}/notes`).then(setRows).catch(() => setRows([])); }, [id]);
  if (!rows || (!rows.length && !look.notesEnabled)) return null;
  const state = (r: NoteRow) => (r.status === "signed" && !r.ai_drafted ? n.patientStates.manual : n.patientStates[r.status] ?? r.status);
  return (
    <section className="panel">
      <h2>{n.notesTitle}</h2>
      {rows.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>{n.date}</th><th>{n.doctor}</th><th>{n.visit}</th><th>{n.note}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{can("booking.notes.read") ? <Link to={`/bookings/${r.appointment_id}/note`} state={{ from: `/patients/${id}` }}>{fmtDateTime(r.starts_at, look.clinic.timezone, lang)}</Link> : fmtDateTime(r.starts_at, look.clinic.timezone, lang)}</td>
              <td>{lang === "ar" ? r.doctor_name_ar : r.doctor_name_en}</td>
              <td>{lang === "ar" ? r.service_name_ar : r.service_name_en}</td>
              <td><span className={`pill ${r.status === "signed" ? (r.ai_drafted ? "ok" : "") : r.status === "failed" ? "bad" : "warn"}`}>{state(r)}</span>
                {r.additions > 0 && <span className="hint"> {fill(n.patientStates.additions, { n: r.additions })}</span>}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <p className="hint">{n.notesNone}</p>}
    </section>
  );
}

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
  const { look, can, me } = useApp();
  const { id } = useParams();
  const isNew = id === "new";
  const records = !isNew && me.recordsUrl && (can("records.chart.read") || can("records.details.view")) ? `${me.recordsUrl}/patients/${id}` : "";
  const nav = useNavigate();
  const [f, setF] = useState({ fullName: "", phone: "", language: "ar" as "ar" | "en", whatsappReminders: false, email: "",
    onlineAllowed: false, onlineMode: "" as "" | "video" | "audio" | "patient" });
  const [p0, setP0] = useState<Patient | null>(null);
  const [nextOnline, setNextOnline] = useState<{ appointmentId: string; byName: string | null; at: string; visitAt: string } | null>(null);
  const ov = useOV();
  const [appts, setAppts] = useState<Appt[]>([]);
  const [saved, setSaved] = useState(false);
  const [missing, setMissing] = useState(false);
  const a = useAction();
  const load = useCallback(() => {
    if (isNew) return;
    get<{ patient: Patient; appointments: Appt[]; nextOnline: typeof nextOnline }>(`/api/patients/${id}`).then(({ patient: p, appointments, nextOnline: n }) => {
      setF({ fullName: p.full_name || "", phone: p.phone_e164 || "", language: p.preferred_language || "ar", whatsappReminders: p.whatsapp_reminders,
             email: p.email || "", onlineAllowed: !!p.online_allowed, onlineMode: p.online_mode || "" }); setAppts(appointments); setP0(p); setNextOnline(n ?? null);
    }).catch(() => setMissing(true));
  }, [id, isNew]);
  useEffect(load, [load]);
  const canEdit = can("booking.patients.edit");
  const dup = a.err?.code === "patient_exists" ? String(a.err.data.patientId || "") : "";
  if (missing) return <main className="wrap page"><Banner kind="warn">{t("notAvailable")}</Banner></main>;
  return (
    <main className="wrap page">
      <div className="row between"><h1 className="display">{isNew ? t("newPatientTitle") : t("editPatient")}</h1>{records && <a className="btn btn-outline btn-sm" href={records}>{t("openInRecords")}</a>}</div>
      {!isNew && id && <InsuranceLine patientId={id} as="line" />}
      <form className="panel stack" onSubmit={a.submit(async () => {
        const body = { fullName: f.fullName, phone: f.phone || null, language: f.language, whatsappReminders: f.whatsappReminders, email: f.email.trim() || null,
          ...(look.online?.enabled || p0?.online_allowed ? { onlineAllowed: f.onlineAllowed, onlineMode: f.onlineMode || null } : {}) };
        if (isNew) { const p = await post<Patient>("/api/patients", body); nav(`/patients/${p.id}`); } else { await patch(`/api/patients/${id}`, body); setSaved(true); load(); }
      })}>
        <Field label={t("fullName")}><input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required disabled={!canEdit} /></Field>
        <Field label={t("phoneOptional")} hint={!f.phone ? t("noPhone") : undefined}><input className="mono" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t("language")}><select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as "ar" | "en" })} disabled={!canEdit}><option value="ar">العربية</option><option value="en">English</option></select></Field>
        <label className="check"><input type="checkbox" disabled={!f.phone || !canEdit} checked={f.whatsappReminders && !!f.phone} onChange={(e) => setF({ ...f, whatsappReminders: e.target.checked })} /> <span>{t("reminders")}<br /><small className="hint">{t("reminderHint")}</small></span></label>
        <Field label={ov.email} hint={ov.emailHint}><input className="mono" dir="ltr" type="email" maxLength={120} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} disabled={!canEdit} /></Field>
        {!isNew && (look.online?.enabled || p0?.online_allowed) && <div className="stack onlinebox">
          <b><Cam size={15} /> {ov.docTitle}</b>
          <label className="check"><input type="checkbox" checked={f.onlineAllowed} disabled={!canEdit} onChange={(e) => setF({ ...f, onlineAllowed: e.target.checked })} />
            <span><b>{ov.canBook}</b><br /><small className="hint">{ov.canBookHint}{p0?.online_allowed && p0.online_allowed_by_name && p0.online_allowed_at
              ? " " + fillOV(ov.setBy, { name: p0.online_allowed_by_name, when: fmtShortDate(dayOf(p0.online_allowed_at, look.clinic.timezone), lang) }) : ""}</small></span></label>
          <div className="row" style={{ paddingInlineStart: 30 }}><b className="lbl">{ov.modeField}</b>
            <select value={f.onlineMode} disabled={!canEdit} onChange={(e) => setF({ ...f, onlineMode: e.target.value as typeof f.onlineMode })} aria-label={ov.modeField}>
              <option value="">{fillOV(ov.clinicDefault, { mode: ov.modeShort[look.online?.mode ?? "audio"] })}</option>
              <option value="video">{ov.modeShort.video}</option><option value="audio">{ov.modeShort.audio}</option><option value="patient">{ov.modeShort.patient}</option></select>
            <span className="hint">{ov.profileModeHint}</span></div>
          {nextOnline && <p className="hint">{fillOV(ov.pendingNext, { name: nextOnline.byName ?? "", when: fmtShortDate(dayOf(nextOnline.visitAt, look.clinic.timezone), lang) })}{" "}
            <Link to={`/bookings/${nextOnline.appointmentId}`}>{ov.openBooking}</Link></p>}
        </div>}
        {a.err && <Banner>{a.message} {dup && <Link to={`/patients/${dup}`}>→</Link>}</Banner>}
        {saved && <Banner kind="ok">{t("saved")}</Banner>}
        {canEdit && <div className="row"><button className="btn btn-accent" disabled={a.busy}>{t("save")}</button></div>}
      </form>
      {!isNew && (
        <section className="panel">
          <div className="row between"><h2>{t("patientBookings")}</h2><div className="row"><SendLinkButton phone={f.phone} language={f.language} />{can("booking.appointments.create") && <Link className="btn btn-outline btn-sm" to={`/new?patient=${id}`} state={{ from: `/patients/${id}` }}>{t("newBooking")}</Link>}</div></div>
          <div className="tablewrap"><table><tbody>{appts.map((x) => (
            <tr key={x.id}><td><Link to={`/bookings/${x.id}`} state={{ from: `/patients/${id}` }}>{fmtDateTime(x.starts_at, look.clinic.timezone, lang)}</Link>
              {x.visit_type === "online" && <> <span className="pill vt" title={ov.pill}><Cam size={12} /> {ov.modeShort[x.online_mode ?? "audio"]}</span></>}</td>
              <td>{lang === "ar" ? x.service_name_ar : x.service_name_en}</td><td>{lang === "ar" ? x.doctor_name_ar : x.doctor_name_en}</td>
              <td>{d.sources[x.source] ?? x.source}</td><td><StatusPill status={x.status} /></td></tr>))}</tbody></table></div>
        </section>
      )}
      {!isNew && id && <PatientNotes id={id} />}
    </main>
  );
}
