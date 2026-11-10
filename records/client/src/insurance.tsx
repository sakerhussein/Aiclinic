// Insurance in Records (design: booking/design/insurance.html): the answer under the patient's name, the company's card, and the
// insurance part of the Details form.
import { useState } from "react";
import type { Company, CompanyName, Details, InsStatus } from "./api";
import { useI18n } from "./i18n";
import { Field } from "./ui";

export const companyName = (c: { name_en: string; name_ar: string }, lang: string) => (lang === "ar" ? c.name_ar : c.name_en);
const dial = (p: string) => p.replace(/[^\d+]/g, "");
// WhatsApp needs the number with its country code: offered only when it was written that way (+962… or 00962…).
const waNumber = (p: string) => { const x = dial(p); return x.startsWith("+") ? x.slice(1) : x.startsWith("00") ? x.slice(2) : ""; };

/** Under the patient's name: "Insured · MedNet" (tap for the company's card), "No insurance", or nothing while not asked. */
export function InsurancePill({ details, insurer }: { details: Details | null; insurer: Company | null }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const status = details?.insurance_status ?? "unknown";
  if (status === "unknown") return null;
  if (status === "none") return <span className="pill">{t("insNone")}</span>;
  const name = insurer ? companyName(insurer, lang) : details?.insurance ?? "";
  if (!insurer) return <span className="pill ok">{t("insPill", { name })}</span>;
  return (
    <span className="inswrap">
      <button type="button" className="pill ok pillbtn" aria-expanded={open} onClick={() => setOpen(!open)}>{t("insPill", { name })} ▾</button>
      {open && <CompanyCard c={insurer} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** The company's card: tap-to-call numbers, WhatsApp to the contact person, and the clinic's notes in amber. */
export function CompanyCard({ c, onClose }: { c: Company; onClose: () => void }) {
  const { t, lang } = useI18n();
  return (
    <div className="pop" role="dialog" aria-label={companyName(c, lang)}>
      <div className="row between"><b>{companyName(c, lang)}</b><button type="button" className="link" onClick={onClose}>{t("close")}</button></div>
      <dl>
        {c.phone && <><dt>{t("coPhone")}</dt><dd><a className="mono" dir="ltr" href={`tel:${dial(c.phone)}`}>{c.phone}</a></dd></>}
        {(c.contact_name || c.contact_phone) && <><dt>{t("coContactShort")}</dt><dd>
          {[c.contact_name, c.contact_title].filter(Boolean).join(" · ")}
          {c.contact_phone && <><br /><a className="mono" dir="ltr" href={`tel:${dial(c.contact_phone)}`}>{c.contact_phone}</a>
            {waNumber(c.contact_phone) && <>{" · "}<a href={`https://wa.me/${waNumber(c.contact_phone)}`} target="_blank" rel="noreferrer">{t("whatsapp")}</a></>}</>}
          {c.contact_email && <><br /><a dir="ltr" href={`mailto:${c.contact_email}`}>{c.contact_email}</a></>}
        </dd></>}
        {c.email && <><dt>{t("coEmail")}</dt><dd><a dir="ltr" href={`mailto:${c.email}`}>{c.email}</a></dd></>}
        {c.address && <><dt>{t("coAddress")}</dt><dd dir="auto">{c.address}</dd></>}
      </dl>
      {c.notes && <div className="popnote" dir="auto">{c.notes}</div>}
    </div>
  );
}

export type InsDraft = { status: InsStatus; company: string; other: string };   // company: an id, "other", or ""
export const insDraftOf = (d: Details | null): InsDraft => ({
  status: d?.insurance_status ?? "unknown",
  company: d?.insurance_company_id ?? (d?.insurance ? "other" : ""),
  other: d?.insurance ?? "",
});
export const insBody = (x: InsDraft) => ({
  insuranceStatus: x.status,
  insuranceCompanyId: x.status === "insured" && x.company && x.company !== "other" ? x.company : null,
  insurance: x.status === "insured" && x.company === "other" ? x.other.trim() || null : null,
});

/** The insurance part of the Details form. Hidden companies are offered only to the patient who already has one. */
export function InsuranceFields({ x, set, companies, required, disabled }: { x: InsDraft; set: (x: InsDraft) => void; companies: CompanyName[];
                                                                              required: boolean; disabled: boolean }) {
  const { t, lang } = useI18n();
  const opts = companies.filter((c) => !c.hidden || c.id === x.company);
  const choices: [InsStatus, string][] = [["unknown", t("insUnknown")], ["none", t("insNone")], ["insured", t("insInsured")]];
  return (
    <div className="insbox">
      <span className="field" style={{ gap: 0 }}>{t("insurance")} <span className="hint">{required ? t("required") : t("optional")}</span></span>
      <div className="chips" role="radiogroup" aria-label={t("insurance")}>
        {choices.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={x.status === k} className={`chip${x.status === k ? " on" : ""}`} disabled={disabled}
            onClick={() => set({ ...x, status: k, company: k === "insured" ? x.company || (opts[0]?.id ?? "other") : x.company })}>{label}</button>
        ))}
      </div>
      {x.status === "insured" && (
        <div className="dgrid">
          <Field label={t("insCompany")}>
            <select value={x.company} disabled={disabled} onChange={(e) => set({ ...x, company: e.target.value })}>
              {opts.map((c) => <option key={c.id} value={c.id}>{companyName(c, lang)}{c.hidden ? ` ${t("insHidden")}` : ""}</option>)}
              <option value="other">{t("insOther")}</option>
            </select>
          </Field>
          {x.company === "other" && (
            <Field label={t("insOtherName")} hint={t("insOtherHint")}>
              <input dir="auto" maxLength={120} value={x.other} disabled={disabled} onChange={(e) => set({ ...x, other: e.target.value })} />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
