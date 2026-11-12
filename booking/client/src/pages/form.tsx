import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, get, patch, post, type Appt, type Patient } from "../api";
import { backTo, dayOf, fmtDateTime, hm, localToIso, todayIn } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, Field, useAction } from "../ui";
import { fill, useOV } from "./online-text";
import { duration, useS } from "./settings-text";

type Slot = { doctorId: string; startsAt: string };

// One page for a new booking and for editing one (design §4.2).
export function BookingForm() {
  const { t, lang, d } = useI18n();
  const { look, can, me } = useApp();
  const tz = look.clinic.timezone;
  const nav = useNavigate();
  const { id } = useParams();
  const { state } = useLocation();                      // where the booking was opened from: handed on, so its "Back" returns there
  const [q] = useSearchParams();
  const editing = !!id;
  const [orig, setOrig] = useState<Appt | null>(null);
  const [patientQ, setPatientQ] = useState(""); const [found, setFound] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [np, setNp] = useState({ fullName: "", phone: "", language: "ar" as "ar" | "en", whatsappReminders: false });
  const [serviceId, setServiceId] = useState(q.get("service") || "");     // ?service=: "Book session 5" from a course in Records
  const ownDoctor = me.role === "doctor" ? me.doctorId : null;   // a doctor books for themselves
  const [doctorId, setDoctorId] = useState(ownDoctor || q.get("doctor") || "any");
  const [date, setDate] = useState(q.get("date") || (q.get("start") ? dayOf(q.get("start")!, tz) : todayIn(tz)));
  const [startsAt, setStartsAt] = useState(q.get("start") || "");
  const [other, setOther] = useState(false); const [otherHm, setOtherHm] = useState("");
  const [source, setSource] = useState<"phone" | "walkin">("phone");
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [done, setDone] = useState("");
  const a = useAction();
  // Online visits (design: booking/design/online-visits.html). ?online=1&mode=: from "Book the next visit".
  const ov = useOV(); const ss = useS();
  const on = look.online?.enabled ? look.online : null;
  const [visit, setVisit] = useState<"in_clinic" | "online">(q.get("online") === "1" ? "online" : "in_clinic");
  const askedMode = q.get("mode");
  const [mode, setMode] = useState<"video" | "audio" | "">(askedMode === "video" || askedMode === "audio" ? askedMode : "");
  const [channel, setChannel] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [meetingUrl, setMeetingUrl] = useState(""); const [ownLink, setOwnLink] = useState(false);
  const isOnline = visit === "online";

  useEffect(() => {
    if (!id) return;
    get<Appt>(`/api/appointments/${id}`).then((x) => {
      setOrig(x); setServiceId(x.service_id); setDoctorId(x.doctor_id); setDate(dayOf(x.starts_at, tz)); setStartsAt(x.starts_at);
      setNote(x.internal_note || ""); setPatient({ id: x.patient_id, full_name: x.patient_name, phone_e164: x.patient_phone, preferred_language: null, whatsapp_reminders: x.whatsapp_reminders, email: x.patient_email });
      setVisit(x.visit_type === "online" ? "online" : "in_clinic"); setMode(x.online_mode ?? ""); setChannel(x.link_channel ?? ""); setLinkEmail(x.link_email ?? "");
      setMeetingUrl(x.meeting_url ?? ""); setOwnLink(!!x.meeting_url);
    }).catch(() => nav(`/bookings/${id}`, { replace: true, state }));     // the booking page says it is not available
  }, [id, tz]);                                                    // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pid = q.get("patient");
    if (pid && !id) get<{ patient: Patient }>(`/api/patients/${pid}`).then((r) => setPatient(r.patient)).catch(() => {});
  }, [q, id]);

  useEffect(() => {
    if (patientQ.trim().length < 2) { setFound([]); return; }
    const h = window.setTimeout(() => get<Patient[]>(`/api/patients?q=${encodeURIComponent(patientQ)}`).then(setFound).catch(() => {}), 250);
    return () => window.clearTimeout(h);
  }, [patientQ]);

  const doctorsFor = look.doctors.filter((x) => (!ownDoctor || x.id === ownDoctor) && (!serviceId || x.service_ids.includes(serviceId)) && (!isOnline || x.online_enabled));
  const services = look.services.filter((s) => (!ownDoctor || look.doctors.find((x) => x.id === ownDoctor)?.service_ids.includes(s.id)) && (!isOnline || s.online_allowed));
  useEffect(() => {
    if (!serviceId) { setSlots([]); return; }
    const qs = `service=${serviceId}&date=${date}${doctorId !== "any" ? `&doctor=${doctorId}` : ""}`;
    get<Slot[]>(`/api/slots?${qs}`).then((s) => setSlots(s.filter((x) => dayOf(x.startsAt, tz) === date))).catch(() => setSlots([]));
  }, [serviceId, doctorId, date, tz]);

  const times = [...new Set(slots.map((s) => s.startsAt))];
  const chosen = other && otherHm ? localToIso(date, Number(otherHm.slice(0, 2)), Number(otherHm.slice(3, 5)), tz) : startsAt;
  const isOther = !!chosen && !times.includes(chosen);
  const service = look.services.find((s) => s.id === serviceId);
  // Video or audio: the most specific choice (the patient's profile, then the clinic). Staff may change it when Settings allows.
  const profileMode = patient?.online_mode ?? null;
  const defaultMode = ((profileMode ?? on?.mode) === "video" ? "video" : "audio") as "video" | "audio";
  const shownMode = mode || defaultMode;
  const linkWay = channel || on?.defaultChannel || "whatsapp";
  const doctor = doctorId !== "any" ? look.doctors.find((x) => x.id === doctorId) : null;
  const insideBuffer = isOnline && !!chosen && !!doctor?.online_min_notice_minutes && Date.parse(chosen) < Date.now() + doctor.online_min_notice_minutes * 60000;
  const onlineBody = (bufferOk = false) => (isOnline ? { visitType: "online", onlineMode: shownMode, linkChannel: linkWay, linkEmail: linkWay === "email" ? linkEmail.trim() || patient?.email || null : null,
    meetingUrl: ownLink ? meetingUrl.trim() || null : null, allowInsideBuffer: insideBuffer || allowBuffer || bufferOk } : editing ? { visitType: "in_clinic" } : {});
  const [allowBuffer, setAllowBuffer] = useState(false);

  async function save(allowOverLimit = false, existingPatient = "", bufferOk = false) {
    if (isOnline && linkWay === "email" && !linkEmail.trim() && !patient?.email) throw new ApiError(400, "email_needed");
    if (!chosen) throw new Error("no time");
    if (editing && orig) {
      const r = await patch<Appt>(`/api/appointments/${orig.id}`, { expectedVersion: orig.row_version, serviceId, doctorId: doctorId === "any" ? undefined : doctorId,
        startsAt: chosen, internalNote: note || null, override: isOther, ...onlineBody(bufferOk) });
      nav(`/bookings/${r.id}`, { state });
    } else {
      const body: Record<string, unknown> = { serviceId, doctorId, startsAt: chosen, source, internalNote: note || null, override: isOther, allowOverLimit, ...onlineBody(bufferOk) };
      if (existingPatient) body.patientId = existingPatient;
      else if (isNew) body.newPatient = { fullName: np.fullName, phone: np.phone || null, language: np.language, whatsappReminders: np.whatsappReminders };
      else body.patientId = patient!.id;
      const r = await post<Appt>("/api/appointments", body);
      setDone(r.id); nav(`/bookings/${r.id}`, { state });
    }
  }
  const conflict = a.err?.code === "version_conflict";
  const ready = !!serviceId && !!chosen && (editing || isNew ? (isNew ? !!np.fullName.trim() : true) : !!patient);

  return (
    <main className="wrap page">
      <h1 className="display">{editing ? t("edit") : t("newBooking")}</h1>
      <form className="panel formgrid" onSubmit={a.submit(() => save())}>
        <section>
          <h2>{t("patient")}</h2>
          {editing || (patient && !isNew) ? (
            <div className="row"><b>{patient?.full_name || patient?.phone_e164}</b><span className="mono hint">{patient?.phone_e164}</span>
              {!editing && <button type="button" className="link" onClick={() => setPatient(null)}>{t("clear")}</button>}</div>
          ) : isNew ? (
            <div className="stack">
              <Field label={t("fullName")}><input value={np.fullName} onChange={(e) => setNp({ ...np, fullName: e.target.value })} required /></Field>
              <Field label={t("phoneOptional")} hint={!np.phone ? t("noPhone") : undefined}><input className="mono" inputMode="tel" value={np.phone} onChange={(e) => setNp({ ...np, phone: e.target.value })} /></Field>
              <Field label={t("language")}><select value={np.language} onChange={(e) => setNp({ ...np, language: e.target.value as "ar" | "en" })}><option value="ar">العربية</option><option value="en">English</option></select></Field>
              <label className="check"><input type="checkbox" disabled={!np.phone} checked={np.whatsappReminders && !!np.phone} onChange={(e) => setNp({ ...np, whatsappReminders: e.target.checked })} /> <span>{t("reminders")}<br /><small className="hint">{t("reminderHint")}</small></span></label>
              <button type="button" className="link" onClick={() => setIsNew(false)}>{t("existingPatient")}</button>
            </div>
          ) : (
            <div className="stack">
              <input placeholder={t("pickPatient")} value={patientQ} onChange={(e) => setPatientQ(e.target.value)} autoFocus />
              {found.map((p) => <button type="button" key={p.id} className="pick" onClick={() => { setPatient(p); setFound([]); }}><b>{p.full_name || "—"}</b> <span className="mono">{p.phone_e164}</span>{p.last_visit && <small> · {t("lastVisit")}: {fmtDateTime(p.last_visit, tz, lang)}</small>}</button>)}
              {can("booking.patients.edit") && <button type="button" className="link" onClick={() => { setIsNew(true); setNp({ ...np, fullName: /\d/.test(patientQ) ? "" : patientQ, phone: /\d/.test(patientQ) ? patientQ : "" }); }}>{t("newPatient")}</button>}
            </div>
          )}
        </section>

        <section className="stack">
          <h2>{t("details")}</h2>
          {(on || isOnline) && <div className="stack">
            <b className="lbl">{ov.visit}</b>
            <div className="seg" role="radiogroup" aria-label={ov.visit}>
              <button type="button" role="radio" aria-checked={!isOnline} className={!isOnline ? "on" : ""} onClick={() => setVisit("in_clinic")}>{ov.atClinic}</button>
              <button type="button" role="radio" aria-checked={isOnline} className={isOnline ? "on" : ""} disabled={!on} onClick={() => {
                setVisit("online");
                if (serviceId && !look.services.find((s) => s.id === serviceId)?.online_allowed) { setServiceId(""); setStartsAt(""); }
                if (doctorId !== "any" && !look.doctors.find((x) => x.id === doctorId)?.online_enabled && !ownDoctor) { setDoctorId("any"); setStartsAt(""); }
              }}><Cam /> {ov.online}</button>
            </div>
            {isOnline && <div className="grid2">
              <Field label={ov.modeField}><select value={shownMode} disabled={!on?.staffChangeMode} onChange={(e) => setMode(e.target.value as "video" | "audio")}>
                <option value="audio">{ov.modeShort.audio}</option><option value="video">{ov.modeShort.video}</option></select></Field>
              <Field label={ov.sendBy}><select value={linkWay} onChange={(e) => setChannel(e.target.value)}>
                {(on?.channels ?? []).filter((c) => c !== "sms").map((c) => <option key={c} value={c}>{ov.chName[c] ?? c}</option>)}</select></Field>
            </div>}
            {isOnline && linkWay === "email" && <Field label={ov.email} hint={patient?.email && !linkEmail ? patient.email : ov.emailHint}>
              <input className="mono" dir="ltr" type="email" maxLength={120} value={linkEmail} placeholder={patient?.email ?? ""} onChange={(e) => setLinkEmail(e.target.value)} /></Field>}
            {isOnline && !ownLink && <span className="hint">{doctor && !doctor.has_teams_link ? ov.noDoctorLink : ov.doctorLink}{" "}
              <button type="button" className="link" onClick={() => setOwnLink(true)}>{ov.useAnother}</button></span>}
            {isOnline && ownLink && <Field label={ov.linkForBooking}><div className="linkrow">
              <input className="mono" dir="ltr" type="url" maxLength={2000} value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://teams.microsoft.com/…" />
              <button type="button" className="link" onClick={() => { setOwnLink(false); setMeetingUrl(""); }}>{ov.useDoctors}</button></div></Field>}
          </div>}
          <Field label={t("service")}>
            <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setStartsAt(""); }} required>
              <option value="">{t("pickService")}</option>
              {services.map((s) => <option key={s.id} value={s.id}>{lang === "ar" ? s.name_ar : s.name_en} · {s.duration_minutes} {t("min")}{s.price_jod ? ` · ${s.price_jod} ${t("jod")}` : ""}</option>)}
            </select>
          </Field>
          <Field label={t("doctor")}>
            <select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setStartsAt(""); }}>
              {!editing && !ownDoctor && <option value="any">{t("anyDoctor")}</option>}
              {doctorsFor.map((x) => <option key={x.id} value={x.id}>{lang === "ar" ? x.name_ar : x.name_en}</option>)}
            </select>
          </Field>
          <Field label={t("date")}><input type="date" value={date} min={todayIn(tz)} onChange={(e) => { setDate(e.target.value); setStartsAt(""); }} required /></Field>
          <div>
            <b className="lbl">{t("freeTimes")}</b>
            {serviceId && times.length === 0 && <p className="hint">{t("noFreeTimes")}</p>}
            <div className="chips">
              {times.map((s) => <button type="button" key={s} className={`chip ${!other && chosen === s ? "on" : ""}`} onClick={() => { setOther(false); setStartsAt(s); }}>{hm(s, tz)}</button>)}
              {look.rules.outsideHours !== "block" && <button type="button" className={`chip ${other ? "on" : ""}`} onClick={() => setOther(!other)}>{t("otherTime")}</button>}
            </div>
            {other && <div className="stack"><input type="time" value={otherHm} onChange={(e) => setOtherHm(e.target.value)} step={300} required />{look.rules.outsideHours === "warn" && <Banner kind="warn">{t("otherTimeWarn")}</Banner>}</div>}
            {!other && isOther && chosen && look.rules.outsideHours === "warn" && <Banner kind="warn">{t("warnOutside")}: {hm(chosen, tz)}</Banner>}
            {insideBuffer && doctor && <Banner kind="warn">{fill(ov.insideBuffer, { t: duration(doctor.online_min_notice_minutes!, ss) })}</Banner>}
          </div>
          {!editing && (
            <Field label={t("source")}><select value={source} onChange={(e) => setSource(e.target.value as "phone" | "walkin")}><option value="phone">{d.sources.phone}</option><option value="walkin">{d.sources.walkin}</option></select></Field>
          )}
          <Field label={t("note")} hint={t("noteHint")}><textarea className="ta" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} rows={3} /></Field>
          {service && <p className="hint">{t("duration")}: {service.duration_minutes} {t("min")}</p>}
        </section>

        <div className="formfoot">
          {conflict && (
            <Banner><b>{t("conflictTitle")}</b><br />{t("conflictBody", { time: a.err?.data.changedAt ? fmtDateTime(String(a.err.data.changedAt), tz, lang) : "", v: String(a.err?.data.currentVersion ?? "") })}{" "}
              <button type="button" className="link" onClick={() => window.location.reload()}>{t("reload")}</button></Banner>
          )}
          {a.err && !conflict && <Banner>{a.message}{a.err.code === "over_max_upcoming" && <> <button type="button" className="link" onClick={() => void a.run(() => save(true))}>{t("bookAnyway")}</button></>}
            {a.err.code === "inside_online_buffer" && <> <button type="button" className="link" onClick={() => { setAllowBuffer(true); void a.run(() => save(false, "", true)); }}>{t("bookAnyway")}</button></>}
            {a.err.code === "patient_exists" && !!a.err.data.patientId && <> <button type="button" className="link" onClick={() => void a.run(() => save(false, String(a.err?.data.patientId)))}>{t("bookThisPatient")}</button></>}</Banner>}
          <div className="row">
            <button className="btn btn-accent" disabled={a.busy || !ready || !!done}>{editing ? t("save") : isOther ? t("confirmOther") : t("create")}</button>
            <Link className="btn btn-outline" to={editing ? `/bookings/${id}` : backTo(state, "/")} state={editing ? state : undefined}>{t("cancel")}</Link>
          </div>
          {!chosen && serviceId && <p className="hint">{t("chooseTime")}</p>}
        </div>
      </form>
      <span hidden>{me.user.id}</span>
    </main>
  );
}
export const Cam = ({ size = 14 }: { size?: number }) => (
  <svg className="vic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3z" /></svg>);
