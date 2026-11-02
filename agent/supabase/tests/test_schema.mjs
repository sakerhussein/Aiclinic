// Runs the booking migration and seed on a throwaway Postgres 17, then checks the rules it must enforce.
// usage: node test_schema.mjs <node_modules dir> <migration.sql> <seed.sql> <data dir>
import fs from "node:fs";
import { createRequire } from "node:module";
const [modDir, migration, seed, dataDir] = process.argv.slice(2);
const require = createRequire(modDir + "/x.js");
const EmbeddedPostgres = require("embedded-postgres").default;
const { Client } = require("pg");

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "test", port: 54329, persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
fs.rmSync(dataDir, { recursive: true, force: true });
await pg.initialise();
await pg.start();
await pg.createDatabase("booking");
const db = new Client({ host: "localhost", port: 54329, user: "postgres", password: "test", database: "booking" });
await db.connect();

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };
const rejects = async (name, sql, params, code) => {
  try { await db.query(sql, params); ok(`${name} (was accepted!)`, false); }
  catch (e) { ok(`${name} -> ${e.code} ${e.constraint || ""}`.trim(), !code || e.code === code); }
};

try {
  console.log("Postgres", (await db.query("show server_version")).rows[0].server_version);
  await db.query(fs.readFileSync(migration, "utf8"));
  ok("migration runs", true);
  await db.query(fs.readFileSync(seed, "utf8"));
  await db.query(fs.readFileSync(seed, "utf8"));
  ok("seed runs twice", true);

  const C = "00000000-0000-4000-8000-000000000001", D1 = "00000000-0000-4000-8000-0000000000d1",
    D2 = "00000000-0000-4000-8000-0000000000d2", S1 = "00000000-0000-4000-8000-0000000000b1";
  const counts = (await db.query(`select (select count(*) from doctors) d, (select count(*) from services) s,
    (select count(*) from doctor_services) ds, (select count(*) from working_hours) wh, (select count(*) from clinic_faqs) f`)).rows[0];
  ok(`seed counts ${JSON.stringify(counts)}`, counts.d == 2 && counts.s == 5 && counts.ds == 8 && counts.wh == 17 && counts.f == 5);

  const P = (await db.query(`insert into patients (clinic_id, phone_e164, full_name) values ($1, '+962791234567', 'Test') returning id`, [C])).rows[0].id;
  await rejects("same phone twice in one clinic", `insert into patients (clinic_id, phone_e164) values ($1, '+962791234567')`, [C], "23505");
  await rejects("phone not in +E.164 form", `insert into patients (clinic_id, phone_e164) values ($1, '0791234567')`, [C], "23514");

  const book = (doc, start, end, status = "booked") => db.query(
    `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at, status)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`, [C, doc, S1, P, start, end, status]);
  const A = (await book(D1, "2026-12-06 10:00+03", "2026-12-06 10:20+03")).rows[0].id;
  ok("first booking accepted", !!A);
  await rejects("overlapping booking, same doctor", `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at)
     values ($1, $2, $3, $4, '2026-12-06 10:10+03', '2026-12-06 10:30+03')`, [C, D1, S1, P], "23P01");
  ok("back-to-back booking accepted (10:20)", !!(await book(D1, "2026-12-06 10:20+03", "2026-12-06 10:40+03")).rows[0].id);
  ok("same time, other doctor accepted", !!(await book(D2, "2026-12-06 10:00+03", "2026-12-06 10:20+03")).rows[0].id);
  await db.query(`update appointments set status = 'cancelled' where id = $1`, [A]);
  ok("slot free again after cancelling", !!(await book(D1, "2026-12-06 10:00+03", "2026-12-06 10:20+03")).rows[0].id);
  await rejects("re-activating the cancelled one now overlaps", `update appointments set status = 'booked' where id = $1`, [A], "23P01");
  const u = (await db.query(`select updated_at > created_at as moved from appointments where id = $1`, [A])).rows[0];
  ok("updated_at changes on update", u.moved);
  await rejects("end before start", `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at)
     values ($1, $2, $3, $4, '2026-12-07 11:00+03', '2026-12-07 10:00+03')`, [C, D1, S1, P], "23514");

  // A second clinic must not be able to use the first clinic's doctor, service or patient.
  const C2 = (await db.query(`insert into clinics (slug, name_en, name_ar) values ('other', 'Other', 'أخرى') returning id`)).rows[0].id;
  await rejects("other clinic books clinic 1's doctor", `insert into appointments (clinic_id, doctor_id, service_id, patient_id, starts_at, ends_at)
     values ($1, $2, $3, $4, '2026-12-08 10:00+03', '2026-12-08 10:20+03')`, [C2, D1, S1, P], "23503");
  ok("same phone allowed in another clinic", !!(await db.query(`insert into patients (clinic_id, phone_e164) values ($1, '+962791234567') returning id`, [C2])).rows[0].id);
  await rejects("overlapping working hours for a doctor", `insert into working_hours (clinic_id, doctor_id, weekday, start_time, end_time) values ($1, $2, 0, '13:00', '15:00')`, [C, D1], "23P01");

  const conv = (await db.query(`insert into conversations (clinic_id, patient_id, wa_phone) values ($1, $2, '+962791234567') returning id`, [C, P])).rows[0].id;
  await db.query(`insert into messages (clinic_id, conversation_id, direction, body, wa_message_id) values ($1, $2, 'in', 'مرحبا', 'wamid.1')`, [C, conv]);
  await rejects("same WhatsApp message stored twice", `insert into messages (clinic_id, conversation_id, direction, body, wa_message_id) values ($1, $2, 'in', 'مرحبا', 'wamid.1')`, [C, conv], "23505");
  await rejects("unknown handoff reason", `insert into handoffs (clinic_id, conversation_id, reason) values ($1, $2, 'bored')`, [C, conv], "23514");

  const rls = (await db.query(`select count(*) filter (where not relrowsecurity) off, count(*) n from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'`)).rows[0];
  ok(`row level security on for all ${rls.n} tables`, rls.off == 0 && rls.n == 12);
} catch (e) {
  ok("unexpected error: " + e.message, false);
} finally {
  await db.end();
  await pg.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
