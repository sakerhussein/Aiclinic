// Photos and documents (Records, phase B; design: booking/design/records-phase-b.html). No HTTP in here.
// Who sees what, decided here where the files are read:
//   photos: doctors (records.photos.view), once the patient's photo consent is recorded (when the clinic asks for it);
//   documents: doctors all of them; secretaries and administrators only the kinds marked "secretaries can open", though they may
//   add any kind (records.files.add) and see that the others exist.
// A file is opened through a link that works for a few minutes (Settings) and only for the person who asked; every opening is
// recorded in "Who opened this record". Files are never deleted: a wrong one is marked "entered in error".
// Taking photos with the clinic phone: a one-time code for one patient, for a few minutes; only its hash is kept.
import crypto from "node:crypto";
import { HttpError, bad, notFound } from "./http.js";
import { sniff, stripMetadata } from "./storage.js";

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const EXT = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
const FILE_COLS = `id, patient_id, kind, area_key, doc_kind, title, doc_date::text as doc_date, mime, size_bytes, source, created_at, created_by,
  created_by_name, created_by_role, reviewed_at, reviewed_by_name, error_at, error_by_name, error_reason, row_version`;

export function createFiles({ pool, svc, storage, secret, siteUrl, now = () => new Date() }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];
  const sign = (s) => crypto.createHmac("sha256", secret).update(s).digest("base64url");
  const kindOf = (s, key) => s.doc_kinds.find((k) => k.key === key);
  const conflict = (row) => new HttpError(409, "version_conflict", { rowVersion: row.row_version });

  // May this person open this file? (The patient must be open to them too: svc.allowedPatient, called before.)
  const canOpen = (ctx, s, f) => (f.kind === "photo" ? ctx.canPhotos : ctx.canChart || (ctx.canDetails && !!kindOf(s, f.doc_kind)?.secretary));

  async function list(ctx, patientId) {
    const s = await svc.settingsRow(pool, ctx.clinicId);
    await svc.allowedPatient(pool, ctx, patientId, s);
    const rows = (await pool.query(`select ${FILE_COLS} from record_files where clinic_id = $1 and patient_id = $2 order by coalesce(doc_date::timestamptz, created_at) desc, created_at desc`,
      [ctx.clinicId, patientId])).rows;
    const consent = await one(pool, "select photo_consent, photo_consent_at, photo_consent_by_name from patient_details where patient_id = $1", [patientId]);
    const docs = rows.filter((f) => f.kind === "document");
    const visible = docs.filter((f) => canOpen(ctx, s, f));
    return {
      photos: ctx.canPhotos ? rows.filter((f) => f.kind === "photo") : null,
      documents: visible,
      othersCount: docs.filter((f) => !canOpen(ctx, s, f) && !f.error_at).length,      // clinical documents this person may not open
      consent: consent?.photo_consent ? consent : null,
      rules: { consentRequired: s.photo_consent_required, maxFileMb: s.max_file_mb, areas: s.photo_areas, docKinds: s.doc_kinds },
    };
  }

  // One file in: checked by its content, size from Settings, the camera's notes removed from photos, stored under numbers only.
  async function add(c, ctx, s, patientId, meta, raw, { source = "upload", by } = {}) {
    if (!raw?.length) throw bad("empty_file");
    if (raw.length > s.max_file_mb * 1024 * 1024) throw bad("file_too_large", { maxMb: s.max_file_mb });
    const mime = sniff(raw);
    if (!mime || (meta.kind === "photo" && mime === "application/pdf")) throw bad("file_type_not_allowed");
    if (meta.kind === "photo") {
      if (!s.photo_areas.some((a) => a.key === meta.area)) throw bad("unknown_area");
      if (s.photo_consent_required) {
        const d = await one(c, "select photo_consent from patient_details where patient_id = $1", [patientId]);
        if (!d?.photo_consent || d.photo_consent === "refused") throw bad("photo_consent_needed");
      }
    } else {
      if (!kindOf(s, meta.docKind)) throw bad("unknown_doc_kind");
      if (!meta.title?.trim()) throw bad("title_needed");
      if (meta.docDate && new Date(meta.docDate) > now()) throw bad("date_in_future");
    }
    const buf = meta.kind === "photo" || mime !== "application/pdf" ? stripMetadata(raw, mime) : raw;
    const id = crypto.randomUUID();
    const storagePath = `${ctx.clinicId}/${patientId}/${id}.${EXT[mime]}`;
    await storage.put(storagePath, buf, mime);
    const who = by ?? { id: ctx.user.id, name: ctx.user.name, role: ctx.role ?? null };
    // A result the doctor adds themselves needs no review; one added by someone else waits for "Mark reviewed".
    const selfReviewed = meta.kind === "document" && kindOf(s, meta.docKind).review && ctx.canChartWrite;
    return one(c,
      `insert into record_files (id, clinic_id, patient_id, kind, area_key, doc_kind, title, doc_date, mime, size_bytes, sha256, storage_path, source,
                                 created_at, created_by, created_by_name, created_by_role, reviewed_at, reviewed_by_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning ${FILE_COLS}`,
      [id, ctx.clinicId, patientId, meta.kind, meta.kind === "photo" ? meta.area : null, meta.kind === "document" ? meta.docKind : null,
       meta.kind === "document" ? meta.title.trim() : null, meta.kind === "document" ? meta.docDate || null : null, mime, buf.length, sha(buf), storagePath,
       source, now(), who.id, who.name, who.role, selfReviewed ? now() : null, selfReviewed ? who.name : null]);
  }

  async function upload(ctx, patientId, meta, raw) {
    if (meta.kind === "photo" && !ctx.canPhotos) throw new HttpError(403, "forbidden");
    if (meta.kind === "document" && !ctx.canAddFiles) throw new HttpError(403, "forbidden");
    return svc.tx(ctx, async (c) => {
      const s = await svc.settingsRow(c, ctx.clinicId);
      await svc.allowedPatient(c, ctx, patientId, s);
      return add(c, ctx, s, patientId, meta, raw);
    });
  }

  async function fileFor(c, ctx, id, lock = false) {
    const f = await one(c, `select ${FILE_COLS}, storage_path from record_files where clinic_id = $1 and id = $2${lock ? " for update" : ""}`, [ctx.clinicId, id]);
    if (!f) throw notFound("file_not_found");
    const s = await svc.settingsRow(c, ctx.clinicId);
    await svc.allowedPatient(c, ctx, f.patient_id, s);
    if (!canOpen(ctx, s, f)) throw notFound("file_not_found");          // the same answer as "no such file"
    return { f, s };
  }

  // A link that works for Settings' minutes, for this person only. Asking for it is the opening that is recorded.
  async function link(ctx, id) {
    return svc.tx(ctx, async (c) => {
      const { f, s } = await fileFor(c, ctx, id);
      await c.query("insert into record_openings (clinic_id, patient_id, user_id, user_name, role, opened_at, file_id, what) values ($1,$2,$3,$4,$5,$6,$7,'file')",
        [ctx.clinicId, f.patient_id, ctx.user.id, ctx.user.name, ctx.role ?? null, now(), f.id]);
      const exp = now().getTime() + s.link_minutes * 60000;
      return { url: `/api/files/${f.id}/content?e=${exp}&s=${sign(`file|${f.id}|${ctx.user.id}|${exp}`)}`, expiresAt: new Date(exp).toISOString(), mime: f.mime };
    });
  }
  async function content(ctx, id, exp, sig) {
    const e = Number(exp);
    if (!e || e < now().getTime() || typeof sig !== "string" || sig.length !== 43
        || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(`file|${id}|${ctx.user.id}|${e}`)))) throw new HttpError(410, "link_expired");
    const { f } = await fileFor(pool, ctx, id);
    return { buf: await storage.get(f.storage_path), mime: f.mime };
  }

  // The Photos tab: links for all of the patient's photos at once. Looking at them is recorded once ("photos viewed").
  async function photoLinks(ctx, patientId) {
    if (!ctx.canPhotos) throw new HttpError(403, "forbidden");
    return svc.tx(ctx, async (c) => {
      const s = await svc.settingsRow(c, ctx.clinicId);
      await svc.allowedPatient(c, ctx, patientId, s);
      const ids = (await c.query("select id from record_files where clinic_id = $1 and patient_id = $2 and kind = 'photo' and error_at is null", [ctx.clinicId, patientId])).rows;
      if (ids.length) await c.query("insert into record_openings (clinic_id, patient_id, user_id, user_name, role, opened_at, what) values ($1,$2,$3,$4,$5,$6,'photos')",
        [ctx.clinicId, patientId, ctx.user.id, ctx.user.name, ctx.role ?? null, now()]);
      const exp = now().getTime() + s.link_minutes * 60000;
      return Object.fromEntries(ids.map(({ id }) => [id, `/api/files/${id}/content?e=${exp}&s=${sign(`file|${id}|${ctx.user.id}|${exp}`)}`]));
    });
  }

  async function review(ctx, id, b) {
    return svc.tx(ctx, async (c) => {
      const { f, s } = await fileFor(c, ctx, id, true);
      if (!ctx.canChartWrite || f.kind !== "document" || !kindOf(s, f.doc_kind)?.review) throw new HttpError(403, "forbidden");
      if (f.error_at) throw new HttpError(409, "entry_locked");
      if (f.row_version !== b.expectedVersion) throw conflict(f);
      return one(c, `update record_files set reviewed_at = $2, reviewed_by_name = $3 where id = $1 returning ${FILE_COLS}`, [id, now(), ctx.user.name]);
    });
  }
  async function markError(ctx, id, b) {
    return svc.tx(ctx, async (c) => {
      const { f } = await fileFor(c, ctx, id, true);
      if (!(f.kind === "photo" ? ctx.canChartWrite : ctx.canChartWrite || ctx.canAddFiles)) throw new HttpError(403, "forbidden");
      if (f.error_at) throw new HttpError(409, "entry_locked");
      if (f.row_version !== b.expectedVersion) throw conflict(f);
      return one(c, `update record_files set error_at = $2, error_by_name = $3, error_reason = $4 where id = $1 returning ${FILE_COLS}`,
        [id, now(), ctx.user.name, b.reason.trim()]);
    });
  }

  // The patient's photo consent: for the record only, also for teaching, or refused. Kept with the date and who asked.
  async function setConsent(ctx, patientId, value) {
    if (!ctx.canPhotos) throw new HttpError(403, "forbidden");
    return svc.tx(ctx, async (c) => {
      const s = await svc.settingsRow(c, ctx.clinicId);
      await svc.allowedPatient(c, ctx, patientId, s);
      return one(c,
        `insert into patient_details (patient_id, clinic_id, photo_consent, photo_consent_at, photo_consent_by_name, updated_by_name) values ($1,$2,$3,$4,$5,$5)
         on conflict (patient_id) do update set photo_consent = excluded.photo_consent, photo_consent_at = excluded.photo_consent_at,
           photo_consent_by_name = excluded.photo_consent_by_name, updated_by_name = excluded.updated_by_name
         returning photo_consent, photo_consent_at, photo_consent_by_name`, [patientId, ctx.clinicId, value, now(), ctx.user.name]);
    });
  }

  // ---------------------------------------------------------------- taking photos with the clinic phone
  async function phoneCode(ctx, patientId, area) {
    if (!ctx.canPhotos) throw new HttpError(403, "forbidden");
    return svc.tx(ctx, async (c) => {
      const s = await svc.settingsRow(c, ctx.clinicId);
      await svc.allowedPatient(c, ctx, patientId, s);
      if (!s.photo_areas.some((a) => a.key === area)) throw bad("unknown_area");
      if (s.photo_consent_required) {
        const d = await one(c, "select photo_consent from patient_details where patient_id = $1", [patientId]);
        if (!d?.photo_consent || d.photo_consent === "refused") throw bad("photo_consent_needed");
      }
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(now().getTime() + s.phone_minutes * 60000);
      const r = await one(c,
        `insert into phone_captures (clinic_id, patient_id, area_key, token_hash, created_by, created_by_name, created_at, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [ctx.clinicId, patientId, area, sha(token), ctx.user.id, ctx.user.name, now(), expiresAt]);
      return { id: r.id, url: `${siteUrl}/c/${token}`, expiresAt: expiresAt.toISOString() };
    });
  }
  async function phoneState(ctx, id) {
    const r = await one(pool, "select patient_id, photos, opened_at, done_at, expires_at from phone_captures where clinic_id = $1 and id = $2 and created_by = $3",
      [ctx.clinicId, id, ctx.user.id]);
    if (!r) throw notFound("code_not_found");
    return { photos: r.photos, opened: !!r.opened_at, done: !!r.done_at, expired: r.expires_at < now(), expiresAt: r.expires_at };
  }

  // The phone has no sign-in: the code is the key. It works until it expires or the phone says "Done".
  async function capture(c, token, lock = false) {
    if (typeof token !== "string" || token.length !== 43) throw new HttpError(410, "code_expired");
    const r = await one(c, `select * from phone_captures where token_hash = $1${lock ? " for update" : ""}`, [sha(token)]);
    if (!r || r.done_at || r.expires_at < now()) throw new HttpError(410, "code_expired");
    return r;
  }
  // The actor written in the audit trail is the person who made the code.
  const asMaker = (r) => ({ clinicId: r.clinic_id, user: { id: r.created_by, name: r.created_by_name }, role: "doctor", reason: "photos taken with the clinic phone" });

  async function captureInfo(token) {
    const r = await capture(pool, token);
    if (!r.opened_at) await pool.query("update phone_captures set opened_at = $2 where id = $1", [r.id, now()]);
    const p = await one(pool, "select p.full_name, d.file_no from patients p left join patient_details d on d.patient_id = p.id where p.id = $1", [r.patient_id]);
    const s = await svc.settingsRow(pool, r.clinic_id);
    const first = (p?.full_name || "").trim().split(/\s+/);
    return { patient: first.length > 1 ? `${first[0]} ${first[first.length - 1][0]}.` : first[0] || "—", fileNo: p?.file_no ?? null,
             area: r.area_key, areas: s.photo_areas, photos: r.photos, expiresAt: r.expires_at, maxFileMb: s.max_file_mb };
  }
  // The last photo of an area, shown faintly over the camera so the new one lines up.
  async function captureGhost(token, area) {
    const r = await capture(pool, token);
    const f = await one(pool, `select storage_path, mime from record_files where clinic_id = $1 and patient_id = $2 and kind = 'photo' and area_key = $3
                                 and error_at is null order by created_at desc limit 1`, [r.clinic_id, r.patient_id, area]);
    return f ? { buf: await storage.get(f.storage_path), mime: f.mime } : null;
  }
  async function captureAdd(token, area, raw) {
    const r0 = await capture(pool, token);
    return svc.tx(asMaker(r0), async (c) => {
      const r = await capture(c, token, true);
      const s = await svc.settingsRow(c, r.clinic_id);
      const f = await add(c, asMaker(r), s, r.patient_id, { kind: "photo", area }, raw,
        { source: "phone", by: { id: r.created_by, name: r.created_by_name, role: "doctor" } });
      await c.query("update phone_captures set photos = photos + 1 where id = $1", [r.id]);
      return { id: f.id, photos: r.photos + 1 };
    });
  }
  async function captureDone(token) {
    const r = await capture(pool, token);
    await pool.query("update phone_captures set done_at = $2 where id = $1", [r.id, now()]);
    return { photos: r.photos };
  }

  return { list, upload, link, photoLinks, content, review, markError, setConsent, phoneCode, phoneState, captureInfo, captureGhost, captureAdd, captureDone };
}
