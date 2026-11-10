import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

// English and Arabic for every piece of text. The Arabic is a working draft for a native reader to review.
const EN = {
  brand: "Limitsiz Clinic", product: "Booking", langSwitch: "العربية",
  calendar: "Calendar", bookings: "Bookings", patients: "Patients", mySchedule: "My schedule", settings: "Settings", bookAnyway: "Book anyway",
  myServices: "My services", switchUser: "Switch user", signOut: "Sign out",
  notAvailable: "This record is not available.", exportExcel: "Export to Excel", exporting: "Preparing the file…", bookThisPatient: "Book this patient", today: "Today", prev: "Previous day", next: "Next day", newBooking: "New booking", allDoctors: "All doctors",
  dayView: "Day", weekView: "Week", thisWeek: "This week", prevWeek: "Previous week", nextWeek: "Next week", closedDay: "Closed", nBooked: "{n} booked",
  tlToday: "Today", tlBooked: "{n} booked", tlNotChecked: "{n} not checked", tlCompleted: "{n} completed", tlNoShow: "{n} no-show",
  tlNextFree: "Next free time: {t}", tlNoFree: "No free time left today", calView: "Calendar view",
  noBookings: "No bookings.", loading: "Loading…", save: "Save", cancel: "Cancel", back: "Back", edit: "Edit", search: "Search", clear: "Clear",
  patient: "Patient", service: "Service", doctor: "Doctor", date: "Date", time: "Time", status: "Status", source: "How it was booked", note: "Internal note",
  noteHint: "Staff only. No medical details here.", phone: "Phone", name: "Name", language: "Language", reminders: "WhatsApp reminders",
  reminderHint: "The patient agreed to receive WhatsApp reminders.", price: "Price", duration: "Duration", min: "min", jod: "JOD",
  anyDoctor: "Any available doctor", pickService: "Choose a service", pickPatient: "Find a patient by name or phone",
  newPatient: "+ New patient", existingPatient: "Choose an existing patient", fullName: "Full name", phoneOptional: "Phone (optional)",
  noPhone: "Without a phone number the patient cannot get WhatsApp reminders.",
  freeTimes: "Free times", noFreeTimes: "No free times that day.", otherTime: "Other time", otherTimeWarn: "This time is outside the doctor's free times. Booking here is allowed, but check it first.",
  confirmOther: "Book this other time", create: "Book", saved: "Saved.", chooseTime: "Choose a time.", lastVisit: "Last visit",
  sources: { whatsapp: "WhatsApp", phone: "Phone", walkin: "Walk-in", staff: "Staff", web: "Online page" } as Record<string, string>,
  roles: { clinic_admin: "Clinic administrator", secretary: "Secretary", doctor: "Doctor", readonly: "Read-only", platform_admin: "Limitsiz administrator" } as Record<string, string>,
  statuses: { booked: "Booked", confirmed: "Confirmed", completed: "Completed", no_show: "No-show", cancelled: "Cancelled", voided: "Voided" } as Record<string, string>,
  actions: { confirmed: "Confirm", completed: "Mark completed", no_show: "No-show", cancelled: "Cancel booking", voided: "Void (delete)", restore: "Restore" } as Record<string, string>,
  reason: "Reason", reasonNeeded: "A reason is needed.", apply: "Apply", details: "Details", history: "History", by: "by",
  historyActions: { created: "Created", status_changed: "Status changed", rescheduled: "Moved or edited", cancelled: "Cancelled", voided: "Voided", restored: "Restored", updated: "Edited", checked: "Checked (online booking)" } as Record<string, string>,
  actors: { agent: "WhatsApp assistant", system: "System", database: "Direct database access", patient: "The patient, online" } as Record<string, string>,
  from: "From", to: "To", showVoided: "Show voided", allStatuses: "All statuses", allSources: "All sources",
  conflictTitle: "Someone changed this booking", conflictBody: "It was changed at {time} (version {v}). Nothing was overwritten. Reload to see the latest.", reload: "Reload",
  patientBookings: "Bookings", newPatientTitle: "New patient", editPatient: "Patient details",
  lockedNote: "Your screen is locked. Please unlock it.",
  warnOutside: "Outside the doctor's free times", warnFlag: "outside free times",
  notChecked: "Online, not checked", markChecked: "Mark as checked", checkHint: "Call or message the number to make sure the booking is real, then mark it as checked.",
  nameDiffers: "Typed online as “{name}”. The patient record was not changed.", forOther: "Booked for someone else", onlineFrom: "Came from",
  movedByPatient: "Time changed by patient", movedHint: "The patient chose this new time on their private link. Press Confirm so they see the clinic agrees, or call them.",
  onlyUnchecked: "Online, waiting for the clinic only", sendLink: "Send booking link", openInRecords: "Open in Records ↗", linkCopied: "Message copied. Paste it into WhatsApp.",
  errors: {
    slot_taken: "That time was just taken. Choose another.", slot_unavailable: "No doctor is free at that time.",
    not_a_free_time: "That is not one of the free times.", patient_exists: "A patient with this phone number already exists.", own_bookings_only: "You can only work with your own bookings.",
    patient_already_booked_then: "This patient already has a booking at that time.", invalid_phone: "That phone number is not valid.",
    in_the_past: "That time has already passed.", too_far_ahead: "That is too far ahead.", reason_required: "A reason is needed.",
    status_change_not_allowed: "That change is not allowed for this booking.", not_editable: "This booking can no longer be edited.",
    forbidden: "You are not allowed to do that.", doctor_does_not_offer_service: "This doctor does not offer that service.",
    invalid_input: "Please check what you typed.", server_error: "Something went wrong. Please try again.", bad_origin: "Please reload the page.",
    not_voided: "This booking is not voided.", unknown_service: "Choose a service.", version_conflict: "Someone changed this booking meanwhile.",
    too_soon: "That is sooner than the clinic's minimum notice.", too_late_to_change: "It is too close to the appointment to change it.",
    over_max_upcoming: "This patient has reached the clinic's limit of upcoming bookings.", outside_hours_blocked: "This clinic does not allow bookings outside the free times.",
    hours_overlap: "Two periods overlap on the same day.", end_before_start: "The end must be after the start.", invalid_timezone: "That time zone is not valid.",
    doctor_hours_outside_clinic: "A doctor's hours must fit inside the clinic's opening hours.", invalid_value: "One of the values is not allowed.",
    nothing_to_check: "This booking is already checked.",
    scribe_off: "Visit notes are off at this clinic.", scribe_not_for_doctor: "Recording is not switched on for you. Write the note by hand.",
    consent_required: "Tick the patient's agreement first.", note_exists: "This visit already has a note. Reload to open it.",
    scribe_daily_limit: "You have reached today's number of recorded notes. Write this one by hand.", visit_not_open: "This booking is cancelled or voided.",
    own_patients_only: "Only the treating doctor can do this.", note_not_found: "This note is not available.", not_recording: "The recording has already stopped.",
    recording_too_long: "The recording reached its longest length.", not_a_draft: "This note is no longer a draft. Reload to see it.",
    dictation_off: "Dictation is off at this clinic (Settings › AI Scribe).", dictation_too_long: "That recording is longer than this clinic allows.",
    nothing_heard: "No speech was heard. Try again, a little closer to the microphone.", speech_failed: "The speech service did not answer. Try again, or type.",
    tidy_failed: "The words could not be sorted into the fields. What was heard is shown below so nothing is lost.",
    whole_note_needs_tidy: "Dictating the whole note needs a model in Settings › AI Scribe › Dictation.", unknown_section: "This field is no longer in the note. Reload the page.",
    dictation_daily_limit: "You have reached today's number of dictations. Type the rest.",
    note_empty: "The note is empty. Write at least one section before signing.", not_signed: "Additions go under a signed note.",
    not_failed: "The draft is still being made.", nothing_to_retry: "Nothing is left to try again with. Write the note by hand.",
    note_signed: "A signed note cannot be thrown away.", duplicate_section: "Two sections have the same key.", empty_audio: "Nothing was recorded.", not_audio: "That is not a recording.",
  } as Record<string, string>,
};

const AR: typeof EN = {
  brand: "Limitsiz Clinic", product: "المواعيد", langSwitch: "English",
  calendar: "التقويم", bookings: "المواعيد", patients: "المرضى", mySchedule: "جدولي", settings: "الإعدادات", bookAnyway: "احجز رغم ذلك",
  myServices: "خدماتي", switchUser: "تبديل المستخدم", signOut: "تسجيل الخروج",
  notAvailable: "هذا السجل غير متاح.", exportExcel: "تصدير إلى Excel", exporting: "جارٍ تجهيز الملف…", bookThisPatient: "احجز لهذا المريض", today: "اليوم", prev: "اليوم السابق", next: "اليوم التالي", newBooking: "حجز جديد", allDoctors: "كل الأطباء",
  dayView: "يوم", weekView: "أسبوع", thisWeek: "هذا الأسبوع", prevWeek: "الأسبوع السابق", nextWeek: "الأسبوع التالي", closedDay: "مغلق", nBooked: "محجوزة: {n}",
  tlToday: "اليوم", tlBooked: "محجوزة: {n}", tlNotChecked: "غير مُراجَعة: {n}", tlCompleted: "مكتملة: {n}", tlNoShow: "لم يحضر: {n}",
  tlNextFree: "أقرب وقت فارغ: {t}", tlNoFree: "لا وقت فارغ متبقٍ اليوم", calView: "طريقة العرض",
  noBookings: "لا توجد مواعيد.", loading: "جارٍ التحميل…", save: "حفظ", cancel: "إلغاء", back: "رجوع", edit: "تعديل", search: "بحث", clear: "مسح",
  patient: "المريض", service: "الخدمة", doctor: "الطبيب", date: "التاريخ", time: "الوقت", status: "الحالة", source: "طريقة الحجز", note: "ملاحظة داخلية",
  noteHint: "للموظفين فقط. بدون تفاصيل طبية.", phone: "الهاتف", name: "الاسم", language: "اللغة", reminders: "تذكيرات واتساب",
  reminderHint: "وافق المريض على استلام تذكيرات واتساب.", price: "السعر", duration: "المدة", min: "دقيقة", jod: "دينار",
  anyDoctor: "أي طبيب متاح", pickService: "اختر الخدمة", pickPatient: "ابحث عن مريض بالاسم أو الهاتف",
  newPatient: "+ مريض جديد", existingPatient: "اختر مريضاً موجوداً", fullName: "الاسم الكامل", phoneOptional: "الهاتف (اختياري)",
  noPhone: "بدون رقم هاتف لا يمكن إرسال تذكيرات واتساب للمريض.",
  freeTimes: "الأوقات المتاحة", noFreeTimes: "لا توجد أوقات متاحة في هذا اليوم.", otherTime: "وقت آخر", otherTimeWarn: "هذا الوقت خارج الأوقات المتاحة للطبيب. الحجز فيه مسموح لكن تحقق منه أولاً.",
  confirmOther: "احجز في هذا الوقت الآخر", create: "احجز", saved: "تم الحفظ.", chooseTime: "اختر وقتاً.", lastVisit: "آخر زيارة",
  sources: { whatsapp: "واتساب", phone: "هاتف", walkin: "حضور مباشر", staff: "موظف", web: "الصفحة الإلكترونية" },
  roles: { clinic_admin: "مدير العيادة", secretary: "سكرتيرة", doctor: "طبيب", readonly: "قراءة فقط", platform_admin: "مدير Limitsiz" },
  statuses: { booked: "محجوز", confirmed: "مؤكد", completed: "مكتمل", no_show: "لم يحضر", cancelled: "ملغى", voided: "مُبطل" },
  actions: { confirmed: "تأكيد", completed: "تم الحضور", no_show: "لم يحضر", cancelled: "إلغاء الحجز", voided: "إبطال (حذف)", restore: "استعادة" },
  reason: "السبب", reasonNeeded: "السبب مطلوب.", apply: "تطبيق", details: "التفاصيل", history: "السجل", by: "بواسطة",
  historyActions: { created: "أُنشئ", status_changed: "تغيّرت الحالة", rescheduled: "نُقل أو عُدّل", cancelled: "أُلغي", voided: "أُبطل", restored: "استُعيد", updated: "عُدّل", checked: "رُوجع (حجز إلكتروني)" },
  actors: { agent: "مساعد واتساب", system: "النظام", database: "وصول مباشر لقاعدة البيانات", patient: "المريض، من الصفحة الإلكترونية" },
  from: "من", to: "إلى", showVoided: "إظهار المُبطلة", allStatuses: "كل الحالات", allSources: "كل الطرق",
  conflictTitle: "شخص آخر غيّر هذا الحجز", conflictBody: "تغيّر في {time} (النسخة {v}). لم يُكتب فوق أي شيء. أعد التحميل لرؤية الأحدث.", reload: "إعادة التحميل",
  patientBookings: "المواعيد", newPatientTitle: "مريض جديد", editPatient: "بيانات المريض",
  lockedNote: "الشاشة مقفلة. افتح القفل من فضلك.",
  warnOutside: "خارج الأوقات المتاحة للطبيب", warnFlag: "خارج الأوقات المتاحة",
  notChecked: "إلكتروني، لم يُراجع", markChecked: "تمّت المراجعة", checkHint: "اتصل أو راسل الرقم للتأكد أن الحجز حقيقي، ثم علّمه كمراجَع.",
  nameDiffers: "كُتب في الصفحة باسم «{name}». لم يتغيّر سجل المريض.", forOther: "حُجز لشخص آخر", onlineFrom: "جاء من",
  movedByPatient: "غيّر المريض الوقت", movedHint: "اختار المريض هذا الوقت الجديد عبر رابطه الخاص. اضغط «تأكيد» ليعرف أن العيادة موافقة، أو اتصل به.",
  onlyUnchecked: "الإلكتروني بانتظار العيادة فقط", sendLink: "إرسال رابط الحجز", openInRecords: "فتح في السجلات الطبية ↗", linkCopied: "نُسخت الرسالة. الصقها في واتساب.",
  errors: {
    slot_taken: "هذا الوقت حُجز للتو. اختر وقتاً آخر.", slot_unavailable: "لا يوجد طبيب متاح في هذا الوقت.",
    not_a_free_time: "هذا ليس من الأوقات المتاحة.", patient_exists: "يوجد مريض بهذا الرقم بالفعل.", own_bookings_only: "يمكنك التعامل مع مواعيدك فقط.",
    patient_already_booked_then: "لدى هذا المريض حجز في هذا الوقت.", invalid_phone: "رقم الهاتف غير صالح.",
    in_the_past: "هذا الوقت مضى.", too_far_ahead: "بعيد جداً في المستقبل.", reason_required: "السبب مطلوب.",
    status_change_not_allowed: "هذا التغيير غير مسموح لهذا الحجز.", not_editable: "لم يعد بالإمكان تعديل هذا الحجز.",
    forbidden: "غير مسموح لك بهذا الإجراء.", doctor_does_not_offer_service: "هذا الطبيب لا يقدّم هذه الخدمة.",
    invalid_input: "تحقق مما كتبته.", server_error: "حدث خطأ. حاول مرة أخرى.", bad_origin: "أعد تحميل الصفحة.",
    not_voided: "هذا الحجز ليس مُبطلاً.", unknown_service: "اختر الخدمة.", version_conflict: "شخص آخر غيّر هذا الحجز.",
    too_soon: "هذا أقرب من أقل مدة تسمح بها العيادة.", too_late_to_change: "الموعد قريب جداً ولا يمكن تغييره.",
    over_max_upcoming: "وصل هذا المريض إلى حد المواعيد القادمة في العيادة.", outside_hours_blocked: "لا تسمح هذه العيادة بالحجز خارج الأوقات المتاحة.",
    hours_overlap: "فترتان متداخلتان في اليوم نفسه.", end_before_start: "يجب أن تكون النهاية بعد البداية.", invalid_timezone: "المنطقة الزمنية غير صالحة.",
    doctor_hours_outside_clinic: "يجب أن تكون ساعات الطبيب ضمن ساعات دوام العيادة.", invalid_value: "إحدى القيم غير مسموحة.",
    nothing_to_check: "هذا الحجز مراجَع بالفعل.",
    scribe_off: "ملاحظات الزيارة مطفأة في هذه العيادة.", scribe_not_for_doctor: "التسجيل غير مفعّل لك. اكتب الملاحظة يدوياً.",
    consent_required: "أشّر على موافقة المريض أولاً.", note_exists: "لهذه الزيارة ملاحظة بالفعل. أعد التحميل لفتحها.",
    scribe_daily_limit: "وصلت إلى عدد الملاحظات المسجّلة لليوم. اكتب هذه الملاحظة يدوياً.", visit_not_open: "هذا الحجز ملغى أو محذوف.",
    own_patients_only: "الطبيب المعالج وحده يستطيع ذلك.", note_not_found: "هذه الملاحظة غير متاحة.", not_recording: "توقف التسجيل بالفعل.",
    recording_too_long: "وصل التسجيل إلى أطول مدة له.", not_a_draft: "لم تعد هذه الملاحظة مسودة. أعد التحميل لرؤيتها.",
    dictation_off: "الإملاء متوقف في هذه العيادة (الإعدادات › الكاتب الذكي).", dictation_too_long: "التسجيل أطول مما تسمح به العيادة.",
    nothing_heard: "لم يُسمع كلام. حاول مجدداً وأنت أقرب إلى الميكروفون.", speech_failed: "لم تستجب خدمة الكلام. حاول مجدداً، أو اكتب.",
    tidy_failed: "تعذّر توزيع الكلمات على الحقول. ما سُمع معروض أدناه كي لا يضيع شيء.",
    whole_note_needs_tidy: "إملاء الملاحظة كاملة يحتاج نموذجاً في الإعدادات › الكاتب الذكي › الإملاء.", unknown_section: "هذا الحقل لم يعد في الملاحظة. أعد تحميل الصفحة.",
    dictation_daily_limit: "وصلت إلى عدد الإملاءات لليوم. اكتب الباقي.",
    note_empty: "الملاحظة فارغة. اكتب قسماً واحداً على الأقل قبل التوقيع.", not_signed: "الإضافات تكون تحت ملاحظة موقّعة.",
    not_failed: "ما زالت المسودة قيد الكتابة.", nothing_to_retry: "لم يبقَ ما يُعاد به. اكتب الملاحظة يدوياً.",
    note_signed: "لا يمكن التخلص من ملاحظة موقّعة.", duplicate_section: "لقسمين المفتاح نفسه.", empty_audio: "لم يُسجَّل شيء.", not_audio: "هذا ليس تسجيلاً.",
  },
};

const DICT = { en: EN, ar: AR };
type Key = Exclude<keyof typeof EN, "roles" | "sources" | "statuses" | "actions" | "historyActions" | "actors" | "errors">;
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
    document.title = lang === "ar" ? "Limitsiz Clinic: المواعيد" : "Limitsiz Clinic: Booking";
  }, [lang]);
  const setLang = (l: Lang) => { setL(l); try { localStorage.setItem("lc_lang", l); } catch { /* ignore */ } };
  const d = DICT[lang];
  const t: Ctx["t"] = (k, vars) => String(d[k]).replace(/\{(\w+)\}/g, (_, v) => String(vars?.[v] ?? ""));
  return <C.Provider value={{ lang, setLang, t, d, error: (c) => d.errors[c] || d.errors.server_error }}>{children}</C.Provider>;
}
