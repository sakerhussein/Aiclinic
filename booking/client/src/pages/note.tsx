// The visit note (AI Scribe, design booking/design/ai-scribe.html screens 2 to 5): consent, recording, the draft next to the
// transcript, signing, additions. Opened from the booking page at /bookings/:id/note. The server decides who may do what.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, get, goSignIn, patch, post, type Appt } from "../api";
import { fmtDateTime } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, useAction } from "../ui";
import { fill, useN } from "./notes-text";

type Section = { key: string; en: string; ar: string; hint?: string };
type Flag = { section: string; text: string; kind: "unsure" | "medicine" };
type Line = { t: number; who: string; text: string; unsure?: string[] };
type Addition = { id: string; text: string; addedAt: string; addedByName: string };
export type Note = {
  id: string; appointmentId: string; kind: "scribe" | "manual"; status: string; language: "en" | "ar"; sections: Section[]; content: Record<string, string>; flags: Flag[];
  transcript: Line[] | null; transcriptDeletedAt: string | null; aiDrafted: boolean; recordingStartedAt: string | null; recordingSeconds: number | null;
  error: string | null; signedAt: string | null; signedName: string | null; rowVersion: number; slow: boolean; additions: Addition[];
};
type Visit = {
  appointment: Appt; note: Note | null;
  settings: { enabled: boolean; recording: boolean; language: "en" | "ar"; consentEn: string; consentAr: string; maxMinutes: number; keepDays: number;
    standIn: boolean; isTheDoctor: boolean; openVisit: boolean;
    dictation: { enabled: boolean; tidy: boolean; fieldSeconds: number; noteMinutes: number } };
};

const NOT_MENTIONED = ["Not mentioned.", "لم يُذكر."];
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pill: Record<string, string> = { recording: "bad", processing: "", draft: "warn", failed: "bad", signed: "ok" };

export function VisitNote() {
  const n = useN();
  const { lang } = useI18n();
  const { look } = useApp();
  const { id } = useParams();
  const [v, setV] = useState<Visit | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => get<Visit>(`/api/appointments/${id}/note`).then(setV).catch(() => setMissing(true)), [id]);
  useEffect(() => { void load(); }, [load]);
  // While the draft is being made, look again every two seconds.
  const status = v?.note?.status;
  useEffect(() => {
    if (status !== "processing") return;
    const h = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(h);
  }, [status, load]);
  const setNote = (note: Note | null) => setV((x) => (x ? { ...x, note } : x));

  if (!v) return <main className="wrap page">{missing ? <Banner kind="warn">{n.off}</Banner> : <p>…</p>}</main>;
  const a = v.appointment, note = v.note, s = v.settings;
  const tz = look.clinic.timezone;
  return (
    <main className="wrap page">
      <div className="row between">
        <h1 className="display">{n.title} · {a.patient_name || a.patient_phone}</h1>
        {note && <span className={`pill ${pill[note.status] ?? ""}`}>{n.states[note.status] ?? note.status}</span>}
      </div>
      <p className="hint">{fmtDateTime(a.starts_at, tz, lang)} · {lang === "ar" ? a.service_name_ar : a.service_name_en} · {lang === "ar" ? a.doctor_name_ar : a.doctor_name_en}</p>
      {!note && !s.enabled && <Banner kind="warn">{n.off}</Banner>}
      {!note && s.enabled && !s.isTheDoctor && <Banner kind="warn">{n.notTheDoctor}</Banner>}
      {!note && s.enabled && s.isTheDoctor && !s.openVisit && <Banner kind="warn">{n.closedVisit}</Banner>}
      {!note && s.enabled && s.isTheDoctor && s.openVisit && <Consent v={v} onStarted={setNote} />}
      {note?.status === "recording" && (s.isTheDoctor ? <Recorder note={note} maxMinutes={s.maxMinutes} standIn={s.standIn} onStopped={setNote} onDiscarded={load} /> : <Banner kind="warn">{n.notTheDoctor}</Banner>)}
      {(note?.status === "processing" || note?.status === "failed") && <Waiting note={note} doctor={s.isTheDoctor} onChange={setNote} onDiscarded={load} />}
      {note?.status === "draft" && <Draft v={v} note={note} onChange={setNote} onDiscarded={load} />}
      {note?.status === "signed" && <Signed v={v} note={note} onChange={setNote} />}
      <Link to={`/bookings/${a.id}`} className="link">{n.back}</Link>
    </main>
  );
}

// ---------------------------------------------------------------- consent, every time (screen 2)
function Consent({ v, onStarted }: { v: Visit; onStarted: (n: Note) => void }) {
  const n = useN();
  const [agreed, setAgreed] = useState(false);
  const a = useAction();
  const start = (mode: "scribe" | "manual") => void a.run(async () =>
    onStarted(await post<Note>(`/api/appointments/${v.appointment.id}/note`, mode === "scribe" ? { mode, consent: true } : { mode })));
  return (
    <section className="panel stack note-card">
      {v.settings.recording ? (
        <>
          <div className="lbl">{n.readThis}</div>
          <div className="consent" dir="rtl" lang="ar">{v.settings.consentAr}</div>
          <p className="hint" dir="ltr" lang="en">{n.englishVersion}: “{v.settings.consentEn}”</p>
          <label className="check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> <span>{n.agreed}</span></label>
          {v.settings.standIn && <Banner kind="warn">{n.standIn}</Banner>}
          <div className="row">
            <button type="button" className="btn btn-accent btn-sm" disabled={!agreed || a.busy} onClick={() => start("scribe")}>{n.startRecording}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => start("manual")}>{n.writeByHand}</button>
          </div>
          <p className="hint">{n.unlockHint}</p>
        </>
      ) : (
        <>
          <p>{n.recordingOffForYou}</p>
          <div className="row"><button type="button" className="btn btn-accent btn-sm" disabled={a.busy} onClick={() => start("manual")}>{n.writeByHand}</button></div>
        </>
      )}
      {a.err && <Banner>{a.message}</Banner>}
    </section>
  );
}

// ---------------------------------------------------------------- recording (screen 3)
// The sound goes to the server in five-second pieces. Leaving the page stops the recording, and what was recorded still becomes
// the draft. Each start keeps its own record, so React's test double-start never stops a real recording.
type Rec = { cancelled: boolean; stopped: boolean; rec: MediaRecorder | null; stream: MediaStream | null; audio: AudioContext | null; raf: number;
  seq: number; queue: Promise<unknown>; startedAt: number; pausedMs: number; pausedAt: number; wake: { release: () => Promise<void> } | null };

function Recorder({ note, maxMinutes, standIn, onStopped, onDiscarded }: { note: Note; maxMinutes: number; standIn: boolean; onStopped: (n: Note) => void; onDiscarded: () => void }) {
  const n = useN();
  const [state, setState] = useState<"starting" | "recording" | "paused" | "stopping" | "error">("starting");
  const [secs, setSecs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(18).fill(4));
  const [trouble, setTrouble] = useState(false);
  const cur = useRef<Rec | null>(null);
  const a = useAction();

  const elapsed = (r: Rec) => (r.startedAt ? (Date.now() - r.startedAt - r.pausedMs - (r.pausedAt ? Date.now() - r.pausedAt : 0)) / 1000 : 0);
  const send = (r: Rec, blob: Blob) => {
    const seq = r.seq++;
    r.queue = r.queue.then(async () => {
      for (let i = 0; i < 4; i++) {
        try {
          const res = await fetch(`/api/notes/${note.id}/audio/${seq}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
          if (res.ok || res.status === 409) { setTrouble(false); return; }
        } catch { /* the connection dropped: try again */ }
        setTrouble(true);
        await new Promise((ok) => window.setTimeout(ok, 1500 * (i + 1)));
      }
    });
  };
  const release = (r: Rec) => {
    r.stream?.getTracks().forEach((t) => t.stop());
    cancelAnimationFrame(r.raf);
    void r.audio?.close().catch(() => {});
    void r.wake?.release().catch(() => {});
  };
  // Stop: the last piece is sent, then the server is told. Leaving the page: told with keepalive, nothing waits.
  const finish = async (r: Rec | null, leaving = false) => {
    if (!r || r.stopped) return;
    r.stopped = true;
    const seconds = Math.round(elapsed(r));
    await new Promise<void>((done) => {
      if (r.rec && r.rec.state !== "inactive") { r.rec.addEventListener("stop", () => done(), { once: true }); r.rec.stop(); } else done();
    });
    release(r);
    const tell = () => fetch(`/api/notes/${note.id}/stop`, { method: "POST", keepalive: leaving, credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ seconds }) });
    if (leaving) { void r.queue.then(tell); return; }
    setState("stopping");
    await r.queue;
    await a.run(async () => onStopped(await post<Note>(`/api/notes/${note.id}/stop`, { seconds })));
  };

  useEffect(() => {
    const r: Rec = { cancelled: false, stopped: false, rec: null, stream: null, audio: null, raf: 0, seq: 0, queue: Promise.resolve(), startedAt: 0, pausedMs: 0, pausedAt: 0, wake: null };
    cur.current = r;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (r.cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        r.stream = stream;
        const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((x) => MediaRecorder.isTypeSupported?.(x));
        const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
        r.rec = rec;
        rec.ondataavailable = (e) => { if (e.data?.size) send(r, e.data); };
        rec.start(5000);
        r.startedAt = Date.now();
        setState("recording");
        // The level bars: proof the microphone hears the room.
        try {
          const audio = new AudioContext(); r.audio = audio;
          const an = audio.createAnalyser(); an.fftSize = 64;
          audio.createMediaStreamSource(stream).connect(an);
          const buf = new Uint8Array(an.frequencyBinCount);
          const draw = () => { an.getByteFrequencyData(buf); setLevels(Array.from({ length: 18 }, (_, i) => 4 + Math.round(((buf[i + 1] ?? 0) / 255) * 40))); r.raf = requestAnimationFrame(draw); };
          draw();
        } catch { /* no level bars: the recording itself goes on */ }
        try { r.wake = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Rec["wake"]> } }).wakeLock?.request("screen") ?? null; } catch { /* the screen may dim */ }
      } catch {
        if (!r.cancelled) setState("error");
      }
    })();
    const leave = () => void finish(r, true);
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); r.cancelled = true; if (r.rec) void finish(r, true); else release(r); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // The timer, the longest recording, and a sign of life while paused.
  useEffect(() => {
    const h = window.setInterval(() => {
      const r = cur.current;
      if (!r || r.stopped || !r.startedAt) return;
      const s = elapsed(r);
      setSecs(s);
      if (s >= maxMinutes * 60) void finish(r);
      if (r.pausedAt && Math.round(s) % 30 === 0) void fetch(`/api/notes/${note.id}/alive`, { method: "POST", credentials: "same-origin" }).catch(() => {});
    }, 1000);
    return () => window.clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, maxMinutes]);

  const pause = () => {
    const r = cur.current; if (!r?.rec) return;
    if (r.rec.state === "recording") { r.rec.pause(); r.pausedAt = Date.now(); setState("paused"); }
    else if (r.rec.state === "paused") { r.rec.resume(); r.pausedMs += Date.now() - r.pausedAt; r.pausedAt = 0; setState("recording"); }
  };
  const discard = () => {
    if (!window.confirm(n.confirmDiscard)) return;
    const r = cur.current;
    if (r) { r.stopped = true; r.rec?.state !== "inactive" && r.rec?.stop(); release(r); }
    void a.run(async () => { await post(`/api/notes/${note.id}/discard`); onDiscarded(); });
  };

  return (
    <section className="panel stack note-card rec-card" aria-live="polite">
      {state === "error" ? (
        <>
          <Banner>{n.noMic}</Banner>
          <div className="row center"><button type="button" className="btn btn-accent btn-sm" disabled={a.busy} onClick={() => void a.run(async () => {
            await post(`/api/notes/${note.id}/discard`);
            onStopped(await post<Note>(`/api/appointments/${note.appointmentId}/note`, { mode: "manual" }));
          })}>{n.writeByHand}</button></div>
        </>
      ) : (
        <>
          <span className={`rec${state === "paused" ? " off" : ""}`}><i />{state === "paused" ? n.paused : state === "starting" ? n.micBusy : n.recording}</span>
          <div className="timer mono">{mmss(secs)}</div>
          <div className="level" aria-hidden="true">{levels.map((h, i) => <span key={i} style={{ height: state === "recording" ? h : 4 }} />)}</div>
          {standIn && <p className="hint">{n.standIn}</p>}
          <div className="row center">
            <button type="button" className="btn btn-ghost btn-sm" disabled={state !== "recording" && state !== "paused"} onClick={pause}>{state === "paused" ? n.resume : n.pause}</button>
            <button type="button" className="btn btn-ink btn-sm" disabled={state !== "recording" && state !== "paused"} onClick={() => void finish(cur.current)}>{n.stopAndMake}</button>
          </div>
          <p className="hint">{n.leaveHint} {fill(n.maxHint, { n: maxMinutes })}</p>
          {trouble && <Banner kind="warn">{n.uploadTrouble}</Banner>}
        </>
      )}
      <div className="row center"><button type="button" className="btn btn-outline btn-xs" disabled={a.busy} onClick={discard}>{n.discard}</button></div>
      {a.err && <Banner>{a.message}</Banner>}
    </section>
  );
}

// ---------------------------------------------------------------- the draft being made, or not
function Waiting({ note, doctor, onChange, onDiscarded }: { note: Note; doctor: boolean; onChange: (n: Note) => void; onDiscarded: () => void }) {
  const n = useN();
  const a = useAction();
  const failed = note.status === "failed";
  return (
    <section className="panel stack note-card" aria-live="polite">
      {failed ? <Banner>{n.failed} {note.error && (n.errorCodes[note.error] ?? "")}</Banner> : <p><span className="spinner" aria-hidden="true" /> {n.making}</p>}
      {!failed && note.slow && <Banner kind="warn">{n.slow}</Banner>}
      {doctor && (failed || note.slow) && (
        <div className="row">
          {failed && <button type="button" className="btn btn-accent btn-sm" disabled={a.busy} onClick={() => void a.run(async () => onChange(await post<Note>(`/api/notes/${note.id}/retry`)))}>{n.tryAgain}</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => void a.run(async () => onChange(await post<Note>(`/api/notes/${note.id}/by-hand`)))}>{n.writeByHand}</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={a.busy} onClick={() => { if (window.confirm(n.confirmDiscard)) void a.run(async () => { await post(`/api/notes/${note.id}/discard`); onDiscarded(); }); }}>{n.discard}</button>
        </div>
      )}
      {a.err && <Banner>{a.message}</Banner>}
    </section>
  );
}

// ---------------------------------------------------------------- marked words: amber unsure, blue medicines and doses
function Marked({ text, flags }: { text: string; flags: { text: string; kind: string }[] }) {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let best: { j: number; f: { text: string; kind: string } } | null = null;
    for (const f of flags) {
      if (!f.text) continue;
      const j = text.indexOf(f.text, i);
      if (j >= 0 && (!best || j < best.j || (j === best.j && f.text.length > best.f.text.length))) best = { j, f };
    }
    if (!best) { out.push(text.slice(i)); break; }
    if (best.j > i) out.push(text.slice(i, best.j));
    out.push(<mark key={out.length} className={best.f.kind === "medicine" ? "d" : "u"}>{best.f.text}</mark>);
    i = best.j + best.f.text.length;
  }
  return <>{out}</>;
}

function Transcript({ note, keepDays }: { note: Note; keepDays: number }) {
  const n = useN();
  return (
    <aside className="tx" aria-label={n.transcript}>
      <div className="row between"><div className="sec-h">{n.transcript}</div>{note.recordingSeconds != null && <span className="hint mono">{mmss(note.recordingSeconds)}</span>}</div>
      {note.transcript ? note.transcript.map((l, i) => (
        <div key={i} className={`tl${l.who === "doctor" ? " dr" : ""}`}>
          <span className="t mono">{mmss(l.t)}</span>
          <div><b>{n.who[l.who] ?? l.who}</b><span dir="auto"><Marked text={l.text} flags={(l.unsure ?? []).map((u) => ({ text: u, kind: "unsure" }))} /></span></div>
        </div>
      )) : <p className="hint">{note.transcriptDeletedAt ? n.transcriptGone : n.noTranscript}</p>}
      {note.transcript && <p className="hint">{fill(n.keptDays, { n: keepDays })}</p>}
    </aside>
  );
}

const SectionText = ({ text, flags }: { text: string; flags: Flag[] }) => {
  const n = useN();
  if (!text.trim()) return <span className="hint">{n.empty}</span>;
  return <Marked text={text} flags={flags} />;
};

// ---------------------------------------------------------------- the draft, next to the transcript (screens 4 and 5)
function Draft({ v, note, onChange, onDiscarded }: { v: Visit; note: Note; onChange: (n: Note) => void; onDiscarded: () => void }) {
  const n = useN();
  const { lang } = useI18n();
  const [content, setContent] = useState<Record<string, string>>(note.content);
  const [editing, setEditing] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [read, setRead] = useState(false);
  const [saved, setSaved] = useState(false);
  const a = useAction();
  useEffect(() => { setContent(note.content); }, [note.id, note.rowVersion]);   // eslint-disable-line react-hooks/exhaustive-deps
  const mine = v.settings.isTheDoctor;

  // Dictation (design: booking/design/dictation.html): one field or the whole note at a time. Unsaved typing is saved first, then
  // the words are added after what each field holds. "Heard" and Undo stay until the next edit.
  const d = v.settings.dictation;
  const canDictate = mine && !signing && d.enabled;
  const mic = useMic();
  const [active, setActive] = useState<Target | null>(null);
  const [busy, setBusy] = useState<Target | null>(null);
  const [last, setLast] = useState<{ scope: Target["scope"]; sections: string[]; heard: string; before: Record<string, string>; tidyFailed: boolean } | null>(null);
  const [lost, setLost] = useState("");
  const dz = useAction();
  const free = !active && !busy && mic.state !== "starting" && mic.state !== "recording";
  const limit = active?.scope === "note" ? d.noteMinutes * 60 : d.fieldSeconds;
  const begin = (t: Target) => { if (!free) return; setLast(null); setLost(""); dz.clear(); setEditing(null); setActive(t); void mic.start(); };
  const cancelMic = () => { mic.cancel(); setActive(null); };
  const finish = async () => {
    const which = active;
    const clip = await mic.stop();
    setActive(null);
    if (!which || !clip) return;
    setBusy(which);
    await dz.run(async () => {
      try {
        const cur = await saveNow();
        const q = new URLSearchParams({ scope: which.scope, ...(which.section ? { section: which.section } : {}), seconds: String(Math.round(clip.seconds)), expectedVersion: String(cur.rowVersion) });
        const res = await fetch(`/api/notes/${note.id}/dictate?${q}`, { method: "POST", credentials: "same-origin", headers: { "content-type": clip.blob.type || "audio/webm" }, body: clip.blob });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 423) { goSignIn(); return; }
        if (!res.ok) { if (data?.heard) setLost(data.heard); throw new ApiError(res.status, data?.error || "server_error", data || {}); }
        const r = data as { note: Note; heard: string; sections: string[]; tidyFailed: boolean };
        onChange(r.note);
        setLast({ scope: which.scope, sections: r.sections, heard: r.heard, tidyFailed: r.tidyFailed,
          before: Object.fromEntries(r.sections.map((k) => [k, cur.content[k] ?? ""])) });
      } finally { setBusy(null); }
    });
  };
  const undo = () => { if (last) void dz.run(async () => {
    onChange(await patch<Note>(`/api/notes/${note.id}`, { content: { ...content, ...last.before }, expectedVersion: note.rowVersion }));
    setLast(null);
  }); };
  // The longest recording is a clinic setting: it stops by itself there.
  useEffect(() => { if (active && mic.state === "recording" && mic.secs >= limit) void finish(); });   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mic.state === "error") setActive(null); }, [mic.state]);
  const recBar = (stop: string) => (
    <div className="dict">
      <span className="rec"><i />{mic.state === "starting" ? n.micBusy : active?.scope === "note" ? n.wholeRec : n.recording}</span>
      <span className="mono">{mmss(mic.secs)} / {mmss(limit)}</span>
      <div className="level small" aria-hidden="true">{mic.levels.map((h, i) => <span key={i} style={{ height: mic.state === "recording" ? h : 4 }} />)}</div>
      <span className="grow" />
      <button type="button" className="btn btn-ink btn-sm" disabled={mic.state !== "recording"} onClick={() => void finish()}>{stop}</button>
      <button type="button" className="btn btn-outline btn-xs" onClick={cancelMic}>{n.cancel}</button>
    </div>
  );
  const heardLine = (label: string) => last && (
    <div className="heard">
      <span>{label}</span><q dir="auto">{last.heard}</q>
      <button type="button" className="link" disabled={dz.busy} onClick={undo}>{n.undo}</button>
      {last.tidyFailed && <span>{n.tidyFailed}</span>}
    </div>
  );
  const dirty = note.sections.some((s) => (content[s.key] ?? "") !== (note.content[s.key] ?? ""));
  const saveNow = async () => (dirty ? patch<Note>(`/api/notes/${note.id}`, { content, expectedVersion: note.rowVersion }) : note);
  const dir = note.language === "ar" ? "rtl" : "ltr";
  return (
    <div className="note">
      <div className="stack">
        {v.settings.standIn && note.aiDrafted && <Banner kind="warn">{n.standIn}</Banner>}
        {canDictate && v.settings.standIn && <p className="hint">{n.standInDictate}</p>}
        {canDictate && d.tidy && (active?.scope === "note" ? recBar(n.wholeStop) : busy?.scope === "note" ? (
          <div className="whole"><span className="spinner" aria-hidden="true" /> <span>{n.wholeBusy}</span></div>
        ) : (
          <div className="whole">
            <span className="ic"><MicIcon /></span>
            <div className="grow"><b>{n.wholeTitle}</b><span className="hint">{n.wholeHint}</span></div>
            <button type="button" className="btn btn-accent btn-sm" disabled={!free} onClick={() => begin({ scope: "note" })}><MicIcon />{n.wholeStart}</button>
          </div>
        ))}
        {last?.scope === "note" && heardLine(n.heardWhole)}
        {mic.state === "error" && <Banner kind="warn">{n.noMicDictate}</Banner>}
        {dz.err && <Banner>{dz.message}</Banner>}
        {lost && <Banner kind="warn"><span dir="auto">{lost}</span></Banner>}
        {note.aiDrafted && <div className="legend2"><span><mark className="u">{n.unsure}</mark></span><span><mark className="d">{n.medicine}</mark></span>{mine && <span>{n.clickToEdit}</span>}</div>}
        {note.sections.map((s) => {
          const text = content[s.key] ?? "";
          const label = lang === "ar" ? s.ar : s.en;
          return (
            <div key={s.key}>
              <div className="sec-row">
                <div className="sec-h" id={`sec-${s.key}`}>{label}</div>
                {canDictate && active?.section !== s.key && busy?.section !== s.key && (
                  <button type="button" className="mic" disabled={!free} onClick={() => begin({ scope: "field", section: s.key })} aria-label={`${n.dictate}: ${label}`}><MicIcon />{n.dictate}</button>
                )}
              </div>
              {active?.section === s.key ? recBar(n.fieldStop) : busy?.section === s.key ? (
                <div className="dict busy"><span className="spinner" aria-hidden="true" /> <span>{n.fieldBusy}</span></div>
              ) : editing === s.key && mine && !signing ? (
                <textarea className="nbox" dir={dir} lang={note.language} autoFocus aria-labelledby={`sec-${s.key}`} rows={Math.max(2, Math.ceil(text.length / 70))} maxLength={4000}
                  value={text} onChange={(e) => { setSaved(false); setLast(null); setContent({ ...content, [s.key]: e.target.value }); }} onBlur={() => setEditing(null)} />
              ) : (
                <div className={`nbox${NOT_MENTIONED.includes(text.trim()) ? " nm" : ""}${mine && !signing ? " editable" : ""}${last?.sections.includes(s.key) ? " new" : ""}`} dir={dir} lang={note.language}
                  role={mine && !signing ? "button" : undefined} tabIndex={mine && !signing ? 0 : undefined} aria-labelledby={`sec-${s.key}`}
                  onClick={() => mine && !signing && setEditing(s.key)} onKeyDown={(e) => { if (mine && !signing && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setEditing(s.key); } }}>
                  <SectionText text={text} flags={note.flags.filter((f) => f.section === s.key)} />
                </div>
              )}
              {last?.scope === "field" && last.sections[0] === s.key && heardLine(n.heard)}
            </div>
          );
        })}
        {mine && !signing && (
          <div className="signbar">
            <button type="button" className="btn btn-ghost btn-sm" disabled={a.busy || !dirty} onClick={() => void a.run(async () => { onChange(await saveNow()); setSaved(true); })}>{n.saveDraft}</button>
            <button type="button" className="btn btn-accent btn-sm" disabled={a.busy || !free} onClick={() => { setEditing(null); setLast(null); setSigning(true); setRead(false); }}>{n.reviewSign}</button>
            <span className="hint">{saved && !dirty ? n.saved : n.usedAfterSign}</span>
            <span className="grow" />
            <button type="button" className="btn btn-outline btn-xs" disabled={a.busy} onClick={() => { if (window.confirm(n.confirmDiscard)) void a.run(async () => { await post(`/api/notes/${note.id}/discard`); onDiscarded(); }); }}>{n.discard}</button>
          </div>
        )}
        {mine && signing && (
          <section className="panel stack sign-card">
            <h2>{n.signTitle}</h2>
            <label className="check"><input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} /> <span>{n.readAll}</span></label>
            <div className="row">
              <button type="button" className="btn btn-accent btn-sm" disabled={!read || a.busy} onClick={() => void a.run(async () => {
                const cur = await saveNow();
                onChange(await post<Note>(`/api/notes/${note.id}/sign`, { expectedVersion: cur.rowVersion, confirmRead: true }));
              })}>{n.signNote}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => setSigning(false)}>{n.backToDraft}</button>
            </div>
          </section>
        )}
        {a.err && <Banner>{a.message}</Banner>}
      </div>
      <Transcript note={note} keepDays={v.settings.keepDays} />
    </div>
  );
}

// ---------------------------------------------------------------- the microphone for dictation
// A short recording kept in the browser until Stop, then sent once. Nothing is sent while recording.
type Target = { scope: "field" | "note"; section?: string };
type Clip = { stream: MediaStream; rec: MediaRecorder; parts: Blob[]; startedAt: number; audio: AudioContext | null; raf: number; cancelled: boolean };
const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
function useMic() {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "error">("idle");
  const [secs, setSecs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(10).fill(4));
  const cur = useRef<Clip | null>(null);
  const release = (c: Clip) => { c.stream.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(c.raf); void c.audio?.close().catch(() => {}); };
  const start = async () => {
    setState("starting"); setSecs(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((x) => MediaRecorder.isTypeSupported?.(x));
      const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      const c: Clip = { stream, rec, parts: [], startedAt: Date.now(), audio: null, raf: 0, cancelled: false };
      cur.current = c;
      rec.ondataavailable = (e) => { if (e.data?.size) c.parts.push(e.data); };
      rec.start(1000);
      setState("recording");
      try {
        const audio = new AudioContext(); c.audio = audio;
        const an = audio.createAnalyser(); an.fftSize = 32;
        audio.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const draw = () => { an.getByteFrequencyData(buf); setLevels(Array.from({ length: 10 }, (_, i) => 4 + Math.round(((buf[i + 1] ?? 0) / 255) * 26))); c.raf = requestAnimationFrame(draw); };
        draw();
      } catch { /* no level bars: the recording goes on */ }
    } catch { setState("error"); }
  };
  const stop = () => new Promise<{ blob: Blob; seconds: number } | null>((done) => {
    const c = cur.current;
    if (!c) { done(null); return; }
    c.rec.addEventListener("stop", () => {
      release(c); cur.current = null; setState("idle");
      done(c.cancelled ? null : { blob: new Blob(c.parts, { type: c.rec.mimeType || "audio/webm" }), seconds: (Date.now() - c.startedAt) / 1000 });
    }, { once: true });
    c.rec.stop();
  });
  const cancel = () => {
    const c = cur.current;
    if (c) { c.cancelled = true; if (c.rec.state !== "inactive") c.rec.stop(); release(c); cur.current = null; }
    setState("idle");
  };
  useEffect(() => {
    if (state !== "recording") return;
    const h = window.setInterval(() => { const c = cur.current; if (c) setSecs((Date.now() - c.startedAt) / 1000); }, 250);
    return () => window.clearInterval(h);
  }, [state]);
  useEffect(() => () => { const c = cur.current; if (c) { c.cancelled = true; if (c.rec.state !== "inactive") c.rec.stop(); release(c); } }, []);
  return { state, secs, levels, start, stop, cancel };
}

// ---------------------------------------------------------------- signed: locked, with dated additions (screen 5)
function Signed({ v, note, onChange }: { v: Visit; note: Note; onChange: (n: Note) => void }) {
  const n = useN();
  const { lang } = useI18n();
  const { look } = useApp();
  const tz = look.clinic.timezone;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const a = useAction();
  const dir = note.language === "ar" ? "rtl" : "ltr";
  return (
    <div className="note">
      <div className="stack">
        {note.sections.map((s) => (
          <div key={s.key}>
            <div className="sec-h">{lang === "ar" ? s.ar : s.en}</div>
            <div className={`nbox${NOT_MENTIONED.includes((note.content[s.key] ?? "").trim()) ? " nm" : ""}`} dir={dir} lang={note.language}>{note.content[s.key] || "—"}</div>
          </div>
        ))}
        <div className="locked">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          <div><b>{fill(n.signedBy, { name: note.signedName ?? "", when: note.signedAt ? fmtDateTime(note.signedAt, tz, lang) : "" })}</b> {note.aiDrafted ? n.aiLine : n.handLine}</div>
        </div>
        {(note.additions.length > 0 || v.settings.isTheDoctor) && <h2>{n.additions}</h2>}
        {note.additions.map((x) => (
          <div key={x.id} className="addition">
            <div className="hint">{fill(n.addedBy, { name: x.addedByName, when: fmtDateTime(x.addedAt, tz, lang) })}</div>
            <div dir="auto">{x.text}</div>
          </div>
        ))}
        {v.settings.isTheDoctor && (adding ? (
          <form className="stack" onSubmit={a.submit(async () => { onChange(await post<Note>(`/api/notes/${note.id}/additions`, { text })); setText(""); setAdding(false); })}>
            <textarea dir="auto" rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} required autoFocus aria-label={n.addAddition} />
            <p className="hint">{n.additionHint}</p>
            <div className="row"><button className="btn btn-accent btn-sm" disabled={a.busy || !text.trim()}>{n.add}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>{n.cancel}</button></div>
          </form>
        ) : <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>{n.addAddition}</button></div>)}
        {a.err && <Banner>{a.message}</Banner>}
      </div>
      <Transcript note={note} keepDays={v.settings.keepDays} />
    </div>
  );
}
