import { useI18n } from "../i18n";

// The Settings pages' text, English and Arabic. The Arabic is a working draft for a native reader to review.
const EN = {
  title: "Settings", readOnly: "You can read these settings. Only a clinic administrator can change them.",
  tabs: { profile: "Clinic profile", hours: "Working hours", doctors: "Doctors", services: "Services", rules: "Booking rules", reminders: "Reminders", assistant: "WhatsApp assistant", security: "Security", audit: "Audit" },
  days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  outsideTitle: "{n} upcoming booking(s) no longer fit.", outsideBody: "Nothing was moved or cancelled. Please contact these patients.",
  nameEn: "Name (English)", nameAr: "Name (Arabic)", addressEn: "Address (English)", addressAr: "Address (Arabic)", maps: "Map link", timezone: "Time zone",
  defaultLanguage: "Default language", weekStart: "Week starts on", clinicInterval: "Appointment interval", clinicIntervalHint: "Used for doctors with no interval of their own.",
  faqTitle: "What the assistant can answer", faqHint: "Payment methods, insurance, preparation advice, parking. The assistant gives these answers word for word.",
  topic: "Topic", questionEn: "Question (English)", questionAr: "Question (Arabic)", answerEn: "Answer (English)", answerAr: "Answer (Arabic)", add: "Add", remove: "Remove", none: "None.",
  openingHours: "Opening hours", openingHint: "Doctors can only be booked inside these hours.", openingNotSet: "Not set yet: each doctor's own hours apply. Once you add hours, a day with none is closed.",
  closed: "Closed", addPeriod: "+ Add period", from: "From", to: "To", closures: "Closures (holidays, trips)", reasonName: "Name",
  doctorDetails: "Doctor details", newDoctor: "+ New doctor", inactive: "not active", active: "Active", titleEn: "Title (English)", titleAr: "Title (Arabic)", gender: "Gender", female: "Female", male: "Male",
  interval: "Appointment interval", intervalHint: "New bookings only. Existing ones stay as they are.", clinicDefault: "Clinic default", buffer: "Buffer after each appointment", noneOption: "None", offOption: "Off",
  doctorHours: "Weekly hours", doctorHoursHint: "Must fit inside the clinic's opening hours.", doctorServices: "Services this doctor offers", leave: "Leave",
  newService: "+ New service", descEn: "Description (English)", descAr: "Description (Arabic)", priceFrom: "This is a starting price (\"from\")", fromPrice: "from",
  neverOverlap: "Whatever these rules say, two bookings of one doctor can never overlap.",
  rulesPatient: "Patients (WhatsApp)", rulesPatientHint: "What the WhatsApp assistant allows.", rulesStaff: "Staff (Booking)", rulesStaffHint: "What secretaries and doctors can do here.",
  minNotice: "Minimum notice", window: "How far ahead", changeNotice: "Change / cancel notice", maxUpcoming: "Most upcoming bookings per patient", maxUpcomingStaffHint: "For staff this only warns.", noLimit: "No limit", daysUnit: "days",
  outsideHours: "Booking outside working hours", ohWarn: "Allow with a warning", ohAllow: "Allow", ohBlock: "Block", walkinBack: "Enter walk-ins up to", requireReason: "Require a reason to cancel",
  remindersOn: "Send WhatsApp reminders", reminder1: "First reminder", reminder2: "Second reminder", noReminder: "No reminder", before: "{t} before", quietFrom: "No sending from", quietTo: "until",
  quietHint: "A reminder due at night goes out when this quiet time ends, if the appointment has not started. Only patients who agreed get reminders.",
  assistantOn: "The assistant answers patients", afterEn: "Message outside working hours (English)", afterAr: "Message outside working hours (Arabic)", afterHint: "Passed on once in a conversation. The assistant keeps working.",
  alertEmails: "Who gets hand-off alert emails", alertHint: "Separate several addresses with commas.", visibility: "What staff may see", visibilityHint: "Takes effect when conversations move into Booking.",
  visNone: "No conversations", visHandoff: "Hand-off chats only", visAll: "All conversations", visAllWarn: "Pending legal review: confirm with your compliance advisor before turning this on for a real clinic. Every opened chat is recorded in the audit trail.",
  lockAfter: "Lock the screen after", lockHint: "The same person unlocks with their password.", idleAfter: "Sign out after", twoStepAll: "Require two-step verification for everyone", twoStepHint: "It is always required for administrators.",
  auditLogHint: "See who did what, check the log is intact, and export it.", openAuditLog: "Open the audit log",
  retention: "Keep the audit trail for", retentionHint: "The minimum is 12 months. Only Limitsiz can go lower. Older entries are removed in the nightly job, and the removal is recorded.", keepForever: "Keep for ever", monthsUnit: "months", yearUnit: "year", yearsUnit: "years",
  min: "min", hour: "hour", hours: "hours", day: "day", dayPlural: "days",
};

const AR: typeof EN = {
  title: "الإعدادات", readOnly: "يمكنك قراءة هذه الإعدادات. مدير العيادة فقط يمكنه تغييرها.",
  tabs: { profile: "ملف العيادة", hours: "ساعات العمل", doctors: "الأطباء", services: "الخدمات", rules: "قواعد الحجز", reminders: "التذكيرات", assistant: "مساعد واتساب", security: "الأمان", audit: "سجل التدقيق" },
  days: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  outsideTitle: "{n} حجز قادم لم يعد مناسباً.", outsideBody: "لم يُنقل أو يُلغَ أي حجز. تواصل مع هؤلاء المرضى من فضلك.",
  nameEn: "الاسم (إنجليزي)", nameAr: "الاسم (عربي)", addressEn: "العنوان (إنجليزي)", addressAr: "العنوان (عربي)", maps: "رابط الخريطة", timezone: "المنطقة الزمنية",
  defaultLanguage: "اللغة الافتراضية", weekStart: "يبدأ الأسبوع يوم", clinicInterval: "الفاصل بين المواعيد", clinicIntervalHint: "يُستخدم للأطباء الذين ليس لهم فاصل خاص.",
  faqTitle: "ما يمكن للمساعد الإجابة عنه", faqHint: "طرق الدفع والتأمين وتعليمات التحضير والمواقف. يعطي المساعد هذه الإجابات كما هي.",
  topic: "الموضوع", questionEn: "السؤال (إنجليزي)", questionAr: "السؤال (عربي)", answerEn: "الإجابة (إنجليزي)", answerAr: "الإجابة (عربي)", add: "إضافة", remove: "إزالة", none: "لا يوجد.",
  openingHours: "ساعات الدوام", openingHint: "لا يمكن الحجز مع الأطباء إلا ضمن هذه الساعات.", openingNotSet: "لم تُحدَّد بعد: تُطبَّق ساعات كل طبيب. بعد الإضافة، أي يوم بلا ساعات يعتبر مغلقاً.",
  closed: "مغلق", addPeriod: "+ إضافة فترة", from: "من", to: "إلى", closures: "الإغلاقات (عطل، سفر)", reasonName: "الاسم",
  doctorDetails: "بيانات الطبيب", newDoctor: "+ طبيب جديد", inactive: "غير نشط", active: "نشط", titleEn: "اللقب (إنجليزي)", titleAr: "اللقب (عربي)", gender: "الجنس", female: "أنثى", male: "ذكر",
  interval: "الفاصل بين المواعيد", intervalHint: "للحجوزات الجديدة فقط. تبقى الحجوزات الحالية كما هي.", clinicDefault: "افتراضي العيادة", buffer: "فاصل بعد كل موعد", noneOption: "بدون", offOption: "إيقاف",
  doctorHours: "الساعات الأسبوعية", doctorHoursHint: "يجب أن تكون ضمن ساعات دوام العيادة.", doctorServices: "الخدمات التي يقدّمها الطبيب", leave: "الإجازات",
  newService: "+ خدمة جديدة", descEn: "الوصف (إنجليزي)", descAr: "الوصف (عربي)", priceFrom: "هذا سعر يبدأ من", fromPrice: "من",
  neverOverlap: "مهما كانت هذه القواعد، لا يمكن أن يتداخل حجزان لطبيب واحد.",
  rulesPatient: "المرضى (واتساب)", rulesPatientHint: "ما يسمح به مساعد واتساب.", rulesStaff: "الموظفون (الحجوزات)", rulesStaffHint: "ما يمكن للسكرتيرات والأطباء فعله هنا.",
  minNotice: "أقل مدة قبل الموعد", window: "أقصى مدة مقدماً", changeNotice: "مهلة التغيير أو الإلغاء", maxUpcoming: "أقصى عدد حجوزات قادمة للمريض", maxUpcomingStaffHint: "للموظفين يظهر تحذير فقط.", noLimit: "بلا حد", daysUnit: "يوماً",
  outsideHours: "الحجز خارج ساعات العمل", ohWarn: "مسموح مع تحذير", ohAllow: "مسموح", ohBlock: "ممنوع", walkinBack: "تسجيل الحضور المباشر حتى", requireReason: "طلب سبب عند الإلغاء",
  remindersOn: "إرسال تذكيرات واتساب", reminder1: "التذكير الأول", reminder2: "التذكير الثاني", noReminder: "بدون تذكير", before: "قبل {t}", quietFrom: "عدم الإرسال من", quietTo: "حتى",
  quietHint: "التذكير المستحق ليلاً يُرسل عند انتهاء هذه الفترة إذا لم يبدأ الموعد. تصل التذكيرات فقط لمن وافق عليها.",
  assistantOn: "المساعد يرد على المرضى", afterEn: "رسالة خارج ساعات العمل (إنجليزي)", afterAr: "رسالة خارج ساعات العمل (عربي)", afterHint: "تُذكر مرة واحدة في المحادثة. يستمر المساعد في العمل.",
  alertEmails: "من يستلم تنبيهات التحويل بالبريد", alertHint: "افصل بين العناوين بفواصل.", visibility: "ما يمكن للموظفين رؤيته", visibilityHint: "يُطبَّق عند نقل المحادثات إلى الحجوزات.",
  visNone: "لا محادثات", visHandoff: "المحادثات المحوّلة فقط", visAll: "كل المحادثات", visAllWarn: "بانتظار المراجعة القانونية: تأكد مع مستشار الامتثال قبل تفعيلها لعيادة حقيقية. كل محادثة تُفتح تُسجَّل في سجل التدقيق.",
  lockAfter: "قفل الشاشة بعد", lockHint: "يفتحها الشخص نفسه بكلمة المرور.", idleAfter: "تسجيل الخروج بعد", twoStepAll: "طلب التحقق بخطوتين من الجميع", twoStepHint: "مطلوب دائماً من المدراء.",
  auditLogHint: "اعرف من فعل ماذا، وافحص سلامة السجل، وصدّره.", openAuditLog: "فتح سجل التدقيق",
  retention: "الاحتفاظ بسجل التدقيق لمدة", retentionHint: "الحد الأدنى 12 شهراً. Limitsiz فقط يمكنها التخفيض. تُحذف السجلات الأقدم في الفحص الليلي، ويُسجَّل الحذف.", keepForever: "الاحتفاظ دائماً", monthsUnit: "شهراً", yearUnit: "سنة", yearsUnit: "سنوات",
  min: "دقيقة", hour: "ساعة", hours: "ساعات", day: "يوم", dayPlural: "أيام",
};

export const useS = () => (useI18n().lang === "ar" ? AR : EN);
export function duration(m: number, s: typeof EN): string {
  if (m >= 1440 && m % 1440 === 0) { const d = m / 1440; return `${d} ${d === 1 ? s.day : s.dayPlural}`; }
  if (m >= 60 && m % 60 === 0) { const h = m / 60; return `${h} ${h === 1 ? s.hour : s.hours}`; }
  return `${m} ${s.min}`;
}
