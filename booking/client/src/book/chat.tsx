// "Talk to the assistant" on the online booking page (design: booking/design/assistant-chat.html).
// The assistant only proposes a time. The name and number are typed into a small form here and sent with the Yes press (or a
// call-back request) straight to the clinic's page server; they are never part of a chat message, so they never reach the AI.
// An online visit's card also holds the clinic's consent tick, video or audio (when the patient chooses) and how the Join link
// comes; the page's server decides whether this number may book one (the assistant never learns the number).
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Banner, CalendarButtons, Fail, PaymentCard, Shell, ShareLink, call, hm, longDate, message, useLang, type Info, type Online, type Summary } from "./app";
import type { Lang, Tx } from "./text";
import { HumanBox, HumanError, HumanLine, isHumanError, useHuman, type Human } from "./human";

type Proposal = { serviceEn: string; serviceAr: string; doctorEn: string; doctorAr: string; startsAt: string; visitType?: string };
type OnlineChoice = { consent: boolean; mode: string; channel: string; email: string };
type Turn = { reply: string | null; buttons: string[] | null; proposal: Proposal | null; callback: boolean; emergency: boolean };
type Details = { name: string; phone: string; agree: boolean; website: string };
type Item =
  | { k: "ai" | "me"; text: string }
  | { k: "buttons"; labels: string[]; used?: boolean }
  | { k: "details"; then: Proposal }
  | { k: "confirm"; p: Proposal; done?: boolean; needMode?: boolean; refused?: boolean; human?: string }
  | { k: "booked"; s: Summary & { manageToken?: string }; channel?: string }
  | { k: "callback"; sent?: boolean; human?: string }
  | { k: "emergency"; text: string }
  | { k: "unavailable"; limit?: boolean }
  | { k: "error"; text: string };

// *bold* as in WhatsApp, without ever treating text as HTML.
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.startsWith("*") && part.endsWith("*") && part.length > 2 ? <b key={i}>{part.slice(1, -1)}</b>
      : part.split("\n").map((line, j) => <Fragment key={`${i}-${j}`}>{j > 0 && <br />}{line}</Fragment>))}</>;
}

// The chat and the page always use one language. A message decides it only when it clearly is in one: Arabic letters, or
// English words other than short neutral ones ("ok", "yes", "thanks" are often typed in Latin letters in an Arabic chat).
// Anything else (a time like "10:30", a number, an emoji, "ok") keeps the language last used.
const NEUTRAL = new Set(["ok", "okay", "k", "yes", "yeah", "no", "thanks", "thank", "thx", "hi", "hello", "bye", "sure", "done", "cool", "please", "pls"]);
export function languageOf(text: string, last: Lang): Lang {
  if (/[؀-ۿ]/.test(text)) return "ar";
  const words = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !NEUTRAL.has(w));
  return words.some((w) => w.length >= 2) ? "en" : last;
}

const masked = (phone: string, cc: string) => {
  const d = phone.replace(/[^\d]/g, "").replace(/^0+/, "");
  return `+${cc} ${d.slice(0, 2)} ••• ${d.slice(-4)}`;
};

export function ChatPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState("");
  const { lang, setLang, x } = useLang(info?.clinic.defaultLanguage);
  useEffect(() => { call<Info>("GET", `/api/c/${slug}`).then(setInfo).catch((e) => setMissing(e instanceof Fail ? e.code : "server_error")); }, [slug]);
  const [items, setItems] = useState<Item[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  // The human check (design: booking/design/human-check.html) on "Yes, book it", "Call me back" and, when the clinic chose it, starting the chat.
  const hc = info?.options.humanCheck;
  const hBook = useHuman(hc, "chat_book", lang), hCall = useHuman(hc, "callback", lang), hStart = useHuman(hc, "chat_start", lang);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [items, busy]);

  if (!info) {
    const msg = missing === "clinic_not_found" ? x.clinicNotFound : missing ? x.serverError : "";
    return <Shell name="Limitsiz" lang={lang} setLang={setLang} x={x}>{msg ? <Banner kind="warn">{msg}</Banner> : <p className="bk-hint">…</p>}</Shell>;
  }
  const c = info.clinic, o = info.options;
  const add = (...it: Item[]) => setItems((v) => [...v, ...it]);
  const update = (i: number, it: Item) => setItems((v) => v.map((old, j) => (j === i ? it : old)));
  const closed = !o.chatEnabled || items.some((i) => i.k === "unavailable");

  const fail = (e: unknown) => {
    const code = e instanceof Fail ? e.code : "server_error";
    if (["chat_limit", "too_many_chats"].includes(code)) add({ k: "unavailable", limit: true });
    else if (["assistant_unavailable", "assistant_busy", "chat_not_available", "chat_not_found"].includes(code)) add({ k: "unavailable" });
    else add({ k: "error", text: message(e, x) });
  };

  async function send(t: string) {
    const msg = t.trim();
    if (!msg || busy || closed) return;
    const language = languageOf(msg, lang);
    if (language !== lang) setLang(language);           // the page follows the conversation: button, greeting, cards and forms
    setText(""); setBusy(true);
    setItems((v) => [...v.map((i) => (i.k === "buttons" ? { ...i, used: true } : i)), { k: "me", text: msg }]);
    try {
      let id = chatId;
      if (!id) { id = (await call<{ chatId: string }>("POST", `/api/c/${slug}/chat`, { human: await hStart.token() })).chatId; setChatId(id); }
      // The assistant answers in this language: the one the patient wrote in, or the button's choice.
      const r = await call<Turn>("POST", `/api/c/${slug}/chat/${id}/message`, { text: msg, language });
      const out: Item[] = [];
      if (r.emergency && r.reply) out.push({ k: "emergency", text: r.reply });
      else if (r.reply) out.push({ k: "ai", text: r.reply });
      if (r.buttons?.length) out.push({ k: "buttons", labels: r.buttons });
      if (r.proposal) out.push(details ? { k: "confirm", p: r.proposal } : { k: "details", then: r.proposal });
      if (r.callback) out.push({ k: "callback" });
      add(...out);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function book(i: number, p: Proposal, d: Details, oc?: OnlineChoice) {
    setBusy(true);
    setItems((v) => v.map((old, j) => (j === i && old.k === "confirm" ? { ...old, human: undefined } : old)));   // a new try clears the last failure
    try {
      const human = await hBook.token();
      const s = await call<Summary & { manageToken?: string }>("POST", `/api/c/${slug}/chat/${chatId}/book`,
        { name: d.name, phone: d.phone, language: lang, agree: true, website: d.website, human,
          ...(oc ? { onlineConsent: oc.consent, onlineMode: oc.mode || undefined, linkChannel: oc.channel || undefined,
                     email: oc.channel === "email" ? oc.email.trim() || undefined : undefined } : {}) });
      update(i, { k: "confirm", p, done: true });
      add({ k: "me", text: x.yesBook }, { k: "booked", s, channel: oc?.channel }, { k: "ai", text: x.anythingElse });
    } catch (e) {
      const code = e instanceof Fail ? e.code : "";
      // Online: the card asks for video or audio when this patient chooses, or says the clinic did not accept an online visit.
      if (oc && code === "choose_mode") update(i, { k: "confirm", p, needMode: true });
      else if (code === "phone_not_accepted") update(i, { k: "confirm", p, refused: true });
      else if (isHumanError(code)) update(i, { k: "confirm", p, human: code });
      else if (code === "nothing_to_book") { update(i, { k: "confirm", p, done: true }); add({ k: "ai", text: x.cardExpired }); }
      else fail(e);
    } finally { setBusy(false); }
  }

  async function callBack(i: number, d: { name: string; phone: string; website: string }) {
    setBusy(true);
    try {
      update(i, { k: "callback" });
      let id = chatId;
      if (!id) { id = (await call<{ chatId: string }>("POST", `/api/c/${slug}/chat`, { human: await hStart.token() })).chatId; setChatId(id); }
      await call("POST", `/api/c/${slug}/chat/${id}/callback`, { ...d, human: await hCall.token() });
      update(i, { k: "callback", sent: true });
      add({ k: "ai", text: x.callbackSent });
    } catch (e) {
      const code = e instanceof Fail ? e.code : "";
      if (isHumanError(code)) update(i, { k: "callback", human: code }); else fail(e);
    } finally { setBusy(false); }
  }

  const nm = (p: Proposal) => ({ svc: lang === "ar" ? p.serviceAr : p.serviceEn, doc: lang === "ar" ? p.doctorAr : p.doctorEn });
  // Cloudflare's box lives in one place per form: the newest open card of each kind.
  const lastConfirm = items.reduce((n, it, j) => (it.k === "confirm" && !it.done && !it.refused ? j : n), -1);
  const lastCallback = items.reduce((n, it, j) => (it.k === "callback" && !it.sent ? j : n), -1);
  const view = items.map((it, i): ReactNode => {
    switch (it.k) {
      // The bubble keeps the page's side and corner; the text inside reads in its own direction (dir="auto"), so Arabic
      // runs right to left even on the English page, and the other way round.
      case "ai": return <div key={i} className="ch-b ai"><div dir="auto"><Rich text={it.text} /></div></div>;
      case "me": return <div key={i} className="ch-b me"><div dir="auto">{it.text}</div></div>;
      case "buttons": return it.used ? null : <div key={i} className="ch-chips">{it.labels.map((l) =>
        <button key={l} type="button" className={/^\d{1,2}:\d{2}$/.test(l) ? "mono" : ""} disabled={busy} onClick={() => void send(l)}>{l}</button>)}</div>;
      case "details": return <DetailsCard key={i} x={x} cc={o.countryCode} privacyUrl={o.privacyUrl} onDone={(d) => {
        setDetails(d);
        update(i, { k: "me", text: `${d.name} · ${masked(d.phone, o.countryCode)}` });
        add({ k: "ai", text: x.checkConfirm }, { k: "confirm", p: it.then });
      }} />;
      case "confirm": {
        const { svc, doc } = nm(it.p);
        const online = it.p.visitType === "online" && o.online?.enabled ? o.online : null;
        return <div key={i} className="ch-card">
          <div className="bk-sum"><span>{x.service}</span><b>{svc}</b></div>
          <div className="bk-sum"><span>{x.doctor}</span><b>{doc}</b></div>
          <div className="bk-sum"><span>{x.when}</span><b>{longDate(it.p.startsAt, c.timezone, lang)}{lang === "ar" ? "، " : ", "}<span className="mono">{hm(it.p.startsAt, c.timezone)}</span></b></div>
          {online && <div className="bk-sum"><span>{x.visit}</span><b>{x.onlineWhere}</b></div>}
          {details && <div className="bk-sum"><span>{x.name}</span><b>{details.name}</b></div>}
          {!it.done && !it.refused && <HumanError code={it.human} x={x} phone={c.phone} />}
          {!it.done && !it.refused && i === lastConfirm && <HumanBox h={hBook} x={x} />}
          {!it.done && (online && !(it.refused && online.whoCanBook === "everyone")
            ? <OnlineConfirm key={`o${i}`} on={online} x={x} lang={lang} busy={busy} ready={!!details} needMode={!!it.needMode} refused={!!it.refused} phone={c.phone}
                label={busy && hBook.checking ? x.checking : it.human ? x.tryAgain : x.yesBook}
                onBook={(oc) => details && void book(i, it.p, details, oc)}
                onClinic={() => { update(i, { ...it, done: true }); void send(x.atClinicText); }}
                onNo={() => { update(i, { ...it, done: true }); void send(x.noChangeText); }} />
            : it.refused ? <Refused x={x} phone={c.phone} busy={busy} onCallBack={() => { update(i, { ...it, done: true }); add({ k: "callback" }); }} />
            : <>
              <button type="button" className="bk-btn accent" disabled={busy || !details} onClick={() => details && void book(i, it.p, details)}>
                {busy && hBook.checking ? x.checking : it.human ? x.tryAgain : x.yesBook}</button>
              <button type="button" className="bk-btn ghost" disabled={busy} onClick={() => { update(i, { ...it, done: true }); void send(x.noChangeText); }}>{x.noChange}</button>
            </>)}
          {!it.done && !it.refused && i === lastConfirm && <HumanLine h={hBook} x={x} />}
        </div>;
      }
      case "booked": {
        const s = it.s, link = `${location.origin}/${slug}/manage#${s.manageToken}`;
        return <div key={i} className="ch-card">
          <div className="ch-done"><span className="bk-ok" aria-hidden="true">✓</span><b>{x.doneTitle}</b></div>
          {s.waitingForCheck && <Banner kind="warn">{x.waiting.replace("{phone}", "⁦" + masked(details?.phone ?? "", o.countryCode) + "⁩")}</Banner>}
          {s.visitType === "online" && <div className="bk-join wait"><b>{x.yourJoin}</b><span className="bk-hint">{it.channel === "whatsapp" || it.channel === "email"
            ? x.joinComes.replace("{channel}", it.channel === "email" ? x.chEmail : x.chWhatsapp) : x.joinComesPage}</span></div>}
          {s.visitType === "online" && <PaymentCard p={s.payment} x={x} lang={lang} />}
          {s.manageToken && <ShareLink s={s} x={x} lang={lang} link={link} />}
          {s.manageToken && <CalendarButtons s={s} x={x} lang={lang} link={link} />}
        </div>;
      }
      case "callback": return it.sent ? null : <CallbackCard key={i} x={x} cc={o.countryCode} phone={c.phone} busy={busy} onSend={(d) => void callBack(i, d)}
        human={i === lastCallback ? hCall : null} humanCode={it.human} label={busy && (hCall.checking || hStart.checking) ? x.checking : it.human ? x.tryAgain : x.callMe} />;
      case "emergency": return <Fragment key={i}>
        <Banner kind="bad"><span dir="auto" style={{ display: "block" }}><Rich text={it.text} /></span></Banner>
        <a className="bk-btn danger solid" href="tel:911">{x.call911}</a>
      </Fragment>;
      case "unavailable": return <Fragment key={i}>
        <Banner kind="warn">{it.limit ? x.chatLimit : x.chatUnavailable}</Banner>
        <a className="bk-btn ink" href={`/${slug}`}>{x.chooseYourself}</a>
        {c.phone && <a className="bk-btn ghost" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}><span className="mono">{c.phone}</span></a>}
      </Fragment>;
      case "error": return <Banner key={i} kind="bad">{it.text}</Banner>;
    }
  });

  return (
    <Shell name={lang === "ar" ? c.nameAr : c.nameEn} place={lang === "ar" ? c.addressAr : c.addressEn} lang={lang} setLang={setLang} x={x} privacyUrl={o.privacyUrl}>
      <div className="ch">
        <div className="ch-head"><span className="ch-ai">AI</span>{x.aiName}
          <button type="button" className="ch-person" onClick={() => add({ k: "callback" })} disabled={closed}>{x.talkToPerson}</button></div>
        {!o.chatEnabled ? <>
            <Banner kind="warn">{x.chatUnavailable}</Banner>
            <a className="bk-btn ink" href={`/${slug}`}>{x.chooseYourself}</a>
          </> : <>
            <div className="ch-b ai">{x.chatHello}</div>
            {!items.length && <div className="ch-chips">{x.chatSuggest.map((l) => <button key={l} type="button" onClick={() => void send(l)}>{l}</button>)}</div>}
            {view}
            {busy && <div className="ch-b ai ch-typing">{x.thinking}</div>}
          </>}
        <div ref={end} />
      </div>
      {o.chatEnabled && <form className="ch-in" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(text); }}>
        <input value={text} maxLength={1000} dir="auto" placeholder={x.typeMessage} aria-label={x.typeMessage} disabled={closed} onChange={(e) => setText(e.target.value)} />
        <button className="ch-send" aria-label={x.send} disabled={busy || closed || !text.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="flip"><path d="M4 12l16-8-6 16-2.5-6.5z" fill="currentColor" /></svg>
        </button>
      </form>}
    </Shell>
  );
}

// The online part of the Yes card: the clinic's consent (Settings › Online visits), video or audio when the patient chooses it,
// and how the Join link comes. The same choices as the booking page's details step.
function OnlineConfirm({ on, x, lang, busy, ready, needMode, refused, phone, label, onBook, onClinic, onNo }: {
  on: Online; x: Tx; lang: Lang; busy: boolean; ready: boolean; needMode: boolean; refused: boolean; phone: string | null; label: string;
  onBook: (oc: OnlineChoice) => void; onClinic: () => void; onNo: () => void;
}) {
  const chans = on.channels ?? [];
  const [oc, setOc] = useState<OnlineChoice>({ consent: false, mode: "", channel: chans.includes(on.defaultChannel ?? "") ? on.defaultChannel! : chans[0] ?? "", email: "" });
  if (refused) return <>
    <Banner kind="bad"><b>{x.onlineRefused}</b><br />{x.onlineRefused2}{phone && <> <a className="mono" dir="ltr" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></>}</Banner>
    <button type="button" className="bk-btn ink" disabled={busy} onClick={onClinic}>{x.bookAtClinic}</button>
  </>;
  const modeMissing = (on.modeChoice || needMode) && !oc.mode;
  const emailMissing = oc.channel === "email" && !/^\S+@\S+\.\S+$/.test(oc.email.trim());
  return <form className="bk-stack" onSubmit={(e) => { e.preventDefault(); if (oc.consent && !modeMissing && !emailMissing) onBook(oc); }}>
    {needMode && !oc.mode && <Banner kind="warn">{x.chooseMode}</Banner>}
    {(on.modeChoice || needMode) && <div className="bk-field">{x.talkHow}
      <div className="bk-chips" role="radiogroup">{(["video", "audio"] as const).map((m) => (
        <button type="button" key={m} role="radio" aria-checked={oc.mode === m} className={oc.mode === m ? "on" : ""} onClick={() => setOc({ ...oc, mode: m })}>{m === "video" ? x.video : x.audio}</button>))}</div></div>}
    {chans.length > 1 && <div className="bk-field">{x.sendLinkBy}
      <div className="bk-chips" role="radiogroup">{chans.map((ch) => (
        <button type="button" key={ch} role="radio" aria-checked={oc.channel === ch} className={oc.channel === ch ? "on" : ""} onClick={() => setOc({ ...oc, channel: ch })}>{ch === "email" ? x.chEmail : x.chWhatsapp}</button>))}</div>
      <small>{x.linkByHint}</small></div>}
    {oc.channel === "email" && <label className="bk-field">{x.email}<input type="email" dir="ltr" autoComplete="email" required maxLength={120} value={oc.email} onChange={(e) => setOc({ ...oc, email: e.target.value })} /><small>{x.emailHint}</small></label>}
    <label className="bk-check"><input type="checkbox" required checked={oc.consent} onChange={(e) => setOc({ ...oc, consent: e.target.checked })} /><span>{lang === "ar" ? on.consentAr : on.consentEn}</span></label>
    <button className="bk-btn accent" disabled={busy || !ready || !oc.consent || modeMissing || emailMissing}>{label}</button>
    <button type="button" className="bk-btn ghost" disabled={busy} onClick={onNo}>{x.noChange}</button>
  </form>;
}

// The clinic did not accept a booking for this number (its limits in Settings › Online booking). The same words as the booking
// page; the clinic's phone and a call-back are one tap away.
function Refused({ x, phone, busy, onCallBack }: { x: Tx; phone: string | null; busy: boolean; onCallBack: () => void }) {
  return <>
    <Banner kind="bad"><b>{x.phoneRefused}</b><br />{x.phoneRefused2}{phone && <> <a className="mono" dir="ltr" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></>}</Banner>
    <button type="button" className="bk-btn ghost" disabled={busy} onClick={onCallBack}>{x.callMe}</button>
  </>;
}

function PhoneField({ cc, value, onChange }: { cc: string; value: string; onChange: (v: string) => void }) {
  return <span className="bk-tel" dir="ltr"><span className="mono">+{cc}</span>
    <input className="mono" type="tel" inputMode="tel" autoComplete="tel" required minLength={6} maxLength={30} value={value} onChange={(e) => onChange(e.target.value)} /></span>;
}

function DetailsCard({ x, cc, privacyUrl, onDone }: { x: Tx; cc: string; privacyUrl: string; onDone: (d: Details) => void }) {
  const [d, setD] = useState<Details>({ name: "", phone: "", agree: false, website: "" });
  return <form className="ch-card" onSubmit={(e) => { e.preventDefault(); if (d.agree) onDone(d); }}>
    <b>{x.whoFor}</b>
    <label className="bk-field">{x.fullName}<input autoComplete="name" required minLength={2} maxLength={120} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
    <label className="bk-field">{x.mobile}<PhoneField cc={cc} value={d.phone} onChange={(v) => setD({ ...d, phone: v })} /></label>
    <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={d.website} onChange={(e) => setD({ ...d, website: e.target.value })} /></label>
    <label className="bk-check"><input type="checkbox" required checked={d.agree} onChange={(e) => setD({ ...d, agree: e.target.checked })} />
      <span>{x.agree1}<a href={privacyUrl} target="_blank" rel="noopener">{x.privacy}</a>{x.agree2}</span></label>
    <button className="bk-btn ink" disabled={!d.agree}>{x.send}</button>
    <small className="bk-hint">🔒 {x.detailsSafe}</small>
  </form>;
}

function CallbackCard({ x, cc, phone, busy, onSend, human, humanCode, label }: { x: Tx; cc: string; phone: string | null; busy: boolean;
  onSend: (d: { name: string; phone: string; website: string }) => void; human: Human | null; humanCode?: string; label: string }) {
  const [d, setD] = useState({ name: "", phone: "", website: "" });
  return <form className="ch-card" onSubmit={(e) => { e.preventDefault(); onSend(d); }}>
    <b>{x.callMeTitle}</b>
    <label className="bk-field">{x.fullName}<input autoComplete="name" required minLength={2} maxLength={120} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
    <label className="bk-field">{x.mobile}<PhoneField cc={cc} value={d.phone} onChange={(v) => setD({ ...d, phone: v })} /></label>
    <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={d.website} onChange={(e) => setD({ ...d, website: e.target.value })} /></label>
    <HumanError code={humanCode} x={x} phone={phone} />
    {human && <HumanBox h={human} x={x} />}
    <button className="bk-btn ink" disabled={busy}>{label}</button>
    {phone && <a className="bk-btn ghost" href={`tel:${phone.replace(/[^\d+]/g, "")}`}><span className="mono">{phone}</span></a>}
    <small className="bk-hint">🔒 {x.detailsSafe}</small>
    {human && <HumanLine h={human} x={x} />}
  </form>;
}
