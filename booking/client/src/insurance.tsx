// The insurance line from Records, on the booking page and the patient page (design: booking/design/insurance.html, section 2).
// Shown while the clinic keeps Records › Settings › Chart › "Show the insurance line in Booking" on. Tapping the company opens its
// card: tap-to-call numbers, WhatsApp to the contact person, the clinic's notes. The card copies Records' (records/client/src/insurance.tsx).
import { useEffect, useState } from "react";
import { get } from "./api";
import { useI18n } from "./i18n";

type Company = { id: string; name_en: string; name_ar: string; phone: string | null; email: string | null; address: string | null; contact_name: string | null;
  contact_title: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null; hidden: boolean };
type Ins = { on: boolean; status: "unknown" | "none" | "insured" | null; company?: Company | null; other?: string | null };

const EN = { insurance: "Insurance", unknown: "Not asked yet", none: "No insurance", insured: "Insured", phone: "Telephone", contact: "Contact",
             email: "Email", address: "Address", whatsapp: "WhatsApp", close: "Close" };
const AR: typeof EN = { insurance: "التأمين", unknown: "لم يُسأل بعد", none: "بدون تأمين", insured: "مؤمَّن", phone: "الهاتف", contact: "المسؤول",
             email: "البريد", address: "العنوان", whatsapp: "واتساب", close: "إغلاق" };

const dial = (p: string) => p.replace(/[^\d+]/g, "");
const waNumber = (p: string) => { const x = dial(p); return x.startsWith("+") ? x.slice(1) : x.startsWith("00") ? x.slice(2) : ""; };

/** as="facts": a <dt>/<dd> pair inside the booking page's facts list; as="line": a line of its own. */
export function InsuranceLine({ patientId, as }: { patientId: string; as: "facts" | "line" }) {
  const { lang } = useI18n();
  const x = lang === "ar" ? AR : EN;
  const [ins, setIns] = useState<Ins | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { setIns(null); get<Ins>(`/api/patients/${patientId}/insurance`).then(setIns).catch(() => setIns(null)); }, [patientId]);
  if (!ins?.on) return null;
  const co = ins.company;
  const name = co ? (lang === "ar" ? co.name_ar : co.name_en) : ins.other;
  const value = (
    <span className="inswrap">
      {ins.status === "insured" ? <>
        {co ? <button type="button" className="linkish" aria-expanded={open} onClick={() => setOpen(!open)}><b>{name}</b> ▾</button> : <b dir="auto">{name}</b>}
        {" "}<span className="pill ok">{x.insured}</span>
      </> : ins.status === "none" ? <span className="pill">{x.none}</span> : <span className="hint">{x.unknown}</span>}
      {open && co && <Card c={co} name={name ?? ""} x={x} onClose={() => setOpen(false)} />}
    </span>
  );
  return as === "facts" ? <><dt>{x.insurance}</dt><dd>{value}</dd></> : <p className="insline">{x.insurance}: {value}</p>;
}

function Card({ c, name, x, onClose }: { c: Company; name: string; x: typeof EN; onClose: () => void }) {
  return (
    <div className="pop" role="dialog" aria-label={name}>
      <div className="row between"><b>{name}</b><button type="button" className="link" onClick={onClose}>{x.close}</button></div>
      <dl>
        {c.phone && <><dt>{x.phone}</dt><dd><a className="mono" dir="ltr" href={`tel:${dial(c.phone)}`}>{c.phone}</a></dd></>}
        {(c.contact_name || c.contact_phone) && <><dt>{x.contact}</dt><dd>
          {[c.contact_name, c.contact_title].filter(Boolean).join(" · ")}
          {c.contact_phone && <><br /><a className="mono" dir="ltr" href={`tel:${dial(c.contact_phone)}`}>{c.contact_phone}</a>
            {waNumber(c.contact_phone) && <>{" · "}<a href={`https://wa.me/${waNumber(c.contact_phone)}`} target="_blank" rel="noreferrer">{x.whatsapp}</a></>}</>}
          {c.contact_email && <><br /><a dir="ltr" href={`mailto:${c.contact_email}`}>{c.contact_email}</a></>}
        </dd></>}
        {c.email && <><dt>{x.email}</dt><dd><a dir="ltr" href={`mailto:${c.email}`}>{c.email}</a></dd></>}
        {c.address && <><dt>{x.address}</dt><dd dir="auto">{c.address}</dd></>}
      </dl>
      {c.notes && <div className="popnote" dir="auto">{c.notes}</div>}
    </div>
  );
}
