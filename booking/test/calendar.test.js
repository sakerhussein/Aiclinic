// The calendar's "today" line and the week view's closures: a doctor sees their own counts, others the clinic's.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, ids, P, sec, dr, mineId, otherId;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

// The test clock's day in Amman (UTC+3).
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t.clock.t));
const at = (day, hhmm) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 3) * 60 + m) * 60000).toISOString(); };

beforeEach(async () => {
  await t.reset(); P = await t.people(); ids = await t.seedIds();
  sec = (await t.login(P.secretary)).b;
  dr = (await t.login(P.doctor)).b;
  mineId = (await dr.get("/api/me")).json.doctorId;
  otherId = ids.docs.map((d) => d.id).find((id) => id !== mineId);
});

test("the today line counts today's bookings: the clinic's for a secretary, a doctor's own for a doctor", async () => {
  const d = today();
  const book = async (doctorId, time, name, phone) => (await sec.post("/api/appointments", { serviceId: ids.services[0].id, doctorId, startsAt: at(d, time),
    source: "phone", override: true, newPatient: { fullName: name, phone } })).json;
  const a1 = await book(mineId, "14:00", "Rania Saleh", "0785550102");
  const a2 = await book(otherId, "15:00", "Omar Saleh", "0785550103");
  assert.ok(a1.id && a2.id, JSON.stringify([a1, a2]));
  await sec.post(`/api/appointments/${a2.id}/status`, { status: "no_show", expectedVersion: a2.row_version });
  const all = (await sec.get("/api/today-line")).json;
  assert.equal(all.date, d);
  assert.equal(all.booked, 2);
  assert.equal(all.noShow, 1);
  const own = (await dr.get("/api/today-line")).json;
  assert.equal(own.booked, 1);
  assert.equal(own.noShow, 0);
});

test("time off for a week comes back in one request; more than a month is refused", async () => {
  const d = today();
  const plus = (n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  await t.owner.query("insert into time_off (clinic_id, doctor_id, starts_at, ends_at, reason) values ($1, null, $2, $3, 'Holiday')",
    [t.clinicA, at(plus(3), "00:00"), at(plus(4), "00:00")]);
  assert.equal((await sec.get(`/api/time-off?date=${d}`)).json.length, 0);
  assert.equal((await sec.get(`/api/time-off?date=${d}&to=${plus(6)}`)).json.length, 1);
  assert.equal((await sec.get(`/api/time-off?date=${d}&to=${plus(40)}`)).status, 400);
});
