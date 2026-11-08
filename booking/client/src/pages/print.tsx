// Brochures (design: booking/design/brochures.html), printed at their real size from the clinic's own details. The browser's
// own "Save as PDF" makes the file: sharp at any size and with Arabic shaped correctly, which in-browser PDF libraries miss.
// /print/flyer · /print/stand · /print/card · /print/next   (from Settings › Online booking › Brochures)
import QRCode from "qrcode";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { get } from "../api";
import { useI18n } from "../i18n";
import "./print.css";

type Lang = "ar" | "en";
type Data = {
  profile: { name_en: string; name_ar: string; phone: string | null; address_en: string | null; address_ar: string | null };
  online: { brochure_colour: string; brochure_card_languages: "ar_en" | "ar" | "en"; brochure_show_ai: boolean; chat_enabled: boolean };
  onlineLink: { url?: string };
};
export const DESIGNS = ["flyer", "stand", "card", "next"] as const;
type Design = (typeof DESIGNS)[number];

// The printed wording: booking information only, no prices, offers or claims about results (plan, Feature 3).
const W = {
  en: {
    head: "Book your visit in a minute", lead: "Scan the code, choose the service, the doctor and a time that suits you. The clinic confirms your booking.",
    s1: "Scan", s2: "Choose a time", s3: "Clinic confirms",
    ai: "Or chat with our assistant on the same link. It is an AI; staff check every booking.",
    standHead: "Your next visit, booked from here", standAi: "Book yourself, or chat with our AI assistant.",
    cardHead: "Book your next visit", cardLead: "Scan, choose a time. Booking, change or cancel online.",
    next: "Your next visit", date: "Date", time: "Time", doctor: "Doctor", bookOrChange: "Book or change", by: "Booking by",
  },
  ar: {
    head: "احجز موعدك بدقيقة", lead: "امسح الرمز، واختر الخدمة والطبيب والوقت المناسب لك. والعيادة بتأكد حجزك.",
    s1: "امسح الرمز", s2: "اختر الوقت", s3: "العيادة بتأكد",
    ai: "أو احكي مع مساعدنا على نفس الرابط. هو مساعد ذكي (ذكاء اصطناعي)، والعيادة بتراجع كل حجز.",
    standHead: "احجز زيارتك الجاية من هون", standAi: "احجز بنفسك، أو احكي مع مساعدنا الذكي.",
    cardHead: "احجز زيارتك الجاية", cardLead: "امسح واختر الوقت. حجز أو تغيير أو إلغاء أونلاين.",
    next: "موعدك الجاي", date: "التاريخ", time: "الوقت", doctor: "الطبيب", bookOrChange: "احجز أو غيّر", by: "الحجز عبر",
  },
};
const UI = {
  en: { print: "Print or save as PDF", hint: "In the print window choose “Save as PDF” to keep a file, or choose a printer. Set margins to “None” and scale to 100%.", back: "Back to Settings", noLink: "The booking link is not set up on this server yet.", loadErr: "Could not load the clinic's details. Reload the page to try again.", names: { flyer: "Reception flyer · A5", stand: "Table stand · A6 folded, printed on A5", card: "Take-away card · 85 × 55 mm", next: "Next-visit card · 85 × 55 mm" } },
  ar: { print: "طباعة أو حفظ PDF", hint: "في نافذة الطباعة اختر «حفظ بتنسيق PDF» لحفظ ملف، أو اختر طابعة. اجعل الهوامش «بلا» والمقياس ١٠٠٪.", back: "العودة إلى الإعدادات", noLink: "رابط الحجز غير مُعدّ على هذا الخادم بعد.", loadErr: "تعذّر تحميل بيانات العيادة. أعد تحميل الصفحة للمحاولة مرة أخرى.", names: { flyer: "منشور الاستقبال · A5", stand: "حامل الطاولة · A6 مطوي، يُطبع على A5", card: "بطاقة للأخذ · ٨٥ × ٥٥ ملم", next: "بطاقة الموعد القادم · ٨٥ × ٥٥ ملم" } },
};
const SIZE: Record<Design, string> = { flyer: "148mm 210mm", stand: "148mm 210mm", card: "85mm 55mm", next: "85mm 55mm" };

function useQr(url: string | undefined) {
  const [svg, setSvg] = useState("");
  useEffect(() => { if (url) void QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(setSvg); }, [url]);
  return svg;
}
// The QR from the qrcode library: an SVG it draws from the link alone.
const Qr = ({ svg, mm }: { svg: string; mm: number }) => <span className="pr-qr" style={{ width: `${mm}mm`, height: `${mm}mm` }} dangerouslySetInnerHTML={{ __html: svg }} />;
const Mark = ({ mm }: { mm: number }) => (
  <span className="pr-mark" style={{ width: `${mm}mm`, height: `${mm}mm` }}>
    <svg viewBox="0 0 40 20" width="70%" aria-hidden="true"><path d="M20 10 C16.6 5.5 13.2 2 8.8 2 A8 8 0 0 0 8.8 18 C13.2 18 16.6 14.5 20 10 C23.4 5.5 26.8 2 31.2 2 A8 8 0 0 1 38.4 12.9" fill="none" stroke="#2EE6B5" strokeWidth="2.8" strokeLinecap="round" /><circle cx="33.6" cy="17.2" r="1.8" fill="#2EE6B5" /></svg>
  </span>
);

export function PrintPage() {
  const { design } = useParams();
  const { lang: uiLang } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { get<Data>("/api/settings").then(setData).catch(() => setErr(true)); }, []);
  const d = (DESIGNS as readonly string[]).includes(design ?? "") ? (design as Design) : "flyer";
  const tagged = data?.onlineLink.url ? `${data.onlineLink.url}?from=${d}` : undefined;
  const svg = useQr(tagged);
  const ui = UI[uiLang];
  useEffect(() => { document.title = `${ui.names[d]} · Limitsiz`; }, [d, ui]);
  if (err) return <p className="pr-msg">{ui.loadErr} <Link to="/settings?tab=online">{ui.back}</Link></p>;
  if (!data) return <p className="pr-msg">…</p>;
  if (!data.onlineLink.url) return <p className="pr-msg">{ui.noLink} <Link to="/settings?tab=online">{ui.back}</Link></p>;

  const o = data.online, p = data.profile;
  const c = (l: Lang) => ({ name: l === "ar" ? p.name_ar : p.name_en, place: (l === "ar" ? p.address_ar : p.address_en) ?? "", phone: p.phone ?? "" });
  const showAi = o.brochure_show_ai && o.chat_enabled;
  const short = tagged!.replace(/^https?:\/\//, "").replace(/\?from=.*$/, "");
  // The short link may wrap only after its slash, never at a hyphen in the clinic's name, and it shrinks to fit its box
  // (--n: the longest part in characters; the mono font is 0.6 em wide per character).
  const slash = short.indexOf("/");
  const parts = slash < 0 ? [short] : [short.slice(0, slash + 1), short.slice(slash + 1)];
  const Url = () => (
    <span className="pr-urlbox"><span className="pr-url" style={{ "--n": Math.max(...parts.map((x) => x.length)) } as CSSProperties}>
      <span>{parts[0]}</span>{parts[1] !== undefined && <><wbr /><span>{parts[1]}</span></>}
    </span></span>
  );
  const style = { "--brand": o.brochure_colour } as CSSProperties;
  const cardLangs: Lang[] = o.brochure_card_languages === "ar_en" ? ["ar", "en"] : [o.brochure_card_languages];

  const Top = ({ l, mm = 13 }: { l: Lang; mm?: number }) => (
    <div className="pr-top"><Mark mm={mm} /><div className="pr-name">{c(l).name}<small>{c(l).place}</small></div></div>
  );
  const By = ({ l }: { l: Lang }) => <span className="pr-by">{W[l].by} <b>Limitsiz</b></span>;
  const Sheet = ({ l, cls, children, flip }: { l: Lang; cls: string; children: ReactNode; flip?: boolean }) => (
    <div className={`pr-sheet ${cls}${flip ? " pr-flip" : ""}`} dir={l === "ar" ? "rtl" : "ltr"} lang={l}>{children}</div>
  );

  const flyer = (l: Lang) => {
    const w = W[l];
    return <div className="pr-page pr-a5" key={`f-${l}`}><Sheet l={l} cls="pr-flyer">
      <Top l={l} />
      <h1 className="pr-big">{w.head}</h1>
      <p className="pr-lead">{w.lead}</p>
      <div className="pr-qrwrap"><Qr svg={svg} mm={44} /><Url /></div>
      <div className="pr-steps"><div><b>{l === "ar" ? "١" : "1"}</b>{w.s1}</div><div><b>{l === "ar" ? "٢" : "2"}</b>{w.s2}</div><div><b>{l === "ar" ? "٣" : "3"}</b>{w.s3}</div></div>
      {showAi && <div className="pr-ai"><b>AI</b>{w.ai}</div>}
      <div className="pr-foot"><span className="pr-mono">{c(l).phone}</span><By l={l} /></div>
    </Sheet></div>;
  };
  // Each face is A6 on its side (half of the A5 sheet), so the code sits beside the words.
  const standFace = (l: Lang, flip: boolean) => {
    const w = W[l];
    return <Sheet l={l} cls="pr-a6face" flip={flip}>
      <Top l={l} mm={11} />
      <div className="pr-standbody">
        <div className="pr-standtext">
          <h1 className="pr-big pr-mid">{w.standHead}</h1>
          <Url />
          {showAi && <div className="pr-ai pr-small"><b>AI</b>{w.standAi}</div>}
        </div>
        <Qr svg={svg} mm={40} />
      </div>
      <div className="pr-foot"><span className="pr-mono">{c(l).phone}</span><By l={l} /></div>
    </Sheet>;
  };
  const cardFront = (l: Lang) => <div className="pr-page pr-bc" key={`cf-${l}`}><Sheet l={l} cls="pr-card">
    <Top l={l} mm={9} />
    <div className="pr-foot pr-tiny"><span className="pr-mono">{c(l).phone}</span><By l={l} /></div>
  </Sheet></div>;
  const cardBack = (l: Lang) => <div className="pr-page pr-bc" key={`cb-${l}`}><Sheet l={l} cls="pr-card pr-row">
    <Qr svg={svg} mm={30} />
    <div className="pr-cardtext"><b>{W[l].cardHead}</b><span className="pr-cardlead">{W[l].cardLead}</span><Url /></div>
  </Sheet></div>;
  const nextCard = (l: Lang) => {
    const w = W[l];
    return <div className="pr-page pr-bc" key={`n-${l}`}><Sheet l={l} cls="pr-card pr-next">
      <div className="pr-nexthead"><b>{w.next}</b><span>{c(l).name}</span></div>
      <div className="pr-nextbody">
        <div className="pr-lines">{[w.date, w.time, w.doctor].map((x) => <div key={x}>{x}<i /></div>)}</div>
        <div className="pr-nextqr"><Qr svg={svg} mm={17} /><span>{w.bookOrChange}</span></div>
      </div>
      <div className="pr-foot pr-tiny"><span className="pr-mono">{c(l).phone}</span><By l={l} /></div>
    </Sheet></div>;
  };

  const pages = d === "flyer" ? [flyer("ar"), flyer("en")]
    : d === "stand" ? [<div className="pr-page pr-a5 pr-tent" key="stand">{standFace("en", true)}<div className="pr-fold" />{standFace("ar", false)}</div>]
    : d === "card" ? cardLangs.flatMap((l) => [cardFront(l), cardBack(l)])
    : cardLangs.map(nextCard);

  return (
    <div className="pr" style={style}>
      <style>{`@page { size: ${SIZE[d]}; margin: 0; }`}</style>
      <div className="pr-bar" dir={uiLang === "ar" ? "rtl" : "ltr"}>
        <b>{ui.names[d]}</b>
        <button type="button" className="btn btn-accent btn-sm" onClick={() => window.print()}>{ui.print}</button>
        <Link className="btn btn-ghost btn-sm" to="/settings?tab=online">{ui.back}</Link>
        <span className="hint">{ui.hint}</span>
      </div>
      <div className="pr-pages">{pages}</div>
    </div>
  );
}
