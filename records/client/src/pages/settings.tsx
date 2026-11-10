import { useState } from "react";
import { KINDS, put, type Field as SField, type Settings as S } from "../api";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, Field, useAction } from "../ui";

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

  return (
    <main className="wrap page">
      <h1 className="display">{t("settingsTitle")}</h1>
      {!edit && <Banner kind="warn">{t("readOnly")}</Banner>}
      <div className="setwrap">
        <nav className="settabs" aria-label={t("settingsTitle")}><button type="button" className="on">{t("setChart")}</button></nav>
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

          {a.err && <Banner>{a.message}</Banner>}
          {saved && !a.err && <Banner kind="ok">{t("saved")}</Banner>}
          {edit && <div><button className="btn btn-ink" disabled={a.busy}>{t("save")}</button></div>}
        </form>
      </div>
    </main>
  );
}
