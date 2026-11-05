// Fetch wrapper. 401 means "sign in" and 423 means "locked": both go through Accounts' single sign-on, which shows the
// sign-in or the lock screen and returns here.
export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: Record<string, any> = {}) { super(code); }
}

export function goSignIn() {
  window.location.assign(`/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 || res.status === 423) { goSignIn(); await new Promise(() => {}); }
  if (!res.ok) throw new ApiError(res.status, data?.error || "server_error", data || {});
  return data as T;
}
export const get = <T = any>(u: string) => api<T>("GET", u);
export const post = <T = any>(u: string, b: unknown = {}) => api<T>("POST", u, b);
export const patch = <T = any>(u: string, b: unknown) => api<T>("PATCH", u, b);
export const put = <T = any>(u: string, b: unknown) => api<T>("PUT", u, b);
export const del = <T = any>(u: string) => api<T>("DELETE", u);

export type Me = {
  user: { id: string; email: string; name: string; language: "ar" | "en" };
  clinic: { id: string; slug: string; nameEn: string; nameAr: string };
  role: string; doctorId: string | null; permissions: string[]; accountsUrl: string;
};
export type Doctor = { id: string; name_en: string; name_ar: string; service_ids: string[]; hours: { weekday: number; start: string; end: string }[] };
export type Service = { id: string; name_en: string; name_ar: string; duration_minutes: number; price_jod: string | null; price_is_from: boolean };
export type Period = { weekday: number; start: string; end: string };
export type Lookups = { clinic: { id: string; timezone: string; slot_step_minutes: number; week_start: number }; doctors: Doctor[]; services: Service[]; openingHours: Period[]; rules: { outsideHours: string; requireCancelReason: boolean } };
export type Block = { id: string; doctor_id: string | null; starts_at: string; ends_at: string; reason: string | null };
export type Appt = {
  id: string; doctor_id: string; service_id: string; patient_id: string; starts_at: string; ends_at: string; status: string; source: string;
  cancel_reason: string | null; internal_note: string | null; row_version: number; updated_at: string; void_reason: string | null;
  patient_name: string | null; patient_phone: string | null; whatsapp_reminders: boolean;
  doctor_name_en: string; doctor_name_ar: string; service_name_en: string; service_name_ar: string; duration_minutes: number; price_jod: string | null;
  outside_hours?: boolean;
};
export type Patient = { id: string; full_name: string | null; phone_e164: string | null; preferred_language: "ar" | "en" | null; whatsapp_reminders: boolean; last_visit?: string | null };
