// Records, phase B: photos (doctors, after consent), documents (secretaries open only front-desk kinds), links that expire,
// every opening recorded, never deleted, the clinic phone's one-time code, the emergency contact in two parts, and the nightly
// encrypted backup with its retry, restore check and email.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setup } from "./helpers.js";
import { decrypt } from "../server/backup.js";

let t, P;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); P = await t.people(); });

// A tiny JPEG with an EXIF block (where a phone writes the place), a PNG and a PDF: only their first bytes matter here.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a]), Buffer.from("Exif\0\0"), Buffer.from([0x01, 0x02]),
  Buffer.from([0xff, 0xda, 0x00, 0x04, 0x11, 0x22, 0x33, 0x44, 0xff, 0xd9])]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n");

async function send(b, url, buf, type = "application/octet-stream") {
  const r = await fetch(t.base + url, { method: "POST", headers: { "content-type": type, origin: t.base, cookie: b.cookie }, body: buf });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json };
}
const getRaw = async (b, url) => fetch(t.base + url, { headers: { cookie: b.cookie } });

test("photos: doctors only, after the patient's consent; the camera's notes are removed; secretaries never see them", async () => {
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b: dr } = await t.login(P.doctor);
  assert.equal((await send(dr, `/api/patients/${pid}/files?kind=photo&area=face`, JPEG)).json.error, "photo_consent_needed");
  assert.equal((await dr.put(`/api/patients/${pid}/photo-consent`, { value: "record" })).status, 200);
  assert.equal((await send(dr, `/api/patients/${pid}/files?kind=photo&area=nowhere`, JPEG)).json.error, "unknown_area");
  const up = await send(dr, `/api/patients/${pid}/files?kind=photo&area=face`, JPEG);
  assert.equal(up.status, 201);
  const row = (await t.owner.query("select storage_path, size_bytes from record_files where id = $1", [up.json.id])).rows[0];
  const stored = fs.readFileSync(path.join(t.config.storage.dir, row.storage_path));
  assert.ok(!stored.includes(Buffer.from("Exif")), "EXIF removed");
  assert.equal(stored.length, row.size_bytes);
  assert.ok(!row.storage_path.includes("Lina"));                   // stored under numbers only

  const { b: sec } = await t.login(P.secretary);
  const l = (await sec.get(`/api/patients/${pid}/files`)).json;
  assert.equal(l.photos, null);
  assert.equal((await sec.get(`/api/files/${up.json.id}/link`)).status, 404);
  assert.equal((await send(sec, `/api/patients/${pid}/files?kind=photo&area=face`, JPEG)).status, 403);
  assert.equal((await dr.get(`/api/patients/${pid}/files`)).json.photos.length, 1);
});

test("only real PDF, JPG or PNG, within the size from Settings", async () => {
  const pid = await t.patient("Lina Haddad");
  const { b: sec } = await t.login(P.secretary);
  const doc = (q) => `/api/patients/${pid}/files?kind=document&docKind=insurance_card&title=Card${q}`;
  assert.equal((await send(sec, doc(""), Buffer.from("MZ\x90\x00 not a picture"))).json.error, "file_type_not_allowed");
  assert.equal((await send(sec, doc(""), Buffer.alloc(0))).json.error, "empty_file");
  await t.owner.query("update record_settings set max_file_mb = 1");
  assert.equal((await send(sec, doc(""), Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10)]))).json.error, "file_too_large");
  assert.equal((await send(sec, doc("&docDate=2099-01-01"), PDF)).json.error, "date_in_future");
  assert.equal((await send(sec, `/api/patients/${pid}/files?kind=document&docKind=nope&title=x`, PDF)).json.error, "unknown_doc_kind");
});

test("documents: a secretary adds any kind but opens only front-desk ones; results wait for the doctor's review; links expire", async () => {
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b: sec } = await t.login(P.secretary);
  const lab = await send(sec, `/api/patients/${pid}/files?kind=document&docKind=lab_result&title=${encodeURIComponent("TSH, liver tests")}&docDate=2026-11-09`, PDF);
  assert.equal(lab.status, 201);
  assert.equal(lab.json.reviewed_at, null);
  const card = await send(sec, `/api/patients/${pid}/files?kind=document&docKind=insurance_card&title=MedNet%20card`, JPEG);
  const l = (await sec.get(`/api/patients/${pid}/files`)).json;
  assert.deepEqual(l.documents.map((d) => d.doc_kind), ["insurance_card"]);
  assert.equal(l.othersCount, 1);
  assert.equal((await sec.get(`/api/files/${lab.json.id}/link`)).status, 404);

  const link = (await sec.get(`/api/files/${card.json.id}/link`)).json;
  const ok = await getRaw(sec, link.url);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal((await getRaw(sec, link.url.replace(/s=.{5}/, "s=AAAAA"))).status, 410);
  const { b: dr } = await t.login(P.doctor);
  assert.equal((await getRaw(dr, link.url)).status, 410);           // the link is for the person who asked for it
  t.clock.t += 6 * 60000;
  assert.equal((await getRaw(sec, link.url)).status, 410);         // Settings: 5 minutes

  // The doctor sees the result waiting, on Today's patients too, and marks it reviewed.
  await t.booking(pid, P.lina, { at: new Date(t.clock.t + 3600000).toISOString(), status: "booked" });
  const today = (await dr.get("/api/today")).json;
  assert.equal(today.find((r) => r.patient_id === pid).to_review, 1);
  const docs = (await dr.get(`/api/patients/${pid}/files`)).json.documents;
  assert.equal(docs.length, 2);
  const rv = await dr.post(`/api/files/${lab.json.id}/review`, { expectedVersion: lab.json.row_version });
  assert.equal(rv.json.reviewed_by_name, "Dr Lina");
  assert.equal((await dr.get("/api/today")).json.find((r) => r.patient_id === pid).to_review, 0);
  // A result the doctor adds is reviewed already.
  const own = await send(dr, `/api/patients/${pid}/files?kind=document&docKind=lab_result&title=CBC`, PDF);
  assert.ok(own.json.reviewed_at);
});

test("every opening is recorded, by kind only; the audit trail never holds a title; a file is never deleted, only marked in error", async () => {
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b: dr } = await t.login(P.doctor);
  const lab = (await send(dr, `/api/patients/${pid}/files?kind=document&docKind=lab_result&title=${encodeURIComponent("HIV test, negative")}`, PDF)).json;
  await dr.get(`/api/files/${lab.id}/link`);
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const opened = (await adm.get(`/api/patients/${pid}/openings`)).json;
  assert.equal(opened[0].file_kind, "document");
  assert.equal(opened[0].doc_kind, "lab_result");
  assert.ok(!JSON.stringify(opened).includes("HIV"));
  const audit = (await t.owner.query("select before, after, changed_fields from audit.events where entity = 'record_file'")).rows;
  assert.ok(audit.length >= 2);
  assert.ok(!JSON.stringify(audit).includes("HIV"));

  const err = await dr.post(`/api/files/${lab.id}/error`, { reason: "wrong patient", expectedVersion: lab.row_version });
  assert.equal(err.status, 200);
  assert.equal((await dr.post(`/api/files/${lab.id}/review`, { expectedVersion: err.json.row_version })).json.error, "entry_locked");
  await assert.rejects(t.pool.query("update record_files set title = 'x' where id = $1", [lab.id]), /locked/);
  await assert.rejects(t.pool.query("update record_files set storage_path = 'x' where id = $1", [lab.id]), /never change/);
  await assert.rejects(t.pool.query("delete from record_files where id = $1", [lab.id]), /permission denied/);
});

test("the clinic phone: a one-time code for one patient; photos go into the chart under the doctor's name; it ends on Done or after the minutes", async () => {
  const pid = await t.patient("Huda Al-Khatib", { doctor: P.lina });
  const { b: dr } = await t.login(P.doctor);
  assert.equal((await dr.post(`/api/patients/${pid}/phone-code`, { area: "face" })).json.error, "photo_consent_needed");
  await dr.put(`/api/patients/${pid}/photo-consent`, { value: "teaching" });
  const code = (await dr.post(`/api/patients/${pid}/phone-code`, { area: "face" })).json;
  const token = code.url.split("/c/")[1];
  assert.equal(token.length, 43);
  const phone = t.jar();                                           // no sign-in on the phone
  const info = (await phone.get(`/api/capture/${token}`)).json;
  assert.equal(info.patient, "Huda A.");
  assert.equal(info.area, "face");
  assert.equal((await getRaw(phone, `/api/capture/${token}/ghost?area=face`)).status, 204);
  const shot = await send(phone, `/api/capture/${token}/photos?area=face`, JPEG, "image/jpeg");
  assert.equal(shot.status, 201);
  assert.equal((await getRaw(phone, `/api/capture/${token}/ghost?area=face`)).status, 200);
  const f = (await t.owner.query("select source, created_by_name from record_files where id = $1", [shot.json.id])).rows[0];
  assert.deepEqual(f, { source: "phone", created_by_name: "Dr Lina" });
  assert.equal((await dr.get(`/api/phone-codes/${code.id}`)).json.photos, 1);
  assert.equal((await phone.post(`/api/capture/${token}/done`)).status, 200);
  assert.equal((await send(phone, `/api/capture/${token}/photos?area=face`, JPEG)).status, 410);
  assert.equal((await phone.get(`/api/capture/${"x".repeat(43)}`)).status, 410);
  const code2 = (await dr.post(`/api/patients/${pid}/phone-code`, { area: "face" })).json;
  t.clock.t += 11 * 60000;
  assert.equal((await phone.get(`/api/capture/${code2.url.split("/c/")[1]}`)).status, 410);
});

test("the emergency contact: name, relationship from the clinic's list, phone; 'required' means a name and a phone", async () => {
  const pid = await t.patient("Lina Haddad");
  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.put(`/api/patients/${pid}/details`, { emergencyName: "Khaled", emergencyRelation: "cousin" })).json.error, "invalid_value");
  const d = (await sec.put(`/api/patients/${pid}/details`, { emergencyName: "Khaled Haddad", emergencyRelation: "spouse", emergencyPhone: "+962 79 555 0142" })).json;
  assert.deepEqual([d.emergency_name, d.emergency_relation, d.emergency_phone], ["Khaled Haddad", "spouse", "+962 79 555 0142"]);
  await t.owner.query("update record_settings set required_details = '{emergency_contact}'");
  const r = await sec.put(`/api/patients/${pid}/details`, { emergencyName: "Khaled Haddad", expectedVersion: d.row_version });
  assert.equal(r.json.error, "details_required");
});

test("settings: an area or a kind of document in use can't be removed", async () => {
  const pid = await t.patient("Lina Haddad");
  const { b: dr } = await t.login(P.doctor);
  await dr.put(`/api/patients/${pid}/photo-consent`, { value: "record" });
  await send(dr, `/api/patients/${pid}/files?kind=photo&area=face`, JPEG);
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const s = (await adm.get("/api/settings")).json;
  const r = await adm.put("/api/settings", { ...s, photoAreas: s.photoAreas.filter((a) => a.key !== "face") });
  assert.equal(r.json.error, "in_use");
  assert.deepEqual(r.json.keys, ["face"]);
  const ok = await adm.put("/api/settings", { ...s, photoAreas: s.photoAreas.filter((a) => a.key !== "feet"), maxFileMb: 10 });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.maxFileMb, 10);
});

test("backups: files copied once and encrypted, the tables dumped, a sample restored and compared; a failure is emailed and retried", async () => {
  const pid = await t.patient("Lina Haddad", { doctor: P.lina });
  const { b: dr } = await t.login(P.doctor);
  await dr.put(`/api/patients/${pid}/photo-consent`, { value: "record" });
  const up = (await send(dr, `/api/patients/${pid}/files?kind=photo&area=face`, JPEG)).json;
  // Sunday 15 November 2026, 03:05 in Amman: the restore-check day (Settings: Sunday).
  t.clock.t = Date.parse("2026-11-15T00:05:00Z");
  const r = await t.backups.tick();
  assert.equal(r.state, "done");
  assert.equal(r.files, 1);
  assert.equal(r.restoreChecked, 1);
  const key = fs.readFileSync(t.config.backup.keyFile);
  const row = (await t.owner.query("select storage_path, backed_up_at from record_files where id = $1", [up.id])).rows[0];
  assert.ok(row.backed_up_at);
  const enc = fs.readFileSync(path.join(t.config.backup.dir, "files", `${row.storage_path}.enc`));
  assert.ok(!enc.includes(Buffer.from([0xff, 0xda, 0x00, 0x04, 0x11, 0x22])), "encrypted on disk");
  assert.ok(decrypt(key, enc).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])));
  const dump = JSON.parse(decrypt(key, fs.readFileSync(path.join(t.config.backup.dir, "db", "2026-11-15.json.enc"))).toString());
  assert.equal(dump.tables.record_files.length, 1);
  assert.equal(await t.backups.tick(), null);                     // once a night
  assert.equal((await t.backups.run("manual")).files, 0);         // a file is copied once

  // The next night fails (the key is gone): emailed, then retried after Settings' minutes.
  fs.renameSync(t.config.backup.keyFile, t.config.backup.keyFile + ".away");
  const backupsFresh = (await import("../server/backup.js")).createBackups({ pool: t.pool, storage: t.storage, config: t.config, now: () => new Date(t.clock.t), log: () => {},
    sendMail: async (to, subject) => { t.mails.push({ to, subject }); return true; } });
  t.clock.t = Date.parse("2026-11-16T00:10:00Z");
  assert.equal((await backupsFresh.tick()).state, "failed");
  assert.equal(t.mails.length, 1);
  assert.equal(t.mails[0].to, "owner@example.jo");
  assert.equal(await backupsFresh.tick(), null);                  // not before the retry time
  fs.renameSync(t.config.backup.keyFile + ".away", t.config.backup.keyFile);
  t.clock.t += 61 * 60000;
  assert.equal((await backupsFresh.tick()).state, "done");
});

test("backups page: administrators see the state; only a Limitsiz administrator changes the schedule", async () => {
  const { b: adm } = await t.login(P.admin, { mfa: P.admin.secret });
  const s = (await adm.get("/api/backups")).json;
  assert.equal(s.configured, true);
  assert.equal(s.canEdit, false);
  assert.equal(s.keyFingerprint.length, 16);
  assert.equal((await adm.put("/api/backups/settings", { runAt: "02:00", timezone: "Asia/Amman", keepDaily: 30, keepMonthly: 12, restoreWeekday: 0 })).status, 403);
  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.get("/api/backups")).status, 403);
});

test("looking at the photos is recorded once, not once per photo", async () => {
  const pid = await t.patient("Lina Haddad");
  const { b: dr } = await t.login(P.doctor);
  await dr.put(`/api/patients/${pid}/photo-consent`, { value: "record" });
  for (let i = 0; i < 3; i++) await send(dr, `/api/patients/${pid}/files?kind=photo&area=face`, JPEG);
  const links = (await dr.get(`/api/patients/${pid}/photo-links`)).json;
  assert.equal(Object.keys(links).length, 3);
  assert.equal((await getRaw(dr, Object.values(links)[0])).status, 200);
  const n = (await t.owner.query("select what, count(*)::int as n from record_openings where patient_id = $1 group by what", [pid])).rows;
  assert.deepEqual(n, [{ what: "photos", n: 1 }]);
  const { b: sec } = await t.login(P.secretary);
  assert.equal((await sec.get(`/api/patients/${pid}/photo-links`)).status, 403);
});
