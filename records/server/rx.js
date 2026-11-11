// Prescriptions (Records, phase C; design: booking/design/records-phase-c.html §3). No HTTP in here.
// Written by a doctor, checked, then printed with the clinic, the doctor's licence number (Booking › Settings › Doctors), the
// patient's allergies and a number. Once printed it is locked; printing again counts a copy. A wrong one is marked entered in error.
// Print only for now: sending one on WhatsApp waits for the legal review. No drug-interaction check (it needs a licensed database).
import { HttpError, bad, notFound } from "./http.js";

const COL_LIST = ['id', 'patient_id', 'doctor_id', 'appointment_id', 'items', 'language', 'valid_days', 'status', 'rx_no', 'printed_at', 'printed', 'print_count',
  'created_at', 'created_by_name', 'updated_at', 'error_at', 'error_by_name', 'error_reason', 'row_version'];
const COLS = COL_LIST.join(', ');

export function createRx({ pool, svc, now = () => new Date() }) {
  const one = async (c, sql, p) => (await c.query(sql, p)).rows[0];
  const conflict = (row) => new HttpError(409, "version_conflict", { rowVersion: row.row_version });
  const clean = (items) => items.map((i) => ({ name: i.name.trim(), how: i.how?.trim() || "", days: i.days ?? null, qty: i.qty?.trim() || "" }));

  async function guard(c, ctx, patientId, { write = false } = {}) {
    if (!ctx.canChart || (write && !ctx.canRx)) throw new HttpError(403, "forbidden");
    const s = await svc.settingsRow(c, ctx.clinicId);
    if (!s.rx_on) throw new HttpError(409, "rx_off");
    const p = await svc.allowedPatient(c, ctx, patientId, s);
    return { s, p };
  }

  async function list(ctx, patientId) {
    return svc.tx(ctx, async (c) => {
      await guard(c, ctx, patientId);
      const rows = (await c.query(
        `select ${COL_LIST.map((k) => "r." + k).join(", ")}, d.name_en as doctor_en, d.name_ar as doctor_ar
           from prescriptions r join doctors d on d.id = r.doctor_id where r.clinic_id = $1 and r.patient_id = $2 order by r.created_at desc`,
        [ctx.clinicId, patientId])).rows;
      // The paper's heading, for the preview before printing: this doctor and the clinic.
      const me = ctx.doctorId ? await one(c, "select name_en, name_ar, title_en, title_ar, licence_no from doctors where clinic_id = $1 and id = $2", [ctx.clinicId, ctx.doctorId]) : null;
      const clinic = await one(c, "select name_en, name_ar, phone, address_en, address_ar from clinics where id = $1", [ctx.clinicId]);
      return { prescriptions: rows, canWrite: !!ctx.canRx && !!ctx.doctorId, licence: me?.licence_no ?? null, clinic,
               doctor: me ? { name_en: me.name_en, name_ar: me.name_ar, title_en: me.title_en, title_ar: me.title_ar, licence: me.licence_no } : null };
    });
  }

  async function create(ctx, patientId, b) {
    return svc.tx(ctx, async (c) => {
      const { s } = await guard(c, ctx, patientId, { write: true });
      if (!ctx.doctorId) throw new HttpError(409, "not_a_doctor");
      if (b.appointmentId && !(await one(c, "select 1 from appointments where clinic_id = $1 and id = $2 and patient_id = $3", [ctx.clinicId, b.appointmentId, patientId]))) {
        throw bad("unknown_appointment");
      }
      return one(c,
        `insert into prescriptions (clinic_id, patient_id, doctor_id, appointment_id, items, language, valid_days, created_at, created_by, created_by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning ${COLS}`,
        [ctx.clinicId, patientId, ctx.doctorId, b.appointmentId ?? null, JSON.stringify(clean(b.items)), b.language, b.validDays ?? s.rx_valid_days,
         now(), ctx.user.id, ctx.user.name]);
    });
  }

  async function rxFor(c, ctx, id) {
    const r = await one(c, "select * from prescriptions where clinic_id = $1 and id = $2 for update", [ctx.clinicId, id]);
    if (!r) throw notFound("rx_not_found");
    const g = await guard(c, ctx, r.patient_id, { write: true });
    if (r.error_at) throw new HttpError(409, "entry_locked");
    return { r, ...g };
  }

  // A draft is changed by the doctor who wrote it.
  async function update(ctx, id, b) {
    return svc.tx(ctx, async (c) => {
      const { r } = await rxFor(c, ctx, id);
      if (r.row_version !== b.expectedVersion) throw conflict(r);
      if (r.status !== "draft") throw new HttpError(409, "rx_printed");
      if (r.doctor_id !== ctx.doctorId) throw new HttpError(403, "forbidden");
      return one(c, `update prescriptions set items = $2, language = $3, valid_days = $4, updated_by_name = $5 where id = $1 returning ${COLS}`,
        [id, JSON.stringify(clean(b.items)), b.language, b.validDays, ctx.user.name]);
    });
  }

  // The first print gives the number and locks what is on the paper; every later print is a copy of exactly that.
  async function print(ctx, id, b) {
    return svc.tx(ctx, async (c) => {
      const { r, p } = await rxFor(c, ctx, id);
      if (r.row_version !== b.expectedVersion) throw conflict(r);
      if (r.status === "printed") {
        const x = await one(c, `update prescriptions set print_count = print_count + 1, updated_by_name = $2 where id = $1 returning ${COLS}`, [id, ctx.user.name]);
        return { ...x, copy: true };
      }
      if (r.doctor_id !== ctx.doctorId) throw new HttpError(403, "forbidden");
      const doc = await one(c, "select name_en, name_ar, title_en, title_ar, licence_no from doctors where clinic_id = $1 and id = $2", [ctx.clinicId, r.doctor_id]);
      if (!doc?.licence_no) throw new HttpError(409, "licence_missing");
      const cl = await one(c, `select name_en, name_ar, phone, address_en, address_ar, timezone, extract(year from ($2::timestamptz at time zone timezone))::int as year,
                                      ($2::timestamptz at time zone timezone)::date::text as day from clinics where id = $1`, [ctx.clinicId, now()]);
      const s = await svc.settingsRow(c, ctx.clinicId, true);
      const n = s.rx_year === cl.year ? s.rx_next : 1;
      await c.query("update record_settings set rx_year = $2, rx_next = $3 where clinic_id = $1", [ctx.clinicId, cl.year, n + 1]);
      const d = await one(c, "select file_no, birth_date::text as birth_date, sex from patient_details where patient_id = $1", [r.patient_id]);
      const allergies = (await c.query(
        "select title, detail from chart_entries where clinic_id = $1 and patient_id = $2 and kind = 'allergy' and error_at is null and status = 'active' order by created_at",
        [ctx.clinicId, r.patient_id])).rows;
      const printed = {
        clinic: { name_en: cl.name_en, name_ar: cl.name_ar, phone: cl.phone, address_en: cl.address_en, address_ar: cl.address_ar },
        doctor: { name_en: doc.name_en, name_ar: doc.name_ar, title_en: doc.title_en, title_ar: doc.title_ar, licence: doc.licence_no },
        patient: { name: p.full_name, file_no: d?.file_no ?? null, birth_date: d?.birth_date ?? null, sex: d?.sex ?? null },
        allergies: allergies.map((a) => a.title), day: cl.day, paper: s.rx_paper,
      };
      const x = await one(c,
        `update prescriptions set status = 'printed', rx_no = $2, printed_at = $3, printed = $4, print_count = 1, updated_by_name = $5 where id = $1 returning ${COLS}`,
        [id, `${cl.year}-${String(n).padStart(5, "0")}`, now(), JSON.stringify(printed), ctx.user.name]);
      return { ...x, copy: false };
    });
  }

  async function markError(ctx, id, b) {
    return svc.tx(ctx, async (c) => {
      const { r } = await rxFor(c, ctx, id);
      if (r.row_version !== b.expectedVersion) throw conflict(r);
      return one(c, `update prescriptions set error_at = $2, error_by_name = $3, error_reason = $4, updated_by_name = $3 where id = $1 returning ${COLS}`,
        [id, now(), ctx.user.name, b.reason.trim()]);
    });
  }

  return { list, create, update, print, markError };
}
