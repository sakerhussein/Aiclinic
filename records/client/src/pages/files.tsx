// Photos and documents in the chart (Records, phase B; design: booking/design/records-phase-b.html, screens 1–4).
// Files are never shown from the bucket directly: each comes through a link that works for a few minutes (Settings), and opening
// is recorded on the server. Nothing is deleted: a wrong file is marked "entered in error".
import { useCallback, useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { ApiError, get, goSignIn, post, put, type DocKind, type FileRow, type FilesList, type Named } from "../api";
import { fmtDateTime } from "../lib";
import { useI18n } from "../i18n";
import { useApp } from "../session";
import { Banner, Field, useAction } from "../ui";

/** Sends a file as it is (the server checks what it really is). */
export async function sendFile<T = any>(url: string, body: Blob): Promise<T> {
  const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": body.type || "application/octet-stream" }, body });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 || res.status === 423) { goSignIn(); await new Promise(() => {}); }
  if (!res.ok) throw new ApiError(res.status, data?.error || "server_error", data || {});
  return data as T;
}
/** A photo redrawn upright as JPEG, at most `max` pixels: what the camera wrote about it (place, phone) is left behind. */
export async function toJpeg(file: Blob, max = 2400): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/jpeg", 0.9));
}
const nameOf = (x: Named | undefined, key: string | null, lang: string) => (x ? (lang === "ar" ? x.ar : x.en) : key ?? "—");
const dateOnly = (iso: string, tz: string, lang: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

// ---------------------------------------------------------------- "entered in error", for a photo or a document
function ErrorForm({ f, onDone, onCancel }: { f: FileRow; onDone: (f: FileRow) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const a = useAction();
  return (
    <div className="efrm">
      <Field label={t("errorReason")} hint={t("errorHint")}><input dir="auto" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
      {a.err && <Banner>{a.message}</Banner>}
      <div className="row">
        <button type="button" className="btn btn-danger btn-sm" disabled={a.busy || !reason.trim()}
          onClick={() => void a.run(async () => onDone(await post<FileRow>(`/api/files/${f.id}/error`, { reason, expectedVersion: f.row_version })))}>{t("confirmError")}</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>{t("cancel")}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- photos
export function PhotosTab({ patientId, list, reload }: { patientId: string; list: FilesList; reload: () => void }) {
  const { t, lang } = useI18n();
  const { look, can } = useApp();
  const tz = look.clinic.timezone;
  const write = can("records.chart.write");
  const photos = (list.photos ?? []).filter((p) => !p.error_at);
  const areas = list.rules.areas;
  const [area, setArea] = useState<string>("");                  // "" = all
  const [upArea, setUpArea] = useState<string>(areas[0]?.key ?? "");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<string[]>([]);
  const [big, setBig] = useState<FileRow | null>(null);
  const [erring, setErring] = useState(false);
  const [phone, setPhone] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const a = useAction();
  const fileIn = useRef<HTMLInputElement>(null);
  const loadLinks = useCallback(() => { get<Record<string, string>>(`/api/patients/${patientId}/photo-links`).then(setUrls).catch(() => setUrls({})); }, [patientId]);
  const count = photos.length;
  useEffect(() => { if (count) loadLinks(); }, [count, loadLinks]);

  const consentOk = !list.rules.consentRequired || (list.consent && list.consent.photo_consent !== "refused");
  const consentLabel = (v: string) => ({ record: t("consentRecord"), teaching: t("consentTeaching"), refused: t("consentRefused") } as Record<string, string>)[v];
  const shown = photos.filter((p) => !area || p.area_key === area);
  const byArea = areas.filter((x) => photos.some((p) => p.area_key === x.key));
  const pair = pick.map((id) => photos.find((p) => p.id === id)).filter(Boolean).sort((x, y) => x!.created_at.localeCompare(y!.created_at)) as FileRow[];
  const togglePick = (id: string) => setPick((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    await a.run(async () => {
      for (const f of Array.from(files)) await sendFile(`/api/patients/${patientId}/files?kind=photo&area=${encodeURIComponent(upArea)}`, await toJpeg(f));
      reload();
    });
    if (fileIn.current) fileIn.current.value = "";
  }

  const img = (p: FileRow) => urls[p.id] ? <img src={urls[p.id]} alt="" loading="lazy" onError={() => loadLinks()} /> : <span className="phold" />;
  return (
    <div className="stack">
      {(!consentOk || askConsent) ? (
        <section className="panel">
          <h2>{t("consentTitle")}</h2>
          <p className="hint">{t("consentAsk")}</p>
          <div className="chips">{(["record", "teaching", "refused"] as const).map((v) => (
            <button key={v} type="button" className={`chip${list.consent?.photo_consent === v ? " on" : ""}`} disabled={a.busy}
              onClick={() => void a.run(async () => { await put(`/api/patients/${patientId}/photo-consent`, { value: v }); setAskConsent(false); reload(); })}>{consentLabel(v)}</button>
          ))}</div>
          {a.err && <Banner>{a.message}</Banner>}
        </section>
      ) : (
        <div className="row between">
          <div className="chips" style={{ margin: 0 }}>
            <button type="button" className={`chip${!area ? " on" : ""}`} onClick={() => setArea("")}>{t("allAreas")} · {photos.length}</button>
            {byArea.map((x) => <button key={x.key} type="button" className={`chip${area === x.key ? " on" : ""}`} onClick={() => setArea(x.key)}>{nameOf(x, x.key, lang)} · {photos.filter((p) => p.area_key === x.key).length}</button>)}
          </div>
          <div className="row">
            {list.consent && <span className={`pill ${list.consent.photo_consent === "refused" ? "bad" : "ok"}`} title={`${list.consent.photo_consent_by_name} · ${fmtDateTime(list.consent.photo_consent_at, tz, lang)}`}>
              {t("consentPill", { v: consentLabel(list.consent.photo_consent) })}</span>}
            <button type="button" className="link" onClick={() => setAskConsent(true)}>{t("consentChange")}</button>
          </div>
        </div>
      )}
      {consentOk && (
        <section className="panel">
          <div className="row between">
            <label className="field" style={{ minWidth: 180 }}>{t("area")}
              <select value={upArea} onChange={(e) => setUpArea(e.target.value)}>{areas.map((x) => <option key={x.key} value={x.key}>{nameOf(x, x.key, lang)}</option>)}</select>
            </label>
            <div className="row">
              <input ref={fileIn} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => void upload(e.target.files)} />
              <button type="button" className="btn btn-outline btn-sm" disabled={a.busy || !upArea} onClick={() => fileIn.current?.click()}>{a.busy ? t("uploading") : t("uploadHere")}</button>
              <button type="button" className="btn btn-accent btn-sm" disabled={!upArea} onClick={() => setPhone(!phone)}>{t("takePhone")}</button>
            </div>
          </div>
          {a.err && !askConsent && <Banner>{a.message}</Banner>}
          {phone && <PhoneCode key={upArea} patientId={patientId} area={upArea} areaName={nameOf(areas.find((x) => x.key === upArea), upArea, lang)} onPhoto={reload} onClose={() => setPhone(false)} />}
        </section>
      )}
      {pair.length === 2 && (
        <section className="ccard">
          <h3><span>{t("compare")}: {nameOf(areas.find((x) => x.key === pair[0].area_key), pair[0].area_key, lang)}</span><button type="button" className="link" onClick={() => setPick([])}>{t("close")}</button></h3>
          <div className="cmp2">{pair.map((p, i) => (
            <figure key={p.id} className="pht big">{img(p)}<figcaption><span>{i === 0 ? t("before") : t("now")}</span><span className="mono">{dateOnly(p.created_at, tz, lang)}</span></figcaption></figure>
          ))}</div>
        </section>
      )}
      <section className="ccard">
        <h3><span>{area ? nameOf(areas.find((x) => x.key === area), area, lang) : t("tabPhotos")}</span><span className="hint">{t("compareHint")}</span></h3>
        {shown.length === 0 ? <p className="hint">{t("noPhotos")}</p> : (
          <div className="pgrid">{shown.map((p) => (
            <figure key={p.id} className={`pht${pick.includes(p.id) ? " sel" : ""}`}>
              <button type="button" className="phbtn" onClick={() => { setBig(p); setErring(false); }} aria-label={t("open")}>{img(p)}</button>
              <button type="button" className="phpick" aria-pressed={pick.includes(p.id)} onClick={() => togglePick(p.id)} title={t("compare")}>{pick.includes(p.id) ? "✓" : "+"}</button>
              <figcaption><span>{nameOf(areas.find((x) => x.key === p.area_key), p.area_key, lang)}</span><span className="mono">{dateOnly(p.created_at, tz, lang)}</span></figcaption>
            </figure>
          ))}</div>
        )}
      </section>
      {big && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setBig(null); }}>
          <div className="lbbox">
            <div className="row between"><b>{nameOf(areas.find((x) => x.key === big.area_key), big.area_key, lang)}</b><button type="button" className="link" onClick={() => setBig(null)}>{t("close")}</button></div>
            <div className="lbimg">{img(big)}</div>
            <p className="hint">{t("byOn", { name: big.created_by_name, date: fmtDateTime(big.created_at, tz, lang) })}{big.source === "phone" ? " · 📱" : ""}</p>
            {write && (erring ? <ErrorForm f={big} onCancel={() => setErring(false)} onDone={() => { setBig(null); reload(); }} />
              : <div><button type="button" className="link" onClick={() => setErring(true)}>{t("markError")}</button></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

// The code the clinic phone scans: one patient, one area, a few minutes. The computer shows the photos as they arrive.
function PhoneCode({ patientId, area, areaName, onPhoto, onClose }: { patientId: string; area: string; areaName: string; onPhoto: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const { look } = useApp();
  const [code, setCode] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [state, setState] = useState<{ photos: number; done: boolean; expired: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { error } = useI18n();
  const seen = useRef(0);
  useEffect(() => { post<typeof code>(`/api/patients/${patientId}/phone-code`, { area }).then(setCode).catch((e) => setErr(e instanceof ApiError ? e.code : "server_error")); }, [patientId, area]);
  useEffect(() => {
    if (!code) return;
    const i = window.setInterval(() => {
      get<{ photos: number; done: boolean; expired: boolean }>(`/api/phone-codes/${code.id}`).then((s) => {
        setState(s);
        if (s.photos !== seen.current) { seen.current = s.photos; onPhoto(); }
        if (s.done || s.expired) window.clearInterval(i);
      }).catch(() => {});
    }, 3000);
    return () => window.clearInterval(i);
  }, [code, onPhoto]);
  if (err) return <Banner>{error(err)}</Banner>;
  if (!code) return null;
  const qr = qrcode(0, "M"); qr.addData(code.url); qr.make();
  return (
    <div className="qrbox">
      <div className="qr" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) }} />
      <div className="stack" style={{ flex: 1, minWidth: 200 }}>
        <b>{t("phoneTitle")}</b>
        <p>{t("area")}: <b>{areaName}</b></p>
        <p className="hint">{t("phoneHint", { n: look.settings.phoneMinutes })}</p>
        <span className={`pill ${state?.done ? "ok" : state?.expired ? "bad" : "warn"}`}>
          {state?.done ? t("phoneDone") : state?.expired ? t("phoneExpired") : state?.photos ? t("phoneGot", { n: state.photos }) : t("phoneWaiting")}</span>
        <span className="hint">{t("phoneLink")}</span><span className="linkbox">{code.url}</span>
        <div><button type="button" className="btn btn-outline btn-sm" onClick={onClose}>{t("close")}</button></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- documents
export function DocumentsTab({ patientId, list, reload }: { patientId: string; list: FilesList; reload: () => void }) {
  const { t, lang, error } = useI18n();
  const { look, can } = useApp();
  const tz = look.clinic.timezone;
  const kinds = list.rules.docKinds;
  const canAdd = can("records.files.add");
  const write = can("records.chart.write");
  const [kind, setKind] = useState("");
  const [erring, setErring] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const a = useAction();
  const kindOf = (k: string | null) => kinds.find((x) => x.key === k) as DocKind | undefined;
  const docs = list.documents.filter((d) => !kind || d.doc_kind === kind);
  const present = kinds.filter((k) => list.documents.some((d) => d.doc_kind === k.key));

  async function open(f: FileRow) {
    setOpenErr(null);
    const w = window.open("", "_blank");
    try {
      const l = await get<{ url: string }>(`/api/files/${f.id}/link`);
      if (w) w.location.href = l.url; else window.location.assign(l.url);
    } catch (e) { w?.close(); setOpenErr(e instanceof ApiError ? e.code : "server_error"); }
  }
  return (
    <div className="note">
      <section className="ccard">
        <h3><span>{t("tabDocs")}</span><span className="hint">{t("newestFirst")}</span></h3>
        {present.length > 1 && <div className="chips" style={{ margin: 0 }}>
          <button type="button" className={`chip${!kind ? " on" : ""}`} onClick={() => setKind("")}>{t("allAreas")}</button>
          {present.map((k) => <button key={k.key} type="button" className={`chip${kind === k.key ? " on" : ""}`} onClick={() => setKind(k.key)}>{nameOf(k, k.key, lang)}</button>)}
        </div>}
        {openErr && <Banner>{error(openErr)}</Banner>}
        {docs.length === 0 && !list.othersCount && <p className="hint">{t("noDocs")}</p>}
        {docs.map((d) => {
          const k = kindOf(d.doc_kind);
          return (
            <div key={d.id} className={`li dl${d.error_at ? " err" : ""}`} style={{ display: "block" }}>
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "nowrap", minWidth: 0 }}>
                  <span className="fileic">{d.mime === "application/pdf" ? "PDF" : "IMG"}</span>
                  <div style={{ minWidth: 0 }}>
                    <b dir="auto">{d.error_at ? <s>{d.title}</s> : d.title}</b>
                    <div className="s">{nameOf(k, d.doc_kind, lang)}{d.doc_date ? ` · ${t("docDated", { date: dateOnly(d.doc_date + "T12:00:00Z", "UTC", lang) })}` : ""} · {t("byOn", { name: d.created_by_name, date: dateOnly(d.created_at, tz, lang) })}</div>
                    {d.error_at && <div className="s">{t("inError", { name: d.error_by_name ?? "" })} · {d.error_reason}</div>}
                  </div>
                </div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  {!d.error_at && k?.review && (d.reviewed_at ? <span className="pill ok">{t("reviewedBy", { name: d.reviewed_by_name ?? "" })}</span>
                    : <>{write && <button type="button" className="btn btn-accent btn-sm" disabled={a.busy}
                        onClick={() => void a.run(async () => { await post(`/api/files/${d.id}/review`, { expectedVersion: d.row_version }); reload(); })}>{t("markReviewed")}</button>}
                        <span className="pill warn">{t("notReviewed")}</span></>)}
                  {!d.error_at && <button type="button" className="link" onClick={() => void open(d)}>{t("open")}</button>}
                  {!d.error_at && (write || canAdd) && erring !== d.id && <button type="button" className="link" onClick={() => setErring(d.id)}>{t("markError")}</button>}
                </div>
              </div>
              {erring === d.id && <ErrorForm f={d} onCancel={() => setErring(null)} onDone={() => { setErring(null); reload(); }} />}
            </div>
          );
        })}
        {list.othersCount > 0 && <div className="li"><div className="lockrow"><span aria-hidden="true">🔒</span><span>{t("othersLocked", { n: list.othersCount })}</span></div></div>}
        {a.err && <Banner>{a.message}</Banner>}
      </section>
      {canAdd && <AddDocument patientId={patientId} kinds={kinds} maxMb={list.rules.maxFileMb} onAdded={reload} />}
    </div>
  );
}

function AddDocument({ patientId, kinds, maxMb, onAdded }: { patientId: string; kinds: DocKind[]; maxMb: number; onAdded: () => void }) {
  const { t, lang } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState(kinds[0]?.key ?? "");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [drag, setDrag] = useState(false);
  const a = useAction();
  const input = useRef<HTMLInputElement>(null);
  const pickFile = (f: File | undefined | null) => { if (f) { setFile(f); if (!title) setTitle(f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 200)); } };
  return (
    <form className="ccard" onSubmit={a.submit(async () => {
      const q = new URLSearchParams({ kind: "document", docKind: kind, title: title.trim() });
      if (date) q.set("docDate", date);
      await sendFile(`/api/patients/${patientId}/files?${q}`, file!);
      setFile(null); setTitle(""); setDate(""); if (input.current) input.current.value = ""; onAdded();
    })}>
      <h3><span>{t("addDoc")}</span></h3>
      <div className={`drop${drag ? " on" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files[0]); }}>
        {file ? <b dir="auto">{file.name}</b> : <button type="button" className="link" onClick={() => input.current?.click()}>{t("chooseFile")}</button>}
        <small className="hint">{t("dropHint", { n: maxMb })}</small>
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
      </div>
      <Field label={t("docKind")}><select value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k.key} value={k.key}>{nameOf(k, k.key, lang)}</option>)}</select></Field>
      <Field label={t("docTitle")}><input dir="auto" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label={t("docDate")}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {a.err && <Banner>{a.message}</Banner>}
      <div><button className="btn btn-accent btn-sm" disabled={a.busy || !file || !title.trim() || !kind}>{a.busy ? t("uploading") : t("addBtn")}</button></div>
    </form>
  );
}
