import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

// English and Arabic for every piece of text. The Arabic is a working draft for a native reader to review.
const EN = {
  brand: "Limitsiz Clinic", product: "Booking", langSwitch: "العربية",
  calendar: "Calendar", bookings: "Bookings", patients: "Patients", mySchedule: "My schedule",
  accounts: "Accounts", switchUser: "Switch user", signOut: "Sign out",
  today: "Today", prev: "Previous day", next: "Next day", newBooking: "New booking", allDoctors: "All doctors",
  noBookings: "No bookings.", loading: "Loading…", save: "Save", cancel: "Cancel", back: "Back", edit: "Edit", search: "Search", clear: "Clear",
  patient: "Patient", service: "Service", doctor: "Doctor", date: "Date", time: "Time", status: "Status", source: "How it was booked", note: "Internal note",
  noteHint: "Staff only. No medical details here.", phone: "Phone", name: "Name", language: "Language", reminders: "WhatsApp reminders",
  reminderHint: "The patient agreed to receive WhatsApp reminders.", price: "Price", duration: "Duration", min: "min", jod: "JOD",
  anyDoctor: "Any available doctor", pickService: "Choose a service", pickPatient: "Find a patient by name or phone",
  newPatient: "+ New patient", existingPatient: "Choose an existing patient", fullName: "Full name", phoneOptional: "Phone (optional)",
  noPhone: "Without a phone number the patient cannot get WhatsApp reminders.",
  freeTimes: "Free times", noFreeTimes: "No free times that day.", otherTime: "Other time", otherTimeWarn: "This time is outside the doctor's free times. Booking here is allowed, but check it first.",
  confirmOther: "Book this other time", create: "Book", saved: "Saved.", chooseTime: "Choose a time.", lastVisit: "Last visit",
  sources: { whatsapp: "WhatsApp", phone: "Phone", walkin: "Walk-in", staff: "Staff", web: "Web" } as Record<string, string>,
  statuses: { booked: "Booked", confirmed: "Confirmed", completed: "Completed", no_show: "No-show", cancelled: "Cancelled", voided: "Voided" } as Record<string, string>,
  actions: { confirmed: "Confirm", completed: "Mark completed", no_show: "No-show", cancelled: "Cancel booking", voided: "Void (delete)", restore: "Restore" } as Record<string, string>,
  reason: "Reason", reasonNeeded: "A reason is needed.", apply: "Apply", details: "Details", history: "History", by: "by",
  historyActions: { created: "Created", status_changed: "Status changed", rescheduled: "Moved or edited", cancelled: "Cancelled", voided: "Voided", restored: "Restored", updated: "Edited" } as Record<string, string>,
  actors: { agent: "WhatsApp assistant", system: "System", database: "Direct database access" } as Record<string, string>,
  from: "From", to: "To", showVoided: "Show voided", allStatuses: "All statuses", allSources: "All sources",
  conflictTitle: "Someone changed this booking", conflictBody: "It was changed at {time} (version {v}). Nothing was overwritten. Reload to see the latest.", reload: "Reload",
  patientBookings: "Bookings", newPatientTitle: "New patient", editPatient: "Patient details",
  lockedNote: "Your screen is locked. Please unlock it.",
  warnOutside: "Outside the doctor's free times", warnFlag: "outside free times",
  errors: {
    slot_taken: "That time was just taken. Choose another.", slot_unavailable: "No doctor is free at that time.",
    not_a_free_time: "That is not one of the free times.", patient_exists: "A patient with this phone number already exists.",
    patient_already_booked_then: "This patient already has a booking at that time.", invalid_phone: "That phone number is not valid.",
    in_the_past: "That time has already passed.", too_far_ahead: "That is too far ahead.", reason_required: "A reason is needed.",
    status_change_not_allowed: "That change is not allowed for this booking.", not_editable: "This booking can no longer be edited.",
    forbidden: "You are not allowed to do that.", doctor_does_not_offer_service: "This doctor does not offer that service.",
    invalid_input: "Please check what you typed.", server_error: "Something went wrong. Please try again.", bad_origin: "Please reload the page.",
    not_voided: "This booking is not voided.", unknown_service: "Choose a service.", version_conflict: "Someone changed this booking meanwhile.",
  } as Record<string, string>,
};

const AR: typeof EN = {
  brand: "Limitsiz Clinic", product: "الحجوزات", langSwitch: "English",
  calendar: "التقويم", bookings: "الحجوزات", patients: "المرضى", mySchedule: "جدولي",
  accounts: "الحسابات", switchUser: "تبديل المستخدم", signOut: "تسجيل الخروج",
  today: "اليوم", prev: "اليوم السابق", next: "اليوم التالي", newBooking: "حجز جديد", allDoctors: "كل الأطباء",
  noBookings: "لا توجد حجوزات.", loading: "جارٍ التحميل…", save: "حفظ", cancel: "إلغاء", back: "رجوع", edit: "تعديل", search: "بحث", clear: "مسح",
  patient: "المريض", service: "الخدمة", doctor: "الطبيب", date: "التاريخ", time: "الوقت", status: "الحالة", source: "طريقة الحجز", note: "ملاحظة داخلية",
  noteHint: "للموظفين فقط. بدون تفاصيل طبية.", phone: "الهاتف", name: "الاسم", language: "اللغة", reminders: "تذكيرات واتساب",
  reminderHint: "وافق المريض على استلام تذكيرات واتساب.", price: "السعر", duration: "المدة", min: "دقيقة", jod: "دينار",
  anyDoctor: "أي طبيب متاح", pickService: "اختر الخدمة", pickPatient: "ابحث عن مريض بالاسم أو الهاتف",
  newPatient: "+ مريض جديد", existingPatient: "اختر مريضاً موجوداً", fullName: "الاسم الكامل", phoneOptional: "الهاتف (اختياري)",
  noPhone: "بدون رقم هاتف لا يمكن إرسال تذكيرات واتساب للمريض.",
  freeTimes: "الأوقات المتاحة", noFreeTimes: "لا توجد أوقات متاحة في هذا اليوم.", otherTime: "وقت آخر", otherTimeWarn: "هذا الوقت خارج الأوقات المتاحة للطبيب. الحجز فيه مسموح لكن تحقق منه أولاً.",
  confirmOther: "احجز في هذا الوقت الآخر", create: "احجز", saved: "تم الحفظ.", chooseTime: "اختر وقتاً.", lastVisit: "آخر زيارة",
  sources: { whatsapp: "واتساب", phone: "هاتف", walkin: "حضور مباشر", staff: "موظف", web: "الموقع" },
  statuses: { booked: "محجوز", confirmed: "مؤكد", completed: "مكتمل", no_show: "لم يحضر", cancelled: "ملغى", voided: "مُبطل" },
  actions: { confirmed: "تأكيد", completed: "تم الحضور", no_show: "لم يحضر", cancelled: "إلغاء الحجز", voided: "إبطال (حذف)", restore: "استعادة" },
  reason: "السبب", reasonNeeded: "السبب مطلوب.", apply: "تطبيق", details: "التفاصيل", history: "السجل", by: "بواسطة",
  historyActions: { created: "أُنشئ", status_changed: "تغيّرت الحالة", rescheduled: "نُقل أو عُدّل", cancelled: "أُلغي", voided: "أُبطل", restored: "استُعيد", updated: "عُدّل" },
  actors: { agent: "مساعد واتساب", system: "النظام", database: "وصول مباشر لقاعدة البيانات" },
  from: "من", to: "إلى", showVoided: "إظهار المُبطلة", allStatuses: "كل الحالات", allSources: "كل الطرق",
  conflictTitle: "شخص آخر غيّر هذا الحجز", conflictBody: "تغيّر في {time} (النسخة {v}). لم يُكتب فوق أي شيء. أعد التحميل لرؤية الأحدث.", reload: "إعادة التحميل",
  patientBookings: "الحجوزات", newPatientTitle: "مريض جديد", editPatient: "بيانات المريض",
  lockedNote: "الشاشة مقفلة. افتح القفل من فضلك.",
  warnOutside: "خارج الأوقات المتاحة للطبيب", warnFlag: "خارج الأوقات المتاحة",
  errors: {
    slot_taken: "هذا الوقت حُجز للتو. اختر وقتاً آخر.", slot_unavailable: "لا يوجد طبيب متاح في هذا الوقت.",
    not_a_free_time: "هذا ليس من الأوقات المتاحة.", patient_exists: "يوجد مريض بهذا الرقم بالفعل.",
    patient_already_booked_then: "لدى هذا المريض حجز في هذا الوقت.", invalid_phone: "رقم الهاتف غير صالح.",
    in_the_past: "هذا الوقت مضى.", too_far_ahead: "بعيد جداً في المستقبل.", reason_required: "السبب مطلوب.",
    status_change_not_allowed: "هذا التغيير غير مسموح لهذا الحجز.", not_editable: "لم يعد بالإمكان تعديل هذا الحجز.",
    forbidden: "غير مسموح لك بهذا الإجراء.", doctor_does_not_offer_service: "هذا الطبيب لا يقدّم هذه الخدمة.",
    invalid_input: "تحقق مما كتبته.", server_error: "حدث خطأ. حاول مرة أخرى.", bad_origin: "أعد تحميل الصفحة.",
    not_voided: "هذا الحجز ليس مُبطلاً.", unknown_service: "اختر الخدمة.", version_conflict: "شخص آخر غيّر هذا الحجز.",
  },
};

const DICT = { en: EN, ar: AR };
type Key = Exclude<keyof typeof EN, "sources" | "statuses" | "actions" | "historyActions" | "actors" | "errors">;
type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: Key, vars?: Record<string, string | number>) => string; d: typeof EN; error: (code: string) => string };
const C = createContext<Ctx>(null as never);
export const useI18n = () => useContext(C);

function initial(): Lang {
  try { const s = localStorage.getItem("lc_lang"); if (s === "ar" || s === "en") return s; } catch { /* storage blocked */ }
  return navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(initial);
  useEffect(() => {
    document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = lang === "ar" ? "Limitsiz Clinic: الحجوزات" : "Limitsiz Clinic: Booking";
  }, [lang]);
  const setLang = (l: Lang) => { setL(l); try { localStorage.setItem("lc_lang", l); } catch { /* ignore */ } };
  const d = DICT[lang];
  const t: Ctx["t"] = (k, vars) => String(d[k]).replace(/\{(\w+)\}/g, (_, v) => String(vars?.[v] ?? ""));
  return <C.Provider value={{ lang, setLang, t, d, error: (c) => d.errors[c] || d.errors.server_error }}>{children}</C.Provider>;
}
