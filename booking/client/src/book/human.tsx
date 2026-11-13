// The human check on the booking page (design: booking/design/human-check.html): Cloudflare Turnstile on the final button of
// each form the clinic chose (Settings › Online booking). Cloudflare's script is loaded only when such a step is shown, never on
// the first page or while choosing a time. The check runs on the tap itself ("execute"), so a page left open for a long time
// never holds an expired token, and every try gets a fresh one (tokens are single-use). Most people see nothing; when Cloudflare
// is unsure, its own box appears where <HumanBox> is and the booking carries on once it is ticked.
// If the script can't load, the form is sent without a token and the server decides (a failure, or let through when Cloudflare
// itself is down, as the clinic chose).
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Lang, Tx } from "./text";

export type HumanForm = "book" | "chat_book" | "callback" | "find" | "chat_start";
export type HumanCfg = { siteKey: string; forms: HumanForm[] };

type Turnstile = {
  render(el: HTMLElement, o: Record<string, unknown>): string | null | undefined;
  execute(id: string): void; reset(id: string): void; remove(id: string): void;
};
declare global { interface Window { turnstile?: Turnstile } }

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<Turnstile> | null = null;
function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((ok, no) => {
    const s = document.createElement("script");
    s.src = SRC; s.async = true;
    s.onload = () => (window.turnstile ? ok(window.turnstile) : no(new Error("turnstile_missing")));
    s.onerror = () => { loading = null; s.remove(); no(new Error("turnstile_blocked")); };
    document.head.appendChild(s);
  });
  return loading;
}

export type Human = { on: boolean; box: RefObject<HTMLDivElement>; asking: boolean; checking: boolean; token: () => Promise<string | undefined> };

// form: which final button this is (the server checks the token was made for it). lang: the language of Cloudflare's own box.
export function useHuman(cfg: HumanCfg | null | undefined, form: HumanForm, lang: Lang): Human {
  const on = !!cfg && cfg.forms.includes(form);
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null), idLang = useRef<Lang | null>(null);
  const wait = useRef<((t: string | undefined) => void) | null>(null);
  const [asking, setAsking] = useState(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => { if (on) load().catch(() => { /* the server decides */ }); }, [on]);
  useEffect(() => () => {
    if (id.current) { try { window.turnstile?.remove(id.current); } catch { /* already gone */ } }
    id.current = null;
  }, []);
  const finish = (t?: string) => { const w = wait.current; wait.current = null; setAsking(false); w?.(t); };

  async function token(): Promise<string | undefined> {
    if (!on || !cfg) return undefined;
    setChecking(true);
    try {
      let ts: Turnstile;
      try { ts = await load(); } catch { return undefined; }
      const el = box.current;
      if (!el) return undefined;
      if (id.current && idLang.current !== lang) { try { ts.remove(id.current); } catch { /* gone */ } id.current = null; }
      return await new Promise<string | undefined>((resolve) => {
        wait.current = resolve;
        try {
          if (!id.current) {
            id.current = ts.render(el, {
              // theme "light": the page is always light, so Cloudflare's box doesn't follow the phone's dark mode.
              sitekey: cfg.siteKey, action: form, language: lang, theme: "light", appearance: "interaction-only", execution: "execute", "refresh-expired": "manual",
              callback: (t: string) => finish(t),
              "error-callback": () => { finish(undefined); return true; },
              "unsupported-callback": () => finish(undefined),
              "before-interactive-callback": () => setAsking(true),
            }) ?? null;
            idLang.current = lang;
          } else ts.reset(id.current);
          if (!id.current) return finish(undefined);
          ts.execute(id.current);
        } catch { finish(undefined); }
      });
    } finally { setChecking(false); }
  }
  return { on, box, asking, checking, token };
}

// Where Cloudflare's box appears when it asks for a tick, with our words above it.
export function HumanBox({ h, x }: { h: Human; x: Tx }) {
  if (!h.on) return null;
  return <>
    {h.asking && <div className="bk-banner info" role="status"><b>{x.humanAsk}</b><br />{x.humanAsk2}</div>}
    <div ref={h.box} className="bk-human" />
  </>;
}

// The quiet line under the final button.
export function HumanLine({ h, x, privacyUrl }: { h: Human; x: Tx; privacyUrl?: string }) {
  if (!h.on) return null;
  return <p className="bk-hc">
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span>{x.humanLine}{privacyUrl && <> <a href={privacyUrl} target="_blank" rel="noopener noreferrer">{x.privacy}</a></>}</span>
  </p>;
}

export const isHumanError = (code?: string | null) => code === "human_check_failed" || code === "human_check_unavailable";

// One message for every failure, never depending on the phone number; the clinic's number one tap away.
export function HumanError({ code, x, phone }: { code?: string | null; x: Tx; phone?: string | null }) {
  if (!isHumanError(code)) return null;
  const down = code === "human_check_unavailable";
  const second = down ? x.humanDown2 : x.humanFailed2;
  return <div className={`bk-banner ${down ? "warn" : "bad"}`} role={down ? "status" : "alert"}>
    <b>{down ? x.humanDown : x.humanFailed}</b><br />
    {phone ? <>{second} <a className="mono" dir="ltr" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></> : second.replace(/[:：]\s*$/, ".")}
  </div>;
}
