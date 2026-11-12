// Online visits on Microsoft Teams, phase 1 (design: booking/design/online-visits.html, migration 0024).
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setup } from "./helpers.js";

let t, ids, P, adm, sec;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });
beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  adm = (await t.login(P.admin, { mfa: P.admin.secret })).b;
  sec = (await t.login(P.secretary)).b;
});

// The test clock is Tuesday 2026-11-10 12:00 in Amman (UTC+3).
const DAY = "2026-11-11";
const at = (hhmm, day = DAY) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };
const SLUG = "demo-derma";
const LINK = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_test%40thread.v2/0";
const svc = () => ids.services[0];
const OV = {
  enabled: true, mode: "audio", staffChangeMode: true, whoCanBook: "marked", linkWhen: "confirmed", joinOpensMinutes: 10, joinClosesMinutes: 15,
  channels: ["whatsapp", "email", "print"], patientPicks: true, defaultChannel: "whatsapp", printSize: "a6", printLanguages: "patient", nextVisitDays: [7, 14, 30],
  consentEn: "I agree to an online visit.", consentAr: "أوافق على زيارة أونلاين.", howToEn: "Install Teams.", howToAr: "نزّل Teams.",
  messageEn: "{clinic}: your online visit with {doctor} on {when}. Join: {link}", messageAr: "{clinic}: زيارتك أونلاين مع {doctor} {when}. ادخل من: {link}",
  emailSubjectEn: "Your online visit link – {clinic}", emailSubjectAr: "رابط زيارتك أونلاين – {clinic}",
};
const PAGE = {
  enabled: true, staffCheck: true, showPrices: true, allowAnyDoctor: true, allowCancel: true, allowReschedule: true, allowForOther: true,
  offerReminders: true, defaultCountryCode: "962", maxUncheckedPerPhone: 5, bookingsPerPhonePerDay: 5, bookingsPerIpPerDay: 50,
  lookupsPerIpPerMinute: 500, managePerIpPerHour: 500, daysPerPage: 7, introEn: null, introAr: null, doneNoteEn: null, doneNoteAr: null,
  shareMessageEn: "Book at {clinic}: {link}", shareMessageAr: "احجز في {clinic}: {link}", privacyUrl: "https://limitsiz.si/privacy",
  findEnabled: false, findPerPhonePerDay: 3, findPerIpPerHour: 10,
  findMessageEn: "{clinic} {when} {doctor} {link}", findMessageAr: "{clinic} {when} {doctor} {link}",
  chatEnabled: false, chatMessagesPerChat: 30, chatChatsPerIpPerDay: 5, chatMessagesPerClinicPerDay: 500, chatKeepDays: 30,
  brochureColour: "#2EE6B5", brochureCardLanguages: "ar_en", brochureShowAi: true,
};
async function onlineOn(over = {}, doctor = {}) {
  assert.equal((await adm.patch("/api/settings/online", PAGE)).status, 200);
  assert.equal((await adm.patch("/api/settings/online-visits", { ...OV, onlineServiceIds: [svc().id], ...over })).status, 200);
  assert.equal((await adm.patch(`/api/settings/doctors/${ids.lina}/online`, { onlineEnabled: true, onlineMinNoticeMinutes: 60, teamsLink: LINK, ...doctor })).status, 200);
  t.forgetPublic();
}
const free = async (day = DAY) => (await sec.get(`/api/slots?service=${svc().id}&doctor=${ids.lina}&date=${day}`)).json.map((s) => s.startsAt);
const staffBook = (startsAt, over = {}) => sec.post("/api/appointments", { serviceId: svc().id, doctorId: ids.lina, startsAt, source: "phone",
  newPatient: { fullName: "Omar Online", phone: "0790000001" }, visitType: "online", onlineMode: "audio", linkChannel: "whatsapp", ...over });
const pageBook = (startsAt, over = {}) => t.pub("POST", `/api/c/${SLUG}/book`, { serviceId: svc().id, doctorId: ids.lina, startsAt, name: "Huda Online",
  phone: "0791234567", language: "en", agree: true, visitType: "online", onlineConsent: true, linkChannel: "whatsapp", ...over });
const join = (token, slug = SLUG) => t.pub("POST", `/api/c/${slug}/join`, { token });
const tokenOf = (url) => url.split("#")[1];

test("Settings › Online visits, Payment and the doctor's online settings: administrators only, checked, and the consent keeps versions", async () => {
  assert.equal((await sec.patch("/api/settings/online-visits", OV)).status, 403);
  assert.equal((await adm.patch("/api/settings/online-visits", { ...OV, messageEn: "no link" })).status, 400, "the message must hold {link}");
  assert.equal((await adm.patch("/api/settings/online-visits", { ...OV, defaultChannel: "sms" })).json.error, "invalid_value", "the first choice must be switched on");
  await onlineOn();
  let s = (await adm.get("/api/settings")).json;
  assert.equal(s.onlineVisits.visits.enabled, true);
  assert.equal(s.onlineVisits.visits.mode, "audio", "audio only is the clinic default");
  const v0 = s.onlineVisits.visits.consent_version;
  assert.equal(s.services.find((x) => x.id === svc().id).online_allowed, true);
  assert.equal(s.services.filter((x) => x.online_allowed).length, 1, "only the service chosen");
  assert.equal(s.doctors.find((d) => d.id === ids.lina).teams_link, LINK);
  await adm.patch("/api/settings/online-visits", { ...OV, consentEn: "A new consent text." });
  s = (await adm.get("/api/settings")).json;
  assert.equal(s.onlineVisits.visits.consent_version, v0 + 1, "a changed consent text is a new version");
  await adm.patch("/api/settings/online-visits", { ...OV, consentEn: "A new consent text." });
  assert.equal((await adm.get("/api/settings")).json.onlineVisits.visits.consent_version, v0 + 1, "the same text again: the same version");
  const bad = await adm.patch(`/api/settings/doctors/${ids.lina}/online`, { onlineEnabled: true, onlineMinNoticeMinutes: 60, teamsLink: "https://evil.example.com/x" });
  assert.equal(bad.json.error, "invalid_teams_link");
  assert.equal((await adm.patch("/api/settings/payment", { cliqEnabled: true, cliqAlias: "", cliqName: "", payWhen: "before", forOnline: true, noteEn: "x", noteAr: "x" })).json.error,
    "cliq_details_needed");
  assert.equal((await sec.patch("/api/settings/payment", { cliqEnabled: false, payWhen: "before", forOnline: true, noteEn: "x", noteAr: "x" })).status, 403);
  const lk = (await sec.get("/api/lookups")).json;
  assert.equal(lk.online.enabled, true);
  assert.equal(lk.doctors.find((d) => d.id === ids.lina).online_enabled, true);
  assert.equal(lk.doctors.find((d) => d.id === ids.lina).teams_link, undefined, "the lookups say whether there is a link, never the link");
});

test("staff book an online visit: online on, a service offered online, a doctor who offers them; only warned inside the doctor's buffer", async () => {
  const [t1] = await free();
  assert.equal((await staffBook(t1)).json.error, "online_visits_off");
  await onlineOn({ onlineServiceIds: [] });
  assert.equal((await staffBook(t1)).json.error, "service_not_online");
  await onlineOn({}, { onlineEnabled: false });
  assert.equal((await staffBook(t1)).json.error, "doctor_not_online");
  await onlineOn({}, { onlineMinNoticeMinutes: 2880 });                       // two days
  const r1 = await staffBook(t1);
  assert.equal(r1.status, 409); assert.equal(r1.json.error, "inside_online_buffer"); assert.equal(r1.json.minutes, 2880);
  const r2 = await staffBook(t1, { allowInsideBuffer: true });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.visit_type, "online"); assert.equal(r2.json.online_mode, "audio"); assert.equal(r2.json.link_channel, "whatsapp");
  const today = (await sec.get(`/api/today-line`)).json;
  assert.equal(typeof today.online, "number");
  const list = (await sec.get(`/api/appointments?from=${DAY}&to=${DAY}&visit=online`)).json;
  assert.deepEqual(list.map((a) => a.id), [r2.json.id]);
  assert.equal((await sec.get(`/api/appointments?from=${DAY}&to=${DAY}&visit=in_clinic`)).json.length, 0);
  // Back to the clinic, and online again.
  const back = await sec.patch(`/api/appointments/${r2.json.id}`, { expectedVersion: r2.json.row_version, visitType: "in_clinic" });
  assert.equal(back.status, 200); assert.equal(back.json.visit_type, "in_clinic"); assert.equal(back.json.online_mode, null);
  const email = await staffBook((await free())[2], { newPatient: { fullName: "No Mail", phone: "0790000002" }, linkChannel: "email", allowInsideBuffer: true });
  assert.equal(email.json.error, "email_needed");
});

test("the page: only patients marked “Can book online visits” book online themselves; every other number gets the same refusal", async () => {
  await onlineOn({}, { onlineMinNoticeMinutes: 240 });
  const info = (await t.pub("GET", `/api/c/${SLUG}`)).json;
  assert.equal(info.options.online.enabled, true);
  assert.deepEqual(info.options.online.channels, ["whatsapp", "email"], "the page offers WhatsApp and email (print is at the desk)");
  assert.equal(info.doctors.find((d) => d.id === ids.lina).teams_link, undefined);
  // The doctor's buffer: online times today start four hours from now (16:00); in-clinic times keep the clinic's one hour.
  const online = (await t.pub("GET", `/api/c/${SLUG}/slots?service=${svc().id}&doctor=${ids.lina}&date=2026-11-10&days=1&visit=online`)).json;
  assert.ok(online.every((s) => Date.parse(s.startsAt) >= Date.parse(at("16:00", "2026-11-10"))));
  const times = await free();
  const known = await sec.post("/api/patients", { fullName: "Huda Al-Khatib", phone: "0791234567" });
  const unknownNo = await pageBook(times[0], { phone: "0799999999" });
  const knownNo = await pageBook(times[0]);
  assert.equal(unknownNo.status, 409); assert.equal(knownNo.status, 409);
  assert.deepEqual(unknownNo.json, knownNo.json, "a known number and an unknown one get the same answer");
  assert.equal(knownNo.json.error, "phone_not_accepted");
  // The doctor or staff tick the mark on the profile.
  const marked = await sec.patch(`/api/patients/${known.json.id}`, { onlineAllowed: true });
  assert.equal(marked.json.online_allowed, true); assert.equal(marked.json.online_allowed_by_name, "Sara Secretary");
  assert.equal((await pageBook(times[0], { onlineConsent: false })).json.error, "consent_needed");
  assert.equal((await pageBook(times[0], { linkChannel: "email" })).json.error, "email_needed");
  const ok = await pageBook(times[0], { linkChannel: "email", email: "huda@example.com" });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.visitType, "online"); assert.equal(ok.json.onlineMode, "audio");
  assert.equal(ok.json.join.state, "waiting", "no way in until the clinic confirms");
  assert.equal(ok.json.join.url, null);
  const row = (await t.owner.query("select online_consent_at, online_consent_version, link_channel, link_email from appointments where id = $1", [ok.json.id])).rows[0];
  assert.ok(row.online_consent_at);
  assert.equal(row.online_consent_version, (await adm.get("/api/settings")).json.onlineVisits.visits.consent_version, "the version the patient agreed to"); assert.equal(row.link_channel, "email"); assert.equal(row.link_email, "huda@example.com");
  // "Patient chooses": the clinic default leaves it to the patient.
  await onlineOn({ mode: "patient" }, { onlineMinNoticeMinutes: 0 });
  assert.equal((await pageBook(times[3])).json.error, "choose_mode");
  const v = await pageBook(times[3], { onlineMode: "video" });
  assert.equal(v.status, 201); assert.equal(v.json.onlineMode, "video");
  // "Everyone": no mark needed.
  await onlineOn({ whoCanBook: "everyone" });
  assert.equal((await pageBook(times[5], { phone: "0798888888", onlineMode: "audio" })).status, 201);
});

test("the doctor's “next follow-up can be online”: lets that patient book one online follow-up, then it is used up", async () => {
  await onlineOn({}, { onlineMinNoticeMinutes: 0 });
  const times = await free();
  const visit = await sec.post("/api/appointments", { serviceId: svc().id, doctorId: ids.lina, startsAt: times[0], source: "phone",
    newPatient: { fullName: "Rania Follow", phone: "0795555555" } });
  assert.equal(visit.status, 201);
  const ticked = await sec.post(`/api/appointments/${visit.json.id}/next-online`, { on: true, mode: "video", expectedVersion: visit.json.row_version });
  assert.equal(ticked.status, 200);
  assert.equal(ticked.json.next_online, true); assert.equal(ticked.json.next_online_mode, "video"); assert.equal(ticked.json.next_online_by_name, "Sara Secretary");
  const p = (await sec.get(`/api/patients/${visit.json.patient_id}`)).json;
  assert.equal(p.nextOnline.appointmentId, visit.json.id);
  assert.equal(p.patient.online_allowed, false, "the one-time tick is not the profile mark");
  const first = await pageBook(times[4], { phone: "0795555555", name: "Rania Follow" });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.onlineMode, "video", "the tick's choice wins");
  const used = (await sec.get(`/api/appointments/${visit.json.id}`)).json;
  assert.equal(used.next_online_used_by, first.json.id);
  assert.equal((await pageBook(times[6], { phone: "0795555555", name: "Rania Follow" })).json.error, "phone_not_accepted", "only once");
  assert.equal((await sec.get(`/api/patients/${visit.json.patient_id}`)).json.nextOnline, null);
});

test("the Join link: nothing until confirmed, the Teams address only near the time, and it stops when cancelled or moved to the clinic", async () => {
  await onlineOn({}, { onlineMinNoticeMinutes: 0 });
  const times = await free();
  const a = (await staffBook(times[0])).json;
  const sent = await sec.post(`/api/appointments/${a.id}/join-link`, { channel: "copy" });
  assert.equal(sent.status, 201);
  assert.match(sent.json.url, /\/demo-derma\/j#[A-Za-z0-9_-]{43}$/);
  assert.ok(sent.json.message.includes(sent.json.url), "the clinic's text with the link in it");
  const token = tokenOf(sent.json.url);
  assert.equal((await join(token)).json.state, "waiting");
  assert.equal((await join(token, "other-clinic")).status, 404, "a link works only on its own clinic's page");
  const conf = await sec.post(`/api/appointments/${a.id}/status`, { status: "confirmed", expectedVersion: a.row_version });
  assert.equal(conf.status, 200);
  let j = (await join(token)).json;
  assert.equal(j.state, "early"); assert.equal(j.url, null, "the address is not shown before the window");
  t.clock.t = Date.parse(times[0]) - 9 * 60000;                                // nine minutes before
  j = (await join(token)).json;
  assert.equal(j.state, "open"); assert.equal(j.url, LINK);
  sec = (await t.login(P.secretary)).b;                                       // the clock moved a day: a fresh sign-in
  // A link pasted on this booking wins over the doctor's.
  const own = "https://teams.microsoft.com/l/meetup-join/19%3aother%40thread.v2/0";
  const cur = (await sec.get(`/api/appointments/${a.id}`)).json;
  assert.equal((await sec.patch(`/api/appointments/${a.id}`, { expectedVersion: cur.row_version, meetingUrl: own })).status, 200);
  assert.equal((await join(token)).json.url, own);
  const log = (await sec.get(`/api/appointments/${a.id}/join-links`)).json;
  assert.equal(log.length, 1); assert.equal(log[0].channel, "copy"); assert.ok(log[0].opens >= 3); assert.equal(log[0].token_hash, undefined);
  t.clock.t = Date.parse(times[0]) + (svc().duration_minutes + 16) * 60000;  // the visit's end and a quarter of an hour
  assert.equal((await join(token)).json.state, "over");
  t.clock.t = Date.parse(times[0]) - 60 * 60000;
  sec = (await t.login(P.secretary)).b;
  const c2 = (await sec.get(`/api/appointments/${a.id}`)).json;
  assert.equal((await sec.post(`/api/appointments/${a.id}/status`, { status: "cancelled", reason: "test", expectedVersion: c2.row_version })).status, 200);
  assert.equal((await join(token)).json.state, "not_active");
  // Another visit, moved back to the clinic: its links stop.
  const b = (await staffBook(times[3], { newPatient: { fullName: "Moved Back", phone: "0790000003" } })).json;
  const tok2 = tokenOf((await sec.post(`/api/appointments/${b.id}/join-link`, { channel: "print" })).json.url);
  assert.equal((await sec.patch(`/api/appointments/${b.id}`, { expectedVersion: b.row_version, visitType: "in_clinic" })).status, 200);
  assert.equal((await join(tok2)).status, 404);
});

test("confirming sends the link by email when that is the patient's way; the identity tick; payment by CliQ on the patient's pages", async () => {
  await onlineOn({}, { onlineMinNoticeMinutes: 0 });
  assert.equal((await adm.patch("/api/settings/payment", { cliqEnabled: true, cliqAlias: "DEMODERMA", cliqName: "Demo Derma", payWhen: "before", forOnline: true,
    noteEn: "Send {price} JOD by CliQ to {alias} ({name}) before the visit.", noteAr: "حوّل {price} دينار عبر CliQ إلى {alias} ({name}) قبل الزيارة." })).status, 200);
  const times = await free();
  const a = (await staffBook(times[0], { linkChannel: "email", linkEmail: "omar@example.com" })).json;
  assert.equal(t.patientMails.length, 0);
  const conf = (await sec.post(`/api/appointments/${a.id}/status`, { status: "confirmed", expectedVersion: a.row_version })).json;
  assert.deepEqual(conf.link_sent, { channel: "email", sentTo: "omar@example.com" });
  assert.equal(t.patientMails.length, 1);
  const m = t.patientMails[0];
  assert.equal(m.to, "omar@example.com");
  assert.match(m.text, /\/demo-derma\/j#[A-Za-z0-9_-]{43}/);
  assert.ok(m.text.includes("DEMODERMA"), "how to pay is in the email");
  assert.ok(!m.text.includes("teams.microsoft.com"), "never the Teams address itself");
  const id1 = await sec.post(`/api/appointments/${a.id}/identity`, { checked: true, expectedVersion: conf.row_version });
  assert.equal(id1.status, 200); assert.equal(id1.json.identity_checked_by_name, "Sara Secretary"); assert.ok(id1.json.identity_checked_at);
  // The patient's own booking shows the payment note, with the service's price.
  const known = await sec.post("/api/patients", { fullName: "Huda Al-Khatib", phone: "0791234567", email: "huda@example.com" });
  await sec.patch(`/api/patients/${known.json.id}`, { onlineAllowed: true, onlineMode: "video" });
  const r = await pageBook(times[3]);
  assert.equal(r.status, 201);
  assert.equal(r.json.onlineMode, "video", "the profile's choice");
  assert.ok(r.json.payment.noteEn.includes("DEMODERMA") && r.json.payment.noteAr.includes("DEMODERMA"));
  assert.ok(r.json.howToEn);
  const manage = (await t.pub("POST", `/api/c/${SLUG}/manage`, { token: r.json.manageToken })).json;
  assert.equal(manage.join.state, "waiting");
  assert.equal(manage.payment.alias, "DEMODERMA");
});

// ---------------------------------------------------------------- phase 2: the assistants and the link again for a new time

test("the chat: the assistant proposes an online visit; the card's consent and choices book it; an unmarked number is refused and the assistant is told", async () => {
  await onlineOn();
  assert.equal((await adm.patch("/api/settings/online", { ...PAGE, chatEnabled: true })).status, 200);
  t.forgetPublic();
  const chat = (p, body) => t.pub("POST", `/api/c/${SLUG}/chat${p}`, body);
  const id = (await chat("", {})).json.chatId;
  const times = await free();
  t.agent.next.push({ reply: "Check the card, tick the consent and press Yes.", proposal: {
    serviceId: svc().id, doctorId: ids.lina, startsAt: times[0], serviceEn: "Consultation", serviceAr: "استشارة", doctorEn: "Dr. Lina", doctorAr: "د. لينا",
    summary: "Online visit: Consultation with Dr. Lina", visitType: "online" } });
  const r = await chat(`/${id}/message`, { text: "An online follow-up please" });
  assert.equal(r.json.proposal.visitType, "online");
  const card = { name: "Huda Chat", phone: "0791234567", language: "en", agree: true };
  assert.equal((await chat(`/${id}/book`, card)).json.error, "consent_needed", "the card's consent tick is needed");
  const no = await chat(`/${id}/book`, { ...card, onlineConsent: true });
  assert.equal(no.json.error, "phone_not_accepted");
  await chat(`/${id}/message`, { text: "Why not?" });
  assert.ok(t.agent.calls.at(-1).events.some((e) => /did not accept an online visit for this number/.test(e)), "the assistant is told");
  const known = await sec.post("/api/patients", { fullName: "Huda Chat", phone: "0791234567" });
  await sec.patch(`/api/patients/${known.json.id}`, { onlineAllowed: true });
  assert.equal((await chat(`/${id}/book`, { ...card, onlineConsent: true, linkChannel: "email" })).json.error, "email_needed");
  const ok = await chat(`/${id}/book`, { ...card, onlineConsent: true, linkChannel: "email", email: "huda@example.com" });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.visitType, "online");
  const a = (await t.owner.query("select visit_type, online_mode, link_channel, link_email, online_consent_at is not null as consent, online_from from appointments where id = $1", [ok.json.id])).rows[0];
  assert.deepEqual(a, { visit_type: "online", online_mode: "audio", link_channel: "email", link_email: "huda@example.com", consent: true, online_from: "chat" });
  assert.ok(!JSON.stringify(t.agent.calls).includes("0791234567") && !JSON.stringify(t.agent.calls).includes("huda@example.com"), "never sent to the AI");
});

test("a confirmed online visit moved by staff: the email link goes again for the new time, once", async () => {
  await onlineOn({}, { onlineMinNoticeMinutes: 0 });
  const times = await free();
  const a = (await staffBook(times[0], { linkChannel: "email", linkEmail: "omar@example.com" })).json;
  const conf = (await sec.post(`/api/appointments/${a.id}/status`, { status: "confirmed", expectedVersion: a.row_version })).json;
  assert.equal(t.patientMails.length, 1);
  const kept = await sec.patch(`/api/appointments/${a.id}`, { expectedVersion: conf.row_version, internalNote: "Prefers audio" });
  assert.equal(kept.status, 200, "sending the link is not an edit: the booking open on screen still saves");
  assert.equal(kept.json.link_sent, undefined, "other edits send nothing");
  const moved = await sec.patch(`/api/appointments/${a.id}`, { expectedVersion: kept.json.row_version, startsAt: times[2] });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.deepEqual(moved.json.link_sent, { channel: "email", sentTo: "omar@example.com" });
  assert.equal(t.patientMails.length, 2);
  const again = await sec.patch(`/api/appointments/${a.id}`, { expectedVersion: moved.json.row_version, startsAt: times[2] });
  assert.equal(again.json.link_sent, undefined, "the same time again: nothing new to tell");
  const links = (await sec.get(`/api/appointments/${a.id}/join-links`)).json;
  assert.equal(links.length, 2); assert.ok(links.every((l) => l.auto === null), "emailed when staff confirmed or moved it: not automatic");
});

// The assistants and the page must offer the same online times (design: the 0-difference rule). Runs the agent's own code when its Python is here.
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const python = [path.join(repo, "agent", ".venv", "Scripts", "python.exe"), path.join(repo, "agent", ".venv", "bin", "python")].find(existsSync);
test("online free times are identical on the page and in the assistants", { skip: !python && "the agent's Python is not installed" }, async () => {
  await onlineOn({}, { onlineMinNoticeMinutes: 240 });
  await adm.patch(`/api/settings/doctors/${ids.omar}/online`, { onlineEnabled: true, onlineMinNoticeMinutes: 30, teamsLink: LINK });
  await staffBook((await free())[1]);
  t.forgetPublic();
  const mine = {};
  for (const d of [ids.lina, ids.omar]) {
    const r = await t.pub("GET", `/api/c/${SLUG}/slots?service=${svc().id}&doctor=${d}&date=2026-11-10&days=7&visit=online`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    mine[d] = r.json.map((x) => x.startsAt);
  }
  const script = `
import json, sys, psycopg
from datetime import datetime, date, timezone
from limitsiz_agent.booking import find_slots
out = {}
with psycopg.connect("postgresql://postgres:test@localhost:54329/accounts_test", autocommit=True) as c:
    for did in json.loads(sys.stdin.read()):
        rows = find_slots(c, "${t.clinicA}", "${svc().id}", date_from=date(2026, 11, 10), days=7, doctor_id=did, visit="online",
                          now=datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc))
        out[did] = [s["starts_at"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z") for s in rows]
print(json.dumps(out))`;
  const theirs = JSON.parse(execFileSync(python, ["-c", script], { input: JSON.stringify(Object.keys(mine)), env: { ...process.env, PYTHONPATH: path.join(repo, "agent") }, maxBuffer: 1 << 24 }).toString());
  let total = 0;
  for (const d of Object.keys(mine)) { total += mine[d].length; assert.deepEqual([...mine[d]].sort(), [...theirs[d]].sort(), d); }
  assert.ok(total > 50, `compared ${total} online times`);
  assert.ok(mine[ids.lina].every((s) => Date.parse(s) >= Date.parse(at("16:00", "2026-11-10"))), "Dr. Lina's four-hour online notice");
});
