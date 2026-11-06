import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

// Every piece of text has English and Arabic. The Arabic is a working draft: a native reader should review it before launch.
const EN = {
  brand: "Limitsiz Clinic",
  langSwitch: "العربية",
  signInTitle: "Sign in to Limitsiz Clinic",
  signInSub: "One account for all Limitsiz Clinic services.",
  email: "Email", password: "Password", signIn: "Sign in", forgot: "Forgot your password?",
  noSignup: "There is no sign-up. Your clinic administrator invites you by email.",
  working: "One moment…",
  mfaTitle: "Two-step verification", mfaSub: "Enter the 6-digit code from your authenticator app.",
  code: "Code", verify: "Verify", useRecovery: "Use a recovery code instead", useApp: "Use the authenticator app instead",
  recoveryCode: "Recovery code", cancel: "Cancel",
  mfaSetupTitle: "Set up two-step verification",
  mfaSetupSub: "Administrators must use it. Scan the code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy), then type the 6-digit code it shows.",
  secretKey: "Or type this key into the app", turnOn: "Turn on",
  recoveryTitle: "Save your recovery codes",
  recoverySub: "Each code works once if you lose your phone. Keep them somewhere safe; they are not shown again.",
  recoverySaved: "I saved them", copyAll: "Copy all",
  lockedTitle: "Screen locked", lockedSub: "Locked for your privacy. Enter your password to continue as {name}.",
  unlock: "Unlock", notYou: "Not you? Switch user",
  chooseTitle: "Choose a clinic", chooseSub: "Your account works in more than one clinic.",
  appsTitle: "My services", hello: "Hello, {name}", noApps: "You do not have access to any service yet. Ask your clinic administrator.",
  openApp: "Open",
  signOut: "Sign out", lock: "Lock screen", switchUser: "Switch user", account: "My account", users: "People",
  forgotTitle: "Reset your password", forgotSub: "Enter your email. If it belongs to an account, we send a link that works for one hour.",
  sendLink: "Send link", forgotDone: "If that email has an account, a link is on its way.", backToSignIn: "Back to sign in",
  resetTitle: "Choose a new password", newPassword: "New password", savePassword: "Save password", resetDone: "Your password is changed. Sign in with it.",
  passwordHint: "At least 12 characters. A short sentence works well.",
  acceptTitle: "Welcome to Limitsiz Clinic", acceptSub: "{clinic} invited you as {role}. Choose your password to finish.",
  yourName: "Your name", createAccount: "Create my account", acceptDone: "Your account is ready. Sign in.", existingAccount: "You already have an account. Enter your current password to join.",
  noAccessTitle: "No access to this service", noAccessSub: "Your account is not allowed to use it. Ask your clinic administrator.",
  accountTitle: "My account", name: "Name", language: "Language", save: "Save", saved: "Saved.",
  changePassword: "Change password", currentPassword: "Current password", changed: "Password changed. Your other sessions were signed out.",
  twoStep: "Two-step verification", on: "On", off: "Off", setUp: "Set up",
  mySessions: "My sessions", thisSession: "This session", endSession: "End", lastActive: "Last active", device: "Device",
  usersTitle: "People and access", invite: "Invite someone", fullName: "Full name", role: "Role", doctorRecord: "Doctor record", sendInvite: "Send invitation",
  inviteSent: "Invitation sent. The link works once, for 72 hours.", inviteLink: "Invitation link (shown because email is not set up):",
  pending: "Invited", active: "Active", disabled: "Disabled", twoStepCol: "2-step", lastSignIn: "Last sign-in", sessionsCol: "Sessions", never: "never",
  canManage: "Can also manage bookings", disable: "Disable", enable: "Enable", signOutEverywhere: "Sign out everywhere", sendReset: "Send reset link",
  resetSent: "Reset link sent.", signedOutN: "{n} session(s) ended.",
  confirmTitle: "Confirm your password", confirmSub: "This is a sensitive change. Enter your password to continue.", confirm: "Confirm",
  roles: { clinic_admin: "Clinic administrator", secretary: "Secretary", doctor: "Doctor", readonly: "Read-only", platform_admin: "Limitsiz administrator" } as Record<string, string>,
  apps: { booking: "Booking" } as Record<string, string>,
  appDesc: { booking: "Appointments, patients, and the WhatsApp assistant." } as Record<string, string>,
  footer: "Limitsiz",
  errors: {
    invalid_credentials: "The email or password is not right, or the account is locked for a few minutes.",
    too_many_requests: "Too many attempts. Please wait a few minutes.",
    invalid_code: "That code is not right.",
    password_required: "Please confirm your password first.",
    weak_password: "That password is too weak.",
    invite_invalid: "This invitation link is not valid any more. Ask for a new one.",
    reset_invalid: "This reset link is not valid any more. Ask for a new one.",
    forbidden: "You are not allowed to do that.",
    last_administrator: "A clinic must keep at least one administrator.",
    cannot_change_own_access: "You cannot change your own access.",
    doctor_record_required: "Choose which doctor this login belongs to.",
    already_member: "This person already has access to this clinic.",
    not_in_setup: "Start the set-up again.",
    bad_origin: "Please reload the page and try again.",
    server_error: "Something went wrong on our side. Please try again.",
    invalid_input: "Please check what you typed.",
  } as Record<string, string>,
  weak: { too_short: "Use at least 12 characters.", too_long: "That is too long.", common: "That password is too common.", contains_email: "It should not contain your email.", contains_name: "It should not contain your name.", too_simple: "Use a less repetitive password." } as Record<string, string>,
};

const AR: typeof EN = {
  brand: "Limitsiz Clinic",
  langSwitch: "English",
  signInTitle: "تسجيل الدخول إلى Limitsiz Clinic",
  signInSub: "حساب واحد لجميع خدمات Limitsiz Clinic.",
  email: "البريد الإلكتروني", password: "كلمة المرور", signIn: "تسجيل الدخول", forgot: "نسيت كلمة المرور؟",
  noSignup: "لا يوجد تسجيل ذاتي. يدعوك مدير العيادة عبر البريد الإلكتروني.",
  working: "لحظة…",
  mfaTitle: "التحقق بخطوتين", mfaSub: "أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.",
  code: "الرمز", verify: "تحقق", useRecovery: "استخدم رمز استرداد بدلاً من ذلك", useApp: "استخدم تطبيق المصادقة بدلاً من ذلك",
  recoveryCode: "رمز الاسترداد", cancel: "إلغاء",
  mfaSetupTitle: "إعداد التحقق بخطوتين",
  mfaSetupSub: "مطلوب من المدراء. امسح الرمز بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو Authy) ثم اكتب الرمز المكوّن من 6 أرقام الذي يظهر فيه.",
  secretKey: "أو اكتب هذا المفتاح في التطبيق", turnOn: "تفعيل",
  recoveryTitle: "احفظ رموز الاسترداد",
  recoverySub: "يعمل كل رمز مرة واحدة إذا فقدت هاتفك. احتفظ بها في مكان آمن؛ لن تظهر مرة أخرى.",
  recoverySaved: "حفظتها", copyAll: "نسخ الكل",
  lockedTitle: "الشاشة مقفلة", lockedSub: "قُفلت الشاشة لحماية الخصوصية. أدخل كلمة المرور للمتابعة باسم {name}.",
  unlock: "فتح القفل", notYou: "لست أنت؟ بدّل المستخدم",
  chooseTitle: "اختر العيادة", chooseSub: "حسابك يعمل في أكثر من عيادة.",
  appsTitle: "خدماتي", hello: "مرحباً، {name}", noApps: "ليس لديك صلاحية على أي خدمة بعد. اطلب من مدير العيادة.",
  openApp: "فتح",
  signOut: "تسجيل الخروج", lock: "قفل الشاشة", switchUser: "تبديل المستخدم", account: "حسابي", users: "الأشخاص",
  forgotTitle: "إعادة تعيين كلمة المرور", forgotSub: "أدخل بريدك الإلكتروني. إذا كان لحساب موجود نرسل رابطاً يعمل لمدة ساعة.",
  sendLink: "إرسال الرابط", forgotDone: "إذا كان لهذا البريد حساب فسيصله رابط.", backToSignIn: "العودة لتسجيل الدخول",
  resetTitle: "اختر كلمة مرور جديدة", newPassword: "كلمة المرور الجديدة", savePassword: "حفظ كلمة المرور", resetDone: "تم تغيير كلمة المرور. سجّل الدخول بها.",
  passwordHint: "12 حرفاً على الأقل. جملة قصيرة تفي بالغرض.",
  acceptTitle: "أهلاً بك في Limitsiz Clinic", acceptSub: "دعتك {clinic} بصفة {role}. اختر كلمة المرور لإكمال التسجيل.",
  yourName: "اسمك", createAccount: "إنشاء حسابي", acceptDone: "حسابك جاهز. سجّل الدخول.", existingAccount: "لديك حساب بالفعل. أدخل كلمة مرورك الحالية للانضمام.",
  noAccessTitle: "لا صلاحية على هذه الخدمة", noAccessSub: "حسابك غير مسموح له باستخدامها. اطلب من مدير العيادة.",
  accountTitle: "حسابي", name: "الاسم", language: "اللغة", save: "حفظ", saved: "تم الحفظ.",
  changePassword: "تغيير كلمة المرور", currentPassword: "كلمة المرور الحالية", changed: "تم تغيير كلمة المرور وإنهاء جلساتك الأخرى.",
  twoStep: "التحقق بخطوتين", on: "مفعّل", off: "غير مفعّل", setUp: "إعداد",
  mySessions: "جلساتي", thisSession: "هذه الجلسة", endSession: "إنهاء", lastActive: "آخر نشاط", device: "الجهاز",
  usersTitle: "الأشخاص والصلاحيات", invite: "دعوة شخص", fullName: "الاسم الكامل", role: "الدور", doctorRecord: "سجل الطبيب", sendInvite: "إرسال الدعوة",
  inviteSent: "أُرسلت الدعوة. يعمل الرابط مرة واحدة ولمدة 72 ساعة.", inviteLink: "رابط الدعوة (يظهر لأن البريد غير مُعدّ):",
  pending: "مدعو", active: "نشط", disabled: "معطّل", twoStepCol: "الخطوتان", lastSignIn: "آخر دخول", sessionsCol: "الجلسات", never: "أبداً",
  canManage: "يمكنه أيضاً إدارة الحجوزات", disable: "تعطيل", enable: "تفعيل", signOutEverywhere: "تسجيل الخروج من كل مكان", sendReset: "إرسال رابط إعادة التعيين",
  resetSent: "أُرسل رابط إعادة التعيين.", signedOutN: "تم إنهاء {n} جلسة.",
  confirmTitle: "أكّد كلمة المرور", confirmSub: "هذا تغيير حساس. أدخل كلمة المرور للمتابعة.", confirm: "تأكيد",
  roles: { clinic_admin: "مدير العيادة", secretary: "سكرتيرة", doctor: "طبيب", readonly: "قراءة فقط", platform_admin: "مدير Limitsiz" },
  apps: { booking: "الحجوزات" },
  appDesc: { booking: "المواعيد والمرضى ومساعد واتساب." },
  footer: "Limitsiz",
  errors: {
    invalid_credentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الحساب مقفل لبضع دقائق.",
    too_many_requests: "محاولات كثيرة. انتظر بضع دقائق.",
    invalid_code: "الرمز غير صحيح.",
    password_required: "أكّد كلمة المرور أولاً.",
    weak_password: "كلمة المرور ضعيفة.",
    invite_invalid: "رابط الدعوة لم يعد صالحاً. اطلب رابطاً جديداً.",
    reset_invalid: "رابط إعادة التعيين لم يعد صالحاً. اطلب رابطاً جديداً.",
    forbidden: "غير مسموح لك بهذا الإجراء.",
    last_administrator: "يجب أن يبقى للعيادة مدير واحد على الأقل.",
    cannot_change_own_access: "لا يمكنك تغيير صلاحياتك بنفسك.",
    doctor_record_required: "اختر الطبيب الذي يخص هذا الحساب.",
    already_member: "هذا الشخص لديه صلاحية على هذه العيادة بالفعل.",
    not_in_setup: "ابدأ الإعداد من جديد.",
    bad_origin: "أعد تحميل الصفحة وحاول مرة أخرى.",
    server_error: "حدث خطأ من جهتنا. حاول مرة أخرى.",
    invalid_input: "تحقق مما كتبته.",
  },
  weak: { too_short: "استخدم 12 حرفاً على الأقل.", too_long: "طويلة جداً.", common: "كلمة المرور شائعة جداً.", contains_email: "يجب ألا تحتوي بريدك الإلكتروني.", contains_name: "يجب ألا تحتوي اسمك.", too_simple: "استخدم كلمة مرور أقل تكراراً." },
};

const DICT = { en: EN, ar: AR };
type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: Exclude<keyof typeof EN, "roles" | "apps" | "appDesc" | "errors" | "weak">, vars?: Record<string, string | number>) => string; dict: typeof EN; error: (code: string, reason?: string) => string };
const I18n = createContext<Ctx>(null as never);
export const useI18n = () => useContext(I18n);

function initialLang(): Lang {
  try { const s = localStorage.getItem("lc_lang"); if (s === "ar" || s === "en") return s; } catch { /* storage blocked */ }
  return navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = lang === "ar" ? "Limitsiz Clinic: الحسابات" : "Limitsiz Clinic: Accounts";
  }, [lang]);
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem("lc_lang", l); } catch { /* ignore */ } };
  const dict = DICT[lang];
  const t: Ctx["t"] = (key, vars) => String(dict[key]).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ""));
  const error = (code: string, reason?: string) => (code === "weak_password" && reason && dict.weak[reason]) || dict.errors[code] || dict.errors.server_error;
  return <I18n.Provider value={{ lang, setLang, t, dict, error }}>{children}</I18n.Provider>;
}
