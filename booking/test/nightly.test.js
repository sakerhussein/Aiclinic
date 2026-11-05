import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";
import { runNightly, startNightly, dateIn, hourIn } from "../server/nightly.js";

let t, P, adm, mails, day = 0;
const send = async (m) => { mails.push(m); return true; };
// Every run in these tests is a new "night": the table of anchors outlives each test, as it does in real life.
const night = () => `2030-${String(1 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day++ % 28)).padStart(2, "0")}`;
const run = (runDate = night()) => runNightly({ pool: t.pool, send, runDate });
const of = (r, name) => r.results.find((x) => x.clinic.includes(name));
const log = (n) => t.pool.query("select audit.log($1,'patient',$2,'updated')", [t.clinicA, n]);

before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); P = await t.people(); adm = (await t.login(P.admin, { mfa: P.admin.secret })).b; mails = []; });

async function asOwner(fn) {
  await t.owner.query("alter table audit.events disable trigger events_no_update_delete");
  try { await fn(); } finally { await t.owner.query("alter table audit.events enable trigger events_no_update_delete"); }
}

test("a good night: every clinic and the platform are checked, and the hashes are emailed", async () => {
  await log("a");
  const r = await run();
  const demo = of(r, "Demo");
  assert.equal(demo.ok, true);
  assert.equal(demo.anchor_ok, true);
  assert.equal(demo.head_hash.length, 64);
  assert.ok(of(r, "Other") && of(r, "platform"), "the other clinic and the platform too");
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /all intact/);
  assert.ok(mails[0].text.includes(demo.head_hash), "the email carries the newest hash");
  assert.ok(mails[0].text.includes("Keep this email"));
  const s = (await adm.get("/api/audit/status")).json;
  assert.equal(s.lastCheck.ok, true);
  assert.equal(s.lastCheck.by, "Nightly audit job");
});

test("a night runs once, however often the job starts", async () => {
  const date = night();
  const first = await run(date);
  const second = await run(date);
  assert.equal(of(first, "Demo").already, false);
  assert.equal(of(second, "Demo").already, true);
  assert.equal(second.emailed, false);
  assert.equal(mails.length, 1);
  assert.equal(of(second, "Demo").head_hash, of(first, "Demo").head_hash);
});

test("a changed entry raises the alarm, names the entry, and nothing is removed from that chain", async () => {
  await t.owner.query("update clinic_settings set audit_retention_months = 12 where clinic_id = $1", [t.clinicA]);
  await log("before");
  const target = (await t.owner.query("select seq, reason from audit.events where chain_key = $1 order by seq desc limit 1", [t.clinicA])).rows[0];
  await asOwner(() => t.owner.query("update audit.events set reason = 'tampered' where chain_key = $1 and seq = $2", [t.clinicA, target.seq]));
  try {
    const r = await run();
    assert.equal(of(r, "Demo").ok, false);
    assert.equal(Number(of(r, "Demo").broken_seq), Number(target.seq));
    assert.equal(Number(of(r, "Demo").removed), 0);
    assert.match(mails[0].subject, /^ALERT/);
    assert.match(mails[0].text, new RegExp(`BROKEN at entry ${target.seq}`));
    const last = (await adm.get("/api/audit/status")).json.lastCheck;
    assert.deepEqual([last.ok, Number(last.brokenSeq)], [false, Number(target.seq)], "the page shows it too, with the entry");
  } finally {
    await asOwner(() => t.owner.query("update audit.events set reason = $3 where chain_key = $1 and seq = $2", [t.clinicA, target.seq, target.reason]));
  }
});

test("entries removed from the end of a chain, which hashes alone cannot show, are caught next night", async () => {
  await run();                                               // tonight's anchor records the newest entry
  await t.owner.query("delete from audit.anchors where false");
  const head = (await t.owner.query("select seq from audit.events where chain_key = $1 order by seq desc limit 1", [t.clinicA])).rows[0].seq;
  await asOwner(() => t.owner.query("delete from audit.events where chain_key = $1 and seq = $2", [t.clinicA, head]));
  const r = await run();
  assert.equal(of(r, "Demo").ok, true, "the chain itself still looks fine");
  assert.equal(of(r, "Demo").anchor_ok, false, "but last night's newest entry has gone");
  assert.match(mails.at(-1).subject, /^ALERT/);
  assert.ok(mails.at(-1).text.includes("ENTRIES MISSING"));
  await run();                                               // the next night compares with the new anchor, so this test leaves the chain usable
});

test("retention: forever keeps everything; the floor is 12 months whatever the setting says", async () => {
  const cut = async () => (await t.owner.query("select audit.retention_cutoff($1) as c", [t.clinicA])).rows[0].c;
  assert.equal(await cut(), null);
  await t.owner.query("update clinic_settings set audit_retention_months = 24 where clinic_id = $1", [t.clinicA]);
  const c24 = await cut();
  assert.ok(Date.now() - c24 > 720 * 86400000 && Date.now() - c24 < 740 * 86400000);
  await assert.rejects(t.owner.query("update clinic_settings set audit_retention_months = 3 where clinic_id = $1", [t.clinicA]), /check/);
  await t.owner.query("update clinic_settings set audit_retention_months = 12 where clinic_id = $1", [t.clinicA]);
  await log("fresh");
  const before2 = (await t.owner.query("select count(*)::int n from audit.events where chain_key = $1", [t.clinicA])).rows[0].n;
  const r = await run();
  assert.equal(Number(of(r, "Demo").removed), 0, "nothing here is 12 months old");
  assert.ok((await t.owner.query("select count(*)::int n from audit.events where chain_key = $1", [t.clinicA])).rows[0].n > before2);
});

test("old entries go through a checkpoint: the chain still verifies, tampering is still caught, the removal is recorded", async () => {
  // A private clinic, so this does not disturb the other tests' chain.
  const c = (await t.owner.query("insert into clinics (slug, name_en, name_ar) values ('purge', 'Purge Test', 'تجربة') returning id")).rows[0].id;
  try {
    for (let i = 0; i < 6; i++) await t.owner.query("select audit.log($1,'patient',$2,'updated')", [c, `p${i}`]);
    const before2 = (await t.owner.query("select count(*)::int n, max(seq) m from audit.events where chain_key = $1", [c])).rows[0];
    const cutoff = new Date(Date.now() + 60000);                // the owner-only step, with a cutoff the nightly job could never choose
    const removed = (await t.owner.query("select audit.purge_before($1, $2) as n", [c, cutoff])).rows[0].n;
    assert.equal(Number(removed), before2.n - 1, "all but the newest");
    const left = (await t.owner.query("select seq, action from audit.events where chain_key = $1 order by seq", [c])).rows;
    assert.equal(left.at(-1).action, "retention_purged");
    assert.equal(left.length, 2);
    const v = (await t.pool.query("select * from audit.verify($1)", [c])).rows[0];
    assert.equal(v.ok, true, "the chain verifies from the checkpoint");
    const cp = (await t.owner.query("select seq, removed from audit.checkpoints where chain_key = $1", [c])).rows[0];
    assert.equal(Number(cp.removed), before2.n - 1);
    await t.pool.query("select audit.log($1,'patient','after','updated')", [c]);
    assert.equal((await t.pool.query("select * from audit.verify($1)", [c])).rows[0].ok, true, "the chain carries on");
    const first = left[0].seq;
    await asOwner(() => t.owner.query("update audit.events set reason = 'x' where chain_key = $1 and seq = $2", [c, first]));
    const bad = (await t.pool.query("select * from audit.verify($1)", [c])).rows[0];
    assert.deepEqual([bad.ok, Number(bad.broken_seq)], [false, Number(first)]);
    await asOwner(() => t.owner.query("update audit.events set reason = null where chain_key = $1 and seq = $2", [c, first]));
  } finally {
    await t.owner.query("delete from clinics where id = $1", [c]);
  }
});

test("nobody else can remove entries, change checkpoints or anchors, or read them", async () => {
  const roles = [["Booking", t.pool], ["Accounts", t.core.pool]];
  for (const [who, pool] of roles) {
    await assert.rejects(pool.query("select audit.purge_before($1, now())", [t.clinicA]), /permission denied/, who);
    await assert.rejects(pool.query("select audit.retention_cutoff($1)", [t.clinicA]), /permission denied/, who);
    await assert.rejects(pool.query("select * from audit.checkpoints"), /permission denied/, who);
    await assert.rejects(pool.query("select * from audit.anchors"), /permission denied/, who);
    await assert.rejects(pool.query("delete from audit.events"), /permission denied/, who);
    await assert.rejects(pool.query("begin; set local audit.purge = 'on'; delete from audit.events; commit"), /permission denied/, who);
    await pool.query("rollback").catch(() => {});
  }
  await assert.rejects(t.core.pool.query("select * from audit.nightly($1, '2031-01-01')", [t.clinicA]), /permission denied/);
  await assert.rejects(t.owner.query("delete from audit.events"), /append-only/, "even the owner, without the job");
  await assert.rejects(t.owner.query("delete from audit.anchors"), /append-only/);
  await assert.rejects(t.owner.query("update audit.checkpoints set hash = 'x'").then(async () => { await t.owner.query("delete from audit.checkpoints"); }), /append-only/);
});

test("the schedule: not before the hour, then once a day, and a failure tries again", async () => {
  let clock = new Date("2031-03-10T22:00:00Z");              // 01:00 on the 11th in Amman
  const runs = [];
  let fail = false;
  const pool = { query: async (sql, p) => {
    if (/from clinics/.test(sql)) return { rows: [{ id: "c", name_en: "C" }] };
    if (fail) throw new Error("database is away");
    runs.push(p[1]);
    return { rows: [{ already: false, ok: true, anchor_ok: true, removed: 0, checked: 1, head_seq: 1, head_hash: "h" }] };
  } };
  const quiet = { log() {}, error() {} };
  const job = startNightly({ pool, send: async () => true, tz: "Asia/Amman", hour: 2, now: () => clock, log: quiet });
  await job.tick();
  assert.equal(runs.length, 0, "not before 02:00");
  clock = new Date("2031-03-10T22:30:00Z");                  // 01:30 on the 11th
  await job.tick();
  assert.equal(runs.length, 0);
  clock = new Date("2031-03-10T23:30:00Z"); fail = true;     // 02:30, database away
  await job.tick();
  assert.equal(runs.length, 0);
  fail = false; clock = new Date("2031-03-10T23:40:00Z");
  await job.tick();
  assert.deepEqual(runs, ["2031-03-11", "2031-03-11"], "the clinic and the platform");
  await job.tick();
  assert.equal(runs.length, 2, "once a day");
  clock = new Date("2031-03-11T20:00:00Z");                  // 23:00 on the 11th: already done today
  await job.tick();
  assert.equal(runs.length, 2);
  clock = new Date("2031-03-12T20:00:00Z");                  // 23:00 on the 12th, the service was down all night: it catches up
  await job.tick();
  assert.equal(runs.at(-1), "2031-03-12");
  job.stop();
  assert.equal(dateIn(new Date("2031-03-10T22:30:00Z"), "Asia/Amman"), "2031-03-11");
  assert.equal(hourIn(new Date("2031-03-10T23:30:00Z"), "Asia/Amman"), 2);
});

test("no email settings: the check still runs and says so", async () => {
  const { createMailer } = await import("../server/nightly.js");
  const logged = [];
  const quietSend = createMailer({ smtp: null, anchorEmail: null }, { log: (m) => logged.push(m) });
  const r = await runNightly({ pool: t.pool, send: quietSend, runDate: night() });
  assert.equal(r.emailed, false);
  assert.match(logged[0], /not sent/);
  assert.equal(of(r, "Demo").ok, true);
});
