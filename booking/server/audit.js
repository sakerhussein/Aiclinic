// The audit log page (design §7.5). Reading goes through the audit_reader login, which can only see the clinic named in the
// transaction. Looking at the log is itself recorded: exports and integrity checks every time, viewing at most every 15 minutes
// per person (so paging and filtering do not flood the log it is reading).
import { HttpError } from "./http.js";

export const TYPES = {
  bookings: ["appointment", "join_link"],
  patients: ["patient"],
  notes: ["visit_note"],
  settings: ["clinic", "doctor", "service", "clinic_hours", "doctor_hours", "time_off", "doctor_service", "booking_rules", "clinic_settings", "clinic_faq", "online_booking", "scribe_settings", "online_visits", "clinic_payment"],
  security: ["session", "user", "membership", "invite"],
  audit: ["audit"],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;   // one odd entry must never break the page
const PAGE = 100, MAX_EXPORT = 50000, VIEW_EVERY_MS = 15 * 60_000;

// A spreadsheet treats a cell starting with = + - @ as a formula: someone could put one in a name. Quote and neutralise.
export function csvCell(v) {
  let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function createAudit({ pool, auditPool, now = () => new Date() }) {
  const lastView = new Map();

  async function reading(ctx, fn) {
    if (!auditPool) throw new HttpError(503, "audit_unavailable");
    const c = await auditPool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.clinic_id', $1, true)", [ctx.clinicId]);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  }

  const record = (ctx, action, after) => pool.query(
    "select audit.log($1,'audit',null,$2,null,$3::jsonb,null,null,'user',$4,$5,$6,$7,$8)",
    [ctx.clinicId, action, after ? JSON.stringify(after) : null, ctx.user.id, ctx.user.name, ctx.ip ?? null, ctx.ua ?? null, ctx.requestId ?? null]);

  function where(ctx, f) {
    const w = ["chain_key = $1"], p = [ctx.clinicId];
    const add = (sql, v) => { p.push(v); w.push(sql.replaceAll("?", `$${p.length}`)); };
    if (f.from) add(`at >= (?::date)::timestamp at time zone $TZ`, f.from);
    if (f.to) add(`at < (?::date + 1)::timestamp at time zone $TZ`, f.to);
    if (f.actor) add("actor_id = ?", f.actor);
    if (f.type) add("entity = any(?::text[])", TYPES[f.type]);
    if (f.q) add(`(coalesce(actor_label,'') || ' ' || action || ' ' || coalesce(reason,'') || ' ' || coalesce(entity_id,'') || ' ' || coalesce(ip,'') || ' ' || coalesce(after::text,'') || ' ' || coalesce(before::text,'')) ilike ?`,
      `%${f.q.replace(/[%_\\]/g, "\\$&")}%`);
    return { w, p };
  }
  // audit_reader cannot read clinics, so the clinic's time zone is passed in.
  const clinicTz = async (ctx) => (await pool.query("select timezone from clinics where id = $1", [ctx.clinicId])).rows[0].timezone;
  const sql = (w, tz) => w.join(" and ").replaceAll("$TZ", `'${tz.replace(/'/g, "")}'`);

  const COLUMNS = "seq, at, actor_type, actor_id, actor_label, db_role, ip, user_agent, request_id, entity, entity_id, action, before, after, changed_fields, reason";

  // Names for the page: which patient a booking belongs to. People's names come from Accounts (see the route).
  async function enrich(ctx, rows) {
    const appts = [...new Set(rows.filter((r) => r.entity === "appointment" && UUID.test(r.entity_id || "")).map((r) => r.entity_id))];
    const pats = [...new Set(rows.filter((r) => r.entity === "patient" && UUID.test(r.entity_id || "")).map((r) => r.entity_id))];
    const names = new Map();
    if (appts.length) {
      const r = await pool.query(`select a.id::text as id, coalesce(p.full_name, p.phone_e164) as name from appointments a join patients p on p.clinic_id = a.clinic_id and p.id = a.patient_id
        where a.clinic_id = $1 and a.id = any($2::uuid[])`, [ctx.clinicId, appts]);
      for (const x of r.rows) names.set(x.id, x.name);
    }
    if (pats.length) {
      const r = await pool.query("select id::text as id, coalesce(full_name, phone_e164) as name from patients where clinic_id = $1 and id = any($2::uuid[])", [ctx.clinicId, pats]);
      for (const x of r.rows) names.set(x.id, x.name);
    }
    return rows.map((r) => ({ ...r, subject: names.get(r.entity_id) ?? null }));
  }

  async function list(ctx, f) {
    const tz = await clinicTz(ctx);
    const { w, p } = where(ctx, f);
    if (f.before) { p.push(f.before); w.push(`seq < $${p.length}`); }
    p.push(PAGE + 1);
    const rows = await reading(ctx, async (c) => (await c.query(
      `select ${COLUMNS} from audit.events where ${sql(w, tz)} order by seq desc limit $${p.length}`, p)).rows);
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    const t = now().getTime(), key = `${ctx.clinicId}:${ctx.user.id}`;
    if (!lastView.has(key) || t - lastView.get(key) > VIEW_EVERY_MS) { lastView.set(key, t); await record(ctx, "viewed"); }
    return { rows: await enrich(ctx, page), nextBefore: more ? page[page.length - 1].seq : null };
  }

  async function facets(ctx) {
    return reading(ctx, async (c) => {
      const actors = (await c.query(
        `select distinct on (actor_id) actor_id as id, actor_label as label, actor_type as type from audit.events
          where chain_key = $1 and actor_id is not null and actor_id <> '' order by actor_id, seq desc`, [ctx.clinicId])).rows;
      return { actors: actors.sort((a, b) => String(a.label).localeCompare(String(b.label))), types: Object.keys(TYPES) };
    });
  }

  async function status(ctx) {
    const s = await reading(ctx, async (c) => {
      const n = (await c.query("select count(*)::int as n from audit.events where chain_key = $1", [ctx.clinicId])).rows[0].n;
      const last = (await c.query(
        "select at, actor_label, after from audit.events where chain_key = $1 and entity = 'audit' and action = 'integrity_checked' order by seq desc limit 1", [ctx.clinicId])).rows[0];
      return { entries: n, lastCheck: last ? { at: last.at, by: last.actor_label, ok: !!last.after?.ok, brokenSeq: last.after?.broken_seq ?? null } : null };
    });
    const r = await pool.query("select audit_retention_months from clinic_settings where clinic_id = $1", [ctx.clinicId]);
    return { ...s, retentionMonths: r.rows[0].audit_retention_months };
  }

  async function verify(ctx) {
    const v = (await pool.query("select ok, checked, broken_seq from audit.verify($1)", [ctx.clinicId])).rows[0];
    const head = (await pool.query("select seq, hash, at from audit.head($1)", [ctx.clinicId])).rows[0] ?? null;
    await record(ctx, "integrity_checked", { ok: v.ok, checked: Number(v.checked), broken_seq: v.broken_seq == null ? null : Number(v.broken_seq) });
    return { ok: v.ok, checked: Number(v.checked), brokenSeq: v.broken_seq == null ? null : Number(v.broken_seq), head };
  }

  async function exportCsv(ctx, f) {
    const tz = await clinicTz(ctx);
    const { w, p } = where(ctx, f);
    p.push(MAX_EXPORT + 1);
    const rows = await reading(ctx, async (c) => (await c.query(
      `select ${COLUMNS}, prev_hash, hash from audit.events where ${sql(w, tz)} order by seq desc limit $${p.length}`, p)).rows);
    const truncated = rows.length > MAX_EXPORT;
    const out = truncated ? rows.slice(0, MAX_EXPORT) : rows;
    await record(ctx, "exported", { rows: out.length, truncated, filters: f });
    const head = ["seq", "time_utc", "who_type", "who_id", "who", "database_login", "ip", "browser", "request_id", "entity", "entity_id", "action", "changed_fields", "reason", "before", "after", "prev_hash", "hash"];
    const lines = out.map((r) => [r.seq, r.at.toISOString(), r.actor_type, r.actor_id, r.actor_label, r.db_role, r.ip, r.user_agent, r.request_id, r.entity, r.entity_id, r.action,
      (r.changed_fields ?? []).join(" "), r.reason, r.before, r.after, r.prev_hash, r.hash].map(csvCell).join(","));
    if (truncated) lines.push(csvCell(`Stopped at ${MAX_EXPORT} rows: narrow the dates and export again.`));
    return "﻿" + [head.join(","), ...lines].join("\r\n") + "\r\n";     // the mark makes Excel read Arabic correctly
  }

  return { list, facets, status, verify, exportCsv, record };
}
