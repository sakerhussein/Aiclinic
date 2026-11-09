// Thin fetch wrapper. The browser adds the Origin header itself; the server checks it.
export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: Record<string, unknown> = {}) { super(code); }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || "server_error", data || {});
  return data as T;
}
export const get = <T = any>(u: string) => api<T>("GET", u);
export const post = <T = any>(u: string, b: unknown = {}) => api<T>("POST", u, b);
export const patch = <T = any>(u: string, b: unknown) => api<T>("PATCH", u, b);
export const del = <T = any>(u: string) => api<T>("DELETE", u);

export type Me = {
  state: "ok" | "locked" | "mfa_required" | "mfa_setup_required" | "choose_clinic" | "no_access";
  user: { id: string; email: string; name: string; language: "ar" | "en"; mfaEnabled: boolean };
  clinic: { id: string; slug: string; nameEn: string; nameAr: string } | null;
  clinics: { id: string; nameEn: string; nameAr: string; role: string }[];
  role: string | null;
  permissions: string[];
  security: { lockMinutes: number; idleMinutes: number; recoveryWarnAt: number };
  recovery: { left: number; warnAt: number } | null;      // null while two-step is off
};
