import { useCallback, useEffect, useState } from "react";
import { KINDS, get, patch, post, put, type CompanyRow, type DocKind, type Field as SField, type Named, type Settings as S } from "../api";
import { fmtDateTime } from "../lib";
import { companyName } from "../insurance";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, Field, useAction } from "../ui";
import { VisitSettings } from "./visit-settings";
import { useV } from "../visit-text";

const DETAILS = ["birth_date", "sex", "national_id", "emergency_contact"];

// A field's key comes from its English name the first time it is saved, and never changes after (answers are stored by it).
function keyFor(en: string, taken: string[]) {
  let base = en.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  if (!/^[a-z]/.test(base)) base = "f_" + base;
  let k = base, n = 2;
  while (taken.includes(k)) k = `${base}_${n++}`;
  return k;
}
type Draft = SField & { isNew?: boolean; optionsText?: string };
const optText = (f: SField) => (f.options ?? []).map((o) => `${o.en} | ${o.ar}`).join("\n");
const parseOpts = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [en, ar] = l.split("|").map((x) => x.trim()); return { en, ar: ar || en }; });

// Records › Settings, laid out like Booking's Settings (the white menu on the left). Phase A has the Chart tab.
export function Settings() {
  const { t, d } = useI18n();
  const { look, can, reloadLook } = useApp();
  const s0 = look.settings;
  const edit = can("records.settings.edit");
  const [f, setF] = useState<S>(s0);
  const [fields, setFields] = useState<Draft[]>(s0.specialtyFields.map((x) => ({ ...x, optionsText: optText(x) })));
  const [saved, setSaved] = useState(false);
  const a = useAction();
  const setField = (i: number, p: Partial<Draft>) => setFields(fields.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const v = useV();
  const [tab, setTab] = useState<"chart" | "files" | "visit" | "backups">("chart");
  const tabs: ["chart" | "files" | "visit" | "backups", string][] = [["chart", t("setChart")], ["files", t("setFiles")], ["visit", v.setVisit],
    ...(can("records.backups.view") ? [["backups", t("setBackups")]] as ["backups", string][] : [])];

  return (
    <main className="wrap page">
      <h1 className="display">{t("settingsTitle")}</h1>
      {!edit && <Banner kind="warn">{t("readOnly")}</Banner>}
      <div className="setwrap">
        <nav className="settabs" aria-label={t("settingsTitle")}>
          {tabs.map(([k, label]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
        </nav>
        {tab === "chart" && <div className="setbody">
        <form className="setbody" onSubmit={a.submit(async () => {
          const taken: string[] = [];
          const specialtyFields = fields.map((x) => {
            const key = x.isNew ? keyFor(x.en, [...taken, ...fields.filter((y) => !y.isNew).map((y) => y.key)]) : x.key;
            taken.push(key);
            return { key, en: x.en, ar: x.ar, kind: x.kind, ...(x.kind === "choice" ? { options: parseOpts(x.optionsText ?? "") } : {}) };
          });
          const r = await put<S>("/api/settings", { ...f, specialtyFields });
          setF(r); setFields(r.specialtyFields.map((x) => ({ ...x, optionsText: optText(x) }))); setSaved(true); reloadLook();
        })}>
          <section className="panel">
            <h2>{t("setChart")}</h2>
            <Field label={t("scope")} hint={t("scopeHint")}>
              <select value={f.doctorsScope} disabled={!edit} onChange={(e) => setF({ ...f, doctorsScope: e.target.value as S["doctorsScope"] })}>
                <option value="all">{t("scopeAll")}</option><option value="treated">{t("scopeTreated")}</option>
              </select>
            </Field>
            <div className="field">{t("lists")}
              <div className="dgrid" style={{ fontWeight: 400 }}>
                {KINDS.map((k) => <label key={k} className="check"><input type="checkbox" disabled={!edit} checked={f.show[k]} onChange={(e) => setF({ ...f, show: { ...f.show, [k]: e.target.checked } })} /> <span>{d.kinds[k]}</span></label>)}
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>{t("specialtyFields")}</h2>
            <p className="hint">{t("specialtyHint")}</p>
            {fields.map((x, i) => (
              <div className="sfield" key={x.isNew ? `new-${i}` : x.key}>
                <Field label={t("fieldEn")}><input dir="ltr" value={x.en} maxLength={60} required disabled={!edit} onChange={(e) => setField(i, { en: e.target.value })} /></Field>
                <Field label={t("fieldAr")}><input dir="rtl" value={x.ar} maxLength={60} required disabled={!edit} onChange={(e) => setField(i, { ar: e.target.value })} /></Field>
                <Field label={t("kind")}>
                  <select value={x.kind} disabled={!edit} onChange={(e) => setField(i, { kind: e.target.value as SField["kind"] })}>
                    <option value="yesno">{t("yesno")}</option><option value="choice">{t("choice")}</option><option value="text">{t("text")}</option>
                  </select>
                </Field>
                {edit && <button type="button" className="link" onClick={() => setFields(fields.filter((_, j) => j !== i))}>{t("remove")}</button>}
                {x.kind === "choice" && (
                  <label className="field full">{t("choices")}
                    <textarea className="ta" dir="auto" rows={4} value={x.optionsText ?? ""} disabled={!edit} onChange={(e) => setField(i, { optionsText: e.target.value })} />
                  </label>
                )}
              </div>
            ))}
            {edit && fields.length < 30 && <div><button type="button" className="btn btn-outline btn-sm" onClick={() => setFields([...fields, { key: "", en: "", ar: "", kind: "yesno", isNew: true }])}>{t("addField")}</button></div>}
          </section>

          <section className="panel">
            <h2>{t("fileNumbers")}</h2>
            <div className="dgrid">
              <Field label={t("fileNumbers")}>
                <select value={f.fileNumbers} disabled={!edit} onChange={(e) => setF({ ...f, fileNumbers: e.target.value as S["fileNumbers"] })}>
                  <option value="auto">{t("fileAutoOpt")}</option><option value="manual">{t("fileManualOpt")}</option>
                </select>
              </Field>
              {f.fileNumbers === "auto" && <>
                <Field label={t("nextNo")}><input type="number" className="mono" min={1} max={99999999} value={f.nextFileNo} disabled={!edit} onChange={(e) => setF({ ...f, nextFileNo: Number(e.target.value) })} /></Field>
                <Field label={t("digits")}><input type="number" className="mono" min={3} max={8} value={f.fileNoDigits} disabled={!edit} onChange={(e) => setF({ ...f, fileNoDigits: Number(e.target.value) })} /></Field>
              </>}
            </div>
            <div className="field">{t("requiredDetails")}
              <div className="dgrid" style={{ fontWeight: 400 }}>
                {DETAILS.map((k) => <label key={k} className="check"><input type="checkbox" disabled={!edit} checked={f.requiredDetails.includes(k)}
                  onChange={(e) => setF({ ...f, requiredDetails: e.target.checked ? [...f.requiredDetails, k] : f.requiredDetails.filter((x) => x !== k) })} /> <span>{d.detailNames[k]}</span></label>)}
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>{t("insQuestions")}</h2>
            <label className="check"><input type="checkbox" disabled={!edit} checked={f.insuranceInBooking} onChange={(e) => setF({ ...f, insuranceInBooking: e.target.checked })} />
              <span>{t("insInBooking")}</span></label>
            <label className="check"><input type="checkbox" disabled={!edit} checked={f.insuranceRequired} onChange={(e) => setF({ ...f, insuranceRequired: e.target.checked })} />
              <span>{t("insRequired")}</span></label>
          </section>

          {a.err && <Banner>{a.message}</Banner>}
          {saved && !a.err && <Banner kind="ok">{t("saved")}</Banner>}
          {edit && <div><button className="btn btn-ink" disabled={a.busy}>{t("save")}</button></div>}
        </form>
        <Insurers edit={edit} />
        </div>}
        {tab === "files" && <FilesSettings edit={edit} />}
        {tab === "visit" && <VisitSettings edit={edit} />}
        {tab === "backups" && <BackupsTab />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- Settings › Chart › Insurance companies
// Each company is saved on its own (not with the form above). Hidden, never deleted.
type Draft2 = { nameEn: string; nameAr: string; phone: string; email: string; address: string; contactName: string; contactTitle: string;
                contactPhone: string; contactEmail: string; notes: string };
const EMPTY: Draft2 = { nameEn: "", nameAr: "", phone: "", email: "", address: "", contactName: "", contactTitle: "", contactPhone: "", contactEmail: "", notes: "" };
const draftOf = (c: CompanyRow): Draft2 => ({ nameEn: c.name_en, nameAr: c.name_ar, phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "",
  contactName: c.contact_name ?? "", contactTitle: c.contact_title ?? "", contactPhone: c.contact_phone ?? "", contactEmail: c.contact_email ?? "", notes: c.notes ?? "" });

function Insurers({ edit }: { edit: boolean }) {
  const { t, lang } = useI18n();
  const [list, setList] = useState<{ companies: CompanyRow[]; typed: { name: string; patients: number }[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);            // a company's id, "new", or null
  const [draft, setDraft] = useState<Draft2>(EMPTY);
  const [fromTyped, setFromTyped] = useState<string | null>(null);
  const a = useAction();
  const load = useCallback(() => get<typeof list>("/api/insurers").then(setList).catch(() => setList({ companies: [], typed: [] })), []);
  useEffect(() => { void load(); }, [load]);
  if (!list) return null;

  const start = (id: string, d: Draft2, typed: string | null = null) => { setOpen(id); setDraft(d); setFromTyped(typed); };
  const save = (c?: CompanyRow) => a.run(async () => {
    if (c) await patch(`/api/insurers/${c.id}`, { ...draft, expectedVersion: c.row_version });
    else await post("/api/insurers", { ...draft, fromTyped });
    setOpen(null); await load();
  });
  const hide = (c: CompanyRow, hidden: boolean) => a.run(async () => { await patch(`/api/insurers/${c.id}`, { hidden, expectedVersion: c.row_version }); setOpen(null); await load(); });
  const inp = (k: keyof Draft2, label: string, o: { dir?: "ltr" | "rtl" | "auto"; mono?: boolean; max: number; full?: boolean; hint?: string } = { max: 80 }) => (
    <label className={`field${o.full ? " full" : ""}`}>{label}
      <input dir={o.dir ?? "auto"} className={o.mono ? "mono" : undefined} maxLength={o.max} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
      {o.hint && <span className="hint">{o.hint}</span>}
    </label>
  );
  const card = (c?: CompanyRow) => (
    <div className="cocard" key={c?.id ?? "new"} onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <div className="cosec">{t("coCompany")}</div>
      <div className="dgrid">
        {inp("nameEn", t("coNameEn"), { dir: "ltr", max: 80 })}
        {inp("nameAr", t("coNameAr"), { dir: "rtl", max: 80 })}
        {inp("phone", `${t("coPhone")} ${t("optional")}`, { dir: "ltr", mono: true, max: 30, hint: t("coPhoneHint") })}
        {inp("email", `${t("coEmail")} ${t("optional")}`, { dir: "ltr", max: 120 })}
        {inp("address", `${t("coAddress")} ${t("optional")}`, { max: 200, full: true })}
      </div>
      <div className="cosec">{t("coContact")}</div>
      <div className="dgrid">
        {inp("contactName", `${t("coName")} ${t("optional")}`, { max: 80 })}
        {inp("contactTitle", `${t("coTitle")} ${t("optional")}`, { max: 80 })}
        {inp("contactPhone", `${t("coMobile")} ${t("optional")}`, { dir: "ltr", mono: true, max: 30 })}
        {inp("contactEmail", `${t("coEmail")} ${t("optional")}`, { dir: "ltr", max: 120 })}
      </div>
      <label className="field">{`${t("coNotes")} ${t("optional")}`}
        <textarea className="ta" dir="auto" rows={2} maxLength={500} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </label>
      {a.err && <Banner>{a.message}</Banner>}
      <div className="row between">
        <div className="row">
          <button type="button" className="btn btn-accent btn-sm" disabled={a.busy || !draft.nameEn.trim() || !draft.nameAr.trim()} onClick={() => void save(c)}>{t("save")}</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(null)}>{t("cancel")}</button>
        </div>
        {c && !c.hidden && <button type="button" className="link" disabled={a.busy} onClick={() => void hide(c, true)}>{t("hide")}</button>}
      </div>
    </div>
  );

  return (
    <section className="panel">
      <h2>{t("insurersTitle")}</h2>
      <p className="hint">{t("insurersHint")}</p>
      {list.companies.length === 0 && open !== "new" && <p className="hint">{t("noCompanies")}</p>}
      {list.companies.map((c) => open === c.id ? card(c) : (
        <div key={c.id} className={`corow${c.hidden ? " off" : ""}`}>
          <b>{companyName(c, lang)}</b>
          <span className="hint">{companyName(c, lang === "ar" ? "en" : "ar")}</span>
          {c.phone && <bdi dir="ltr" className="mono hint">{c.phone}</bdi>}
          {c.hidden && <span className="pill">{t("hiddenPill")}</span>}
          <span className="grow" />
          <span className="hint">{t("insPatients", { n: c.patients })}</span>
          {edit && (c.hidden
            ? <button type="button" className="link" disabled={a.busy} onClick={() => void hide(c, false)}>{t("showAgain")}</button>
            : <button type="button" className="link" onClick={() => start(c.id, draftOf(c))}>{t("edit")}</button>)}
        </div>
      ))}
      {open === "new" && card()}
      {edit && open !== "new" && <div><button type="button" className="btn btn-outline btn-sm" onClick={() => start("new", EMPTY)}>{t("addCompany")}</button></div>}
      {list.typed.length > 0 && (
        <div className="banner warn">
          <b>{t("typedTitle")}</b>
          <ul className="typed">{list.typed.map((x) => (
            <li key={x.name}><span dir="auto">{x.name}</span> <span className="hint">· {t("insPatients", { n: x.patients })}</span>
              {edit && <> · <button type="button" className="link" onClick={() => start("new", { ...EMPTY, nameEn: x.name, nameAr: x.name }, x.name)}>{t("addToList")}</button></>}</li>
          ))}</ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Settings › Photos and documents
// The clinic's own lists (body areas, kinds of document, relationships) and the limits. A new entry's key comes from its English
// name once and never changes (photos and documents point at it); one in use can't be removed (the server refuses).
type Row = { key: string; en: string; ar: string; isNew?: boolean; secretary?: boolean; review?: boolean };
function ListEditor({ title, hint, rows, set, edit, addLabel, flags }: { title: string; hint?: string; rows: Row[]; set: (r: Row[]) => void; edit: boolean; addLabel: string; flags?: boolean }) {
  const { t } = useI18n();
  const upd = (i: number, p: Partial<Row>) => set(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <section className="panel">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {rows.map((r, i) => (
        <div className={`lrow${flags ? " flags" : ""}`} key={r.isNew ? `new-${i}` : r.key}>
          <Field label={t("fieldEn")}><input dir="ltr" value={r.en} maxLength={60} required disabled={!edit} onChange={(e) => upd(i, { en: e.target.value })} /></Field>
          <Field label={t("fieldAr")}><input dir="rtl" value={r.ar} maxLength={60} required disabled={!edit} onChange={(e) => upd(i, { ar: e.target.value })} /></Field>
          {flags && <div className="lflags">
            <label className="check"><input type="checkbox" disabled={!edit} checked={!!r.secretary} onChange={(e) => upd(i, { secretary: e.target.checked })} /> <span>{t("secretaryOpens")}</span></label>
            <label className="check"><input type="checkbox" disabled={!edit} checked={!!r.review} onChange={(e) => upd(i, { review: e.target.checked })} /> <span>{t("needsReview")}</span></label>
          </div>}
          {edit && rows.length > 1 && <button type="button" className="link" onClick={() => set(rows.filter((_, j) => j !== i))}>{t("remove")}</button>}
        </div>
      ))}
      {edit && <div><button type="button" className="btn btn-outline btn-sm" onClick={() => set([...rows, { key: "", en: "", ar: "", isNew: true, ...(flags ? { secretary: false, review: false } : {}) }])}>{addLabel}</button></div>}
    </section>
  );
}
const withKeys = <T extends Row>(rows: T[]) => {
  const taken = rows.filter((r) => !r.isNew).map((r) => r.key);
  return rows.map((r) => { if (!r.isNew) return r; const key = keyFor(r.en, taken); taken.push(key); return { ...r, key, isNew: undefined }; });
};

function FilesSettings({ edit }: { edit: boolean }) {
  const { t, error } = useI18n();
  const { look, reloadLook } = useApp();
  const s0 = look.settings;
  const [areas, setAreas] = useState<Row[]>(s0.photoAreas);
  const [kinds, setKinds] = useState<Row[]>(s0.docKinds);
  const [relations, setRelations] = useState<Row[]>(s0.relations);
  const [rules, setRules] = useState({ photoConsentRequired: s0.photoConsentRequired, maxFileMb: s0.maxFileMb, linkMinutes: s0.linkMinutes, phoneMinutes: s0.phoneMinutes });
  const [saved, setSaved] = useState(false);
  const a = useAction();
  const strip = (r: Row): Named => ({ key: r.key, en: r.en.trim(), ar: r.ar.trim() });
  return (
    <form className="setbody" onSubmit={a.submit(async () => {
      const r = await put<S>("/api/settings", { ...look.settings, ...rules, photoAreas: withKeys(areas).map(strip),
        docKinds: withKeys(kinds).map((k): DocKind => ({ ...strip(k), secretary: !!k.secretary, review: !!k.review })), relations: withKeys(relations).map(strip) });
      setAreas(r.photoAreas); setKinds(r.docKinds); setRelations(r.relations); setSaved(true); reloadLook();
    })}>
      <ListEditor title={t("areasTitle")} hint={t("areasHint")} rows={areas} set={setAreas} edit={edit} addLabel={t("addArea")} />
      <ListEditor title={t("kindsTitle")} hint={t("kindsHint")} rows={kinds} set={setKinds} edit={edit} addLabel={t("addKind")} flags />
      <ListEditor title={t("relationsTitle")} rows={relations} set={setRelations} edit={edit} addLabel={t("addRelation")} />
      <section className="panel">
        <h2>{t("rulesTitle")}</h2>
        <label className="check"><input type="checkbox" disabled={!edit} checked={rules.photoConsentRequired} onChange={(e) => setRules({ ...rules, photoConsentRequired: e.target.checked })} /> <span>{t("consentRequired")}</span></label>
        <div className="dgrid">
          <Field label={t("maxMb")}><input type="number" className="mono" min={1} max={50} disabled={!edit} value={rules.maxFileMb} onChange={(e) => setRules({ ...rules, maxFileMb: Number(e.target.value) })} /></Field>
          <Field label={t("linkMin")}><input type="number" className="mono" min={1} max={60} disabled={!edit} value={rules.linkMinutes} onChange={(e) => setRules({ ...rules, linkMinutes: Number(e.target.value) })} /></Field>
          <Field label={t("phoneMin")}><input type="number" className="mono" min={2} max={60} disabled={!edit} value={rules.phoneMinutes} onChange={(e) => setRules({ ...rules, phoneMinutes: Number(e.target.value) })} /></Field>
        </div>
      </section>
      {a.err && <Banner>{a.err.code === "in_use" ? `${error("in_use")} (${(a.err.data.keys ?? []).join(", ")})` : a.message}</Banner>}
      {saved && !a.err && <Banner kind="ok">{t("saved")}</Banner>}
      {edit && <div><button className="btn btn-ink" disabled={a.busy}>{t("save")}</button></div>}
    </form>
  );
}

// ---------------------------------------------------------------- Settings › Backups
type Run = { id: number; kind: string; started_at: string; finished_at: string | null; state: "running" | "done" | "failed"; files: number; bytes: number; restore_checked: number | null; message: string | null };
type BStatus = { configured: boolean; canEdit?: boolean; settings?: { run_at: string; timezone: string; keep_daily: number; keep_monthly: number; restore_weekday: number; alert_emails: string | null };
  runs?: Run[]; lastDone?: { finished_at: string; files: number } | null; lastCheck?: { finished_at: string; restore_checked: number } | null;
  files?: number; copied?: number; bytes?: number; disk?: { freeGb: number } | null; keyFingerprint?: string | null };
function BackupsTab() {
  const { t, lang } = useI18n();
  const { look } = useApp();
  const [s, setS] = useState<BStatus | null>(null);
  const load = useCallback(() => { get<BStatus>("/api/backups").then(setS).catch(() => setS({ configured: false })); }, []);
  useEffect(load, [load]);
  const [f, setF] = useState<{ runAt: string; timezone: string; keepDaily: number; keepMonthly: number; restoreWeekday: number; alertEmails: string } | null>(null);
  useEffect(() => { if (s?.settings) setF({ runAt: s.settings.run_at.slice(0, 5), timezone: s.settings.timezone, keepDaily: s.settings.keep_daily, keepMonthly: s.settings.keep_monthly,
    restoreWeekday: s.settings.restore_weekday, alertEmails: s.settings.alert_emails ?? "" }); }, [s]);
  const a = useAction();
  if (!s) return null;
  if (!s.configured) return <div className="setbody"><Banner kind="warn">{t("bkNotSet")}</Banner></div>;
  const tz = look.clinic.timezone;
  const when = (iso: string) => fmtDateTime(iso, tz, lang);
  const days = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 15 + i))));
  const last = s.runs?.[0];
  const mb = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;
  const edit = !!s.canEdit;
  return (
    <div className="setbody">
      {last?.state === "failed" ? <Banner>{t("bkFailedNow", { msg: last.message ?? "" })}</Banner>
        : s.lastDone ? <Banner kind="ok">{t("bkLast", { date: when(s.lastDone.finished_at), n: s.lastDone.files })}{s.lastCheck ? ` ${t("bkCheck", { date: when(s.lastCheck.finished_at), n: s.lastCheck.restore_checked })}` : ""}</Banner>
        : <Banner kind="warn">{t("bkNone")}</Banner>}
      <div className="kpis">
        <div className="kpi"><span className="hint">{t("bkFiles")}</span><b>{s.files}</b></div>
        <div className="kpi"><span className="hint">{t("bkCopied")}</span><b>{s.copied}</b><span className="hint">{t("bkFilesN", { n: s.copied ?? 0, mb: mb(s.bytes ?? 0) })}</span></div>
        {s.disk && <div className="kpi"><span className="hint">{t("bkFree")}</span><b>{s.disk.freeGb} GB</b></div>}
      </div>
      <section className="panel">
        <h2>{t("bkNights")}</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>{t("bkNight")}</th><th>{t("bkCopiedCol")}</th><th>{t("bkState")}</th></tr></thead>
          <tbody>{(s.runs ?? []).map((r) => (
            <tr key={r.id}><td>{when(r.started_at)} {r.kind === "retry" ? t("bkRetry") : r.kind === "manual" ? t("bkManual") : ""}</td>
              <td>{t("bkFilesN", { n: r.files, mb: mb(Number(r.bytes)) })}{r.restore_checked !== null ? ` · ${t("bkChecked", { n: r.restore_checked })}` : ""}</td>
              <td><span className={`pill ${r.state === "done" ? "ok" : r.state === "failed" ? "bad" : "warn"}`} title={r.message ?? ""}>{t(r.state === "done" ? "bkDone" : r.state === "failed" ? "bkFailed" : "bkRunning")}</span></td></tr>
          ))}</tbody>
        </table></div>
        {edit && <div><button type="button" className="btn btn-outline btn-sm" disabled={a.busy} onClick={() => void a.run(async () => { await post("/api/backups/run"); load(); })}>{t("bkRunNow")}</button></div>}
      </section>
      {f && <form className="panel" onSubmit={a.submit(async () => { await put("/api/backups/settings", { ...f, alertEmails: f.alertEmails || null }); load(); })}>
        <h2>{t("bkSchedule")}</h2>
        {!edit && <p className="hint">{t("bkEditNote")}</p>}
        <div className="dgrid">
          <Field label={t("bkRunAt")}><input type="time" className="mono" disabled={!edit} value={f.runAt} onChange={(e) => setF({ ...f, runAt: e.target.value })} /></Field>
          <Field label={t("bkTz")}><input dir="ltr" disabled={!edit} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
          <Field label={t("bkKeepDaily")}><input type="number" className="mono" min={1} max={365} disabled={!edit} value={f.keepDaily} onChange={(e) => setF({ ...f, keepDaily: Number(e.target.value) })} /></Field>
          <Field label={t("bkKeepMonthly")}><input type="number" className="mono" min={0} max={120} disabled={!edit} value={f.keepMonthly} onChange={(e) => setF({ ...f, keepMonthly: Number(e.target.value) })} /></Field>
          <Field label={t("bkRestoreDay")}><select disabled={!edit} value={f.restoreWeekday} onChange={(e) => setF({ ...f, restoreWeekday: Number(e.target.value) })}>{days.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></Field>
          <Field label={t("bkEmails")}><input dir="ltr" disabled={!edit} value={f.alertEmails} maxLength={500} onChange={(e) => setF({ ...f, alertEmails: e.target.value })} /></Field>
        </div>
        {a.err && <Banner>{a.message}</Banner>}
        {edit && <div><button className="btn btn-ink" disabled={a.busy}>{t("save")}</button></div>}
      </form>}
      <section className="panel">
        <h2>{t("bkKey")}</h2>
        <p>{t("bkKeyText")}</p>
        {s.keyFingerprint && <p className="hint">{t("bkFingerprint", { f: "" })}<span className="mono">{s.keyFingerprint}</span></p>}
      </section>
    </div>
  );
}
