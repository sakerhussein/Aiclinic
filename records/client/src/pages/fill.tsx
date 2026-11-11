// The patient's phone: forms before the visit (design: booking/design/records-phase-c.html §4). No sign-in: the private link for
// one booking is the key, and it ends some hours after the visit. Arabic or English, large buttons, nothing to install.
// A signed consent is also drawn here as a picture (the form, the answers, the signature) and kept as a locked copy in Documents.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FormAnswer, Question } from "../api";
import { useI18n } from "../i18n";
import { fill, textFor } from "../visit-text";

type PForm = { id: string; title_en: string; title_ar: string; questions: Question[]; consent: boolean; agree_en: string | null; agree_ar: string | null;
  minutes: number; version: number; filled: boolean };
type Info = { language: "en" | "ar"; clinic: { en: string; ar: string; timezone: string }; service: { en: string; ar: string }; startsAt: string;
  firstName: string | null; forms: PForm[] };

const token = () => window.location.pathname.split("/f/")[1]?.split(/[/?#]/)[0] ?? "";
async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "server_error"), { code: data.error || "server_error", data });
  return data as T;
}

export function FillPage() {
  const { lang, setLang, error } = useI18n();
  const v = textFor(lang);
  const [info, setInfo] = useState<Info | null>(null);
  const [ended, setEnded] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    call<Info>("GET", `/api/f/${token()}`).then((x) => {
      setInfo(x); setLang(x.language, false);
      const first = x.forms.findIndex((f) => !f.filled); setI(first < 0 ? x.forms.length : first);
    }).catch(() => setEnded(true));
  }, []);                                                      // eslint-disable-line react-hooks/exhaustive-deps
  if (ended) return <main className="fill"><div className="fcard"><p className="ftext">{v.fEnded}</p></div></main>;
  if (!info) return null;
  const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { timeZone: info.clinic.timezone, weekday: "short", day: "numeric",
    month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(info.startsAt));
  const minutes = info.forms.filter((f) => !f.filled).reduce((n, f) => n + f.minutes, 0);
  const done = i >= info.forms.length;
  return (
    <main className="fill">
      <header className="fhead">
        <span>{lang === "ar" ? info.clinic.ar : info.clinic.en}</span>
        <button type="button" className="flang" onClick={() => setLang(lang === "ar" ? "en" : "ar", false)}>{v.fLang}</button>
      </header>
      <h1>{v.fBefore}</h1>
      <p className="hint">{fill(v.fIntro, { service: lang === "ar" ? info.service.ar : info.service.en, date, n: info.forms.length, m: minutes })}</p>
      <ol className="fsteps">{info.forms.map((f, n) => <li key={f.id} className={n === i ? "on" : f.filled ? "done" : ""}>{n + 1} · {lang === "ar" ? f.title_ar : f.title_en}{f.filled ? " ✓" : ""}</li>)}</ol>
      {done ? <div className="fcard"><p className="ftext">{v.fThanks}</p><p className="hint">{v.fAllDone}</p></div>
        : <OneForm key={info.forms[i].id} f={info.forms[i]} lang={lang} error={error} clinic={lang === "ar" ? info.clinic.ar : info.clinic.en} date={date}
            onSent={() => { info.forms[i].filled = true; const next = info.forms.findIndex((f) => !f.filled); setI(next < 0 ? info.forms.length : next); window.scrollTo(0, 0); }} />}
    </main>
  );
}

function OneForm({ f, lang, error, clinic, date, onSent }: { f: PForm; lang: "en" | "ar"; error: (c: string) => string; clinic: string; date: string; onSent: () => void }) {
  const v = textFor(lang);
  const [ans, setAns] = useState<Record<string, FormAnswer>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const pad = useRef<SignPad>(null);
  const set = (k: string, x: Partial<FormAnswer>) => setAns((a) => ({ ...a, [k]: { ...(a[k] ?? { value: "" }), ...x } }));
  const send = async () => {
    const miss = f.questions.filter((q) => q.required && !ans[q.key]?.value).map((q) => q.key);
    setMissing(miss); setErr("");
    if (miss.length) { document.getElementById(`q-${miss[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const sig = f.consent ? pad.current?.png() ?? null : null;
    if (f.consent && (!sig || !name.trim())) { setErr(error("signature_needed")); return; }
    setBusy(true);
    try {
      const answers = Object.fromEntries(Object.entries(ans).filter(([, a]) => a.value).map(([k, a]) => [k, a.details && a.value === "yes" ? a : { value: a.value }]));
      const r = await call<{ id: string; copy: boolean }>("POST", `/api/f/${token()}/forms/${f.id}`, { answers, language: lang, ...(f.consent ? { signature: sig, signedName: name.trim() } : {}) });
      // The answers and the signature are saved. The locked copy is drawn and sent next; the patient never waits more than a few
      // seconds for it (the Forms tab can always show the signed form from what was saved).
      if (r.copy && sig) {
        const sendCopy = drawCopy({ f, lang, clinic, date, answers, sig, name: name.trim() })
          .then((png) => fetch(`/api/f/${token()}/copy/${r.id}`, { method: "POST", headers: { "content-type": "image/png" }, body: png })).catch(() => null);
        await Promise.race([sendCopy, new Promise((ok) => setTimeout(ok, 8000))]);
      }
      onSent();
    } catch (e) { setErr(error((e as { code?: string }).code ?? "server_error")); } finally { setBusy(false); }
  };
  return (
    <form className="fcard" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <h2>{lang === "ar" ? f.title_ar : f.title_en}</h2>
      {f.questions.map((q) => {
        const a = ans[q.key]; const label = lang === "ar" ? q.ar : q.en; const bad = missing.includes(q.key);
        return (
          <fieldset key={q.key} id={`q-${q.key}`} className={`fq${bad ? " bad" : ""}`}>
            <legend>{label}{q.required ? " *" : ""}</legend>
            {(q.kind === "yesno" || q.kind === "yesno_details") && <div className="fyn">
              {(["yes", "no"] as const).map((x) => <button key={x} type="button" className={a?.value === x ? "on" : ""} aria-pressed={a?.value === x} onClick={() => set(q.key, { value: x })}>{x === "yes" ? v.yes : v.no}</button>)}
            </div>}
            {q.kind === "yesno_details" && a?.value === "yes" && <input dir="auto" placeholder={v.fDetails} value={a.details ?? ""} maxLength={300} onChange={(e) => set(q.key, { details: e.target.value })} />}
            {q.kind === "choice" && <select value={a?.value ?? ""} onChange={(e) => set(q.key, { value: e.target.value })}><option value="">{v.fChoose}</option>
              {(q.options ?? []).map((o) => <option key={o.en} value={o.en}>{lang === "ar" ? o.ar : o.en}</option>)}</select>}
            {q.kind === "text" && <input dir="auto" value={a?.value ?? ""} maxLength={300} onChange={(e) => set(q.key, { value: e.target.value })} />}
            {q.kind === "date" && <input type="date" value={a?.value ?? ""} onChange={(e) => set(q.key, { value: e.target.value })} />}
            {bad && <span className="ferr">{v.fRequired}</span>}
          </fieldset>
        );
      })}
      {f.consent && <div className="fq">
        <p className="ftext" dir="auto">{lang === "ar" ? f.agree_ar : f.agree_en}</p>
        <SignPadView ref={pad} label={v.fSign} clear={v.fClear} />
        <label className="fname">{v.fName}<input dir="auto" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        <p className="hint">{v.fAgree}</p>
      </div>}
      {err && <p className="ferr" role="alert">{err}</p>}
      <button className="fsend" disabled={busy}>{busy ? v.fSending : v.fSend}</button>
    </form>
  );
}

// ---------------------------------------------------------------- the signature: drawn with a finger
type SignPad = { png: () => string | null };
const SignPadView = forwardRef<SignPad, { label: string; clear: string }>(function SignPadView({ label, clear }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  useEffect(() => {
    const c = cv.current!; const r = c.getBoundingClientRect(); const k = window.devicePixelRatio || 1;
    c.width = r.width * k; c.height = r.height * k;
    const g = c.getContext("2d")!; g.scale(k, k); g.lineWidth = 2.4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0A0F14";
    let down = false;
    const at = (e: PointerEvent) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top] as const; };
    const start = (e: PointerEvent) => { down = true; c.setPointerCapture(e.pointerId); const [x, y] = at(e); g.beginPath(); g.moveTo(x, y); };
    const move = (e: PointerEvent) => { if (!down) return; const [x, y] = at(e); g.lineTo(x, y); g.stroke(); drawn.current = true; };
    const end = () => { down = false; };
    c.addEventListener("pointerdown", start); c.addEventListener("pointermove", move); c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    return () => { c.removeEventListener("pointerdown", start); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", end); c.removeEventListener("pointercancel", end); };
  }, []);
  useImperativeHandle(ref, () => ({ png: () => (drawn.current ? cv.current!.toDataURL("image/png") : null) }), []);
  return (
    <div className="fsig">
      <span className="hint">{label}</span>
      <canvas ref={cv} className="fpad" aria-label={label} />
      <button type="button" className="link" onClick={() => { const c = cv.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); drawn.current = false; }}>{clear}</button>
    </div>
  );
});

// ---------------------------------------------------------------- the locked copy: the whole consent as one picture
async function drawCopy({ f, lang, clinic, date, answers, sig, name }: { f: PForm; lang: "en" | "ar"; clinic: string; date: string;
  answers: Record<string, FormAnswer>; sig: string; name: string }): Promise<Blob> {
  const v = textFor(lang);
  const W = 1000, P = 48, rtl = lang === "ar";
  const c = document.createElement("canvas"); c.width = W; c.height = 3000;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, c.height); g.fillStyle = "#0A0F14";
  g.direction = rtl ? "rtl" : "ltr"; g.textAlign = rtl ? "right" : "left";
  const x0 = rtl ? W - P : P;
  let y = P;
  const font = (px: number, bold = false) => { g.font = `${bold ? "600 " : ""}${px}px "IBM Plex Sans Arabic", "Geist", system-ui, sans-serif`; };
  const lines = (text: string, px: number, bold = false, gap = 8) => {
    font(px, bold);
    const words = text.split(/\s+/); let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (g.measureText(test).width > W - 2 * P && line) { y += px; g.fillText(line, x0, y); y += gap; line = w; } else line = test;
    }
    if (line) { y += px; g.fillText(line, x0, y); y += gap; }
  };
  lines(clinic, 22, true); lines(`${rtl ? f.title_ar : f.title_en} · ${fill(v.version, { v: f.version })}`, 30, true, 14); lines(date, 20, false, 20);
  for (const q of f.questions) {
    const a = answers[q.key];
    const shown = !a?.value ? v.noAnswer : q.kind === "yesno" || q.kind === "yesno_details" ? `${a.value === "yes" ? v.yes : v.no}${a.details ? `: ${a.details}` : ""}`
      : q.kind === "choice" ? ((q.options ?? []).find((o) => o.en === a.value)?.[lang] ?? a.value) : a.value;
    lines(rtl ? q.ar : q.en, 20, true, 4); lines(shown, 20, false, 14);
  }
  y += 10; lines((rtl ? f.agree_ar : f.agree_en) ?? "", 20, false, 14);
  const img = new Image();
  await new Promise((ok) => { img.onload = ok; img.onerror = ok; img.src = sig; });
  const h = Math.min(220, (img.height / img.width) * 520);
  g.drawImage(img, rtl ? W - P - 520 : P, y + 6, 520, h); y += h + 16;
  lines(fill(v.signedBy, { name }), 20, true, 8); lines(new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC", 16, false, 8);
  const out = document.createElement("canvas"); out.width = W; out.height = Math.min(c.height, y + P);
  out.getContext("2d")!.drawImage(c, 0, 0);
  return new Promise((r) => out.toBlob((b) => r(b!), "image/png"));
}
