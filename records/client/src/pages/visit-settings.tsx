// Records › Settings › Before and after the visit (design: booking/design/records-phase-c.html §6). Every part is off until the
// clinic switches it on, and every number is here. The clinic's forms are saved one by one (a changed form becomes a new version).
import { useEffect, useState } from "react";
import { get, post, put, type FormTemplate, type Question, type QKind, type RxItem, type Settings as S } from "../api";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, Field, useAction } from "../ui";
import { fill, useV } from "../visit-text";

const keyFor = (en: string, taken: string[]) => {
  let base = en.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  if (!/^[a-z]/.test(base)) base = "q_" + base;
  let k = base, n = 2;
  while (taken.includes(k)) k = `${base}_${n++}`;
  return k;
};

export function VisitSettings({ edit }: { edit: boolean }) {
  const v = useV();
  const { t, lang } = useI18n();
  const { look, reloadLook } = useApp();
  const s0 = look.settings;
  const [f, setF] = useState({ coursesOn: s0.coursesOn, courseAreaRequired: s0.courseAreaRequired, courseDefaults: s0.courseDefaults, rxOn: s0.rxOn, rxValidDays: s0.rxValidDays, rxPaper: s0.rxPaper,
    rxFavourites: s0.rxFavourites, formsOn: s0.formsOn, formLinkHours: s0.formLinkHours, formMessageEn: s0.formMessageEn, formMessageAr: s0.formMessageAr,
    summaryModel: s0.summaryModel, summaryDaily: s0.summaryDaily });
  const [saved, setSaved] = useState(false);
  const a = useAction();
  const svcName = (id: string) => { const x = look.services.find((y) => y.id === id); return x ? (lang === "ar" ? x.name_ar : x.name_en) : "—"; };
  const setFav = (i: number, p: Partial<RxItem>) => setF({ ...f, rxFavourites: f.rxFavourites.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setDef = (i: number, p: Partial<S["courseDefaults"][number]>) => setF({ ...f, courseDefaults: f.courseDefaults.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const unusedService = look.services.find((x) => !f.courseDefaults.some((d) => d.serviceId === x.id));
  return (
    <div className="setbody">
      <form className="setbody" onSubmit={a.submit(async () => {
        await put<S>("/api/settings/visit", { ...f, rxFavourites: f.rxFavourites.filter((x) => x.name.trim()) });
        setSaved(true); reloadLook();
      })}>
        <p className="hint">{v.sEveryOff}</p>
        <section className="panel">
          <h2>{v.sForms}</h2>
          <label className="check"><input type="checkbox" disabled={!edit} checked={f.formsOn} onChange={(e) => setF({ ...f, formsOn: e.target.checked })} /> <span>{v.sFormsOn}</span></label>
          <Field label={v.sLinkHours}><input type="number" className="mono" min={1} max={168} disabled={!edit} value={f.formLinkHours} onChange={(e) => setF({ ...f, formLinkHours: Number(e.target.value) })} /></Field>
          <Field label={`${v.sMessage} (English)`} hint={v.sMessageHint}><textarea dir="ltr" maxLength={400} disabled={!edit} value={f.formMessageEn} onChange={(e) => setF({ ...f, formMessageEn: e.target.value })} /></Field>
          <Field label={`${v.sMessage} (العربية)`}><textarea dir="rtl" maxLength={400} disabled={!edit} value={f.formMessageAr} onChange={(e) => setF({ ...f, formMessageAr: e.target.value })} /></Field>
        </section>

        <section className="panel">
          <h2>{v.sRx}</h2>
          <label className="check"><input type="checkbox" disabled={!edit} checked={f.rxOn} onChange={(e) => setF({ ...f, rxOn: e.target.checked })} /> <span>{v.sRxOn}</span></label>
          <p className="hint">{v.sRxHint}</p>
          <div className="dgrid">
            <Field label={v.validFor}><input type="number" className="mono" min={1} max={365} disabled={!edit} value={f.rxValidDays} onChange={(e) => setF({ ...f, rxValidDays: Number(e.target.value) })} /></Field>
            <Field label={v.sPaper}><select disabled={!edit} value={f.rxPaper} onChange={(e) => setF({ ...f, rxPaper: e.target.value as "A5" | "A4" })}><option>A5</option><option>A4</option></select></Field>
          </div>
          <h3 className="sec-h">{v.sFavs}</h3>
          <p className="hint">{v.sFavsHint}</p>
          {f.rxFavourites.map((x, i) => (
            <div key={i} className="favrow">
              <input dir="ltr" placeholder={v.medicine} aria-label={v.medicine} maxLength={120} disabled={!edit} value={x.name} onChange={(e) => setFav(i, { name: e.target.value })} />
              <input dir="auto" placeholder={v.how} aria-label={v.how} maxLength={200} disabled={!edit} value={x.how} onChange={(e) => setFav(i, { how: e.target.value })} />
              <input type="number" placeholder={v.forDays} aria-label={v.forDays} min={1} max={365} disabled={!edit} value={x.days ?? ""} onChange={(e) => setFav(i, { days: e.target.value ? Number(e.target.value) : null })} />
              {edit && <button type="button" className="link" style={{ color: "var(--muted)" }} onClick={() => setF({ ...f, rxFavourites: f.rxFavourites.filter((_, j) => j !== i) })}>{v.remove}</button>}
            </div>
          ))}
          {edit && <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setF({ ...f, rxFavourites: [...f.rxFavourites, { name: "", how: "", days: null, qty: "" }] })}>{v.sAddFav}</button>}
        </section>

        <section className="panel">
          <h2>{v.sCourses}</h2>
          <label className="check"><input type="checkbox" disabled={!edit} checked={f.coursesOn} onChange={(e) => setF({ ...f, coursesOn: e.target.checked })} /> <span>{v.sCoursesOn}</span></label>
          <label className="check"><input type="checkbox" disabled={!edit} checked={f.courseAreaRequired} onChange={(e) => setF({ ...f, courseAreaRequired: e.target.checked })} /> <span>{v.sAreaRequired}</span></label>
          <p className="hint">{v.sDefaults}</p>
          {f.courseDefaults.map((x, i) => (
            <div key={i} className="favrow">
              <select disabled={!edit} value={x.serviceId} aria-label={v.service} onChange={(e) => setDef(i, { serviceId: e.target.value })}>
                {look.services.filter((s) => s.id === x.serviceId || !f.courseDefaults.some((d) => d.serviceId === s.id)).map((s) => <option key={s.id} value={s.id}>{svcName(s.id)}</option>)}
              </select>
              <input type="number" min={1} max={50} disabled={!edit} aria-label={v.sessionsN} value={x.sessions} onChange={(e) => setDef(i, { sessions: Number(e.target.value) })} />
              <input type="number" min={0} max={52} disabled={!edit} aria-label={v.everyWeeks} value={x.weeks} onChange={(e) => setDef(i, { weeks: Number(e.target.value) })} />
              <span className="hint">{fill(v.sTimesEvery, { n: x.sessions, w: x.weeks })}</span>
              {edit && <button type="button" className="link" style={{ color: "var(--muted)" }} onClick={() => setF({ ...f, courseDefaults: f.courseDefaults.filter((_, j) => j !== i) })}>{v.remove}</button>}
            </div>
          ))}
          {edit && unusedService && <button type="button" className="link" style={{ alignSelf: "flex-start" }}
            onClick={() => setF({ ...f, courseDefaults: [...f.courseDefaults, { serviceId: unusedService.id, sessions: 6, weeks: 6 }] })}>{v.sAddDefault}</button>}
        </section>

        <section className="panel">
          <h2>{v.sAi}</h2>
          <div className="dgrid">
            <Field label={v.sModel}><select disabled={!edit} value={f.summaryModel} onChange={(e) => setF({ ...f, summaryModel: e.target.value as S["summaryModel"] })}>
              <option value="off">{v.sOff}</option><option value="claude-haiku-5-5">Claude Haiku 5.5</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5</option></select></Field>
            <Field label={v.sPerDay}><input type="number" className="mono" min={1} max={200} disabled={!edit} value={f.summaryDaily} onChange={(e) => setF({ ...f, summaryDaily: Number(e.target.value) })} /></Field>
          </div>
          <p className="hint">{v.sAiHint}</p>
        </section>
        {a.err && <Banner>{a.message}</Banner>}
        {saved && !a.err && <Banner kind="ok">{t("saved")}</Banner>}
        {edit && <div><button className="btn btn-ink" disabled={a.busy}>{t("save")}</button></div>}
      </form>
      <FormsList edit={edit} />
    </div>
  );
}

// ---------------------------------------------------------------- the clinic's forms
function FormsList({ edit }: { edit: boolean }) {
  const v = useV();
  const { lang } = useI18n();
  const [list, setList] = useState<FormTemplate[] | null>(null);
  const [open, setOpen] = useState<string | "new" | null>(null);
  const load = () => { get<FormTemplate[]>("/api/forms").then(setList).catch(() => setList([])); };
  useEffect(load, []);
  if (!list) return null;
  return (
    <section className="panel">
      <h2>{v.forms}</h2>
      {list.map((x) => open === x.id ? <FormEditor key={x.id} tpl={x} edit={edit} onDone={() => { setOpen(null); load(); }} /> : (
        <div key={x.id} className="li">
          <span><b>{lang === "ar" ? x.title_ar : x.title_en}</b>{x.hidden && <> <span className="pill">{v.sHidden}</span></>}
            <br /><span className="s">{fill(v.sQuestions, { n: x.questions.length })}{x.consent ? ` ${v.sSignature}` : ""} · {x.first_visit_only ? v.sFirstVisit : ""}{x.first_visit_only ? ", " : ""}
              {x.service_ids.length ? fill(v.sSomeServices, { n: x.service_ids.length }) : v.sAnyService} · {fill(v.version, { v: x.version })}</span></span>
          <span className="end">{edit && <button className="link" onClick={() => setOpen(x.id)}>{v.sEdit}</button>}</span>
        </div>
      ))}
      {open === "new" && <FormEditor edit={edit} onDone={() => { setOpen(null); load(); }} />}
      {edit && open !== "new" && <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setOpen("new")}>{v.sNewForm}</button>}
      <p className="hint">{v.sVersionHint}</p>
    </section>
  );
}

type QDraft = Question & { isNew?: boolean; optionsText?: string };
const optText = (q: Question) => (q.options ?? []).map((o) => `${o.en} | ${o.ar}`).join("\n");
const parseOpts = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [en, ar] = l.split("|").map((x) => x.trim()); return { en, ar: ar || en }; });

function FormEditor({ tpl, edit, onDone }: { tpl?: FormTemplate; edit: boolean; onDone: () => void }) {
  const v = useV();
  const { t, lang } = useI18n();
  const { look } = useApp();
  const [f, setF] = useState({ titleEn: tpl?.title_en ?? "", titleAr: tpl?.title_ar ?? "", consent: tpl?.consent ?? false, agreeEn: tpl?.agree_en ?? "", agreeAr: tpl?.agree_ar ?? "",
    firstVisitOnly: tpl?.first_visit_only ?? false, serviceIds: tpl?.service_ids ?? [], minutes: tpl?.minutes ?? 2, hidden: tpl?.hidden ?? false });
  const [qs, setQs] = useState<QDraft[]>((tpl?.questions ?? []).map((q) => ({ ...q, optionsText: optText(q) })));
  const a = useAction();
  const setQ = (i: number, p: Partial<QDraft>) => setQs(qs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const targets: [string, string][] = [["", v.sNowhere], ...(["allergy", "medicine", "condition"] as const).map((k) => [k, v.goes[k]] as [string, string]),
    ...look.settings.specialtyFields.map((x) => [`field:${x.key}`, lang === "ar" ? x.ar : x.en] as [string, string])];
  return (
    <form className="efrm formed" onSubmit={a.submit(async () => {
      const taken: string[] = qs.filter((x) => !x.isNew).map((x) => x.key);
      const questions = qs.map((x) => {
        const key = x.isNew ? keyFor(x.en, taken) : x.key; taken.push(key);
        return { key, en: x.en, ar: x.ar, kind: x.kind, required: !!x.required, goesTo: x.goesTo || null, ...(x.kind === "choice" ? { options: parseOpts(x.optionsText ?? "") } : {}) };
      });
      const body = { ...f, questions, agreeEn: f.consent ? f.agreeEn : null, agreeAr: f.consent ? f.agreeAr : null };
      if (tpl) await put(`/api/forms/${tpl.id}`, { ...body, expectedVersion: tpl.row_version }); else await post("/api/forms", body);
      onDone();
    })}>
      <div className="dgrid">
        <Field label={v.sTitleEn}><input dir="ltr" maxLength={80} disabled={!edit} value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} required /></Field>
        <Field label={v.sTitleAr}><input dir="rtl" maxLength={80} disabled={!edit} value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} required /></Field>
        <Field label={v.sMinutes}><input type="number" min={1} max={30} disabled={!edit} value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} /></Field>
      </div>
      <label className="check"><input type="checkbox" disabled={!edit} checked={f.firstVisitOnly} onChange={(e) => setF({ ...f, firstVisitOnly: e.target.checked })} /> <span>{v.sFirstOnly}</span></label>
      <fieldset className="svcs"><legend>{v.sServices}</legend>
        {look.services.map((s) => <label key={s.id} className="check"><input type="checkbox" disabled={!edit} checked={f.serviceIds.includes(s.id)}
          onChange={(e) => setF({ ...f, serviceIds: e.target.checked ? [...f.serviceIds, s.id] : f.serviceIds.filter((x) => x !== s.id) })} /> <span>{lang === "ar" ? s.name_ar : s.name_en}</span></label>)}
      </fieldset>
      {qs.map((q, i) => (
        <div key={i} className="qrow">
          <div className="dgrid">
            <Field label={v.sQEn}><input dir="ltr" maxLength={300} disabled={!edit} value={q.en} onChange={(e) => setQ(i, { en: e.target.value })} required /></Field>
            <Field label={v.sQAr}><input dir="rtl" maxLength={300} disabled={!edit} value={q.ar} onChange={(e) => setQ(i, { ar: e.target.value })} required /></Field>
            <Field label={v.sKind}><select disabled={!edit} value={q.kind} onChange={(e) => setQ(i, { kind: e.target.value as QKind })}>
              {Object.entries(v.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label={v.sGoesTo}><select disabled={!edit} value={q.goesTo ?? ""} onChange={(e) => setQ(i, { goesTo: e.target.value || null })}>
              {targets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          </div>
          {q.kind === "choice" && <Field label={v.sOptions}><textarea dir="auto" disabled={!edit} value={q.optionsText ?? ""} onChange={(e) => setQ(i, { optionsText: e.target.value })} /></Field>}
          <div className="row between">
            <label className="check"><input type="checkbox" disabled={!edit} checked={!!q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> <span>{v.sRequired}</span></label>
            {edit && <button type="button" className="link" style={{ color: "var(--muted)" }} onClick={() => setQs(qs.filter((_, j) => j !== i))}>{v.remove}</button>}
          </div>
        </div>
      ))}
      {edit && <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setQs([...qs, { key: "", en: "", ar: "", kind: "yesno", required: false, goesTo: null, isNew: true }])}>{v.sAddQ}</button>}
      <label className="check"><input type="checkbox" disabled={!edit} checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> <span>{v.sConsent}</span></label>
      {f.consent && <div className="dgrid">
        <Field label={v.sAgreeEn}><textarea dir="ltr" maxLength={1000} disabled={!edit} value={f.agreeEn} onChange={(e) => setF({ ...f, agreeEn: e.target.value })} required /></Field>
        <Field label={v.sAgreeAr}><textarea dir="rtl" maxLength={1000} disabled={!edit} value={f.agreeAr} onChange={(e) => setF({ ...f, agreeAr: e.target.value })} required /></Field>
      </div>}
      {tpl && <label className="check"><input type="checkbox" disabled={!edit} checked={f.hidden} onChange={(e) => setF({ ...f, hidden: e.target.checked })} /> <span>{v.sHide}</span></label>}
      <p className="hint">{v.sVersionHint}</p>
      {a.err && <Banner>{a.message}</Banner>}
      <div className="row">{edit && <button className="btn btn-ink btn-sm" disabled={a.busy}>{t("save")}</button>}<button type="button" className="link" onClick={onDone}>{t("cancel")}</button></div>
    </form>
  );
}
