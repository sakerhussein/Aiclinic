import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

// English and Arabic for every piece of text. The Arabic is a working draft for a native reader to review.
const EN = {
  brand: "Limitsiz Clinic", product: "Records", langSwitch: "العربية",
  today: "Today's patients", patients: "Patients", settings: "Settings", myServices: "My services", switchUser: "Switch user",
  search: "Find a patient by name, phone or file number", name: "Name", phone: "Phone", file: "File", age: "Age", lastVisit: "Last visit", nextVisit: "Next visit",
  noPatients: "No patients found.", noToday: "No patients booked with you today.", noTodayAll: "No patients booked today.", time: "Time", visit: "Visit", doctor: "Doctor", alerts: "Alerts",
  openInBooking: "Open in Booking ↗", editInBooking: "Edit in Booking ↗", years: "{n} years", notAvailable: "This patient's record is not available.",
  female: "Female", male: "Male", arabic: "Arabic", english: "English", doctorLine: "Doctor: {name}",
  tabSummary: "Summary", tabTimeline: "Timeline", tabDetails: "Details", tabOpenings: "Who opened this record",
  add: "+ Add", none: "None recorded.", edit: "Edit", save: "Save", cancel: "Cancel", saved: "Saved.",
  entryName: "Name", entryDetail: "Details (optional)", entryAlert: "Show as an alert under the name on every screen", allergyAlways: "Allergies always show as an alert.",
  status: "Status", active: "Current", past: "Past",
  markError: "Entered in error", errorReason: "Why is it wrong?", errorHint: "The entry stays, struck through, with your name and the reason. This cannot be undone.",
  confirmError: "Mark as entered in error", inError: "entered in error · {name}", patientReported: "patient-reported", confirm: "Confirm",
  byOn: "{name} · {date}", specialty: "Specialty details", yes: "Yes", no: "No", notAsked: "—",
  birthDate: "Date of birth", sex: "Sex", nationalId: "National ID", insurance: "Insurance", emergency: "Emergency contact", fileNo: "File number",
  optional: "(optional)", required: "(required)", fileAuto: "Given automatically the first time the details are saved.", nameInBooking: "Name, phone and language are edited in Booking.",
  lastChange: "Last changed by {name}, {date}",
  lockedChart: "Allergies, medicines, conditions and the timeline are for the clinic's doctors.",
  all: "All", visits: "Visits", changes: "Changes",
  noteDraft: "Note: draft", noteSigned: "Note signed", noteSignedAi: "Signed · AI draft", noteFailed: "Note: needs attention", openNote: "Open the note in Booking ↗",
  added: "{kind} added: {title}", errored: "{kind} entered in error: {title}", reasonIs: "Reason: {r}", by: "by {name}", noTimeline: "Nothing yet.",
  who: "Who", role: "Role", when: "When", noOpenings: "Nobody has opened this record yet.",
  settingsTitle: "Settings", setChart: "Chart", readOnly: "You can see these settings but not change them.",
  scope: "Which doctors can open a chart", scopeAll: "Every doctor in the clinic", scopeTreated: "Only patients they have treated or are booked with",
  scopeHint: "Visit notes keep their own rule: only the treating doctor reads them.",
  lists: "Lists on the summary", specialtyFields: "Specialty fields", specialtyHint: "Questions for this clinic's specialty. Each is yes/no, a choice, or short text.",
  fieldEn: "Name (English)", fieldAr: "Name (Arabic)", kind: "Kind", yesno: "Yes / No", choice: "Choice", text: "Short text",
  choices: "Choices, one per line: English | Arabic", addField: "+ Add a field", remove: "Remove",
  fileNumbers: "File numbers", fileAutoOpt: "Automatic", fileManualOpt: "Typed by staff (clinics moving from paper files)", nextNo: "Next number", digits: "Digits",
  requiredDetails: "Required in the patient's details",
  kinds: { allergy: "Allergies", medicine: "Current medicines", condition: "Conditions", procedure: "Past procedures", family: "Family history" } as Record<string, string>,
  kind1: { allergy: "Allergy", medicine: "Medicine", condition: "Condition", procedure: "Procedure", family: "Family history" } as Record<string, string>,
  statuses: { booked: "Booked", confirmed: "Confirmed", completed: "Completed", no_show: "No-show", cancelled: "Cancelled" } as Record<string, string>,
  roles: { clinic_admin: "Clinic administrator", secretary: "Secretary", doctor: "Doctor", readonly: "Read-only", platform_admin: "Limitsiz administrator" } as Record<string, string>,
  detailNames: { birth_date: "Date of birth", sex: "Sex", national_id: "National ID", emergency_contact: "Emergency contact" } as Record<string, string>,
  errors: {
    patient_not_found: "This patient's record is not available.", entry_not_found: "This entry is no longer there. Reload the page.",
    entry_locked: "This entry was marked as entered in error and cannot change.", version_conflict: "Someone else changed this a moment ago. Reload to see the latest.",
    kind_off: "This list is switched off in Settings.", details_required: "Fill in the required details first.", file_no_taken: "Another patient already has this file number.",
    birth_date_in_future: "The date of birth is in the future.", unknown_field: "This field is no longer in Settings. Reload the page.", invalid_value: "That answer does not fit this field.",
    duplicate_field: "Two fields have the same name.", choice_needs_options: "A choice field needs at least one choice.", nothing_to_confirm: "There is nothing to confirm.",
    forbidden: "You are not allowed to do this.", invalid_input: "Check what you typed.", server_error: "Something went wrong. Try again.", bad_origin: "Reload the page.",
    no_access_to_service: "You do not have access to Records.",
  } as Record<string, string>,
};

const AR: typeof EN = {
  brand: "Limitsiz Clinic", product: "السجلات الطبية", langSwitch: "English",
  today: "مرضى اليوم", patients: "المرضى", settings: "الإعدادات", myServices: "خدماتي", switchUser: "تبديل المستخدم",
  search: "ابحث عن مريض بالاسم أو الهاتف أو رقم الملف", name: "الاسم", phone: "الهاتف", file: "الملف", age: "العمر", lastVisit: "آخر زيارة", nextVisit: "الزيارة القادمة",
  noPatients: "لا يوجد مرضى.", noToday: "لا يوجد مرضى محجوزون معك اليوم.", noTodayAll: "لا يوجد مرضى محجوزون اليوم.", time: "الوقت", visit: "الزيارة", doctor: "الطبيب", alerts: "التنبيهات",
  openInBooking: "فتح في المواعيد ↗", editInBooking: "تعديل في المواعيد ↗", years: "{n} سنة", notAvailable: "ملف هذا المريض غير متاح.",
  female: "أنثى", male: "ذكر", arabic: "العربية", english: "الإنجليزية", doctorLine: "الطبيب: {name}",
  tabSummary: "الملخص", tabTimeline: "السجل الزمني", tabDetails: "البيانات", tabOpenings: "من فتح هذا الملف",
  add: "+ إضافة", none: "لا شيء مسجّل.", edit: "تعديل", save: "حفظ", cancel: "إلغاء", saved: "تم الحفظ.",
  entryName: "الاسم", entryDetail: "التفاصيل (اختياري)", entryAlert: "إظهاره كتنبيه تحت الاسم في كل شاشة", allergyAlways: "الحساسية تظهر دائماً كتنبيه.",
  status: "الحالة", active: "حالي", past: "سابق",
  markError: "أُدخل خطأً", errorReason: "لماذا هو خطأ؟", errorHint: "يبقى القيد مشطوباً، مع اسمك والسبب. ولا يمكن التراجع عن ذلك.",
  confirmError: "تعليمه كمُدخل خطأً", inError: "أُدخل خطأً · {name}", patientReported: "أفاد به المريض", confirm: "تأكيد",
  byOn: "{name} · {date}", specialty: "تفاصيل التخصص", yes: "نعم", no: "لا", notAsked: "—",
  birthDate: "تاريخ الميلاد", sex: "الجنس", nationalId: "الرقم الوطني", insurance: "التأمين", emergency: "جهة اتصال للطوارئ", fileNo: "رقم الملف",
  optional: "(اختياري)", required: "(مطلوب)", fileAuto: "يُعطى تلقائياً عند أول حفظ للبيانات.", nameInBooking: "الاسم والهاتف واللغة تُعدَّل في «المواعيد».",
  lastChange: "آخر تعديل: {name}، {date}",
  lockedChart: "الحساسية والأدوية والحالات والسجل الزمني لأطباء العيادة.",
  all: "الكل", visits: "الزيارات", changes: "التغييرات",
  noteDraft: "الملاحظة: مسودة", noteSigned: "الملاحظة موقّعة", noteSignedAi: "موقّعة · مسودة ذكية", noteFailed: "الملاحظة: تحتاج متابعة", openNote: "فتح الملاحظة في المواعيد ↗",
  added: "أُضيف ({kind}): {title}", errored: "أُدخل خطأً ({kind}): {title}", reasonIs: "السبب: {r}", by: "بواسطة {name}", noTimeline: "لا شيء بعد.",
  who: "من", role: "الدور", when: "متى", noOpenings: "لم يفتح أحد هذا الملف بعد.",
  settingsTitle: "الإعدادات", setChart: "الملف", readOnly: "يمكنك رؤية هذه الإعدادات دون تغييرها.",
  scope: "أي الأطباء يمكنهم فتح الملف", scopeAll: "كل أطباء العيادة", scopeTreated: "فقط المرضى الذين عالجهم أو لديهم موعد معه",
  scopeHint: "ملاحظات الزيارة تبقى على قاعدتها: لا يقرأها إلا الطبيب المعالج.",
  lists: "القوائم في الملخص", specialtyFields: "حقول التخصص", specialtyHint: "أسئلة خاصة بتخصص العيادة. كل منها نعم/لا، أو اختيار، أو نص قصير.",
  fieldEn: "الاسم (إنجليزي)", fieldAr: "الاسم (عربي)", kind: "النوع", yesno: "نعم / لا", choice: "اختيار", text: "نص قصير",
  choices: "الخيارات، واحد في كل سطر: إنجليزي | عربي", addField: "+ إضافة حقل", remove: "حذف",
  fileNumbers: "أرقام الملفات", fileAutoOpt: "تلقائية", fileManualOpt: "يكتبها الطاقم (للعيادات المنتقلة من الملفات الورقية)", nextNo: "الرقم التالي", digits: "عدد الخانات",
  requiredDetails: "المطلوب في بيانات المريض",
  kinds: { allergy: "الحساسية", medicine: "الأدوية الحالية", condition: "الحالات", procedure: "الإجراءات السابقة", family: "التاريخ العائلي" },
  kind1: { allergy: "حساسية", medicine: "دواء", condition: "حالة", procedure: "إجراء", family: "تاريخ عائلي" },
  statuses: { booked: "محجوز", confirmed: "مؤكد", completed: "تمت", no_show: "لم يحضر", cancelled: "ملغى" },
  roles: { clinic_admin: "مدير العيادة", secretary: "سكرتيرة", doctor: "طبيب", readonly: "قراءة فقط", platform_admin: "مدير Limitsiz" },
  detailNames: { birth_date: "تاريخ الميلاد", sex: "الجنس", national_id: "الرقم الوطني", emergency_contact: "جهة اتصال للطوارئ" },
  errors: {
    patient_not_found: "ملف هذا المريض غير متاح.", entry_not_found: "هذا القيد لم يعد موجوداً. أعد تحميل الصفحة.",
    entry_locked: "عُلِّم هذا القيد كمُدخل خطأً ولا يمكن تغييره.", version_conflict: "غيّر شخص آخر هذا قبل لحظة. أعد التحميل لرؤية الأحدث.",
    kind_off: "هذه القائمة متوقفة في الإعدادات.", details_required: "املأ البيانات المطلوبة أولاً.", file_no_taken: "رقم الملف هذا لمريض آخر.",
    birth_date_in_future: "تاريخ الميلاد في المستقبل.", unknown_field: "هذا الحقل لم يعد في الإعدادات. أعد تحميل الصفحة.", invalid_value: "هذه الإجابة لا تناسب الحقل.",
    duplicate_field: "لحقلين الاسم نفسه.", choice_needs_options: "حقل الاختيار يحتاج خياراً واحداً على الأقل.", nothing_to_confirm: "لا يوجد ما يُؤكَّد.",
    forbidden: "غير مسموح لك بهذا الإجراء.", invalid_input: "تحقق مما كتبته.", server_error: "حدث خطأ. حاول مرة أخرى.", bad_origin: "أعد تحميل الصفحة.",
    no_access_to_service: "ليس لديك وصول إلى «السجلات الطبية».",
  },
};

const DICT = { en: EN, ar: AR };
type Key = Exclude<keyof typeof EN, "kinds" | "kind1" | "statuses" | "roles" | "detailNames" | "errors">;
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
    document.title = lang === "ar" ? "Limitsiz Clinic: السجلات الطبية" : "Limitsiz Clinic: Records";
  }, [lang]);
  const setLang = (l: Lang) => { setL(l); try { localStorage.setItem("lc_lang", l); } catch { /* ignore */ } };
  const d = DICT[lang];
  const t: Ctx["t"] = (k, vars) => String(d[k]).replace(/\{(\w+)\}/g, (_, v) => String(vars?.[v] ?? ""));
  return <C.Provider value={{ lang, setLang, t, d, error: (c) => d.errors[c] || d.errors.server_error }}>{children}</C.Provider>;
}
