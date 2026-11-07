// "Talk to the assistant" on the online booking page (design: booking/design/assistant-chat.html).
// The assistant only proposes a time. The name and number are typed into a small form here and sent with the Yes press (or a
// call-back request) straight to the clinic's page server; they are never part of a chat message, so they never reach the AI.
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Banner, Fail, Shell, ShareLink, call, hm, icsHref, longDate, message, useLang, type Info, type Summary } from "./app";
import type { Tx } from "./text";

type Proposal = { serviceEn: string; serviceAr: string; doctorEn: string; doctorAr: string; startsAt: string };
type Turn = { reply: string | null; buttons: string[] | null; proposal: Proposal | null; callback: boolean; emergency: boolean };
type Details = { name: string; phone: string; agree: boolean; website: string };
type Item =
  | { k: "ai" | "me"; text: string }
  | { k: "buttons"; labels: string[]; used?: boolean }
  | { k: "details"; then: Proposal }
  | { k: "confirm"; p: Proposal; done?: boolean }
  | { k: "booked"; s: Summary & { manageToken?: string } }
  | { k: "callback"; sent?: boolean }
  | { k: "emergency"; text: string }
  | { k: "unavailable"; limit?: boolean }
  | { k: "error"; text: string };

// *bold* as in WhatsApp, without ever treating text as HTML.
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.startsWith("*") && part.endsWith("*") && part.length > 2 ? <b key={i}>{part.slice(1, -1)}</b>
      : part.split("\n").map((line, j) => <Fragment key={`${i}-${j}`}>{j > 0 && <br />}{line}</Fragment>))}</>;
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
    setText(""); setBusy(true);
    setItems((v) => [...v.map((i) => (i.k === "buttons" ? { ...i, used: true } : i)), { k: "me", text: msg }]);
    try {
      let id = chatId;
      if (!id) { id = (await call<{ chatId: string }>("POST", `/api/c/${slug}/chat`, {})).chatId; setChatId(id); }
      const r = await call<Turn>("POST", `/api/c/${slug}/chat/${id}/message`, { text: msg });
      const out: Item[] = [];
      if (r.emergency && r.reply) out.push({ k: "emergency", text: r.reply });
      else if (r.reply) out.push({ k: "ai", text: r.reply });
      if (r.buttons?.length) out.push({ k: "buttons", labels: r.buttons });
      if (r.proposal) out.push(details ? { k: "confirm", p: r.proposal } : { k: "details", then: r.proposal });
      if (r.callback) out.push({ k: "callback" });
      add(...out);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function book(i: number, p: Proposal, d: Details) {
    setBusy(true);
    try {
      const s = await call<Summary & { manageToken?: string }>("POST", `/api/c/${slug}/chat/${chatId}/book`,
        { name: d.name, phone: d.phone, language: lang, agree: true, website: d.website });
      update(i, { k: "confirm", p, done: true });
      add({ k: "me", text: x.yesBook }, { k: "booked", s }, { k: "ai", text: x.anythingElse });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function callBack(i: number, d: { name: string; phone: string; website: string }) {
    setBusy(true);
    try {
      let id = chatId;
      if (!id) { id = (await call<{ chatId: string }>("POST", `/api/c/${slug}/chat`, {})).chatId; setChatId(id); }
      await call("POST", `/api/c/${slug}/chat/${id}/callback`, d);
      update(i, { k: "callback", sent: true });
      add({ k: "ai", text: x.callbackSent });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const nm = (p: Proposal) => ({ svc: lang === "ar" ? p.serviceAr : p.serviceEn, doc: lang === "ar" ? p.doctorAr : p.doctorEn });
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
        return <div key={i} className="ch-card">
          <div className="bk-sum"><span>{x.service}</span><b>{svc}</b></div>
          <div className="bk-sum"><span>{x.doctor}</span><b>{doc}</b></div>
          <div className="bk-sum"><span>{x.when}</span><b>{longDate(it.p.startsAt, c.timezone, lang)}{lang === "ar" ? "، " : ", "}<span className="mono">{hm(it.p.startsAt, c.timezone)}</span></b></div>
          {details && <div className="bk-sum"><span>{x.name}</span><b>{details.name}</b></div>}
          {!it.done && <>
            <button type="button" className="bk-btn accent" disabled={busy || !details} onClick={() => details && void book(i, it.p, details)}>{x.yesBook}</button>
            <button type="button" className="bk-btn ghost" disabled={busy} onClick={() => { update(i, { ...it, done: true }); void send(x.noChangeText); }}>{x.noChange}</button>
          </>}
        </div>;
      }
      case "booked": {
        const s = it.s, link = `${location.origin}/${slug}/manage#${s.manageToken}`;
        return <div key={i} className="ch-card">
          <div className="ch-done"><span className="bk-ok" aria-hidden="true">✓</span><b>{x.doneTitle}</b></div>
          {s.waitingForCheck && <Banner kind="warn">{x.waiting.replace("{phone}", "⁦" + masked(details?.phone ?? "", o.countryCode) + "⁩")}</Banner>}
          {s.manageToken && <ShareLink s={s} x={x} lang={lang} link={link} />}
          {s.manageToken && <a className="bk-btn outline" href={icsHref(s, lang, x, link)} download="appointment.ics">{x.addCal}</a>}
        </div>;
      }
      case "callback": return it.sent ? null : <CallbackCard key={i} x={x} cc={o.countryCode} phone={c.phone} busy={busy} onSend={(d) => void callBack(i, d)} />;
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

function CallbackCard({ x, cc, phone, busy, onSend }: { x: Tx; cc: string; phone: string | null; busy: boolean; onSend: (d: { name: string; phone: string; website: string }) => void }) {
  const [d, setD] = useState({ name: "", phone: "", website: "" });
  return <form className="ch-card" onSubmit={(e) => { e.preventDefault(); onSend(d); }}>
    <b>{x.callMeTitle}</b>
    <label className="bk-field">{x.fullName}<input autoComplete="name" required minLength={2} maxLength={120} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
    <label className="bk-field">{x.mobile}<PhoneField cc={cc} value={d.phone} onChange={(v) => setD({ ...d, phone: v })} /></label>
    <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={d.website} onChange={(e) => setD({ ...d, website: e.target.value })} /></label>
    <button className="bk-btn ink" disabled={busy}>{x.callMe}</button>
    {phone && <a className="bk-btn ghost" href={`tel:${phone.replace(/[^\d+]/g, "")}`}><span className="mono">{phone}</span></a>}
    <small className="bk-hint">🔒 {x.detailsSafe}</small>
  </form>;
}
