// Records, phase C on the chart (design: booking/design/records-phase-c.html §1–§5): the AI summary before the visit, treatment
// courses, prescriptions (written, checked, printed) and the Forms tab (what the patient wrote, confirmed by the doctor).
// Each part shows only while the clinic has it switched on in Settings; the server checks every rule again.
import { useCallback, useEffect, useRef, useState } from "react";
import { ageOf, get, patch, post, type Chart, type ComingVisit, type Course, type Entry, type FormLink, type FormResponse, type FormsList,
  type Question, type Rx, type RxItem, type RxList, type SummaryState } from "../api";
import { fmtDateTime, fmtShortDate } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, Field, useAction } from "../ui";
import { fill, textFor, useV } from "../visit-text";

const dayOfIso = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));

// ---------------------------------------------------------------- the AI summary before the visit
export function AiSummary({ patientId }: { patientId: string }) {
  const v = useV();
  const { lang, error } = useI18n();
  const { me, look } = useApp();
  const tz = look.clinic.timezone;
  const [st, setSt] = useState<SummaryState | null>(null);
  const a = useAction();
  const auto = useRef(false);
  const make = useCallback(() => a.run(async () => setSt(await post<SummaryState>(`/api/patients/${patientId}/summary`, { lang }))), [patientId, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    auto.current = false;
    get<SummaryState>(`/api/patients/${patientId}/summary`).then(setSt).catch(() => setSt(null));
  }, [patientId]);
  // Made by itself the first time the chart is opened on the visit day, and again after a newer note was signed.
  useEffect(() => {
    if (!st || auto.current || !st.on || !st.visitToday || !st.stale || st.used >= st.cap) return;
    auto.current = true;
    void make();
  }, [st, make]);
  if (!st || (!st.on && !st.summary)) return null;
  const s = st.summary;
  const src = (l: SummaryState["summary"] extends infer S ? S extends { lines: (infer L)[] } ? L : never : never) => {
    const date = l.source.at ? fmtShortDate(l.source.at.length > 10 ? dayOfIso(l.source.at, tz) : l.source.at, lang) : "";
    if (l.source.kind === "note" && l.source.appointment_id) return <a className="src" href={`${me.bookingUrl}/bookings/${l.source.appointment_id}/note`}>{fill(v.srcNote, { date })}</a>;
    if (l.source.kind === "result" && l.source.id) return <button type="button" className="src linkish" onClick={() => void openFile(l.source.id!)}>{fill(v.srcResult, { date })}</button>;
    return <span className="src">{v.srcChart}</span>;
  };
  return (
    <section className="ccard ai">
      <h3><span>{v.aiTitle} <span className="pill ai-pill">AI</span></span>{s && <span className="hint">{fill(v.aiFrom, { notes: s.basis.notes, results: s.basis.results, when: fmtDateTime(s.made_at, tz, lang) })}</span>}</h3>
      {a.busy && <p className="hint" role="status">{v.aiMaking}</p>}
      {!s && !a.busy && <p className="hint">{v.aiNone}</p>}
      {s && <ul className="ailines" dir={s.language === "ar" ? "rtl" : "ltr"}>{s.lines.map((l, i) => <li key={i}><span dir="auto">{l.text}</span> {src(l)}</li>)}</ul>}
      {s && st.stale && !a.busy && <p className="hint">{v.aiStale}</p>}
      <p className="hint">{v.aiNote}</p>
      {a.err && <Banner>{a.message}</Banner>}
      {st.on && <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-outline btn-sm" disabled={a.busy || st.used >= st.cap} onClick={() => void make()}>{s ? v.aiAgain : v.aiMake}</button>
        <span className="hint">{v.aiAuto} {fill(v.aiUsed, { used: st.used, cap: st.cap })}</span>
      </div>}
      {!st.on && <span className="hint">{error("summary_off")}</span>}
    </section>
  );
}
async function openFile(id: string) {
  const w = window.open("", "_blank");
  try { const l = await get<{ url: string }>(`/api/files/${id}/link`); if (w) w.location.href = l.url; else window.location.assign(l.url); } catch { w?.close(); }
}

// ---------------------------------------------------------------- treatment courses
export function Courses({ patientId }: { patientId: string }) {
  const v = useV();
  const { lang } = useI18n();
  const { me, can, look } = useApp();
  const [list, setList] = useState<Course[] | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => { get<Course[]>(`/api/patients/${patientId}/courses`).then(setList).catch(() => setList(null)); }, [patientId]);
  if (!look.settings.coursesOn || !list) return null;
  const edit = can("records.courses.edit");
  return (
    <section className="ccard">
      <h3><span>{v.courses}</span>{edit && !starting && <button className="link" style={{ fontSize: 13, fontWeight: 500 }} onClick={() => setStarting(true)}>{v.startCourse}</button>}</h3>
      {list.length === 0 && !starting && <p className="hint">{v.noCourses}</p>}
      {list.map((c) => <CourseRow key={c.id} c={c} patientId={patientId} edit={edit} bookingUrl={me.bookingUrl} lang={lang} onChange={setList} />)}
      {starting && <StartCourse patientId={patientId} onDone={(l) => { if (l) setList(l); setStarting(false); }} />}
    </section>
  );
}

function CourseRow({ c, patientId, edit, bookingUrl, lang, onChange }: { c: Course; patientId: string; edit: boolean; bookingUrl: string; lang: "en" | "ar"; onChange: (l: Course[]) => void }) {
  const v = useV();
  const { t } = useI18n();
  const { look } = useApp();
  const tz = look.clinic.timezone;
  const [open, setOpen] = useState(false);
  const [ending, setEnding] = useState(false); const [reason, setReason] = useState("");
  const [areaEdit, setAreaEdit] = useState({ areas: c.areas, note: c.note ?? "" });
  const a = useAction();
  const today = dayOfIso(new Date().toISOString(), tz);
  const todays = c.list.find((x) => dayOfIso(x.starts_at, tz) === today);
  const booked = c.list.some((x) => x.n === c.next);
  const bookHref = c.next ? `${bookingUrl}/new?patient=${patientId}&service=${c.service_id}${c.next_about ? `&date=${c.next_about}` : ""}` : null;
  const name = lang === "ar" ? c.service_ar : c.service_en;
  const areaNames = areaLabels(c.areas, look.settings.photoAreas, lang);
  const [changing, setChanging] = useState(false);
  const pct = Math.min(100, Math.round((c.done / c.sessions) * 100));
  return (
    <div className="course">
      <div className="row between" style={{ gap: 8 }}>
        <b dir="auto">{name}{areaNames ? <span className="hint">{lang === "ar" ? "، " : ", "}{areaNames}</span> : null}</b>
        <span className="pill">{fill(v.ofN, { n: c.done, of: c.sessions })}</span>
      </div>
      {c.note && <p className="hint" dir="auto" style={{ margin: 0 }}>{c.note}</p>}
      <div className="cbar" aria-hidden="true"><span style={{ inlineSize: `${pct}%` }} /></div>
      {c.ended_at ? <p className="hint">{fill(v.ended, { name: c.ended_by_name ?? "", reason: c.end_reason ?? "" })}</p>
        : c.complete ? <p className="hint">{v.completeCourse}</p>
        : <p className="hint">{c.every_weeks ? fill(v.every, { w: c.every_weeks }) : v.everyNone} {todays ? fill(v.todayIs, { n: todays.n }) : ""} {c.next && !booked ? fill(v.notBooked, { n: c.next }) : ""}</p>}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {bookHref && <a className="btn btn-accent btn-sm" href={bookHref}>{c.next_about ? fill(v.bookNAbout, { n: c.next!, date: fmtShortDate(c.next_about, lang) }) : fill(v.bookN, { n: c.next! })}</a>}
        <button type="button" className="link" onClick={() => setOpen(!open)}>{open ? v.hide : v.details}</button>
      </div>
      {open && (
        <div className="sessions">
          {Array.from({ length: c.sessions }, (_, i) => i + 1).map((n) => {
            const s = c.list.find((x) => x.n === n);
            return (
              <div key={n} className="li">
                <span>{fill(v.sessionN, { n })}{s ? ` · ${fmtDateTime(s.starts_at, tz, lang)}` : c.next === n && c.next_about ? ` · ${fmtShortDate(c.next_about, lang)}` : ""}
                  {s && <><br /><span className="s">{lang === "ar" ? s.doctor_ar : s.doctor_en}</span></>}</span>
                <span className="end">{s ? <span className={`pill ${s.status === "completed" ? "ok" : "warn"}`}>{s.status === "completed" ? v.sDone : v.sBooked}</span> : null}</span>
              </div>
            );
          })}
          <p className="hint">{v.countHint}</p>
          {edit && !c.ended_at && <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="link" disabled={a.busy} onClick={() => void a.run(async () => onChange(await patch<Course[]>(`/api/courses/${c.id}`, { sessions: c.sessions + 1, expectedVersion: c.row_version })))}>{v.addSession}</button>
            {!changing && <button type="button" className="link" onClick={() => setChanging(true)}>{v.changeAreas}</button>}
            {!ending && !c.complete && <button type="button" className="link" style={{ color: "var(--muted)" }} onClick={() => setEnding(true)}>{v.endEarly}</button>}
          </div>}
          {changing && (
            <form className="efrm" onSubmit={a.submit(async () => { onChange(await patch<Course[]>(`/api/courses/${c.id}`, { areas: areaEdit.areas, note: areaEdit.note.trim() || null, expectedVersion: c.row_version })); setChanging(false); })}>
              <AreasNote value={areaEdit} onChange={setAreaEdit} />
              <div className="row"><button className="btn btn-ink btn-sm" disabled={a.busy || (look.settings.courseAreaRequired && !areaEdit.areas.length)}>{t("save")}</button>
                <button type="button" className="link" onClick={() => setChanging(false)}>{t("cancel")}</button></div>
            </form>
          )}
          {ending && (
            <form className="efrm" onSubmit={a.submit(async () => { onChange(await post<Course[]>(`/api/courses/${c.id}/end`, { reason, expectedVersion: c.row_version })); setEnding(false); })}>
              <Field label={v.endReason}><input dir="auto" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required autoFocus /></Field>
              <div className="row"><button className="btn btn-danger btn-sm" disabled={a.busy || !reason.trim()}>{v.endIt}</button><button type="button" className="link" onClick={() => setEnding(false)}>{t("cancel")}</button></div>
            </form>
          )}
          {a.err && <Banner>{a.message}</Banner>}
        </div>
      )}
    </div>
  );
}

function StartCourse({ patientId, onDone }: { patientId: string; onDone: (l: Course[] | null) => void }) {
  const v = useV();
  const { t, lang } = useI18n();
  const { look } = useApp();
  const defs = look.settings.courseDefaults;
  const first = defs[0];
  const [f, setF] = useState({ serviceId: first?.serviceId ?? look.services[0]?.id ?? "", sessions: first?.sessions ?? 6, everyWeeks: first?.weeks ?? 6, areas: [] as string[], note: "" });
  const a = useAction();
  const pickService = (id: string) => { const d = defs.find((x) => x.serviceId === id); setF({ ...f, serviceId: id, ...(d ? { sessions: d.sessions, everyWeeks: d.weeks } : {}) }); };
  const services = [...look.services].sort((x, y) => Number(defs.some((d) => d.serviceId === y.id)) - Number(defs.some((d) => d.serviceId === x.id)));
  return (
    <form className="efrm" onSubmit={a.submit(async () => onDone(await post<Course[]>(`/api/patients/${patientId}/courses`, { ...f, note: f.note.trim() || null })))}>
      <Field label={v.service}><select value={f.serviceId} onChange={(e) => pickService(e.target.value)}>{services.map((s) => <option key={s.id} value={s.id}>{lang === "ar" ? s.name_ar : s.name_en}</option>)}</select></Field>
      <div className="grid3">
        <Field label={v.sessionsN}><input type="number" min={1} max={50} value={f.sessions} onChange={(e) => setF({ ...f, sessions: Number(e.target.value) })} /></Field>
        <Field label={v.everyWeeks}><input type="number" min={0} max={52} value={f.everyWeeks} onChange={(e) => setF({ ...f, everyWeeks: Number(e.target.value) })} /></Field>
      </div>
      <AreasNote value={f} onChange={(x) => setF({ ...f, ...x })} />
      <p className="hint">{v.defaultsHint}</p>
      {a.err && <Banner>{a.message}</Banner>}
      <div className="row"><button className="btn btn-ink btn-sm" disabled={a.busy || !f.serviceId || (look.settings.courseAreaRequired && !f.areas.length)}>{v.start}</button><button type="button" className="link" onClick={() => onDone(null)}>{t("cancel")}</button></div>
    </form>
  );
}

/** "Legs, Underarms": a course's areas by the clinic's names for them. */
function areaLabels(keys: string[], list: { key: string; en: string; ar: string }[], lang: "en" | "ar") {
  return keys.map((k) => { const x = list.find((y) => y.key === k); return x ? (lang === "ar" ? x.ar : x.en) : k; }).join(lang === "ar" ? "، " : ", ");
}

/** The course's body areas (chips from Settings › Photos and documents, one or more) and the note, apart, for reports by area. */
function AreasNote({ value, onChange }: { value: { areas: string[]; note: string }; onChange: (x: { areas: string[]; note: string }) => void }) {
  const v = useV();
  const { t, lang } = useI18n();
  const { look } = useApp();
  const req = look.settings.courseAreaRequired;
  const toggle = (k: string) => onChange({ ...value, areas: value.areas.includes(k) ? value.areas.filter((x) => x !== k) : [...value.areas, k] });
  return <>
    <div className="field">
      <span>{v.areas}{req ? "" : ` ${t("optional")}`}</span>
      <div className="chips" role="group" aria-label={v.areas} style={{ margin: 0 }}>
        {look.settings.photoAreas.map((x) => (
          <button key={x.key} type="button" className={`chip${value.areas.includes(x.key) ? " on" : ""}`} aria-pressed={value.areas.includes(x.key)} onClick={() => toggle(x.key)}>
            {lang === "ar" ? x.ar : x.en}</button>))}
      </div>
      {req && !value.areas.length && <span className="hint">{v.areasPick}</span>}
    </div>
    <Field label={v.noteOpt}><input dir="auto" value={value.note} maxLength={120} onChange={(e) => onChange({ ...value, note: e.target.value })} /></Field>
  </>;
}

// ---------------------------------------------------------------- prescriptions
export function RxTab({ c, startNew, visitId, onMedsAdded }: { c: Chart; startNew: boolean; visitId: string | null; onMedsAdded: (e: Entry[]) => void }) {
  const v = useV();
  const { lang } = useI18n();
  const { look } = useApp();
  const tz = look.clinic.timezone;
  const [list, setList] = useState<RxList | null>(null);
  const [editing, setEditing] = useState<Rx | "new" | null>(startNew ? "new" : null);
  const [justPrinted, setJustPrinted] = useState<Rx | null>(null);
  const load = useCallback(() => { get<RxList>(`/api/patients/${c.patient.id}/prescriptions`).then(setList).catch(() => setList(null)); }, [c.patient.id]);
  useEffect(load, [load]);
  if (!list) return null;
  const replace = (r: Rx) => setList((l) => l && { ...l, prescriptions: l.prescriptions.some((x) => x.id === r.id) ? l.prescriptions.map((x) => (x.id === r.id ? { ...x, ...r } : x)) : [r, ...l.prescriptions] });
  if (editing) return <RxEditor c={c} rx={editing === "new" ? null : editing} visitId={visitId} list={list}
    onSaved={() => { load(); setEditing(null); }} onPrinted={(r) => { load(); setEditing(null); setJustPrinted(r); printSheet(r); }} onCancel={() => setEditing(null)} />;
  return (
    <div className="note">
      {justPrinted && <MedsOffer rx={justPrinted} c={c} onAdded={onMedsAdded} onClose={() => setJustPrinted(null)} />}
      <section className="ccard">
        <h3><span>{v.tabRx}</span>{list.canWrite && <button className="btn btn-accent btn-sm" onClick={() => setEditing("new")}>{v.newRx}</button>}</h3>
        {list.canWrite && !list.licence && <Banner kind="warn">{v.noLicence}</Banner>}
        {list.prescriptions.length === 0 && <p className="hint">{v.noRx}</p>}
        {list.prescriptions.map((r) => (
          <div key={r.id} className="li">
            <span style={{ minWidth: 0 }}>
              {r.error_at ? <s>{r.items.map((i) => i.name).join(" · ")}</s> : <b dir="auto">{r.items.map((i) => i.name).join(" · ")}</b>}
              <br /><span className="s">{lang === "ar" ? r.doctor_ar : r.doctor_en} · {fmtDateTime(r.printed_at ?? r.created_at, tz, lang)}{r.rx_no ? ` · ${r.rx_no}` : ""}
                {r.error_at ? ` · ${r.error_by_name}: ${r.error_reason}` : ""}</span>
            </span>
            <span className="end">
              <span className={`pill ${r.status === "printed" ? "ok" : "warn"}`}>{r.status === "printed" ? v.printed : v.draft}</span>
              {r.print_count > 1 && <span className="hint">{fill(v.copies, { n: r.print_count - 1 })}</span>}
              {!r.error_at && list.canWrite && r.status === "draft" && <button className="link" style={{ fontSize: 12.5 }} onClick={() => setEditing(r)}>{textFor(lang).sEdit}</button>}
              {!r.error_at && list.canWrite && r.status === "printed" && <button className="link" style={{ fontSize: 12.5 }}
                onClick={() => void post<Rx>(`/api/prescriptions/${r.id}/print`, { expectedVersion: r.row_version }).then((x) => { replace(x); printSheet(x); }).catch(() => load())}>{v.printAgain}</button>}
              {!r.error_at && list.canWrite && <RxError r={r} onDone={replace} />}
            </span>
          </div>
        ))}
        <p className="hint">{v.rxOnlyPrint}</p>
      </section>
    </div>
  );
}

function RxError({ r, onDone }: { r: Rx; onDone: (r: Rx) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false); const [reason, setReason] = useState("");
  const a = useAction();
  if (!open) return <button className="link" style={{ fontSize: 12.5, color: "var(--muted)" }} onClick={() => setOpen(true)}>{t("markError")}</button>;
  return (
    <form className="efrm" onSubmit={a.submit(async () => { onDone(await post<Rx>(`/api/prescriptions/${r.id}/error`, { reason, expectedVersion: r.row_version })); setOpen(false); })}>
      <Field label={t("errorReason")} hint={t("errorHint")}><input dir="auto" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required autoFocus /></Field>
      {a.err && <Banner>{a.message}</Banner>}
      <div className="row"><button className="btn btn-danger btn-sm" disabled={a.busy || !reason.trim()}>{t("confirmError")}</button><button type="button" className="link" onClick={() => setOpen(false)}>{t("cancel")}</button></div>
    </form>
  );
}

const blankItem = (): RxItem => ({ name: "", how: "", days: null, qty: "" });
function RxEditor({ c, rx, visitId, list, onSaved, onPrinted, onCancel }: { c: Chart; rx: Rx | null; visitId: string | null; list: RxList;
  onSaved: (r: Rx) => void; onPrinted: (r: Rx) => void; onCancel: () => void }) {
  const v = useV();
  const { lang, t } = useI18n();
  const { look } = useApp();
  const s = look.settings;
  const licence = list.licence;
  const [items, setItems] = useState<RxItem[]>(rx?.items.length ? rx.items : [blankItem()]);
  const [language, setLanguage] = useState<"en" | "ar">(rx?.language ?? "en");
  const [validDays, setValidDays] = useState(rx?.valid_days ?? s.rxValidDays);
  const [checking, setChecking] = useState(false);
  const a = useAction();
  const allergies = (c.chart?.entries ?? []).filter((e) => e.kind === "allergy" && !e.error_at && e.status === "active");
  const ok = items.some((i) => i.name.trim());
  const body = () => ({ items: items.filter((i) => i.name.trim()).map((i) => ({ ...i, days: i.days || null })), language, validDays });
  const save = async (): Promise<Rx> => {
    if (rx) return patch<Rx>(`/api/prescriptions/${rx.id}`, { ...body(), expectedVersion: rx.row_version });
    return post<Rx>(`/api/patients/${c.patient.id}/prescriptions`, { ...body(), appointmentId: visitId });
  };
  const set = (i: number, k: keyof RxItem, val: string) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: k === "days" ? (val ? Number(val) : null) : val } : x)));
  const addFav = (f: RxItem) => setItems([...items.filter((x) => x.name.trim()), { ...f }]);
  const draftPreview: Rx = { ...(rx ?? ({} as Rx)), id: rx?.id ?? "new", items: body().items, language, valid_days: validDays, status: "draft", rx_no: null, printed_at: null,
    print_count: 0, printed: { clinic: list.clinic,
      doctor: { name_en: list.doctor?.name_en ?? "", name_ar: list.doctor?.name_ar ?? "", title_en: list.doctor?.title_en ?? null, title_ar: list.doctor?.title_ar ?? null, licence: licence ?? "—" },
      patient: { name: c.patient.full_name, file_no: c.details?.file_no ?? null, birth_date: c.details?.birth_date ?? null, sex: c.details?.sex ?? null },
      allergies: allergies.map((e) => e.title), day: dayOfIso(new Date().toISOString(), look.clinic.timezone), paper: s.rxPaper } } as Rx;
  return (
    <div className="rxwrap">
      <form className="panel" onSubmit={a.submit(async () => onSaved(await save()))}>
        <h2>{v.newRx}</h2>
        {allergies.length > 0 && <div className="alerts">{allergies.map((e) => <span key={e.id} className="alert red"><span className="k">{textFor(lang).allergyL}</span><span dir="auto">{e.title}</span></span>)}</div>}
        {items.map((it, i) => (
          <div key={i} className="rxline">
            <Field label={v.medicine}><input dir="ltr" value={it.name} maxLength={120} onChange={(e) => set(i, "name", e.target.value)} required={i === 0} /></Field>
            <Field label={v.how}><input dir="auto" value={it.how} maxLength={200} onChange={(e) => set(i, "how", e.target.value)} /></Field>
            <div className="grid3">
              <Field label={v.forDays}><input type="number" min={1} max={365} value={it.days ?? ""} onChange={(e) => set(i, "days", e.target.value)} /></Field>
              <Field label={v.qty}><input dir="auto" value={it.qty} maxLength={40} onChange={(e) => set(i, "qty", e.target.value)} /></Field>
            </div>
            {items.length > 1 && <button type="button" className="link" style={{ color: "var(--muted)", fontSize: 13 }} onClick={() => setItems(items.filter((_, j) => j !== i))}>{v.remove}</button>}
          </div>
        ))}
        <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setItems([...items, blankItem()])}>{v.addLine}</button>
        {s.rxFavourites.length > 0 && <div className="chips" style={{ margin: 0 }}><span className="hint" style={{ alignSelf: "center" }}>{v.favourites}</span>
          {s.rxFavourites.map((f) => <button key={f.name} type="button" className="chip" onClick={() => addFav(f)}>{f.name}</button>)}</div>}
        <div className="grid3">
          <Field label={v.printIn}><select value={language} onChange={(e) => setLanguage(e.target.value as "en" | "ar")}><option value="en">{v.pEn}</option><option value="ar">{v.pAr}</option></select></Field>
          <Field label={v.validFor}><input type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} /></Field>
        </div>
        {!licence && <Banner kind="warn">{v.noLicence}</Banner>}
        {a.err && <Banner>{a.message}</Banner>}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn-accent btn-sm" disabled={a.busy || !ok || !licence} onClick={() => setChecking(true)}>{v.checkPrint}</button>
          <button className="btn btn-outline btn-sm" disabled={a.busy || !ok}>{v.saveDraft}</button>
          <button type="button" className="link" onClick={onCancel}>{t("cancel")}</button>
        </div>
        <p className="hint">{v.rxOnlyPrint}</p>
      </form>
      {checking && (
        <div className="rxcheck">
          <RxSheet rx={draftPreview} lang={language} preview />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn btn-accent btn-sm" disabled={a.busy} onClick={() => void a.run(async () => {
              const saved = await save();
              onPrinted(await post<Rx>(`/api/prescriptions/${saved.id}/print`, { expectedVersion: saved.row_version }));
            })}>{v.printNow}</button>
            <button type="button" className="link" onClick={() => setChecking(false)}>{v.back}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The paper (A5 or A4): the clinic, the doctor with the licence number, the patient, allergies, the medicines, the number. */
export function RxSheet({ rx, lang, preview }: { rx: Rx; lang: "en" | "ar"; preview?: boolean }) {
  const v = textFor(lang);
  const p = rx.printed!;
  const age = ageOf(p.patient.birth_date);
  return (
    <div className={`rxsheet paper-${p.paper}${preview ? " preview" : ""}`} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      {rx.copy && <span className="rxcopy">{v.copyMark}</span>}
      <header>
        <b>{lang === "ar" ? p.clinic.name_ar : p.clinic.name_en}</b>
        <span>{lang === "ar" ? p.doctor.name_ar : p.doctor.name_en}{(lang === "ar" ? p.doctor.title_ar : p.doctor.title_en) ? ` · ${lang === "ar" ? p.doctor.title_ar : p.doctor.title_en}` : ""}</span>
        <span>{v.licence} <bdi className="mono">{p.doctor.licence}</bdi></span>
        {(p.clinic.address_en || p.clinic.phone) && <span>{[lang === "ar" ? p.clinic.address_ar : p.clinic.address_en, p.clinic.phone].filter(Boolean).join(" · ")}</span>}
      </header>
      <div className="rxpat">
        <span>{v.patientL}: <b dir="auto">{p.patient.name}</b>{age !== null ? ` · ${fill(v.years, { n: age })}` : ""}{p.patient.file_no ? ` · ${v.fileL} ${p.patient.file_no}` : ""}</span>
        <bdi className="mono">{p.day.split("-").reverse().join("-")}</bdi>
      </div>
      {p.allergies.length > 0 && <div className="rxallergy">{v.allergyL}: <span dir="ltr">{p.allergies.join(", ")}</span></div>}
      <ol className="rxitems" dir="ltr">
        {rx.items.map((i, n) => <li key={n}><b>℞ {i.name}</b>{(i.how || i.days || i.qty) && <span dir="auto">{[i.how, i.days ? `${i.days} ${lang === "ar" ? "يوماً" : "days"}` : "", i.qty ? `${v.qtyL}: ${i.qty}` : ""].filter(Boolean).join(", ")}</span>}</li>)}
      </ol>
      <footer>
        <span>{fill(v.validLine, { n: rx.valid_days, no: rx.rx_no ?? "—" })}</span>
        <span className="sign">{v.signStamp}</span>
      </footer>
    </div>
  );
}

// Printing: the sheet goes into its own layer, the page size follows Settings (A5 or A4), then the browser prints it.
function printSheet(rx: Rx) {
  const host = document.createElement("div");
  host.className = "rxprint";
  document.body.appendChild(host);
  const style = document.createElement("style");
  style.textContent = `@page { size: ${rx.printed?.paper ?? "A5"}; margin: 10mm }`;
  document.head.appendChild(style);
  import("react-dom/client").then(({ createRoot }) => {
    const root = createRoot(host);
    root.render(<RxSheet rx={rx} lang={rx.language} />);
    setTimeout(() => {
      const done = () => { root.unmount(); host.remove(); style.remove(); window.removeEventListener("afterprint", done); };
      window.addEventListener("afterprint", done);
      window.print();
      setTimeout(done, 60_000);
    }, 120);
  });
}

// After printing: offer the medicines for "Current medicines", one tap each.
function MedsOffer({ rx, c, onAdded, onClose }: { rx: Rx; c: Chart; onAdded: (e: Entry[]) => void; onClose: () => void }) {
  const v = useV();
  const current = new Set((c.chart?.entries ?? []).filter((e) => e.kind === "medicine" && !e.error_at && e.status === "active").map((e) => e.title.toLowerCase()));
  const [done, setDone] = useState<string[]>([]);
  const a = useAction();
  if (!c.settings.show.medicine) return null;
  const left = rx.items.filter((i) => !current.has(i.name.toLowerCase()));
  if (!left.length) return null;
  return (
    <section className="ccard okcard">
      <h3><span>{v.afterPrint}</span><button className="link" onClick={onClose}>×</button></h3>
      {left.map((i) => (
        <div key={i.name} className="li">
          <span dir="ltr">{i.name}<br /><span className="s" dir="auto">{i.how}</span></span>
          <span className="end">{done.includes(i.name) ? <span className="pill ok">{v.added}</span>
            : <button className="btn btn-outline btn-sm" disabled={a.busy} onClick={() => void a.run(async () => {
              const e = await post<Entry>(`/api/patients/${c.patient.id}/entries`, { kind: "medicine", title: i.name, detail: [i.how, rx.rx_no ? `℞ ${rx.rx_no}` : ""].filter(Boolean).join(" · ") || null });
              setDone((x) => [...x, i.name]); onAdded([e]);
            })}>{v.addToMeds}</button>}</span>
        </div>
      ))}
      {a.err && <Banner>{a.message}</Banner>}
    </section>
  );
}

// ---------------------------------------------------------------- forms: what the patient wrote, confirmed by the doctor
export function FormsTab({ c, onEntries, onAnswer }: { c: Chart; onEntries: (fn: (e: Entry[]) => Entry[]) => void; onAnswer: (key: string, value: string) => void }) {
  const v = useV();
  const { lang } = useI18n();
  const { can, look } = useApp();
  const tz = look.clinic.timezone;
  const [data, setData] = useState<FormsList | null>(null);
  const load = useCallback(() => { get<FormsList>(`/api/patients/${c.patient.id}/forms`).then(setData).catch(() => setData(null)); }, [c.patient.id]);
  useEffect(load, [load]);
  if (!data) return null;
  const doctor = can("records.chart.read");
  return (
    <div className="note">
      {can("records.forms.send") && (
        <section className="ccard">
          <h3><span>{v.forms}</span></h3>
          {data.coming.length === 0 && <p className="hint">{v.noComing}</p>}
          {data.coming.map((a) => <ComingRow key={a.id} a={a} onSent={load} />)}
        </section>
      )}
      <section className="ccard">
        <h3><span>{v.tabForms}</span>{!doctor && <span className="hint">{v.filledOnly}</span>}</h3>
        {data.responses.length === 0 && <p className="hint">{v.noForms}</p>}
        {data.responses.map((r) => <ResponseRow key={r.id} r={r} c={c} doctor={doctor} tz={tz} lang={lang} reload={load} onEntries={onEntries} onAnswer={onAnswer} />)}
      </section>
    </div>
  );
}

function ComingRow({ a, onSent }: { a: ComingVisit; onSent: () => void }) {
  const v = useV();
  const { lang } = useI18n();
  const { look } = useApp();
  const [link, setLink] = useState<FormLink | null>(null);
  const [copied, setCopied] = useState(false);
  const act = useAction();
  const all = a.forms.length > 0 && a.forms.every((f) => f.filled);
  return (
    <div className="li" style={{ display: "block" }}>
      <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
        <span><b>{fill(v.comingVisit, { service: lang === "ar" ? a.service_ar : a.service_en, date: fmtDateTime(a.starts_at, look.clinic.timezone, lang) })}</b>
          <br /><span className="s">{a.forms.map((f) => `${lang === "ar" ? f.title_ar : f.title_en}: ${f.filled ? v.formFilled : v.formNotFilled}`).join(" · ") || "—"}
            {a.sent_count ? ` · ${fill(v.linkSent, { n: a.sent_count })}${a.opened_at ? ` · ${v.linkOpened}` : ""}` : ""}</span></span>
        {a.forms.length > 0 && !all && !link && <button className="btn btn-outline btn-sm" disabled={act.busy}
          onClick={() => void act.run(async () => { setLink(await post<FormLink>(`/api/appointments/${a.id}/form-link`)); onSent(); })}>{a.sent_count ? v.resendLink : v.sendLink}</button>}
      </div>
      {link && (
        <div className="formlink">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {link.whatsapp && <a className="btn btn-accent btn-sm" href={link.whatsapp} target="_blank" rel="noreferrer">{v.whatsapp}</a>}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => setCopied(true)); }}>{v.copyLink}</button>
            <a className="btn btn-outline btn-sm" href={link.url} target="_blank" rel="noreferrer">{v.openHere}</a>
          </div>
          <span className="hint">{v.linkHint}{copied ? ` ${v.copied}` : ""}</span>
        </div>
      )}
      {act.err && <Banner>{act.message}</Banner>}
    </div>
  );
}

function answerShown(q: Question, ans: { value: string; details?: string } | undefined, lang: "en" | "ar") {
  const v = textFor(lang);
  if (!ans?.value) return v.noAnswer;
  if (q.kind === "yesno" || q.kind === "yesno_details") return `${ans.value === "yes" ? v.yes : v.no}${ans.details ? `: “${ans.details}”` : ""}`;
  if (q.kind === "choice") { const o = q.options?.find((x) => x.en === ans.value); return o ? (lang === "ar" ? o.ar : o.en) : ans.value; }
  return `“${ans.value}”`;
}

function ResponseRow({ r, c, doctor, tz, lang, reload, onEntries, onAnswer }: { r: FormResponse; c: Chart; doctor: boolean; tz: string; lang: "en" | "ar"; reload: () => void;
  onEntries: (fn: (e: Entry[]) => Entry[]) => void; onAnswer: (key: string, value: string) => void }) {
  const v = useV();
  const { can } = useApp();
  const [open, setOpen] = useState(false);
  const write = can("records.chart.write");
  const openEntries = (r.entries ?? []).filter((e) => !e.confirmed_at && !e.error_at);
  const left = openEntries.length + (r.pending?.length ?? 0);
  return (
    <div className="li" style={{ display: "block" }}>
      <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
        <span><b>{lang === "ar" ? r.title_ar : r.title_en}</b> <span className="hint">{fill(v.version, { v: r.version })}</span>
          <br /><span className="s">{fill(r.consent ? v.signedOn : v.filledOn, { date: fmtDateTime(r.submitted_at, tz, lang) })}
            {r.consent && r.copy_file_id ? ` · ${fill(v.lockedCopy, { v: r.version })}` : ""}{r.reviewed_at ? ` · ${fill(v.gone, { name: r.reviewed_by_name ?? "" })}` : ""}</span></span>
        <span className="row" style={{ gap: 8 }}>
          {doctor && left > 0 && <span className="pill warn">{fill(v.toConfirm, { n: left })}</span>}
          {doctor && <button className="link" onClick={() => setOpen(!open)}>{open ? v.hide : v.showForm}</button>}
        </span>
      </div>
      {open && doctor && r.questions && (
        <div className="fresp">
          <dl className="facts">{r.questions.map((q) => <><dt key={`q-${q.key}`} dir="auto">{lang === "ar" ? q.ar : q.en}</dt><dd key={`a-${q.key}`} dir="auto">{answerShown(q, r.answers?.[q.key], lang)}</dd></>)}</dl>
          {r.consent && <div className="fsig">{r.agree_text && <p dir="auto">{r.agree_text}</p>}{r.signature && <img src={r.signature} alt="" />}<span className="hint">{fill(v.signedBy, { name: r.signed_name ?? "" })}</span></div>}
          {left > 0 && write && <>
            <h4>{v.confirmTitle}</h4>
            {openEntries.map((e) => <ConfirmEntry key={e.id} e={e} onDone={(x) => { onEntries((all) => all.map((y) => (y.id === x.id ? x : y))); void post(`/api/form-responses/${r.id}/refresh`).then(reload); }} />)}
            {(r.pending ?? []).map((k) => <ConfirmField key={k} r={r} k={k} c={c} lang={lang} onDone={(val) => { if (val !== null) onAnswer(r.questions!.find((q) => q.key === k)!.goesTo!.slice(6), val); reload(); }} />)}
            <p className="hint">{v.answersHint}</p>
          </>}
        </div>
      )}
    </div>
  );
}

function ConfirmEntry({ e, onDone }: { e: NonNullable<FormResponse["entries"]>[number]; onDone: (x: Entry) => void }) {
  const v = useV();
  const { d } = useI18n();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [title, setTitle] = useState(e.title);
  const a = useAction();
  return (
    <div className="li">
      <span><span className="k">{d.kind1[e.kind] ?? e.kind}</span>: {mode === "edit" ? <input dir="auto" value={title} maxLength={200} onChange={(x) => setTitle(x.target.value)} autoFocus /> : <b dir="auto">“{e.title}”</b>}</span>
      <span className="end">
        <button className="btn btn-accent btn-sm" disabled={a.busy || !title.trim()} onClick={() => void a.run(async () => {
          if (title.trim() !== e.title) await patch<Entry>(`/api/entries/${e.id}`, { title: title.trim(), expectedVersion: e.row_version });
          onDone(await post<Entry>(`/api/entries/${e.id}/confirm`));
        })}>{v.addAs}</button>
        {mode === "view" && <button className="link" onClick={() => setMode("edit")}>{v.changeFirst}</button>}
        <button className="link" style={{ color: "var(--muted)" }} disabled={a.busy} onClick={() => void a.run(async () => onDone(await post<Entry>(`/api/entries/${e.id}/error`, { reason: v.setAsideReason, expectedVersion: e.row_version })))}>{v.setAside}</button>
      </span>
      {a.err && <Banner>{a.message}</Banner>}
    </div>
  );
}

function ConfirmField({ r, k, c, lang, onDone }: { r: FormResponse; k: string; c: Chart; lang: "en" | "ar"; onDone: (v: string | null) => void }) {
  const v = useV();
  const q = r.questions!.find((x) => x.key === k)!;
  const field = c.settings.specialtyFields.find((f) => `field:${f.key}` === q.goesTo);
  const ans = r.answers?.[k];
  // The patient's answer, put into the field's own terms (yes/no, one of its choices, or text), for the doctor to check.
  const guess = !ans ? "" : field?.kind === "yesno" ? (ans.value === "yes" || ans.value === "no" ? ans.value : "")
    : field?.kind === "choice" ? (field.options?.find((o) => o.en === ans.value || o.ar === ans.value)?.en ?? "") : (ans.details || ans.value);
  const [val, setVal] = useState(guess);
  const a = useAction();
  if (!field) return null;
  return (
    <div className="li">
      <span>{lang === "ar" ? field.ar : field.en}: <b dir="auto">{answerShown(q, ans, lang)}</b></span>
      <span className="end">
        {field.kind === "text" ? <input dir="auto" value={val} maxLength={200} onChange={(e) => setVal(e.target.value)} />
          : <select value={val} onChange={(e) => setVal(e.target.value)}><option value="">—</option>
              {field.kind === "yesno" ? <><option value="yes">{v.yes}</option><option value="no">{v.no}</option></>
                : (field.options ?? []).map((o) => <option key={o.en} value={o.en}>{lang === "ar" ? o.ar : o.en}</option>)}</select>}
        <button className="btn btn-accent btn-sm" disabled={a.busy || !val} onClick={() => void a.run(async () => { await post(`/api/form-responses/${r.id}/fields/${k}`, { value: val }); onDone(val); })}>{v.saveField}</button>
        <button className="link" style={{ color: "var(--muted)" }} disabled={a.busy} onClick={() => void a.run(async () => { await post(`/api/form-responses/${r.id}/fields/${k}`, { value: null }); onDone(null); })}>{v.setAside}</button>
      </span>
      {a.err && <Banner>{a.message}</Banner>}
    </div>
  );
}

