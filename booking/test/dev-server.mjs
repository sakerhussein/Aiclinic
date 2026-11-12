// Local preview of Accounts (3003) and Booking (3004) together on the throwaway Postgres: node test/dev-server.mjs
// Real single sign-on between the two. Demo people and a few bookings today. Not for production.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { setup, GOOD } from "./helpers.js";
import { createApp as accountsApp } from "../../accounts/server/app.js";
import { createService } from "../server/service.js";
import { createApp as bookingApp } from "../server/app.js";
import { sha256 } from "../../accounts/server/crypto.js";
import { createPublicService } from "../server/public-service.js";
import { createPublicApp } from "../server/public-app.js";
import { createScribe, sampleDrafter } from "../server/scribe.js";
import { sampleTidier } from "../server/dictation.js";

const t = await setup();
await t.reset();
const P = await t.people(); const ids = await t.seedIds();
const SECRET = "dev-secret-".padEnd(40, "x");
await t.owner.query("update accounts.apps set redirect_uris = array['http://localhost:3004/auth/callback'], secret_hash = $1 where key = 'booking'", [sha256(SECRET)]);
await t.owner.query("update accounts.apps set url = 'http://localhost:3004' where key = 'booking'");   // the launcher opens the local Booking
const today = new Date().toISOString().slice(0, 10);
const at = (h, m = 0) => new Date(Date.parse(`${today}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString();
const pat = async (n, ph) => (await t.owner.query("insert into patients (clinic_id, full_name, phone_e164, whatsapp_reminders) values ($1,$2,$3,true) returning id", [t.clinicA, n, ph])).rows[0].id;
const svc = ids.services[0];
for (const [doc, h, m, name, ph, src, st] of [[ids.lina, 10, 0, "Huda Al-Khatib", "+962791110001", "whatsapp", "confirmed"], [ids.lina, 11, 0, "Omar Saleh", "+962791110002", "phone", "booked"],
  [ids.omar, 12, 30, "Dana Mansour", "+962791110003", "walkin", "booked"], [ids.lina, 16, 15, "Rami Faris", "+962791110004", "whatsapp", "booked"]]) {
  const p = await pat(name, ph);
  await t.owner.query("insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source, status) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [t.clinicA, doc, svc.id, p, at(h, m), at(h, m + svc.duration_minutes), src, st]);
}
const common = { trustProxy: "false", secureCookies: false, exposeLinks: true };
const accConfig = { ...common, siteUrl: "http://localhost:3003", origin: "http://localhost:3003", mfaKey: Buffer.alloc(32, 7).toString("base64"), cookieName: "lc_session" };
const { createCore } = await import("../../accounts/server/core.js");
// The tests use a frozen clock; the preview must use the real one (two-step codes, lock after 10 idle minutes, expiry).
const core = createCore({ pool: t.core.pool, config: accConfig, mail: { invite: async () => {}, reset: async () => {}, twoStepReset: async (m) => console.log(`[mail] two-step reset notice to ${m.to}`) } });
accountsApp({ core, config: accConfig }).listen(3003, "127.0.0.1");
const pool = new pg.Pool({ connectionString: "postgresql://booking_app:test@localhost:54329/accounts_test", max: 5 });
const auditPool = new pg.Pool({ connectionString: "postgresql://audit_reader:test@localhost:54329/accounts_test", max: 2 });
const bkConfig = { ...common, siteUrl: "http://localhost:3004", origin: "http://localhost:3004", accountsUrl: "http://localhost:3003", accountsInternalUrl: "http://127.0.0.1:3003",
  clientSecret: SECRET, sessionCookie: "lc_booking", stateCookie: "lc_state", publicBookingUrl: "http://localhost:3005" };
// The online booking page on 3005, on its own login, with the demo clinic's link switched on.
await t.owner.query("update online_booking set enabled = true, chat_enabled = true, done_note_en = 'Please arrive 10 minutes early.', done_note_ar = 'يرجى الحضور قبل الموعد بـ10 دقائق.' where clinic_id = $1", [t.clinicA]);
await t.owner.query("update clinics set phone = '06 592 0000', address_en = 'Abdoun, Amman', address_ar = 'عبدون، عمّان' where id = $1", [t.clinicA]);
const publicPool = new pg.Pool({ connectionString: "postgresql://public_app:test@localhost:54329/accounts_test", max: 4 });
const pubConfig = { siteUrl: "http://localhost:3005", origin: "http://localhost:3005", secure: false, trustProxy: "false" };
// A scripted stand-in for the assistant, so the chat screens can be tried without the AI (the real one: agent/ web mode).
// It offers the first free times of the first service, proposes a typed HH:MM, and shows the emergency and call-back cases.
const local = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const demo = {};
const demoAgent = async ({ text }) => {
  const ar = /[؀-ۿ]/.test(text), L = (en, a) => (ar ? a : en);
  if (/chest|can't breathe|صدر|اتنفس/i.test(text)) return { emergency: true, reply: L("This may be an emergency. Please call 911 now or go to the nearest emergency department. I have also alerted the clinic team.", "قد تكون هذه حالة طارئة. يرجى الاتصال على 911 فوراً أو التوجه إلى أقرب قسم طوارئ. وقد أبلغت فريق العيادة أيضاً.") };
  if (/person|cream|pregnan|شخص|كريم|حامل/i.test(text)) return { reply: L("That's a question for the doctor, and I can't give medical advice. Leave your number and the clinic will call you back.", "هذا سؤال للطبيب، ولا أستطيع تقديم نصائح طبية. اترك رقمك وستتصل بك العيادة."), callback: { reason: "medical_question", summary: "Demo: a medical question." } };
  if (/cancel|ألغي|الغي/i.test(text)) return { reply: L("For your privacy I can't see or change existing bookings on this page. Use the private link you got when you booked, or call the clinic.", "حفاظاً على خصوصيتك لا أستطيع رؤية الحجوزات السابقة أو تعديلها من هذه الصفحة. استخدم الرابط الخاص الذي وصلك عند الحجز، أو اتصل بالعيادة."), buttons: [L("Call the clinic", "اتصل بالعيادة")] };
  const info = await demo.svc.info("demo-derma"), s = info.services[0];
  const from = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const slots = await demo.svc.slots("demo-derma", { serviceId: s.id, from, days: 3 });
  const hit = text.match(/\b(\d{1,2}):(\d{2})\b/);
  const pick = hit && slots.find((x) => local(x.startsAt) === `${hit[1].padStart(2, "0")}:${hit[2]}`);
  if (pick) {
    const d = info.doctors.find((x) => x.id === pick.doctorId);
    return { reply: L("Please check the card, add your name and number, and press Yes.", "يرجى مراجعة البطاقة وإضافة اسمك ورقمك ثم الضغط على «نعم»."),
      proposal: { serviceId: s.id, doctorId: d.id, startsAt: pick.startsAt, serviceEn: s.name_en, serviceAr: s.name_ar, doctorEn: d.name_en, doctorAr: d.name_ar, summary: `${s.name_en} with ${d.name_en} at ${local(pick.startsAt)}` } };
  }
  const first = slots.slice(0, 4);
  return { reply: L(`*${s.name_en}* (${s.duration_minutes} min). The first free times:`, `*${s.name_ar}* (${s.duration_minutes} دقيقة). أول الأوقات المتاحة:`), buttons: first.map((x) => local(x.startsAt)) };
};
demo.svc = createPublicService({ pool: publicPool, agent: demoAgent });
createPublicApp({ svc: demo.svc, config: pubConfig }).listen(3005, "127.0.0.1", () => console.log("READY  Online booking http://localhost:3005/demo-derma"));
// AI Scribe: on for the demo clinic and every doctor, with the worker in this process. The stand-in speech service and a fixed
// sample draft, so trying the screens costs nothing (the real draft: server/scribe-index.js with ANTHROPIC_API_KEY).
await t.owner.query("update scribe_settings set enabled = true, dictation_enabled = true where clinic_id = $1", [t.clinicA]);
await t.owner.query("update doctors set scribe_enabled = true where clinic_id = $1", [t.clinicA]);
createScribe({ pool, drafter: sampleDrafter }).start();
// Records (the patient chart) on 3006, on its own login, with a filled-in chart for the first demo patient.
{
  const { createService: recordsService } = await import("../../records/server/service.js");
  const { createApp: recordsApp } = await import("../../records/server/app.js");
  const RSECRET = "dev-records-".padEnd(40, "x");
  await t.owner.query("alter role records_app password 'test'");
  await t.owner.query("update accounts.apps set redirect_uris = array['http://localhost:3006/auth/callback'], secret_hash = $1, url = 'http://localhost:3006' where key = 'records'", [sha256(RSECRET)]);
  const huda = (await t.owner.query("select id from patients where clinic_id = $1 and full_name = 'Huda Al-Khatib'", [t.clinicA])).rows[0].id;
  // Two example insurance companies (made-up numbers), Huda insured with the first.
  const mednet = (await t.owner.query(
    `insert into insurance_companies (clinic_id, name_en, name_ar, phone, email, address, contact_name, contact_title, contact_phone, notes) values
     ($1, 'MedNet', 'ميدنت', '+962 6 555 0101', 'approvals@example.jo', 'Amman, Shmeisani', 'Rana Haddad', 'Medical approvals', '+962 79 555 0199',
      'Approval needed before laser sessions. Patient brings the card at every visit.') returning id`, [t.clinicA])).rows[0].id;
  await t.owner.query("insert into insurance_companies (clinic_id, name_en, name_ar, phone) values ($1, 'NatHealth', 'نات هيلث', '+962 6 555 0102')", [t.clinicA]);
  await t.owner.query(`insert into patient_details (patient_id, clinic_id, file_no, birth_date, sex, insurance_status, insurance_company_id)
                       values ($1,$2,'00412','1992-03-14','female','insured',$3)`, [huda, t.clinicA, mednet]);
  await t.owner.query("update record_settings set next_file_no = 413 where clinic_id = $1", [t.clinicA]);
  for (const [kind, title, detail, alert] of [["allergy", "Penicillin", "hives", true], ["medicine", "Isotretinoin 20 mg", "daily with food; pregnancy test before each refill", true],
    ["medicine", "Levothyroxine 50 mcg", "from another doctor", false], ["condition", "Acne vulgaris, moderate", null, false], ["condition", "Hypothyroidism", "treated elsewhere", false],
    ["procedure", "Chemical peel (salicylic), 2024", "at another clinic", false]]) {
    await t.owner.query("insert into chart_entries (clinic_id, patient_id, kind, title, detail, alert, created_by, created_by_name) values ($1,$2,$3,$4,$5,$6,'demo','Dr Lina')",
      [t.clinicA, huda, kind, title, detail, alert]);
  }
  await t.owner.query("insert into chart_answers (patient_id, clinic_id, field_key, value, updated_by_name) values ($1,$2,'skin_type','III','Dr Lina')", [huda, t.clinicA]);
  // Phase C, switched on for the demo clinic: a laser course for Huda (three sessions done), the clinic's favourites, two forms,
  // a licence number for Dr Lina (Dr Omar has none, to show the warning), a signed note to summarise, and the AI summary with a
  // stand-in that never calls Claude.
  const laser = (await t.owner.query("select id from services where clinic_id = $1 order by (name_en ilike '%laser%') desc, sort limit 1", [t.clinicA])).rows[0].id;
  const pastDay = (daysAgo, h) => new Date(Date.parse(`${today}T00:00:00Z`) - daysAgo * 86400000 + (h - 3) * 3600000).toISOString();
  let lastPast = null;
  for (const daysAgo of [126, 84, 42]) {
    lastPast = (await t.owner.query("insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source, status) values ($1,$2,$3,$4,$5,$6,'staff','completed') returning id",
      [t.clinicA, ids.lina, laser, huda, pastDay(daysAgo, 9), pastDay(daysAgo, 9.5)])).rows[0].id;
  }
  await t.owner.query(`insert into treatment_courses (clinic_id, patient_id, service_id, sessions, every_weeks, note, starts_on, created_by, created_by_name)
                       values ($1,$2,$3,6,6,'Underarms',$4,'demo','Dr Lina')`, [t.clinicA, huda, laser, pastDay(127, 12).slice(0, 10)]);
  await t.owner.query(
    `insert into visit_notes (clinic_id, appointment_id, patient_id, doctor_id, kind, status, language, sections, content, signed_at, signed_by, signed_name, created_by)
     values ($1,$2,$3,$4,'manual','signed','en',$5,$6,$7,'demo','Dr Lina','demo')`,
    [t.clinicA, lastPast, huda, ids.lina, JSON.stringify([{ key: "assessment", en: "Assessment" }, { key: "plan", en: "Plan" }]),
     JSON.stringify({ assessment: "Acne much better on isotretinoin 20 mg (month 4 of 6); mild lip dryness.", plan: "Laser hair removal, underarms: session 3 done, good response. Continue isotretinoin." }),
     pastDay(42, 10)]);
  await t.owner.query("update doctors set licence_no = 'JMC-18342' where id = $1", [ids.lina]);
  await t.owner.query(`update record_settings set courses_on = true, rx_on = true, forms_on = true, summary_model = 'claude-haiku-5-5',
      course_defaults = $2, rx_favourites = $3 where clinic_id = $1`, [t.clinicA, JSON.stringify([{ serviceId: laser, sessions: 6, weeks: 6 }]),
      JSON.stringify([{ name: "Adapalene 0.1% gel", how: "Thin layer at night", days: 90, qty: "1 tube" }, { name: "Doxycycline 100 mg", how: "1 capsule daily after food", days: 30, qty: "30" },
        { name: "Sunscreen SPF 50", how: "Every morning, again after 2 hours outdoors", days: null, qty: "1" }])]);
  await t.owner.query(`insert into form_templates (clinic_id, title_en, title_ar, questions, minutes, sort) values ($1, 'Medical history', 'التاريخ الطبي', $2, 2, 1)`, [t.clinicA, JSON.stringify([
    { key: "allergic", en: "Are you allergic to any medicine?", ar: "هل لديك حساسية من أي دواء؟", kind: "yesno_details", required: true, goesTo: "allergy" },
    { key: "medicines", en: "Medicines you take now", ar: "الأدوية التي تأخذها حالياً", kind: "text", goesTo: "medicine" },
    { key: "pregnant", en: "Are you pregnant or breastfeeding?", ar: "هل أنتِ حامل أو مرضعة؟", kind: "yesno", goesTo: "field:pregnant" },
    { key: "goal", en: "What would you like from this visit?", ar: "ما الذي تريده من هذه الزيارة؟", kind: "text" }])]);
  await t.owner.query(`insert into form_templates (clinic_id, title_en, title_ar, questions, consent, agree_en, agree_ar, minutes, sort) values
    ($1, 'Laser consent', 'موافقة الليزر', $2, true, 'I agree to the laser treatment as explained to me, and that my answers are true.', 'أوافق على علاج الليزر كما شُرح لي، وأن إجاباتي صحيحة.', 1, 2)`,
    [t.clinicA, JSON.stringify([{ key: "tan", en: "Have you had a tan in the last 4 weeks?", ar: "هل اسمرّت بشرتك في آخر 4 أسابيع؟", kind: "yesno", required: true }])]);
  const rpool = new pg.Pool({ connectionString: "postgresql://records_app:test@localhost:54329/accounts_test", max: 4 });
  const rConfig = { ...common, siteUrl: "http://localhost:3006", origin: "http://localhost:3006", accountsUrl: "http://localhost:3003", accountsInternalUrl: "http://127.0.0.1:3003",
    bookingUrl: "http://localhost:3004", clientSecret: RSECRET, sessionCookie: "lc_records", stateCookie: "lc_rstate" };
  // Photos and documents in a throwaway folder; backups to another, with a throwaway key (emails only logged).
  const { createStorage } = await import("../../records/server/storage.js");
  const { createFiles } = await import("../../records/server/files.js");
  const { createBackups } = await import("../../records/server/backup.js");
  const os = await import("node:os"); const nodeCrypto = await import("node:crypto");
  const rtmp = fs.mkdtempSync(path.join(os.tmpdir(), "records-dev-"));
  rConfig.storage = { kind: "disk", dir: path.join(rtmp, "files") };
  rConfig.backup = { dir: path.join(rtmp, "backup"), keyFile: path.join(rtmp, "backup.key") };
  fs.mkdirSync(rConfig.backup.dir, { recursive: true }); fs.writeFileSync(rConfig.backup.keyFile, nodeCrypto.randomBytes(32));
  const rsvc = recordsService({ pool: rpool }), rstorage = createStorage(rConfig.storage);
  const rfiles = createFiles({ pool: rpool, svc: rsvc, storage: rstorage, secret: RSECRET, siteUrl: rConfig.siteUrl });
  const rbackups = createBackups({ pool: rpool, storage: rstorage, config: rConfig });
  const { createCourses } = await import("../../records/server/courses.js");
  const { createRx } = await import("../../records/server/rx.js");
  const { createForms } = await import("../../records/server/forms.js");
  const { createSummary, sampleSummarizer } = await import("../../records/server/summary.js");
  const rphase = { courses: createCourses({ pool: rpool, svc: rsvc }), rx: createRx({ pool: rpool, svc: rsvc }),
    forms: createForms({ pool: rpool, svc: rsvc, files: rfiles, siteUrl: rConfig.siteUrl }),
    summary: createSummary({ pool: rpool, svc: rsvc, storage: rstorage, summarizer: sampleSummarizer }) };
  recordsApp({ svc: rsvc, config: rConfig, files: rfiles, backups: rbackups, ...rphase }).listen(3006, "127.0.0.1", () => console.log("READY  Records http://localhost:3006   (doctor: dr@demo.jo)"));
  bkConfig.recordsUrl = "http://localhost:3006";
}
// Online visits (design: booking/design/online-visits.html): on for the demo clinic, Dr Lina with a Teams link, the first service
// offered online, Huda marked "Can book online visits" with an email, CliQ payment, and one online visit today. Emails are only logged.
await t.owner.query("update online_visits set enabled = true where clinic_id = $1", [t.clinicA]);
await t.owner.query("update doctors set online_enabled = true, online_min_notice_minutes = 60, teams_link = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo%40thread.v2/0' where id = $1", [ids.lina]);
await t.owner.query("update services set online_allowed = true where id = $1", [svc.id]);
await t.owner.query("update patients set online_allowed = true, email = 'huda@example.com' where clinic_id = $1 and full_name = 'Huda Al-Khatib'", [t.clinicA]);
await t.owner.query("update clinic_payment set cliq_enabled = true, cliq_alias = 'DEMODERMA', cliq_name = 'Limitsiz Demo Dermatology' where clinic_id = $1", [t.clinicA]);
{
  const p = await pat("Sami Online", "+962791110005");
  await t.owner.query(`insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, source, status, visit_type, online_mode, link_channel)
                       values ($1,$2,$3,$4,$5,$6,'phone','confirmed','online','audio','whatsapp')`, [t.clinicA, ids.lina, svc.id, p, at(14, 0), at(14, svc.duration_minutes)]);
}
const devMail = async (m) => { console.log(`[mail] visit link to ${m.to}: ${m.subject}`); return true; };
bookingApp({ svc: createService({ pool, auditPool, tidier: sampleTidier, recordsUrl: bkConfig.recordsUrl, mail: devMail }), config: bkConfig }).listen(3004, "127.0.0.1", () =>
  console.log(`READY  Booking http://localhost:3004   sign in: sec@demo.jo / ${GOOD}   (administrator admin@demo.jo needs two-step)`));
console.log(`Administrator admin@demo.jo has two-step on. Current code:  node -e "import('../accounts/server/crypto.js').then(m=>console.log(m.totp('${P.admin.secret}')))"  (run it in the repo's accounts/ folder... see README)`);
console.log(`ADMIN_SECRET=${P.admin.secret}`);
