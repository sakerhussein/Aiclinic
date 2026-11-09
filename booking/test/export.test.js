// Export to Excel: who may, what is in the file, what is left out, and that it is recorded. Each file is opened again and read cell by cell.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { setup } from "./helpers.js";

let t, ids, P, adm, sec, one, two;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const DAY = "2026-11-11", LATER = "2026-11-12";
const at = (day, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const book = (doctorId, name, phone, day = DAY, time = "12:00", extra = {}) => sec.post("/api/appointments", { serviceId: ids.services[0].id, doctorId, startsAt: at(day, time), source: "phone", newPatient: { fullName: name, phone }, ...extra });
const file = async (b, path) => {
  const res = await fetch(t.base + path, { headers: { cookie: b.cookie } });
  if (!res.ok) return { status: res.status };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.worksheets[0], rows = [];
  ws.eachRow((r) => rows.push(r.values.slice(1)));
  return { status: res.status, ws, rows, type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition") };
};
const exports_ = async () => (await adm.get("/api/audit?type=audit")).json.rows.filter((r) => r.action === "data_exported");

beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  adm = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  sec = (await t.login(P.secretary)).b;
  one = (await book(ids.lina, "Huda Al-Khatib", "0791110001", DAY, "12:30", { internalNote: "private note" })).json;
  two = (await book(ids.omar, "=1+1", "0791110002", LATER, "13:00")).json;
});

test("only clinic administrators can export, and the audit export alone does not allow it", async () => {
  const dr = (await t.login(P.doctor)).b, ro = (await t.login(P.readonly)).b;
  for (const b of [sec, dr, ro]) for (const p of ["/api/export/bookings", "/api/export/patients"]) assert.equal((await file(b, p)).status, 403);
  assert.equal((await file(t.bookingJar(), "/api/export/bookings")).status, 401);
  assert.equal((await adm.get("/api/me")).json.permissions.includes("booking.data.export"), true);
  await t.owner.query("delete from accounts.role_permissions where role_key = 'clinic_admin' and permission = 'booking.data.export'");
  try { assert.equal((await file(adm, "/api/export/bookings")).status, 403); }
  finally { await t.owner.query("insert into accounts.role_permissions (role_key, permission) values ('clinic_admin', 'booking.data.export')"); }
});

test("bookings file: a real Excel file, in clinic time, with notes left out", async () => {
  const f = await file(adm, "/api/export/bookings");
  assert.match(f.type, /spreadsheetml/);
  assert.match(f.disposition, /limitsiz-bookings-\d{4}-\d{2}-\d{2}\.xlsx/);
  assert.equal(f.rows.length, 3);
  assert.deepEqual(f.rows[0].slice(0, 4), ["Date", "Time", "Patient", "Phone"]);
  const r = f.ws.getRow(2);
  assert.equal(r.getCell(1).value.toISOString().slice(0, 10), DAY, "a real date, not text");
  assert.equal(r.getCell(2).value.toISOString().slice(11, 16), "12:30", "12:30 in Amman, not UTC");
  assert.equal(r.getCell(3).value, "Huda Al-Khatib");
  assert.equal(r.getCell(4).value, "+962791110001");
  assert.equal(r.getCell(10).value, "Booked");
  assert.equal(JSON.stringify(f.rows).includes("private note"), false);
  assert.equal(f.ws.views[0].rightToLeft, false);
  assert.equal(f.ws.views[0].state, "frozen");
});

test("the file follows the page's filters, and a voided booking only comes with Show voided", async () => {
  const count = async (q) => (await file(adm, `/api/export/bookings?${q}`)).rows.length - 1;
  assert.equal(await count(`from=${LATER}`), 1);
  assert.equal(await count(`doctor=${ids.lina}`), 1);
  assert.equal(await count("q=Huda"), 1);
  await sec.post(`/api/appointments/${one.id}/status`, { status: "voided", reason: "wrong patient", expectedVersion: one.row_version });
  assert.equal(await count(""), 1);
  assert.equal(await count("voided=1"), 2);
  const f = await file(adm, "/api/export/bookings?voided=1");
  assert.equal(f.ws.getRow(2).getCell(11).value, "wrong patient");
});

test("more rows than the page shows", async () => {
  await t.owner.query(`insert into patients (clinic_id, full_name, phone_e164) select $1, 'Bulk ' || i, '+96279' || lpad(i::text, 7, '0') from generate_series(1, 60) i`, [t.clinicA]);
  assert.equal((await adm.get("/api/patients")).json.length, 50);
  assert.equal((await file(adm, "/api/export/patients")).rows.length - 1, 62);
  assert.equal((await file(adm, "/api/export/patients?q=Huda")).rows.length - 1, 1);
});

test("a name that looks like a formula stays text", async () => {
  const f = await file(adm, "/api/export/patients?q=" + encodeURIComponent("=1+1"));
  const cell = f.ws.getRow(2).getCell(1);
  assert.equal(cell.value, "=1+1");
  assert.equal(cell.formula, undefined);
  assert.equal(cell.type, ExcelJS.ValueType.String);
});

test("Arabic: headings, values and direction, with phone numbers left to right", async () => {
  const f = await file(adm, "/api/export/bookings?lang=ar");
  assert.equal(f.ws.name, "المواعيد");
  assert.equal(f.rows[0][2], "المريض");
  assert.equal(f.ws.views[0].rightToLeft, true);
  assert.equal(f.ws.getRow(2).getCell(10).value, "محجوز");
  assert.equal(f.ws.getRow(2).getCell(4).alignment.readingOrder, "ltr");
  const p = await file(adm, "/api/export/patients?lang=ar");
  assert.equal(p.ws.name, "المرضى");
  assert.equal(p.rows[0][0], "الاسم");
});

test("patients file: the agreed columns", async () => {
  await t.owner.query("update patients set whatsapp_reminders = true, preferred_language = 'ar' where id = $1", [one.patient_id]);
  const f = await file(adm, "/api/export/patients?q=Huda");
  assert.deepEqual(f.rows[0], ["Name", "Phone", "Preferred language", "WhatsApp reminders", "Last visit"]);
  const r = f.ws.getRow(2);
  assert.deepEqual([r.getCell(1).value, r.getCell(2).value, r.getCell(3).value, r.getCell(4).value], ["Huda Al-Khatib", "+962791110001", "Arabic", "Yes"]);
  assert.equal(r.getCell(5).value.toISOString().slice(0, 10), DAY);
});

test("every export is recorded with what, how many and which filters, and a refused one is not", async () => {
  const already = (await exports_()).length;
  await file(sec, "/api/export/patients");
  assert.equal((await exports_()).length, already);
  await file(adm, `/api/export/bookings?doctor=${ids.lina}`);
  await file(adm, "/api/export/patients?q=Huda");
  const [p, b] = await exports_();
  assert.deepEqual([b.after.what, b.after.rows, b.after.truncated, b.after.filters.doctorId], ["bookings", 1, false, ids.lina]);
  assert.deepEqual([p.after.what, p.after.rows, p.after.filters.q], ["patients", 1, "Huda"]);
  assert.equal(b.actor_label, "Layla Admin");
  assert.equal((await adm.post("/api/audit/verify")).json.ok, true, "the audit chain is still whole");
});

test("a bad filter is refused", async () => {
  assert.equal((await file(adm, "/api/export/bookings?status=nonsense")).status, 400);
  assert.equal((await file(adm, "/api/export/bookings?lang=fr")).status, 400);
});
