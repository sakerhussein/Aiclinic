// Records phase C on Booking's pages (design: booking/design/records-phase-c.html §7): the treatment course line, the state of the
// booking's forms with "Send the link", and the "℞ Prescription" button on the visit note. Each appears only while the clinic has
// that part switched on in Records › Settings › Before and after the visit. Booking never sees the patient's answers.
import { useEffect, useState } from "react";
import { get, post } from "./api";
import { useI18n } from "./i18n";
import { useApp } from "./session";
import { useAction } from "./ui";

type Lines = {
  course: { n: number; of: number; service_en: string; service_ar: string; areas_en: string; areas_ar: string } | null;
  forms: { total: number; filled: number; canSend: boolean; link: { created_at: string; sent_count: number; opened_at: string | null; expires_at: string } | null } | null;
  rxOn: boolean;
};
type Link = { url: string; message: string; whatsapp: string | null; expiresAt: string };

const EN = {
  course: "Treatment course", session: "{service}: session {n} of {of}", forms: "Forms before the visit", filled: "Filled ({n} of {of})", allFilled: "Filled",
  notFilled: "Not filled yet", sentTimes: "link sent {n}×", opened: "opened", send: "Send the link", resend: "Send again", whatsapp: "Send on WhatsApp", copy: "Copy the link",
  copied: "Copied.", openHere: "Open here (front-desk tablet)", sendHint: "From the clinic's WhatsApp. The message holds no health information; sending again ends the old link.",
  noPhone: "No phone number for this patient: copy the link instead.", rx: "℞ Prescription",
};
const AR: typeof EN = {
  course: "دورة العلاج", session: "{service}: الجلسة {n} من {of}", forms: "النماذج قبل الزيارة", filled: "عُبّئت ({n} من {of})", allFilled: "عُبّئت",
  notFilled: "لم تُعبّأ بعد", sentTimes: "أُرسل الرابط {n} مرة", opened: "فُتح", send: "إرسال الرابط", resend: "إرسال مرة أخرى", whatsapp: "إرسال على واتساب", copy: "نسخ الرابط",
  copied: "نُسخ.", openHere: "فتح هنا (جهاز الاستقبال)", sendHint: "من واتساب العيادة. الرسالة لا تحمل معلومات صحية؛ وإعادة الإرسال تُنهي الرابط القديم.",
  noPhone: "لا يوجد رقم هاتف لهذا المريض: انسخ الرابط بدلاً من ذلك.", rx: "℞ وصفة",
};
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
/** "Laser hair removal (Legs, Underarms)": the service and the course's areas. */
const courseName = (c: NonNullable<Lines["course"]>, lang: string) => {
  const s = lang === "ar" ? c.service_ar : c.service_en, a = lang === "ar" ? c.areas_ar : c.areas_en;
  return a ? `${s} (${a})` : s;
};

function useLines(id: string) {
  const [l, setL] = useState<Lines | null>(null);
  const load = () => { get<Lines>(`/api/appointments/${id}/visit-lines`).then(setL).catch(() => setL(null)); };
  useEffect(() => { setL(null); load(); }, [id]);                // eslint-disable-line react-hooks/exhaustive-deps
  return { l, load };
}

/** The course and forms lines, as <dt>/<dd> pairs inside the booking page's facts list. */
export function VisitFacts({ id }: { id: string }) {
  const { lang } = useI18n();
  const { can } = useApp();
  const x = lang === "ar" ? AR : EN;
  const { l, load } = useLines(id);
  const [link, setLink] = useState<Link | null>(null);
  const act = useAction();
  const [copied, setCopied] = useState(false);
  if (!l) return null;
  const f = l.forms;
  const send = () => act.run(async () => { setCopied(false); setLink(await post<Link>(`/api/appointments/${id}/form-link`)); load(); });
  return <>
    {l.course && <><dt>{x.course}</dt><dd>{fill(x.session, { service: courseName(l.course, lang), n: l.course.n, of: l.course.of })}</dd></>}
    {f && <><dt>{x.forms}</dt><dd>
      <span className="row" style={{ gap: 8, flexWrap: "wrap", display: "inline-flex" }}>
        {f.filled === f.total ? <span className="pill ok">{x.allFilled}</span>
          : f.filled > 0 ? <span className="pill warn">{fill(x.filled, { n: f.filled, of: f.total })}</span> : <span className="pill warn">{x.notFilled}</span>}
        {f.link && <span className="hint">{fill(x.sentTimes, { n: f.link.sent_count })}{f.link.opened_at ? ` · ${x.opened}` : ""}</span>}
        {f.filled < f.total && f.canSend && can("booking.appointments.edit") && !link &&
          <button type="button" className="link" disabled={act.busy} onClick={() => void send()}>{f.link ? x.resend : x.send}</button>}
      </span>
      {link && (
        <span className="formlink">
          <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {link.whatsapp && <a className="btn btn-accent btn-sm" href={link.whatsapp} target="_blank" rel="noreferrer">{x.whatsapp}</a>}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => setCopied(true)); }}>{x.copy}</button>
            <a className="btn btn-outline btn-sm" href={link.url} target="_blank" rel="noreferrer">{x.openHere}</a>
          </span>
          <span className="hint">{link.whatsapp ? x.sendHint : x.noPhone}{copied ? ` ${x.copied}` : ""}</span>
        </span>
      )}
      {act.err && <span className="hint" role="alert">{act.message}</span>}
    </dd></>}
  </>;
}

/** On the visit note: the course line ("Laser hair removal: session 4 of 6") and "℞ Prescription", which opens a new prescription for
 *  this visit in Records (doctors who may write one). */
export function NoteVisitBar({ id, patientId }: { id: string; patientId: string }) {
  const { lang } = useI18n();
  const { me, can } = useApp();
  const { l } = useLines(id);
  if (!l) return null;
  const x = lang === "ar" ? AR : EN;
  const rx = l.rxOn && me.recordsUrl && can("records.rx.write");
  if (!l.course && !rx) return null;
  return (
    <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
      {l.course ? <p className="hint" style={{ margin: 0 }}>{x.course}: {fill(x.session, { service: courseName(l.course, lang), n: l.course.n, of: l.course.of })}</p> : <span />}
      {rx && <a className="btn btn-outline btn-sm" href={`${me.recordsUrl}/patients/${patientId}?tab=rx&new=1&visit=${id}`}>{x.rx}</a>}
    </div>
  );
}
