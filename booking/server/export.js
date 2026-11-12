// Excel files for the Bookings and Patients pages. Text goes in as text cells, never as formulas, so a name such as "=1+1" stays a name.
// Times are the clinic's, written as real Excel dates so they sort and filter. Internal notes stay out: this file leaves the system.
import ExcelJS from "exceljs";

export const MAX_EXPORT_ROWS = 50000;

const TEXT = {
  en: {
    bookings: "Bookings", patients: "Patients",
    bookingCols: ["Date", "Time", "Patient", "Phone", "Service", "Duration (min)", "Price (JOD)", "Doctor", "Source", "Status", "Cancel or void reason", "Visit"],
    patientCols: ["Name", "Phone", "Preferred language", "WhatsApp reminders", "Last visit"],
    statuses: { booked: "Booked", confirmed: "Confirmed", completed: "Completed", no_show: "No-show", cancelled: "Cancelled", voided: "Voided" },
    sources: { whatsapp: "WhatsApp", phone: "Phone", walkin: "Walk-in", staff: "Staff", web: "Web" },
    languages: { ar: "Arabic", en: "English" }, yes: "Yes", no: "No",
    visits: { in_clinic: "At the clinic", video: "Online (video)", audio: "Online (audio)" },
    stopped: `Stopped at ${MAX_EXPORT_ROWS} rows: narrow the filters and export again.`,
  },
  ar: {
    bookings: "المواعيد", patients: "المرضى",
    bookingCols: ["التاريخ", "الوقت", "المريض", "الهاتف", "الخدمة", "المدة (دقيقة)", "السعر (دينار)", "الطبيب", "المصدر", "الحالة", "سبب الإلغاء أو الإبطال", "الزيارة"],
    patientCols: ["الاسم", "الهاتف", "اللغة المفضلة", "تذكيرات واتساب", "آخر زيارة"],
    statuses: { booked: "محجوز", confirmed: "مؤكد", completed: "مكتمل", no_show: "لم يحضر", cancelled: "ملغى", voided: "مُبطل" },
    sources: { whatsapp: "واتساب", phone: "هاتف", walkin: "حضور مباشر", staff: "موظف", web: "الموقع" },
    languages: { ar: "العربية", en: "الإنجليزية" }, yes: "نعم", no: "لا",
    visits: { in_clinic: "في العيادة", video: "أونلاين (فيديو)", audio: "أونلاين (صوت)" },
    stopped: `توقف التصدير عند ${MAX_EXPORT_ROWS} صف: ضيّق عوامل التصفية وصدّر مرة أخرى.`,
  },
};

// The clock in the clinic, as day and fraction of a day. Excel dates have no time zone, so the parts must already be local.
function local(at, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { date: new Date(Date.UTC(+p.year, +p.month - 1, +p.day)), time: (+p.hour * 60 + +p.minute) / 1440 };
}
export const todayIn = (at, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

async function workbook({ lang, title, columns, rows, truncated, stopped }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1, rightToLeft: lang === "ar" }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  for (const r of rows) ws.addRow(r);
  // A phone number reads left to right on an Arabic sheet too, or its + lands at the wrong end.
  columns.forEach((c, i) => { if (c.ltr) ws.getColumn(i + 1).eachCell({ includeEmpty: false }, (cell, n) => { if (n > 1) cell.alignment = { readingOrder: "ltr", horizontal: "left" }; }); });
  if (truncated) ws.addRow([stopped]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function bookingsFile(rows, { lang, tz, truncated }) {
  const T = TEXT[lang];
  const w = [12, 8, 26, 17, 26, 12, 11, 22, 13, 13, 32, 16];
  const columns = T.bookingCols.map((header, i) => ({ header, width: w[i], numFmt: i === 0 ? "yyyy-mm-dd" : i === 1 ? "hh:mm" : i === 6 ? "0.00" : undefined, ltr: i === 3 }));
  const out = rows.map((a) => {
    const t = local(a.starts_at, tz);
    return [t.date, t.time, a.patient_name ?? "", a.patient_phone ?? "", lang === "ar" ? a.service_name_ar : a.service_name_en, a.duration_minutes,
      a.price_jod == null ? null : Number(a.price_jod), lang === "ar" ? a.doctor_name_ar : a.doctor_name_en,
      T.sources[a.source] ?? a.source, T.statuses[a.status] ?? a.status, a.void_reason ?? a.cancel_reason ?? "",
      a.visit_type === "online" ? T.visits[a.online_mode] ?? "" : T.visits.in_clinic];
  });
  return workbook({ lang, title: T.bookings, columns, rows: out, truncated, stopped: T.stopped });
}

export function patientsFile(rows, { lang, tz, truncated }) {
  const T = TEXT[lang];
  const w = [28, 17, 18, 18, 13];
  const columns = T.patientCols.map((header, i) => ({ header, width: w[i], numFmt: i === 4 ? "yyyy-mm-dd" : undefined, ltr: i === 1 }));
  const out = rows.map((p) => [p.full_name ?? "", p.phone_e164 ?? "", T.languages[p.preferred_language] ?? "", p.whatsapp_reminders ? T.yes : T.no,
    p.last_visit ? local(p.last_visit, tz).date : null]);
  return workbook({ lang, title: T.patients, columns, rows: out, truncated, stopped: T.stopped });
}
