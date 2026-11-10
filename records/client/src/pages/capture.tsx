// The clinic phone's camera page (design: booking/design/records-phase-b.html, screen 2). Opened from the code on the computer:
// no sign-in, the one-time code is the key, and it ends after a few minutes or on "Done". Photos go straight into the patient's
// record, never into the phone's gallery. The last photo of the same area shows faintly over the camera so the new one lines up.
import { useEffect, useRef, useState } from "react";
import type { Named } from "../api";
import { useI18n } from "../i18n";
import { toJpeg } from "./files";

type Info = { patient: string; fileNo: string | null; area: string; areas: Named[]; photos: number; expiresAt: string; maxFileMb: number };

export function CapturePage() {
  const { t, lang, setLang } = useI18n();
  const token = window.location.pathname.split("/c/")[1]?.split(/[/?#]/)[0] ?? "";
  const [info, setInfo] = useState<Info | null>(null);
  const [ended, setEnded] = useState(false);
  const [finished, setFinished] = useState(false);
  const [area, setArea] = useState("");
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [camOk, setCamOk] = useState<boolean | null>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/capture/${token}`).then(async (r) => {
      if (!r.ok) { setEnded(true); return; }
      const i = (await r.json()) as Info;
      setInfo(i); setArea(i.area); setSent(i.photos);
    }).catch(() => setEnded(true));
  }, [token]);

  // The camera on the back of the phone; if it can't be opened, the phone's own camera through the button.
  useEffect(() => {
    if (!info || finished) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; void video.current.play(); } setCamOk(true); })
      .catch(() => setCamOk(false));
    return () => stream?.getTracks().forEach((tr) => tr.stop());
  }, [info, finished]);

  // The faint guide: the last photo of this area.
  useEffect(() => {
    if (!area || !info) return;
    let url: string | null = null;
    fetch(`/api/capture/${token}/ghost?area=${encodeURIComponent(area)}`).then(async (r) => {
      if (r.status !== 200) { setGhost(null); return; }
      url = URL.createObjectURL(await r.blob()); setGhost(url);
    }).catch(() => setGhost(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [area, info, token, sent]);

  async function send(blob: Blob) {
    setBusy(true); setFailed(false);
    try {
      const r = await fetch(`/api/capture/${token}/photos?area=${encodeURIComponent(area)}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
      if (r.status === 410) { setEnded(true); return; }
      if (!r.ok) { setFailed(true); return; }
      setSent((await r.json()).photos);
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  async function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
    if (blob) await send(blob);
  }
  async function done() {
    await fetch(`/api/capture/${token}/done`, { method: "POST" }).catch(() => {});
    setFinished(true);
  }

  const langBtn = <button type="button" className="camlang" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{t("langSwitch")}</button>;
  if (ended || finished) return <main className="cam-page"><div className="cam-msg">{langBtn}<p>{finished ? t("capFinished") : t("capEnded")}</p></div></main>;
  if (!info) return <main className="cam-page" />;
  return (
    <main className="cam-page">
      <div className="camtop"><span>{t("capTitle", { name: info.patient })}{info.fileNo ? ` · ${info.fileNo}` : ""}</span>{langBtn}</div>
      <div className="camchips">{info.areas.map((x) => (
        <button key={x.key} type="button" className={x.key === area ? "on" : ""} onClick={() => setArea(x.key)}>{lang === "ar" ? x.ar : x.en}</button>
      ))}</div>
      <div className="cam">
        {camOk !== false && <video ref={video} playsInline muted autoPlay />}
        {ghost && <img className="ghost" src={ghost} alt="" />}
        {camOk === false && <p className="cam-note">{t("capNoCamera")}</p>}
        {camOk === null && <p className="cam-note">{t("capAllow")}</p>}
      </div>
      {failed && <p className="cam-note bad">{t("capFailed")}</p>}
      <div className="cambar">
        <span className="camcount">{busy ? t("capSending") : sent ? `✓ ${sent}` : ""}</span>
        {camOk ? <button type="button" className="shutter" aria-label={t("capShoot")} disabled={busy} onClick={() => void shoot()} />
          : <button type="button" className="btn btn-accent" disabled={busy} onClick={() => fileIn.current?.click()}>{t("capPick")}</button>}
        <button type="button" className="btn btn-accent btn-sm" onClick={() => void done()}>{t("capDoneN", { n: sent })}</button>
      </div>
      <input ref={fileIn} type="file" accept="image/*" capture="environment" hidden
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) await send(await toJpeg(f)); e.target.value = ""; }} />
    </main>
  );
}
