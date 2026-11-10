import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { KINDS, ageOf, get, patch, post, put, type Answer, type Chart, type Company, type FilesList, type Details, type Entry, type Field as SField, type Item, type Kind } from "../api";
import { InsuranceFields, InsurancePill, insBody, insDraftOf } from "../insurance";
import { DocumentsTab, PhotosTab } from "./files";
import { fmtDateTime } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, Field, useAction } from "../ui";

type Tab = "sum" | "tl" | "ph" | "doc" | "det" | "open";

// The patient's chart (design: booking/design/emr.html, screens 1, 2 and 7). Opening it is recorded on the server. Changes update
// this page in place instead of loading the chart again, so one visit counts as one opening.
export function ChartPage() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const { me, can } = useApp();
  const canChart = can("records.chart.read");
  const [c, setC] = useState<Chart | null>(null);
  const [missing, setMissing] = useState(false);
  const [sp] = useSearchParams();                      // ?tab=doc: straight to the documents (from "results to review")
  const [tab, setTab] = useState<Tab>(sp.get("tab") === "doc" ? "doc" : canChart ? "sum" : "det");
  useEffect(() => { setC(null); setMissing(false); setFiles(null); get<Chart>(`/api/patients/${id}`).then(setC).catch(() => setMissing(true)); }, [id]);
  // Photos and documents load when their tab is opened (and again after a change).
  const [files, setFiles] = useState<FilesList | null>(null);
  const loadFiles = useCallback(() => { get<FilesList>(`/api/patients/${id}/files`).then(setFiles).catch(() => setFiles(null)); }, [id]);
  useEffect(() => { if ((tab === "ph" || tab === "doc") && !files) loadFiles(); }, [tab, files, loadFiles]);
  if (missing) return <main className="wrap page"><Banner kind="warn">{t("notAvailable")}</Banner></main>;
  if (!c) return null;

  const chart = c.chart;
  const setEntries = (fn: (e: Entry[]) => Entry[], extra: Item[] = []) =>
    setC((x) => x && x.chart ? { ...x, chart: { ...x.chart, entries: fn(x.chart.entries), timeline: [...extra, ...x.chart.timeline] } } : x);
  const age = ageOf(c.details?.birth_date ?? null);
  const sex = c.details?.sex ? t(c.details.sex) : null;
  const alerts = (chart?.entries ?? []).filter((e) => !e.error_at && e.status === "active" && (e.kind === "allergy" || e.alert) && c.settings.show[e.kind]);
  const tabs: [Tab, string][] = [
    ...(canChart ? [["sum", t("tabSummary")], ["tl", t("tabTimeline")]] as [Tab, string][] : []),
    ...(can("records.photos.view") ? [["ph", t("tabPhotos")]] as [Tab, string][] : []),
    ["doc", t("tabDocs")],
    ["det", t("tabDetails")],
    ...(can("records.openings.view") ? [["open", t("tabOpenings")]] as [Tab, string][] : []),
  ];

  return (
    <main className="wrap page">
      <div className="chead">
        <div>
          <h1 className="display">{c.patient.full_name || "—"}</h1>
          <div className="cfacts">
            {c.details?.file_no && <span>{t("file")} <b className="mono">{c.details.file_no}</b></span>}
            {(sex || age !== null) && <span>{[sex, age !== null ? t("years", { n: age }) : null].filter(Boolean).join(lang === "ar" ? "، " : ", ")}</span>}
            {c.patient.phone_e164 && <bdi dir="ltr" className="mono">{c.patient.phone_e164}</bdi>}
            {c.patient.preferred_language && <span>{t(c.patient.preferred_language === "ar" ? "arabic" : "english")}</span>}
            <InsurancePill details={c.details} insurer={c.insurer} />
          </div>
        </div>
        <a className="btn btn-outline btn-sm" href={`${me.bookingUrl}/patients/${id}`}>{t("openInBooking")}</a>
      </div>
      {alerts.length > 0 && (
        <div className="alerts" aria-label={t("alerts")}>
          {alerts.map((e) => (
            <span key={e.id} className={`alert ${e.kind === "allergy" ? "red" : "amb"}`}>
              <span className="k">{lang === "ar" ? AR_KIND[e.kind] : EN_KIND[e.kind]}</span><span dir="auto">{e.title}{e.detail ? `: ${e.detail}` : ""}</span>
            </span>))}
        </div>
      )}
      <div className="ctabs" role="tablist">
        {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "sum" && chart && <Summary c={c} setEntries={setEntries} setAnswers={(a) => setC((x) => x && x.chart ? { ...x, chart: { ...x.chart, answers: a(x.chart.answers) } } : x)} />}
      {tab === "tl" && chart && <Timeline items={chart.timeline} />}
      {tab === "ph" && files && <PhotosTab patientId={id} list={files} reload={loadFiles} />}
      {tab === "doc" && files && <DocumentsTab patientId={id} list={files} reload={loadFiles} />}
      {tab === "det" && <DetailsTab c={c} onSaved={(d) => setC((x) => x && { ...x, details: d, insurer: d.insurer })} />}
      {tab === "open" && <Openings id={id} />}
    </main>
  );
}
const EN_KIND: Record<Kind, string> = { allergy: "Allergy", medicine: "Medicine", condition: "Condition", procedure: "Procedure", family: "Family" };
const AR_KIND: Record<Kind, string> = { allergy: "حساسية", medicine: "دواء", condition: "حالة", procedure: "إجراء", family: "عائلي" };

// ---------------------------------------------------------------- summary: the lists and the specialty fields
function Summary({ c, setEntries, setAnswers }: { c: Chart; setEntries: (fn: (e: Entry[]) => Entry[], extra?: Item[]) => void; setAnswers: (fn: (a: Answer[]) => Answer[]) => void }) {
  const { t } = useI18n();
  const kinds = KINDS.filter((k) => c.settings.show[k]);
  return (
    <div className="cgrid">
      {kinds.map((k) => <EntryCard key={k} kind={k} patientId={c.patient.id} entries={c.chart!.entries.filter((e) => e.kind === k)} setEntries={setEntries} />)}
      {c.settings.specialtyFields.length > 0 && (
        <div className="ccard">
          <h3><span>{t("specialty")}</span></h3>
          {c.settings.specialtyFields.map((f) => <AnswerRow key={f.key} f={f} patientId={c.patient.id} answer={c.chart!.answers.find((a) => a.field_key === f.key)} setAnswers={setAnswers} />)}
        </div>
      )}
    </div>
  );
}

function EntryCard({ kind, patientId, entries, setEntries }: { kind: Kind; patientId: string; entries: Entry[]; setEntries: (fn: (e: Entry[]) => Entry[], extra?: Item[]) => void }) {
  const { t, d } = useI18n();
  const { can } = useApp();
  const write = can("records.chart.write");
  const [adding, setAdding] = useState(false);
  const order = (e: Entry) => (e.error_at ? 2 : e.status === "past" ? 1 : 0);
  const rows = [...entries].sort((a, b) => order(a) - order(b) || a.created_at.localeCompare(b.created_at));
  const replace = (e: Entry, extra: Item[] = []) => setEntries((all) => all.map((x) => (x.id === e.id ? e : x)), extra);
  return (
    <div className="ccard">
      <h3><span>{d.kinds[kind]}</span>{write && !adding && <button className="link" style={{ fontSize: 13, fontWeight: 500 }} onClick={() => setAdding(true)}>{t("add")}</button>}</h3>
      {rows.length === 0 && !adding && <p className="hint">{t("none")}</p>}
      <div>{rows.map((e) => <EntryRow key={e.id} e={e} write={write} onChange={replace} />)}</div>
      {adding && (
        <EntryForm kind={kind} onCancel={() => setAdding(false)} onSave={async (b) => {
          const e = await post<Entry>(`/api/patients/${patientId}/entries`, { kind, ...b });
          setEntries((all) => [...all, e], [{ type: "entry", at: e.created_at, id: e.id, kind, title: e.title, by: e.created_by_name, source: e.source }]);
          setAdding(false);
        }} />
      )}
    </div>
  );
}

function EntryRow({ e, write, onChange }: { e: Entry; write: boolean; onChange: (e: Entry, extra?: Item[]) => void }) {
  const { t, lang } = useI18n();
  const { look } = useApp();
  const [mode, setMode] = useState<"view" | "edit" | "error">("view");
  const [reason, setReason] = useState("");
  const a = useAction();
  const tz = look.clinic.timezone;
  if (mode === "edit") return (
    <div className="li" style={{ display: "block" }}>
      <EntryForm kind={e.kind} entry={e} onCancel={() => setMode("view")} onSave={async (b) => {
        onChange(await patch<Entry>(`/api/entries/${e.id}`, { ...b, expectedVersion: e.row_version })); setMode("view");
      }} />
    </div>
  );
  return (
    <div className="li">
      <span style={{ minWidth: 0 }}>
        <span dir="auto">{e.error_at ? <s>{e.title}</s> : <b>{e.title}</b>}{e.detail ? <span>: {e.detail}</span> : null}</span>
        {e.status === "past" && !e.error_at && <> <span className="pill">{t("past")}</span></>}
        <br /><span className="s">{e.error_at ? t("inError", { name: e.error_by_name || "" }) + (e.error_reason ? ` · ${e.error_reason}` : "")
          : t("byOn", { name: e.created_by_name, date: fmtDateTime(e.created_at, tz, lang) })}</span>
        {mode === "error" && (
          <form className="efrm" style={{ marginTop: 8 }} onSubmit={a.submit(async () => {
            const r = await post<Entry>(`/api/entries/${e.id}/error`, { reason, expectedVersion: e.row_version });
            onChange(r, [{ type: "error", at: r.error_at!, id: r.id, kind: r.kind, title: r.title, by: r.error_by_name || "", reason: r.error_reason || "" }]); setMode("view");
          })}>
            <Field label={t("errorReason")} hint={t("errorHint")}><input value={reason} onChange={(x) => setReason(x.target.value)} maxLength={300} required /></Field>
            {a.err && <Banner>{a.message}</Banner>}
            <div className="row"><button className="btn btn-danger btn-sm" disabled={a.busy || !reason.trim()}>{t("confirmError")}</button><button type="button" className="link" onClick={() => setMode("view")}>{t("cancel")}</button></div>
          </form>
        )}
        {a.err && mode === "view" && <Banner>{a.message}</Banner>}
      </span>
      <span className="end">
        {e.source === "patient" && !e.confirmed_at && !e.error_at && <span className="pr">{t("patientReported")}</span>}
        {e.source === "patient" && !e.confirmed_at && !e.error_at && write && <button className="link" style={{ fontSize: 12.5 }} onClick={() => void a.run(async () => onChange(await post<Entry>(`/api/entries/${e.id}/confirm`)))}>{t("confirm")}</button>}
        {write && !e.error_at && mode === "view" && <>
          <button className="link" style={{ fontSize: 12.5 }} onClick={() => setMode("edit")}>{t("edit")}</button>
          <button className="link" style={{ fontSize: 12.5, color: "var(--muted)" }} onClick={() => setMode("error")}>{t("markError")}</button>
        </>}
      </span>
    </div>
  );
}

function EntryForm({ kind, entry, onSave, onCancel }: { kind: Kind; entry?: Entry; onSave: (b: { title: string; detail: string | null; status: "active" | "past"; alert: boolean }) => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(entry?.title ?? "");
  const [detail, setDetail] = useState(entry?.detail ?? "");
  const [status, setStatus] = useState<"active" | "past">(entry?.status ?? "active");
  const [alert, setAlert] = useState(entry?.alert ?? false);
  const a = useAction();
  return (
    <form className="efrm" onSubmit={a.submit(() => onSave({ title, detail: detail.trim() || null, status, alert }))}>
      <Field label={t("entryName")}><input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus /></Field>
      <Field label={t("entryDetail")}><textarea dir="auto" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={1000} /></Field>
      {kind !== "allergy" && kind !== "family" && (
        <Field label={t("status")}><select value={status} onChange={(e) => setStatus(e.target.value as "active" | "past")}><option value="active">{t("active")}</option><option value="past">{t("past")}</option></select></Field>
      )}
      {kind === "allergy" ? <span className="hint">{t("allergyAlways")}</span>
        : <label className="check"><input type="checkbox" checked={alert} onChange={(e) => setAlert(e.target.checked)} /> <span>{t("entryAlert")}</span></label>}
      {a.err && <Banner>{a.message}</Banner>}
      <div className="row"><button className="btn btn-ink btn-sm" disabled={a.busy || !title.trim()}>{t("save")}</button><button type="button" className="link" onClick={onCancel}>{t("cancel")}</button></div>
    </form>
  );
}

function AnswerRow({ f, patientId, answer, setAnswers }: { f: SField; patientId: string; answer?: Answer; setAnswers: (fn: (a: Answer[]) => Answer[]) => void }) {
  const { t, lang } = useI18n();
  const { can } = useApp();
  const [val, setVal] = useState(answer?.value ?? "");
  const a = useAction();
  const save = (v: string) => a.run(async () => {
    const r = await put<Answer>(`/api/patients/${patientId}/answers/${f.key}`, { value: v });
    setAnswers((all) => [...all.filter((x) => x.field_key !== f.key), r]);
  });
  const label = lang === "ar" ? f.ar : f.en;
  const dis = !can("records.chart.write") || a.busy;
  return (
    <div className="li" style={{ alignItems: "center" }}>
      <span>{label}{a.err && <><br /><span className="s" role="alert">{a.message}</span></>}</span>
      <span className="end" style={{ maxWidth: "50%" }}>
        {f.kind === "text"
          ? <input dir="auto" aria-label={label} value={val} disabled={dis} maxLength={200} style={{ font: "inherit", minHeight: 36, border: "1px solid var(--field)", borderRadius: 10, padding: "0 10px", width: "100%" }}
              onChange={(e) => setVal(e.target.value)} onBlur={() => { if (val !== (answer?.value ?? "")) void save(val); }} />
          : <select aria-label={label} value={val} disabled={dis} style={{ font: "inherit", minHeight: 36, border: "1px solid var(--field)", borderRadius: 10, padding: "0 8px", background: "#fff" }}
              onChange={(e) => { setVal(e.target.value); void save(e.target.value); }}>
              <option value="">{t("notAsked")}</option>
              {f.kind === "yesno" ? <><option value="yes">{t("yes")}</option><option value="no">{t("no")}</option></>
                : (f.options ?? []).map((o) => <option key={o.en} value={o.en}>{lang === "ar" ? o.ar : o.en}</option>)}
            </select>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- timeline
function Timeline({ items }: { items: Item[] }) {
  const { t, d, lang } = useI18n();
  const { me, look } = useApp();
  const [f, setF] = useState<"all" | "visits" | "changes">("all");
  const named = (list: { key: string; en: string; ar: string }[], k: string) => { const x = list.find((y) => y.key === k); return x ? (lang === "ar" ? x.ar : x.en) : k; };
  const tz = look.clinic.timezone;
  const shown = items.filter((x) => f === "all" || (f === "visits" ? x.type === "visit" : x.type !== "visit"));
  const noteState = (v: Extract<Item, { type: "visit" }>) => !v.note_status ? null
    : v.note_status === "signed" ? <span className="pill ok">{v.ai_drafted ? t("noteSignedAi") : t("noteSigned")}</span>
    : v.note_status === "failed" ? <span className="pill bad">{t("noteFailed")}</span> : <span className="pill warn">{t("noteDraft")}</span>;
  return (
    <section className="stack">
      <div className="chips" role="group">
        {(["all", "visits", "changes"] as const).map((k) => <button key={k} className={`chip${f === k ? " on" : ""}`} onClick={() => setF(k)}>{t(k)}</button>)}
      </div>
      {shown.length === 0 && <p className="hint">{t("noTimeline")}</p>}
      <div className="tl">{shown.map((x) => (
        <div className="tli" key={`${x.type}-${x.id}`}>
          <span className="when">{fmtDateTime(x.at, tz, lang)}</span>
          <span className="rail"><b className={x.type === "error" ? "bad" : ""} aria-hidden="true">{x.type === "visit" ? "●" : x.type === "error" ? "✕" : x.type === "photos" ? "▣" : x.type === "document" ? "▤" : "+"}</b></span>
          <div className="what">
            {x.type === "visit" ? <>
              <div className="row between"><b>{lang === "ar" ? x.service_ar : x.service_en}</b><span className="row" style={{ gap: 6 }}><span className="pill">{d.statuses[x.status] ?? x.status}</span>{noteState(x)}</span></div>
              <span className="hint">{lang === "ar" ? x.doctor_ar : x.doctor_en}</span>
              {x.note_id && x.note_doctor_id && x.note_doctor_id === me.doctorId && <a href={`${me.bookingUrl}/bookings/${x.id}/note`} style={{ fontSize: 13 }}>{t("openNote")}</a>}
            </> : x.type === "photos" ? <>
              <b>{t("photosAdded", { area: named(look.settings.photoAreas, x.area), n: x.count })}</b><span className="hint">{t("by", { name: x.by })}</span>
            </> : x.type === "document" ? <>
              <b dir="auto">{t("docAdded", { kind: named(look.settings.docKinds, x.docKind), title: x.title })}</b><span className="hint">{t("by", { name: x.by })}</span>
            </> : x.type === "entry" ? <>
              <b dir="auto">{t("added", { kind: d.kind1[x.kind], title: x.title })}</b><span className="hint">{t("by", { name: x.by })}</span>
            </> : <>
              <b dir="auto">{t("errored", { kind: d.kind1[x.kind], title: x.title })}</b><span className="hint">{t("by", { name: x.by })} · {t("reasonIs", { r: x.reason })}</span>
            </>}
          </div>
        </div>))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- details
function DetailsTab({ c, onSaved }: { c: Chart; onSaved: (d: Details & { insurer: Company | null }) => void }) {
  const { t, lang, d } = useI18n();
  const { me, can, look } = useApp();
  const d0 = c.details;
  const [f, setF] = useState({ fileNo: d0?.file_no ?? "", birthDate: d0?.birth_date ?? "", sex: d0?.sex ?? "", nationalId: d0?.national_id ?? "",
                               emName: d0?.emergency_name ?? "", emRelation: d0?.emergency_relation ?? "", emPhone: d0?.emergency_phone ?? "" });
  const [ins, setIns] = useState(insDraftOf(d0));
  const [saved, setSaved] = useState(false);
  const a = useAction();
  const edit = can("records.details.edit");
  const req = c.settings.requiredDetails;
  const lbl = (k: string, text: string) => `${text} ${req.includes(k) ? t("required") : t("optional")}`;
  const manual = c.settings.fileNumbers === "manual";
  return (
    <div className="note">
      <form className="panel" onSubmit={a.submit(async () => {
        const r = await put<Details & { insurer: Company | null }>(`/api/patients/${c.patient.id}/details`, {
          fileNo: manual ? f.fileNo || null : undefined, birthDate: f.birthDate || null, sex: f.sex || null, nationalId: f.nationalId || null,
          emergencyName: f.emName || null, emergencyRelation: f.emRelation || null, emergencyPhone: f.emPhone || null, ...insBody(ins), expectedVersion: d0?.row_version ?? null });
        onSaved(r); setF((x) => ({ ...x, fileNo: r.file_no ?? "" })); setIns(insDraftOf(r)); setSaved(true);
      })}>
        <h2>{t("tabDetails")}</h2>
        <div className="dgrid">
          <Field label={t("fileNo")} hint={manual ? undefined : t("fileAuto")}>
            {manual ? <input className="mono" value={f.fileNo} maxLength={20} disabled={!edit} onChange={(e) => setF({ ...f, fileNo: e.target.value })} />
              : <input className="mono" value={d0?.file_no ?? "—"} disabled readOnly />}
          </Field>
          <Field label={lbl("birth_date", t("birthDate"))}><input type="date" value={f.birthDate} disabled={!edit} onChange={(e) => setF({ ...f, birthDate: e.target.value })} /></Field>
          <Field label={lbl("sex", t("sex"))}><select value={f.sex} disabled={!edit} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="">—</option><option value="female">{t("female")}</option><option value="male">{t("male")}</option></select></Field>
          <Field label={lbl("national_id", t("nationalId"))}><input className="mono" value={f.nationalId} maxLength={20} disabled={!edit} onChange={(e) => setF({ ...f, nationalId: e.target.value })} /></Field>
          <Field label={lbl("emergency_contact", t("emName"))}><input dir="auto" value={f.emName} maxLength={80} disabled={!edit} onChange={(e) => setF({ ...f, emName: e.target.value })} /></Field>
          <Field label={`${t("emRelation")} ${t("optional")}`}>
            <select value={f.emRelation} disabled={!edit} onChange={(e) => setF({ ...f, emRelation: e.target.value })}>
              <option value="">—</option>
              {c.settings.relations.map((r) => <option key={r.key} value={r.key}>{lang === "ar" ? r.ar : r.en}</option>)}
              {f.emRelation && !c.settings.relations.some((r) => r.key === f.emRelation) && <option value={f.emRelation}>{f.emRelation}</option>}
            </select>
          </Field>
          <Field label={lbl("emergency_contact", t("emPhone"))}><input dir="ltr" className="mono" inputMode="tel" value={f.emPhone} maxLength={30} disabled={!edit} onChange={(e) => setF({ ...f, emPhone: e.target.value })} /></Field>
        </div>
        <InsuranceFields x={ins} set={setIns} companies={c.companies} required={c.settings.insuranceRequired} disabled={!edit} />
        <p className="hint">{t("nameInBooking")} <a href={`${me.bookingUrl}/patients/${c.patient.id}`}>{t("editInBooking")}</a></p>
        {d0?.updated_by_name && <p className="hint">{t("lastChange", { name: d0.updated_by_name, date: fmtDateTime(d0.updated_at, look.clinic.timezone, lang) })}</p>}
        {a.err && <Banner>{a.err.code === "details_required" && a.err.data.field === "insurance" ? d.errors.insurance : a.message}</Banner>}
        {saved && !a.err && <Banner kind="ok">{t("saved")}</Banner>}
        {edit && <div><button className="btn btn-accent btn-sm" disabled={a.busy}>{t("save")}</button></div>}
      </form>
      {!c.chart && <div className="lock"><span aria-hidden="true" style={{ fontSize: 22 }}>🔒</span><span>{t("lockedChart")}</span></div>}
    </div>
  );
}

// ---------------------------------------------------------------- who opened this record (administrators)
function Openings({ id }: { id: string }) {
  const { t, d, lang } = useI18n();
  const { look } = useApp();
  const [rows, setRows] = useState<{ user_name: string; role: string | null; opened_at: string; what: string; file_kind: string | null; doc_kind: string | null }[] | null>(null);
  const kindName = (k: string | null) => { const x = look.settings.docKinds.find((y) => y.key === k); return x ? (lang === "ar" ? x.ar : x.en) : k ?? ""; };
  const what = (r: NonNullable<typeof rows>[number]) => r.what === "photos" ? t("whatPhotos")
    : r.what === "file" ? t("whatFile", { kind: r.file_kind === "photo" ? t("photoWord") : kindName(r.doc_kind) }) : t("whatChart");
  useEffect(() => { get<typeof rows>(`/api/patients/${id}/openings`).then(setRows).catch(() => setRows([])); }, [id]);
  if (!rows) return null;
  return (
    <section className="panel">
      {rows.length === 0 ? <p className="hint">{t("noOpenings")}</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>{t("who")}</th><th>{t("role")}</th><th>{t("what")}</th><th>{t("when")}</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{r.user_name}</td><td>{r.role ? d.roles[r.role] ?? r.role : "—"}</td><td>{what(r)}</td><td>{fmtDateTime(r.opened_at, look.clinic.timezone, lang)}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}
