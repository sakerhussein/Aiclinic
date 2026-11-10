import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { get, post, type Appt } from "../api";
import { backTo, fmtDateTime, hm, todayIn, dayOf } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, ExportButton, SendLinkButton, StatusPill, useAction } from "../ui";
import { NOTE_PILL, useN } from "./notes-text";
import { InsuranceLine } from "../insurance";

export function BookingList() {
  const { t, lang, d } = useI18n();
  const { look, me, can } = useApp();
  const nt = useN();
  const own = me.role === "doctor";                     // a doctor's list holds only their own bookings
  const notes = look.notesEnabled;                      // the visit note column and filter, while the clinic uses visit notes
  const tz = look.clinic.timezone;
  // A link can open the list already filtered (the calendar's "today" line: ?from=…&to=…&status=…&unchecked=1).
  const [sp] = useSearchParams();
  const [f, setF] = useState({ from: sp.get("from") || todayIn(tz), to: sp.get("to") || "", doctor: "", status: sp.get("status") || "", source: "", q: "",
                               voided: false, unchecked: sp.get("unchecked") === "1", note: "" });
  const [rows, setRows] = useState<Appt[] | null>(null);
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from); if (f.to) p.set("to", f.to); if (f.doctor) p.set("doctor", f.doctor);
  if (f.status) p.set("status", f.status); if (f.source) p.set("source", f.source); if (f.q) p.set("q", f.q); if (f.voided) p.set("voided", "1"); if (f.unchecked) p.set("unchecked", "1"); if (notes && f.note) p.set("note", f.note);
  const params = p.toString();
  const load = useCallback(() => {
    get<Appt[]>(`/api/appointments?${params}`).then(setRows).catch(() => setRows([]));
  }, [params]);
  useEffect(load, [load]);
  return (
    <main className="wrap page">
      <div className="row between"><h1 className="display">{t("bookings")}</h1><div className="row"><SendLinkButton /><ExportButton url={`/api/export/bookings?${params}`} />{can("booking.appointments.create") && <Link className="btn btn-accent btn-sm" to="/new">{t("newBooking")}</Link>}</div></div>
      <section className="panel">
        <div className="filters">
          <label className="field">{t("from")}<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="field">{t("to")}<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          {!own && <label className="field">{t("doctor")}<select value={f.doctor} onChange={(e) => setF({ ...f, doctor: e.target.value })}><option value="">{t("allDoctors")}</option>{look.doctors.map((x) => <option key={x.id} value={x.id}>{lang === "ar" ? x.name_ar : x.name_en}</option>)}</select></label>}
          <label className="field">{t("status")}<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">{t("allStatuses")}</option>{Object.entries(d.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field">{t("source")}<select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">{t("allSources")}</option>{Object.entries(d.sources).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {notes && <label className="field">{nt.noteLine}<select value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}>{Object.entries(nt.filter).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
          <label className="field">{t("search")}<input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
          <div className="filter-checks">
            <label className="check"><input type="checkbox" checked={f.voided} onChange={(e) => setF({ ...f, voided: e.target.checked })} /> {t("showVoided")}</label>
            <label className="check"><input type="checkbox" checked={f.unchecked} onChange={(e) => setF({ ...f, unchecked: e.target.checked })} /> {t("onlyUnchecked")}</label>
          </div>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>{t("time")}</th><th>{t("patient")}</th><th>{t("service")}</th>{!own && <th>{t("doctor")}</th>}<th>{t("source")}</th><th>{t("status")}</th>{notes && <th>{nt.noteLine}</th>}</tr></thead>
          <tbody>{rows?.map((a) => (
            <tr key={a.id}>
              <td><Link to={`/bookings/${a.id}`}>{fmtDateTime(a.starts_at, tz, lang)}</Link></td>
              <td>{a.patient_name || "—"} <span className="mono hint">{a.patient_phone}</span>{a.name_differs && <div className="hint warntext">{t("nameDiffers", { name: a.booked_name ?? "" })}</div>}</td>
              <td>{lang === "ar" ? a.service_name_ar : a.service_name_en}</td>
              {!own && <td>{lang === "ar" ? a.doctor_name_ar : a.doctor_name_en}</td>}
              <td>{d.sources[a.source] ?? a.source}{a.online_from ? ` · ${a.online_from}` : ""}</td>
              <td><StatusPill status={a.status} />{a.unchecked && <> <span className="pill warn">{t("notChecked")}</span></>}{a.moved_by_patient && <> <span className="pill warn">{t("movedByPatient")}</span></>}</td>
              {notes && <td><NoteState a={a} /></td>}
            </tr>))}</tbody>
        </table>{rows && rows.length === 0 && <p className="hint">{t("noBookings")}</p>}</div>
      </section>
    </main>
  );
}

// The visit note's state on the list. Only the treating doctor gets a link to it; everyone else sees the state alone.
function NoteState({ a }: { a: Appt }) {
  const nt = useN();
  const { me, can } = useApp();
  if (!a.note_status) return <span className="hint">—</span>;
  const label = a.note_by_hand ? nt.patientStates.manual : nt.states[a.note_status] ?? a.note_status;
  const pill = <span className={`pill ${a.note_by_hand ? "" : NOTE_PILL[a.note_status] ?? ""}`}>{label}</span>;
  return can("booking.notes.read") && me.doctorId === a.doctor_id ? <Link className="notelink" to={`/bookings/${a.id}/note`}>{pill}</Link> : pill;
}

type Ev = { at: string; actor_type: string; actor_label: string; action: string; changed_fields: string[] | null; reason: string | null };

export function BookingDetail() {
  const { t, lang, d } = useI18n();
  const { look, can, me } = useApp();
  const nt = useN();
  const tz = look.clinic.timezone;
  const { id } = useParams();
  const { state } = useLocation();                      // where this booking was opened from; handed on to the note and the edit form
  const [a, setA] = useState<Appt | null>(null);
  const [hist, setHist] = useState<Ev[]>([]);
  const [missing, setMissing] = useState(false);
  const [asking, setAsking] = useState<string | null>(null); const [reason, setReason] = useState("");
  const act = useAction();
  const load = useCallback(() => {
    get<Appt>(`/api/appointments/${id}`).then(setA).catch(() => setMissing(true));
    get<Ev[]>(`/api/appointments/${id}/history`).then(setHist).catch(() => {});
  }, [id]);
  useEffect(load, [load]);
  if (!a) return <main className="wrap page">{missing ? <Banner kind="warn">{t("notAvailable")}</Banner> : <p>{t("loading")}</p>}</main>;

  const active = a.status === "booked" || a.status === "confirmed";
  const NEEDS: Record<string, string> = { confirmed: "booking.appointments.edit", completed: "booking.appointments.edit", no_show: "booking.appointments.edit", cancelled: "booking.appointments.cancel", voided: "booking.appointments.void" };
  const options = (active ? ["confirmed", "completed", "no_show", "cancelled", "voided"] : a.status === "cancelled" ? ["voided"] : []).filter((s) => !(s === "confirmed" && a.status === "confirmed") && can(NEEDS[s]));
  const needsReason = (s: string) => s === "voided" || (s === "cancelled" && look.rules.requireCancelReason);
  const apply = (s: string) => act.run(async () => {
    const r = await post<Appt>(`/api/appointments/${a.id}/status`, { status: s, reason: reason || undefined, expectedVersion: a.row_version });
    setA(r); setAsking(null); setReason(""); load();
  });
  const conflict = act.err?.code === "version_conflict" || act.err?.code === "slot_taken";
  const actorName = (e: Ev) => (e.actor_type === "user" ? e.actor_label : d.actors[e.actor_type] ?? e.actor_label);
  // Visit note (AI Scribe): everyone sees whether there is one; the treating doctor opens or starts it. Secretaries never see the content.
  const ownVisit = me.doctorId === a.doctor_id && can("booking.notes.write");
  const noteButton = can("booking.notes.read") && (a.note_status
    ? <Link className="btn btn-outline btn-sm" to={`/bookings/${a.id}/note`} state={state}>{nt.open}</Link>
    : ownVisit && look.notesEnabled && (active || a.status === "completed") && <Link className="btn btn-accent btn-sm" to={`/bookings/${a.id}/note`} state={state}>{nt.start}</Link>);

  return (
    <main className="wrap page">
      <div className="row between"><h1 className="display">{a.patient_name || a.patient_phone}</h1><div className="row"><StatusPill status={a.status} />{a.unchecked && <span className="pill warn">{t("notChecked")}</span>}{a.moved_by_patient && <span className="pill warn">{t("movedByPatient")}</span>}</div></div>
      <section className="panel">
        <dl className="facts">
          <dt>{t("time")}</dt><dd>{fmtDateTime(a.starts_at, tz, lang)} – {hm(a.ends_at, tz)}</dd>
          <dt>{t("service")}</dt><dd>{lang === "ar" ? a.service_name_ar : a.service_name_en} · {a.duration_minutes} {t("min")}{a.price_jod ? ` · ${a.price_jod} ${t("jod")}` : ""}</dd>
          <dt>{t("doctor")}</dt><dd>{lang === "ar" ? a.doctor_name_ar : a.doctor_name_en}</dd>
          <dt>{t("patient")}</dt><dd><Link to={`/patients/${a.patient_id}`}>{a.patient_name || "—"}</Link> <span className="mono">{a.patient_phone}</span></dd>
          <InsuranceLine patientId={a.patient_id} as="facts" />
          <dt>{t("source")}</dt><dd>{d.sources[a.source] ?? a.source}{a.online_from ? ` · ${t("onlineFrom")} ${a.online_from}` : ""}{a.booked_for_other ? ` · ${t("forOther")}` : ""}</dd>
          {a.internal_note && <><dt>{t("note")}</dt><dd>{a.internal_note}</dd></>}
          {a.cancel_reason && <><dt>{t("reason")}</dt><dd>{a.cancel_reason}</dd></>}
          {a.void_reason && <><dt>{t("reason")}</dt><dd>{a.void_reason}</dd></>}
        </dl>
        {a.name_differs && <Banner kind="warn">{t("nameDiffers", { name: a.booked_name ?? "" })}</Banner>}
        {a.unchecked && active && <Banner kind="warn">{t("checkHint")}</Banner>}
        {a.moved_by_patient && <Banner kind="warn">{t("movedHint")}</Banner>}
        {act.err && (conflict
          ? <Banner><b>{t("conflictTitle")}</b> {act.message} <button className="link" onClick={() => { act.clear(); load(); }}>{t("reload")}</button></Banner>
          : <Banner>{act.message}</Banner>)}
        {(look.notesEnabled || a.note_status) && <p className="hint">{nt.noteLine}: {a.note_status ? (a.note_by_hand ? nt.patientStates.manual : nt.states[a.note_status] ?? a.note_status) : nt.none}</p>}
        <div className="row">
          {noteButton}
          {a.unchecked && active && can("booking.appointments.edit") && <button className="btn btn-accent btn-sm" disabled={act.busy}
            onClick={() => void act.run(async () => { setA(await post<Appt>(`/api/appointments/${a.id}/check`, { expectedVersion: a.row_version })); load(); })}>{t("markChecked")}</button>}
          {active && can("booking.appointments.edit") && <Link className="btn btn-ink btn-sm" to={`/bookings/${a.id}/edit`} state={state}>{t("edit")}</Link>}
          {options.map((s) => <button key={s} className={`btn btn-sm ${s === "voided" || s === "cancelled" ? "btn-outline" : "btn-accent"}`} disabled={act.busy}
            onClick={() => (needsReason(s) ? setAsking(s) : void apply(s))}>{d.actions[s]}</button>)}
          {a.status === "voided" && can("booking.appointments.restore") && <button className="btn btn-accent btn-sm" disabled={act.busy} onClick={() => void act.run(async () => { setA(await post<Appt>(`/api/appointments/${a.id}/restore`, { expectedVersion: a.row_version })); load(); })}>{d.actions.restore}</button>}
        </div>
        {asking && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void apply(asking); }}>
            <input className="grow" placeholder={t("reason")} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
            <button className="btn btn-danger btn-sm" disabled={act.busy || !reason.trim()}>{d.actions[asking]}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setAsking(null); setReason(""); }}>{t("cancel")}</button>
          </form>
        )}
      </section>
      <section className="panel">
        <h2>{t("history")}</h2>
        <ol className="hist">{hist.map((e, i) => (
          <li key={i}><b>{d.historyActions[e.action === "updated" && e.changed_fields?.includes("checked_at") ? "checked" : e.action] ?? e.action}</b> · {t("by")} {actorName(e)} · <span className="hint">{fmtDateTime(e.at, tz, lang)}</span>{e.reason && <> · “{e.reason}”</>}</li>))}</ol>
      </section>
      <Link to={backTo(state, "/bookings")} className="link">{t("back")}</Link>
      <span hidden>{dayOf(a.starts_at, tz)}</span>
    </main>
  );
}
