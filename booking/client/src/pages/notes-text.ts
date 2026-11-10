import { useI18n } from "../i18n";

// The visit note screens (AI Scribe), English and Arabic. The Arabic is a working draft for a native reader to review.
const EN = {
  start: "Start visit note", open: "Open visit note", noteLine: "Visit note", none: "none yet",
  states: { recording: "Recording", processing: "Making the draft", draft: "Draft, not signed", failed: "Draft failed", signed: "Signed" } as Record<string, string>,
  patientStates: { recording: "Being recorded", processing: "Draft being made", draft: "Draft, not signed", failed: "Draft failed", signed: "Signed", manual: "Written by hand",
    additions: "+ {n} addition(s)" } as Record<string, string>,
  title: "Visit note", back: "Back to the booking", off: "Visit notes are off at this clinic. A clinic administrator can switch them on in Settings › AI Scribe.",
  notTheDoctor: "Only the treating doctor writes and signs this note.", closedVisit: "This booking is cancelled or voided, so it has no visit note.",
  // consent
  readThis: "Read this to the patient", englishVersion: "English version", agreed: "The patient agreed to this visit being recorded",
  startRecording: "Start recording", writeByHand: "Write without recording", unlockHint: "The button unlocks when the box is ticked. The agreement is saved in the audit log with the time.",
  recordingOffForYou: "Recording is not switched on for you. You can write the note by hand.",
  standIn: "Test mode: the speech service is a stand-in. The transcript and the draft are a sample consultation, not this visit, and no audio leaves the clinic.",
  // recording
  recording: "Recording", paused: "Paused", pause: "Pause", resume: "Resume", stopAndMake: "Stop and make the note", discard: "Discard",
  leaveHint: "Leaving this page stops the recording. Nothing is saved as a note until you sign.", maxHint: "Stops by itself after {n} minutes.",
  noMic: "The microphone could not be opened. Allow it in the browser, or write the note by hand.", micBusy: "Starting the microphone…",
  uploadTrouble: "Some of the recording could not be sent. Check the connection; it keeps trying.",
  confirmDiscard: "Throw away this note? Its recording, transcript and text are deleted.",
  // processing and failure
  making: "Making the draft… This usually takes under a minute.", slow: "This is taking longer than usual.",
  failed: "The Scribe could not make the draft.", tryAgain: "Try again",
  errorCodes: { no_audio: "No sound was recorded.", nothing_heard: "No speech was heard in the recording.", speech_failed: "The speech service did not answer.",
    draft_refused: "The draft was refused.", draft_empty: "The draft came back empty." } as Record<string, string>,
  // draft
  unsure: "unsure word", medicine: "medicine or dose", clickToEdit: "Click any part to edit.", saveDraft: "Save draft", reviewSign: "Review and sign",
  usedAfterSign: "The note is used only after you sign.", saved: "Saved.", transcript: "Transcript", keptDays: "Kept {n} days to check the note (Settings), then deleted.",
  transcriptGone: "The transcript was deleted after the clinic's keep days.", noTranscript: "No transcript: this note was written by hand.",
  who: { doctor: "Doctor", patient: "Patient", other: "Other" } as Record<string, string>, empty: "(empty)",
  // sign
  signTitle: "Sign this note?", readAll: "I have read the whole note and checked the medicines and doses.", signNote: "Sign note", backToDraft: "Back to the draft",
  signedBy: "Signed by {name}, {when}.", aiLine: "Drafted with AI Scribe, reviewed and signed by the doctor.", handLine: "Written and signed by the doctor.",
  additions: "Additions", addAddition: "Add an addition", additionHint: "A signed note never changes. An addition is dated and kept under it.", add: "Add", cancel: "Cancel",
  addedBy: "{name}, {when}",
  // patient page
  filter: { "": "All", none: "None yet", unsigned: "Not signed", signed: "Signed" } as Record<string, string>,
  notesTitle: "Visit notes", notesNone: "No visit notes.", date: "Date", doctor: "Doctor", visit: "Visit", note: "Note",
  // dictation (design: booking/design/dictation.html)
  dictate: "Dictate", wholeTitle: "Dictate the whole note", wholeHint: "Talk through the visit once; each part goes to its field. Fields you do not mention stay as they are.",
  wholeStart: "Start", wholeRec: "Recording the whole note", wholeStop: "Stop and fill the fields", wholeBusy: "Sorting what you said into the fields…",
  fieldStop: "Stop and insert", fieldBusy: "Writing what you said…", heard: "Heard:", undo: "Undo", tidyFailed: "Could not be tidied: inserted exactly as heard.",
  noMicDictate: "The microphone could not be opened. Allow it in the browser, or type.", standInDictate: "Test mode: dictation puts sample words in, not what you said.",
  heardWhole: "Heard (whole note):",
  fromChart: "From the chart", openRecords: "Open in Records ↗", chartAllergy: "Allergy", chartAlert: { medicine: "Medicine", condition: "Condition", procedure: "Procedure", family: "Family" } as Record<string, string>,
  chartMedicines: "Medicines", chartConditions: "Conditions", chartNone: "Nothing recorded in the chart yet.",
};

const AR: typeof EN = {
  start: "ابدأ ملاحظة الزيارة", open: "افتح ملاحظة الزيارة", noteLine: "ملاحظة الزيارة", none: "لا يوجد بعد",
  states: { recording: "يسجّل", processing: "تُكتب المسودة", draft: "مسودة، غير موقّعة", failed: "تعذّرت المسودة", signed: "موقّعة" },
  patientStates: { recording: "قيد التسجيل", processing: "تُكتب المسودة", draft: "مسودة، غير موقّعة", failed: "تعذّرت المسودة", signed: "موقّعة", manual: "مكتوبة يدوياً",
    additions: "+ {n} إضافة" },
  title: "ملاحظة الزيارة", back: "العودة إلى الحجز", off: "ملاحظات الزيارة مطفأة في هذه العيادة. يستطيع مدير العيادة تشغيلها من الإعدادات › الكاتب الذكي.",
  notTheDoctor: "الطبيب المعالج وحده يكتب هذه الملاحظة ويوقّعها.", closedVisit: "هذا الحجز ملغى أو محذوف، فلا ملاحظة زيارة له.",
  readThis: "اقرأ هذا للمريض", englishVersion: "النسخة الإنجليزية", agreed: "وافق المريض على تسجيل هذه الزيارة",
  startRecording: "ابدأ التسجيل", writeByHand: "اكتب بدون تسجيل", unlockHint: "يُفتح الزر عند التأشير. تُحفظ الموافقة في سجل التدقيق مع الوقت.",
  recordingOffForYou: "التسجيل غير مفعّل لك. يمكنك كتابة الملاحظة يدوياً.",
  standIn: "وضع الاختبار: خدمة الكلام بديلة. النص والمسودة لاستشارة نموذجية وليست هذه الزيارة، ولا يخرج أي صوت من العيادة.",
  recording: "يسجّل", paused: "متوقف مؤقتاً", pause: "إيقاف مؤقت", resume: "متابعة", stopAndMake: "إنهاء وكتابة الملاحظة", discard: "تجاهل",
  leaveHint: "مغادرة الصفحة توقف التسجيل. لا يُحفظ شيء كملاحظة قبل توقيعك.", maxHint: "يتوقف وحده بعد {n} دقيقة.",
  noMic: "تعذّر فتح الميكروفون. اسمح به في المتصفح، أو اكتب الملاحظة يدوياً.", micBusy: "يجري تشغيل الميكروفون…",
  uploadTrouble: "تعذّر إرسال جزء من التسجيل. تحقق من الاتصال؛ المحاولة مستمرة.",
  confirmDiscard: "تجاهل هذه الملاحظة؟ يُحذف تسجيلها ونصها ومحتواها.",
  making: "تُكتب المسودة… يستغرق ذلك عادة أقل من دقيقة.", slow: "يستغرق هذا وقتاً أطول من المعتاد.",
  failed: "تعذّر على الكاتب الذكي كتابة المسودة.", tryAgain: "حاول مجدداً",
  errorCodes: { no_audio: "لم يُسجَّل أي صوت.", nothing_heard: "لم يُسمع كلام في التسجيل.", speech_failed: "لم تستجب خدمة الكلام.",
    draft_refused: "رُفضت المسودة.", draft_empty: "عادت المسودة فارغة." },
  unsure: "كلمة غير مؤكدة", medicine: "دواء أو جرعة", clickToEdit: "اضغط على أي جزء للتعديل.", saveDraft: "حفظ المسودة", reviewSign: "مراجعة وتوقيع",
  usedAfterSign: "تُستخدم الملاحظة فقط بعد توقيعك.", saved: "حُفظ.", transcript: "النص", keptDays: "يُحفظ {n} يوماً للتحقق من الملاحظة (الإعدادات)، ثم يُحذف.",
  transcriptGone: "حُذف النص بعد مدة الاحتفاظ في العيادة.", noTranscript: "لا نص: كُتبت هذه الملاحظة يدوياً.",
  who: { doctor: "الطبيب", patient: "المريض", other: "آخر" }, empty: "(فارغ)",
  signTitle: "توقيع هذه الملاحظة؟", readAll: "قرأت الملاحظة كاملة وتحققت من الأدوية والجرعات.", signNote: "وقّع الملاحظة", backToDraft: "العودة إلى المسودة",
  signedBy: "وقّعها {name}، {when}.", aiLine: "صيغت بالكاتب الذكي، وراجعها الطبيب ووقّعها.", handLine: "كتبها الطبيب ووقّعها.",
  additions: "الإضافات", addAddition: "أضف إضافة", additionHint: "الملاحظة الموقّعة لا تتغير. الإضافة مؤرخة وتُحفظ تحتها.", add: "أضف", cancel: "إلغاء",
  addedBy: "{name}، {when}",
  filter: { "": "الكل", none: "لا يوجد بعد", unsigned: "غير موقّعة", signed: "موقّعة" },
  notesTitle: "ملاحظات الزيارات", notesNone: "لا توجد ملاحظات زيارات.", date: "التاريخ", doctor: "الطبيب", visit: "الزيارة", note: "الملاحظة",
  dictate: "إملاء", wholeTitle: "إملاء الملاحظة كاملة", wholeHint: "تحدّث عن الزيارة مرة واحدة، فيذهب كل جزء إلى حقله. الحقول التي لا تذكرها تبقى كما هي.",
  wholeStart: "ابدأ", wholeRec: "تسجيل الملاحظة كاملة", wholeStop: "إيقاف وتعبئة الحقول", wholeBusy: "نرتّب ما قلته في الحقول…",
  fieldStop: "إيقاف وإدراج", fieldBusy: "نكتب ما قلته…", heard: "سُمع:", undo: "تراجع", tidyFailed: "تعذّر الترتيب: أُدرج كما سُمع تماماً.",
  noMicDictate: "تعذّر فتح الميكروفون. اسمح به في المتصفح، أو اكتب.", standInDictate: "وضع الاختبار: الإملاء يضع كلمات تجريبية، لا ما قلته.",
  heardWhole: "سُمع (الملاحظة كاملة):",
  fromChart: "من الملف", openRecords: "فتح في السجلات الطبية ↗", chartAllergy: "حساسية", chartAlert: { medicine: "دواء", condition: "حالة", procedure: "إجراء", family: "عائلي" },
  chartMedicines: "الأدوية", chartConditions: "الحالات", chartNone: "لا شيء مسجّل في الملف بعد.",
};

// The visit note's state as a small coloured label (Bookings list, booking page).
export const NOTE_PILL: Record<string, string> = { signed: "ok", draft: "warn", recording: "bad", failed: "bad", processing: "" };

export const useN = () => (useI18n().lang === "ar" ? AR : EN);
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
