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
  insuranceInBooking: boolean; insuranceRequired: boolean;
  relations: Named[]; photoAreas: Named[]; docKinds: DocKind[]; photoConsentRequired: boolean; maxFileMb: number; linkMinutes: number; phoneMinutes: number;
  // Phase C: before and after the visit
  coursesOn: boolean; courseAreaRequired: boolean; courseDefaults: { serviceId: string; sessions: number; weeks: number }[];
  rxOn: boolean; rxValidDays: number; rxPaper: "A5" | "A4"; rxFavourites: RxItem[];
  formsOn: boolean; formLinkHours: number; formMessageEn: string; formMessageAr: string;
  summaryModel: "off" | "claude-haiku-5-5" | "claude-sonnet-5-5"; summaryDaily: number;
};
export type Named = { key: string; en: string; ar: string };
export type DocKind = Named & { secretary: boolean; review: boolean };
/** A photo or a document (never its content: that comes through a link that expires). */
export type FileRow = { id: string; patient_id: string; kind: "photo" | "document"; area_key: string | null; doc_kind: string | null; title: string | null;
  doc_date: string | null; mime: string; size_bytes: number; source: "upload" | "phone" | "form"; created_at: string; created_by_name: string; created_by_role: string | null;
  reviewed_at: string | null; reviewed_by_name: string | null; error_at: string | null; error_by_name: string | null; error_reason: string | null; row_version: number };
export type Consent = { photo_consent: "record" | "teaching" | "refused"; photo_consent_at: string; photo_consent_by_name: string };
export type FilesList = { photos: FileRow[] | null; documents: FileRow[]; othersCount: number; consent: Consent | null;
  rules: { consentRequired: boolean; maxFileMb: number; areas: Named[]; docKinds: DocKind[] } };
export type InsStatus = "unknown" | "none" | "insured";
export type CompanyName = { id: string; name_en: string; name_ar: string; hidden: boolean };
/** An insurance company's card: what staff see when they tap its name. */
export type Company = CompanyName & { phone: string | null; email: string | null; address: string | null; contact_name: string | null;
  contact_title: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null };
export type CompanyRow = Company & { row_version: number; patients: number };
export type Lookups = { clinic: { id: string; name_en: string; name_ar: string; timezone: string }; doctors: { id: string; name_en: string; name_ar: string }[];
  services: { id: string; name_en: string; name_ar: string }[]; settings: Settings };
export type PatientRow = { id: string; full_name: string | null; phone_e164: string | null; file_no: string | null; birth_date: string | null; sex: string | null;
  last_visit: string | null; next_visit: string | null };
export type TodayRow = { id: string; starts_at: string; status: string; patient_id: string; doctor_id: string; full_name: string | null; file_no: string | null;
  birth_date: string | null; sex: string | null; service_en: string; service_ar: string; doctor_en: string; doctor_ar: string; alerts: number; to_review: number };
export type Details = { patient_id: string; file_no: string | null; birth_date: string | null; sex: "female" | "male" | null; national_id: string | null;
  insurance: string | null; insurance_status: InsStatus; insurance_company_id: string | null;
  emergency_name: string | null; emergency_relation: string | null; emergency_phone: string | null;
  updated_at: string; updated_by_name: string | null; row_version: number };
export type Entry = { id: string; form_response_id?: string | null; kind: Kind; title: string; detail: string | null; status: "active" | "past"; alert: boolean; source: "staff" | "patient";
  confirmed_at: string | null; confirmed_by_name: string | null; created_at: string; created_by_name: string; updated_at: string; updated_by_name: string | null;
  error_at: string | null; error_by_name: string | null; error_reason: string | null; row_version: number };
export type Answer = { field_key: string; value: string; updated_at: string; updated_by_name: string };
export type Item =
  | { type: "visit"; at: string; id: string; status: string; doctor_id: string; service_en: string; service_ar: string; doctor_en: string; doctor_ar: string;
      note_id: string | null; note_status: string | null; ai_drafted: boolean | null; signed_name: string | null; note_doctor_id: string | null }
  | { type: "entry"; at: string; id: string; kind: Kind; title: string; by: string; source: string }
  | { type: "error"; at: string; id: string; kind: Kind; title: string; by: string; reason: string }
  | { type: "photos"; at: string; id: string; area: string; count: number; by: string }
  | { type: "document"; at: string; id: string; docKind: string; title: string; by: string };
/** The numbers beside the chart's tabs: total, and how many wait for this person. null: the tab isn't shown to them. */
export type TabCount = { total: number; waiting: number };
export type TabCounts = { photos: TabCount | null; docs: TabCount; rx: TabCount | null; forms: TabCount | null };
export type Chart = {
  patient: { id: string; full_name: string | null; phone_e164: string | null; preferred_language: "ar" | "en" | null };
  details: Details | null; settings: Settings; companies: CompanyName[]; insurer: Company | null;
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

// ---------------------------------------------------------------- phase C (design: booking/design/records-phase-c.html)
export type RxItem = { name: string; how: string; days: number | null; qty: string };
export type CourseSession = { n: number; appointment_id: string; starts_at: string; status: string; doctor_en: string; doctor_ar: string };
export type Course = { id: string; service_id: string; service_en: string; service_ar: string; sessions: number; every_weeks: number; areas: string[]; note: string | null;
  starts_on: string; created_at: string; created_by_name: string; ended_at: string | null; ended_by_name: string | null; end_reason: string | null;
  row_version: number; done: number; complete: boolean; next: number | null; next_about: string | null; list: CourseSession[] };
export type RxPrinted = { clinic: { name_en: string; name_ar: string; phone: string | null; address_en: string | null; address_ar: string | null };
  doctor: { name_en: string; name_ar: string; title_en: string | null; title_ar: string | null; licence: string };
  patient: { name: string | null; file_no: string | null; birth_date: string | null; sex: string | null }; allergies: string[]; day: string; paper: "A5" | "A4" };
export type Rx = { id: string; patient_id: string; doctor_id: string; appointment_id: string | null; items: RxItem[]; language: "en" | "ar"; valid_days: number;
  status: "draft" | "printed"; rx_no: string | null; printed_at: string | null; printed: RxPrinted | null; print_count: number; created_at: string;
  created_by_name: string; error_at: string | null; error_by_name: string | null; error_reason: string | null; row_version: number;
  doctor_en?: string; doctor_ar?: string; copy?: boolean };
export type RxList = { prescriptions: Rx[]; canWrite: boolean; licence: string | null; clinic: RxPrinted["clinic"]; doctor: Omit<RxPrinted["doctor"], "licence"> & { licence: string | null } | null };
export type QKind = "yesno" | "yesno_details" | "choice" | "text" | "date";
export type Question = { key: string; en: string; ar: string; kind: QKind; required?: boolean; options?: { en: string; ar: string }[]; goesTo?: string | null };
export type FormTemplate = { id: string; title_en: string; title_ar: string; questions: Question[]; consent: boolean; agree_en: string | null; agree_ar: string | null;
  first_visit_only: boolean; service_ids: string[]; minutes: number; version: number; hidden: boolean; sort: number; updated_at: string;
  updated_by_name: string | null; row_version: number };
export type FormAnswer = { value: string; details?: string };
export type FormResponse = { id: string; appointment_id: string; template_id: string; version: number; title_en: string; title_ar: string; consent: boolean;
  submitted_at: string; copy_file_id: string | null; reviewed_at: string | null; reviewed_by_name: string | null; row_version: number;
  questions: Question[] | null; answers?: Record<string, FormAnswer>; agree_text?: string | null; signature?: string | null; signed_name?: string | null;
  language?: "en" | "ar"; pending?: string[]; entries?: (Pick<Entry, "id" | "kind" | "title" | "detail" | "confirmed_at" | "error_at" | "row_version"> & { form_response_id: string })[] };
export type ComingVisit = { id: string; starts_at: string; status: string; service_en: string; service_ar: string; link_at: string | null; sent_count: number | null;
  opened_at: string | null; expires_at: string | null; forms: { id: string; title_en: string; title_ar: string; filled: boolean }[] };
export type FormsList = { responses: FormResponse[]; coming: ComingVisit[] };
export type FormLink = { url: string; message: string; whatsapp: string | null; expiresAt: string; forms: number };
export type SummaryLine = { text: string; source: { kind: "note" | "result" | "chart"; id?: string; appointment_id?: string; at?: string } };
export type SummaryState = { on: boolean; model: string; visitToday: boolean; stale: boolean; used: number; cap: number;
  summary: { id: string; made_at: string; made_by_name: string; model: string; language: "en" | "ar"; lines: SummaryLine[];
    basis: { notes: number; results: number; entries: number } } | null };
