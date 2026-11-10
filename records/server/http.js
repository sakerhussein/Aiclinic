import { z } from "zod";

export class HttpError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
export const bad = (code, extra) => new HttpError(400, code, extra);
export const denied = (code = "forbidden") => new HttpError(403, code);
export const unauthorized = (code = "unauthorized") => new HttpError(401, code);
export const notFound = (code = "not_found") => new HttpError(404, code);

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieString(name, value, { secure, maxAgeSeconds } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join("; ");
}

// Validate a body with zod; a failure is a 400 with the first problem's field.
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw bad("invalid_input", { field: r.error.issues[0]?.path.join(".") });
  return r.data;
}
export { z };

// Fixed-window limiter in memory (one process). key -> {count, resetAt}
export function limiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    let h = hits.get(key);
    if (!h || h.resetAt <= t) { h = { count: 0, resetAt: t + windowMs }; hits.set(key, h); }
    h.count += 1;
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    return h.count <= max;
  };
}
