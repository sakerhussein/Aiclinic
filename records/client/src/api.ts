// Fetch wrapper (as in Booking). 401 means "sign in" and 423 means "locked": both go through Accounts' single sign-on.
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

export type Kind = "allergy" | "medicine" | "condition" | "procedure" | "family";
export const KINDS: Kind[] = ["allergy", "medicine", "condition", "procedure", "family"];

export type Me = {
  user: { id: string; email: string; name: string; language: "ar" | "en" };
  clinic: { id: string; slug: string; nameEn: string; nameAr: string };
  role: string; doctorId: string | null; permissions: string[]; accountsUrl: string; bookingUrl: string;
};
export type Field = { key: string; en: string; ar: string; kind: "yesno" | "choice" | "text"; options?: { en: string; ar: string }[] };
export type Settings = {
  doctorsScope: "all" | "treated"; show: Record<Kind, boolean>; specialtyFields: Field[];
  fileNumbers: "auto" | "manual"; nextFileNo: number; fileNoDigits: number; requiredDetails: string[];
};
export type Lookups = { clinic: { id: string; name_en: string; name_ar: string; timezone: string }; doctors: { id: string; name_en: string; name_ar: string }[]; settings: Settings };
export type PatientRow = { id: string; full_name: string | null; phone_e164: string | null; file_no: string | null; birth_date: string | null; sex: string | null;
  last_visit: string | null; next_visit: string | null };
export type TodayRow = { id: string; starts_at: string; status: string; patient_id: string; doctor_id: string; full_name: string | null; file_no: string | null;
  birth_date: string | null; sex: string | null; service_en: string; service_ar: string; doctor_en: string; doctor_ar: string; alerts: number };
export type Details = { patient_id: string; file_no: string | null; birth_date: string | null; sex: "female" | "male" | null; national_id: string | null;
  insurance: string | null; emergency_contact: string | null; updated_at: string; updated_by_name: string | null; row_version: number };
export type Entry = { id: string; kind: Kind; title: string; detail: string | null; status: "active" | "past"; alert: boolean; source: "staff" | "patient";
  confirmed_at: string | null; confirmed_by_name: string | null; created_at: string; created_by_name: string; updated_at: string; updated_by_name: string | null;
  error_at: string | null; error_by_name: string | null; error_reason: string | null; row_version: number };
export type Answer = { field_key: string; value: string; updated_at: string; updated_by_name: string };
export type Item =
  | { type: "visit"; at: string; id: string; status: string; doctor_id: string; service_en: string; service_ar: string; doctor_en: string; doctor_ar: string;
      note_id: string | null; note_status: string | null; ai_drafted: boolean | null; signed_name: string | null; note_doctor_id: string | null }
  | { type: "entry"; at: string; id: string; kind: Kind; title: string; by: string; source: string }
  | { type: "error"; at: string; id: string; kind: Kind; title: string; by: string; reason: string };
export type Chart = {
  patient: { id: string; full_name: string | null; phone_e164: string | null; preferred_language: "ar" | "en" | null };
  details: Details | null; settings: Settings;
  chart: { entries: Entry[]; answers: Answer[]; timeline: Item[] } | null;
};

/** Whole years between a date of birth and today. */
export function ageOf(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth + "T12:00:00Z"), n = new Date();
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a -= 1;
  return a;
}
