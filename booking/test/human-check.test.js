// The human check on the online booking page (design: booking/design/human-check.html): Cloudflare Turnstile on the final button
// of each form the clinic chose. Cloudflare is never called here: a pretend Cloudflare (test/helpers.js, t.cf) plays its answers.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";
import { humanChecker, isTestSecret, VERIFY_URL } from "../server/human-check.js";

// ---------------------------------------------------------------- the checker on its own (no database)
const answer = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const make = (fetch, keys = {}) => humanChecker({ siteKey: "site", secret: "real-secret", ...keys }, { fetch, log: { warn() {} } });
const ask = (h, token = "tok") => h.check(token, { action: "book", hostname: "book.limitsiz.si", ip: "1.2.3.4" });

test("checker: passed only when Cloudflare says success for our hostname and this form", async () => {
  const sent = [];
  const h = make(async (url, init) => { sent.push({ url, ...JSON.parse(init.body) }); return answer(200, { success: true, action: "book", hostname: "book.limitsiz.si" })(); });
  assert.equal(await ask(h), "passed");
  assert.deepEqual(sent, [{ url: VERIFY_URL, secret: "real-secret", response: "tok", remoteip: "1.2.3.4" }], "only the token and the IP address go to Cloudflare");
  assert.equal(await ask(make(answer(200, { success: true, action: "find", hostname: "book.limitsiz.si" }))), "failed", "a token made for another form");
  assert.equal(await ask(make(answer(200, { success: true, action: "book", hostname: "evil.example" }))), "failed", "a token made on another site");
  assert.equal(await ask(make(answer(200, { success: false, "error-codes": ["timeout-or-duplicate"] }))), "failed", "used before or expired");
  assert.equal(await ask(make(answer(400, { success: false, "error-codes": ["invalid-input-response"] }))), "failed");
});

test("checker: a missing token is sent as 'none', so Cloudflare answering makes it a failure, not an outage", async () => {
  const sent = [];
  const h = make(async (url, init) => { sent.push(JSON.parse(init.body).response); return answer(200, { success: false, "error-codes": ["invalid-input-response"] })(); });
  assert.equal(await h.check(undefined, { action: "book", hostname: "book.limitsiz.si" }), "failed");
  assert.deepEqual(sent, ["none"]);
});

test("checker: unavailable only when Cloudflare itself doesn't answer", async () => {
  assert.equal(await ask(make(async () => { throw new TypeError("fetch failed"); })), "unavailable");
  assert.equal(await ask(make(answer(502, { oops: true }))), "unavailable");
  assert.equal(await ask(make(async () => new Response("not json", { status: 200 }))), "unavailable");
  assert.equal(await ask(make(answer(200, { success: false, "error-codes": ["internal-error"] }))), "unavailable");
  // No answer within the time allowed (TURNSTILE_TIMEOUT_MS).
  const slow = make((url, init) => new Promise((ok, no) => init.signal.addEventListener("abort", () => no(init.signal.reason))), { timeoutMs: 30 });
  assert.equal(await ask(slow), "unavailable");
});

test("checker: no keys, no check; Cloudflare's test keys pass without naming our page", async () => {
  assert.equal(humanChecker({ siteKey: "site", secret: "" }), null);
  assert.equal(humanChecker({ siteKey: "", secret: "x" }), null);
  assert.equal(humanChecker(), null);
  assert.ok(isTestSecret("1x0000000000000000000000000000000AA") && isTestSecret("2x0000000000000000000000000000000AA"));
  assert.ok(!isTestSecret("0x4AAAAAAAsomething") && !isTestSecret("real-secret"));
  const h = make(answer(200, { success: true, hostname: "example.com", action: "" }), { secret: "1x0000000000000000000000000000000AA" });
  assert.equal(await ask(h), "passed");
});

// ---------------------------------------------------------------- the booking page with the check
let t, ids, adm, P;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => {
  await t.reset(); ids = await t.seedIds();
  P = await t.people(); adm = (await t.login(P.admin, { mfa: P.admin.secret })).b;
});

// The test clock is Tuesday 2026-11-10 12:00 in Amman (UTC+3).
const DAY = "2026-11-11";
const at = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${DAY}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const SLUG = "demo-derma";
const ONLINE = {
  enabled: true, staffCheck: true, showPrices: false, allowAnyDoctor: true, allowCancel: true, allowReschedule: true, allowForOther: true,
  offerReminders: true, defaultCountryCode: "962", maxUncheckedPerPhone: 3, bookingsPerPhonePerDay: 5, bookingsPerIpPerDay: 50,
  lookupsPerIpPerMinute: 500, managePerIpPerHour: 100, daysPerPage: 7, introEn: null, introAr: null, doneNoteEn: null, doneNoteAr: null,
  shareMessageEn: "Book your appointment at {clinic} here: {link}", shareMessageAr: "احجز موعدك في {clinic} من هذا الرابط: {link}",
  privacyUrl: "https://limitsiz.si/privacy",
  findEnabled: false, findPerPhonePerDay: 3, findPerIpPerHour: 10,
  findMessageEn: "Your appointment at {clinic}: {when}, {doctor}. Your new private link to see the status, change or cancel: {link}",
  findMessageAr: "موعدك في {clinic}: {when}، {doctor}. رابطك الخاص الجديد لمعرفة حالة الحجز أو تعديله أو إلغائه: {link}",
  chatEnabled: true, chatMessagesPerChat: 30, chatChatsPerIpPerDay: 50, chatMessagesPerClinicPerDay: 500, chatKeepDays: 30,
  brochureColour: "#2EE6B5", brochureCardLanguages: "ar_en", brochureShowAi: true,
};
const turnOn = async (over = {}) => { const r = await adm.patch("/api/settings/online", { ...ONLINE, ...over }); assert.equal(r.status, 200, JSON.stringify(r.json)); t.forgetPublic(); };
const body = (over = {}) => ({ serviceId: ids.services[0].id, doctorId: ids.lina, startsAt: at("10:00"), name: "Huda Online", phone: "0791234567", language: "en", agree: true, ...over });
const book = (over) => t.pub("POST", `/api/c/${SLUG}/book`, body(over));
const row = async (id) => (await t.owner.query("select needs_check, human_check from appointments where id = $1", [id])).rows[0];
const count = async () => Number((await t.owner.query("select count(*) from appointments")).rows[0].count);
const info = async () => (await t.pub("GET", `/api/c/${SLUG}`)).json;
const csp = async () => (await fetch(`${t.publicBase}/api/c/${SLUG}`)).headers.get("content-security-policy");

test("keys not set: every form works as before, without a token, and the page is told nothing", async () => {
  await turnOn();
  assert.equal((await info()).options.humanCheck, null);
  assert.doesNotMatch(await csp(), /challenges\.cloudflare\.com/);
  const r = await book();
  assert.equal(r.status, 201);
  assert.deepEqual(await row(r.json.id), { needs_check: true, human_check: null });
  assert.equal(t.cf.calls.length, 0);
});

test("keys set: the page gets the site key and the forms, never the secret; the CSP lets Cloudflare's box load", async () => {
  t.cf.keys = true;
  await turnOn();
  const i = await info();
  assert.deepEqual(i.options.humanCheck, { siteKey: "site-key-for-tests", forms: ["book", "chat_book", "callback", "find"] });
  assert.ok(!JSON.stringify(i).includes("secret-for-tests"));
  const policy = await csp();
  assert.match(policy, /script-src 'self' https:\/\/challenges\.cloudflare\.com; frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.match(policy, /frame-ancestors 'none'/, "nobody may frame our page, as before");
  await turnOn({ humanCheck: false });
  assert.equal((await info()).options.humanCheck, null, "the clinic switched it off");
});

test("booking page: no or bad token is refused and nothing is saved; a good one books and is recorded as passed", async () => {
  t.cf.keys = true;
  await turnOn();
  for (const human of [undefined, "bad", "good:find"]) {
    const r = await book({ human });
    assert.equal(r.status, 403, String(human)); assert.equal(r.json.error, "human_check_failed");
  }
  assert.equal(await count(), 0, "nothing saved");
  assert.equal((await book({ human: "x".repeat(2049) })).status, 400, "a token is at most 2048 characters");
  const r = await book({ human: "good:book" });
  assert.equal(r.status, 201);
  assert.deepEqual(await row(r.json.id), { needs_check: true, human_check: "passed" });
  const sent = t.cf.calls.at(-1);
  assert.equal(sent.response, "good:book"); assert.equal(sent.secret, "secret-for-tests"); assert.ok(sent.remoteip);
  assert.ok(!JSON.stringify(t.cf.calls).includes("0791234567") && !JSON.stringify(t.cf.calls).includes("Huda"), "no name or number goes to Cloudflare");
});

test("a token made on another site is refused", async () => {
  t.cf.keys = true; t.cf.hostname = "evil.example";
  await turnOn();
  assert.equal((await book({ human: "good:book" })).json.error, "human_check_failed");
});

test("the hidden field and the per-connection limit come first: Cloudflare is not asked", async () => {
  t.cf.keys = true;
  await turnOn({ bookingsPerIpPerDay: 1 });
  assert.equal((await book({ website: "bot" })).status, 201, "bots still see success");
  assert.equal(t.cf.calls.length, 0);
  assert.equal(await count(), 0);
  // The fake success above used the one booking this connection has today.
  assert.equal((await book({ human: "good:book" })).status, 429);
  assert.equal(t.cf.calls.length, 0);
});

test("a refused number: the check comes first, and a passed check gets the usual same answer", async () => {
  t.cf.keys = true;
  await turnOn({ bookingsPerPhonePerDay: 1 });
  assert.equal((await book({ human: "good:book" })).status, 201);
  assert.equal((await book({ human: "bad", startsAt: at("11:00") })).json.error, "human_check_failed", "the same failure as for any number");
  assert.equal((await book({ human: "good:book", startsAt: at("11:00") })).json.error, "phone_not_accepted");
});

test("a form the clinic didn't choose is not checked", async () => {
  t.cf.keys = true;
  await turnOn({ humanCheckForms: ["find"] });
  assert.equal((await book()).status, 201);
  assert.equal(t.cf.calls.length, 0);
});

test("Cloudflare down, let through: saved as skipped and always for a secretary to check, at most the hourly allowance", async () => {
  t.cf.keys = true; t.cf.answer = "down";
  await turnOn({ staffCheck: false, humanCheckSkipPerHour: 2 });
  const a = await book({ human: "good:book" });
  assert.equal(a.status, 201);
  assert.deepEqual(await row(a.json.id), { needs_check: true, human_check: "skipped" }, "marked even though the clinic doesn't check online bookings");
  assert.equal(a.json.waitingForCheck, true);
  t.cf.answer = "500";
  assert.equal((await book({ startsAt: at("11:00") })).status, 201, "a Cloudflare server error is an outage too");
  const third = await book({ startsAt: at("12:00") });
  assert.equal(third.status, 503); assert.equal(third.json.error, "human_check_unavailable");
  assert.equal(await count(), 2);
  // The next hour has a new allowance.
  t.clock.t += 3_600_001;
  assert.equal((await book({ startsAt: at("12:00") })).status, 201);
});

test("Cloudflare down: 'stop', or an allowance of 0, refuses every booking", async () => {
  t.cf.keys = true; t.cf.answer = "down";
  await turnOn({ humanCheckDown: "stop" });
  assert.equal((await book({ human: "good:book" })).json.error, "human_check_unavailable");
  await turnOn({ humanCheckDown: "let_through", humanCheckSkipPerHour: 0 });
  assert.equal((await book({ human: "good:book" })).json.error, "human_check_unavailable");
  assert.equal(await count(), 0);
});

test("chat: 'Yes, book it' and 'Call me back' are checked; starting a chat only when the clinic chose it", async () => {
  t.cf.keys = true;
  await turnOn();
  const chat = (path, b) => t.pub("POST", `/api/c/${SLUG}/chat${path}`, b);
  const id = (await chat("", {})).json.chatId;
  assert.ok(id, "starting a chat is not checked by default");
  t.agent.next.push({ reply: "Press Yes.", proposal: { serviceId: ids.services[0].id, doctorId: ids.lina, startsAt: at("10:00"), serviceEn: "Consultation", serviceAr: "استشارة",
    doctorEn: "Dr. Lina", doctorAr: "د. لينا", summary: "Consultation with Dr. Lina on Wednesday at 10:00" } });
  await chat(`/${id}/message`, { text: "10:00" });
  const yes = (human) => chat(`/${id}/book`, { name: "Huda Chat", phone: "0791234567", language: "en", agree: true, human });
  assert.equal((await yes("good:book")).json.error, "human_check_failed", "a token made for the booking page's button");
  assert.equal(await count(), 0);
  const b = await yes("good:chat_book");
  assert.equal(b.status, 201);
  assert.equal((await row(b.json.id)).human_check, "passed");

  const cb = (human) => chat(`/${id}/callback`, { name: "Huda Chat", phone: "0791234567", human });
  assert.equal((await cb()).json.error, "human_check_failed");
  assert.equal((await cb("good:callback")).status, 201);
  assert.deepEqual((await t.owner.query("select human_check from web_callbacks")).rows, [{ human_check: "passed" }]);

  await turnOn({ humanCheckForms: ["chat_start"] });
  assert.equal((await chat("", {})).json.error, "human_check_failed");
  assert.equal((await chat("", { human: "good:chat_start" })).status, 201);
});

test("Find my booking: checked first, then the same answer for every number", async () => {
  t.cf.keys = true;
  await turnOn({ findEnabled: true });
  await t.owner.query("update clinics set wa_phone_number_id = '1234567890' where slug = $1", [SLUG]);
  t.forgetPublic();
  const find = (phone, human) => t.pub("POST", `/api/c/${SLUG}/find`, { phone, human });
  assert.equal((await find("0791234567")).json.error, "human_check_failed");
  const known = await find("0791234567", "good:find"), unknown = await find("0781112222", "good:find");
  assert.equal(known.status, 202); assert.deepEqual(known.json, unknown.json);
});

test("Settings: only administrators change it, the values are checked, every change is audited; staff bookings are never checked", async () => {
  let s = (await adm.get("/api/settings")).json;
  assert.equal(s.humanCheckReady, false, "the keys are not in this server's .env");
  assert.deepEqual([s.online.human_check, s.online.human_check_forms, s.online.human_check_down, s.online.human_check_skip_per_hour],
    [true, ["book", "chat_book", "callback", "find"], "let_through", 10], "on by default, working once the keys are set");
  t.config.humanCheckReady = true;
  try { assert.equal((await adm.get("/api/settings")).json.humanCheckReady, true); } finally { t.config.humanCheckReady = false; }
  assert.equal((await adm.patch("/api/settings/online", { ...ONLINE, humanCheckForms: ["book", "everything"] })).status, 400);
  assert.equal((await adm.patch("/api/settings/online", { ...ONLINE, humanCheckSkipPerHour: 501 })).status, 400);
  assert.equal((await adm.patch("/api/settings/online", { ...ONLINE, humanCheckDown: "maybe" })).status, 400);
  await turnOn({ humanCheckForms: ["find", "find", "book"], humanCheckDown: "stop", humanCheckSkipPerHour: 0 });
  s = (await adm.get("/api/settings")).json.online;
  assert.deepEqual([s.human_check_forms, s.human_check_down, s.human_check_skip_per_hour], [["find", "book"], "stop", 0]);
  await turnOn();
  assert.deepEqual((await adm.get("/api/settings")).json.online.human_check_forms, ["find", "book"], "left out of the body: kept");
  const sec = (await t.login(P.secretary)).b;
  assert.equal((await sec.patch("/api/settings/online", { ...ONLINE, humanCheck: false })).status, 403);
  const ev = (await t.owner.query("select count(*)::int as n from audit.events where entity = 'online_booking' and after->>'human_check_down' = 'stop'")).rows[0];
  assert.ok(ev.n >= 1, "audited");

  t.cf.keys = true;
  const staff = await sec.post("/api/appointments", { serviceId: ids.services[0].id, doctorId: ids.lina, startsAt: at("10:15"), source: "phone",
    newPatient: { fullName: "Phone Patient", phone: "0795554444" } });
  assert.equal(staff.status, 201);
  assert.equal((await row(staff.json.id)).human_check, null);
  assert.equal(t.cf.calls.length, 0);
});
