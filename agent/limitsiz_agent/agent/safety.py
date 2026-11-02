"""Checks that run before the AI sees a message, so they do not depend on the model getting them right."""

import re
import unicodedata

# Jordan's emergency number.
EMERGENCY_NUMBER = "911"

# Clear emergency signs only; anything subtler is left to the model's own hand-off rule.
_EMERGENCY = [
    # Arabic (MSA and Jordanian)
    "ألم في الصدر", "الم في الصدر", "وجع في صدري", "وجع بصدري", "ضيق تنفس", "ضيق في التنفس", "مش قادر اتنفس",
    "مش قادرة اتنفس", "ما بقدر اتنفس", "لا أستطيع التنفس", "نزيف", "فقدان الوعي", "اغمي عليه", "أغمي عليه",
    "انتحار", "بدي انتحر", "اقتل نفسي", "أقتل نفسي", "تورم الوجه", "تورم الحلق", "انتفاخ الحلق", "تسمم", "جلطة",
    # English
    "chest pain", "can't breathe", "cannot breathe", "cant breathe", "difficulty breathing", "shortness of breath",
    "bleeding heavily", "heavy bleeding", "unconscious", "passed out", "suicide", "kill myself", "end my life",
    "throat is swelling", "face is swelling", "anaphylaxis", "overdose", "poisoning", "stroke", "seizure",
]

_YES = {
    "نعم", "ايوه", "ايوا", "أيوه", "اه", "آه", "اي", "إي", "أكيد", "اكيد", "تمام", "موافق", "موافقة", "اكد", "أكد",
    "تأكيد", "تاكيد", "احجز", "احجزي", "ماشي", "طيب", "يلا", "بالزبط", "بالضبط",
    "yes", "y", "yeah", "yep", "yup", "ok", "okay", "sure", "confirm", "confirmed", "correct", "go ahead", "book it",
    "👍", "✅", "👌",
}
_NO = {
    "لا", "لأ", "لاء", "مش", "بلاش", "الغي", "ألغي", "الغاء", "إلغاء", "لا شكرا", "لا شكراً", "مش هلأ",
    "no", "n", "nope", "nah", "cancel", "don't", "dont", "not now", "no thanks",
    "👎", "❌",
}
# WhatsApp button replies (step 5) arrive as exact payloads.
YES_PAYLOAD = "CONFIRM_YES"
NO_PAYLOAD = "CONFIRM_NO"


def normalize(text: str) -> str:
    """Lower case, no Arabic diacritics or tatweel, collapsed spaces, without trailing punctuation."""
    text = unicodedata.normalize("NFKC", text or "").lower()
    text = re.sub(r"[ً-ْـ]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip(" .!؟?،,")


def is_emergency(text: str) -> bool:
    t = normalize(text)
    return any(normalize(k) in t for k in _EMERGENCY)


def confirmation_answer(text: str) -> str | None:
    """'yes' or 'no' when the whole reply is a clear yes or no, otherwise None (anything else means
    the patient did not confirm, and the waiting change is dropped)."""
    if text.strip() == YES_PAYLOAD:
        return "yes"
    if text.strip() == NO_PAYLOAD:
        return "no"
    t = normalize(text)
    if t in _YES:
        return "yes"
    if t in _NO:
        return "no"
    # Short replies made only of yes words ("نعم تمام", "yes please", "ok thanks").
    words = t.split()
    fillers = {"please", "thanks", "thank", "you", "شكرا", "شكراً", "لو", "سمحت", "يعطيك", "العافية", "الله"}
    if 0 < len(words) <= 4:
        meaningful = [w for w in words if w not in fillers]
        if meaningful and all(w in _YES for w in meaningful):
            return "yes"
        if meaningful and all(w in _NO for w in meaningful):
            return "no"
    return None


def emergency_reply(language: str) -> str:
    if language == "en":
        return (f"This may be an emergency. Please call {EMERGENCY_NUMBER} now or go to the nearest emergency "
                "department. I have also alerted the clinic team.")
    return (f"قد تكون هذه حالة طارئة. يرجى الاتصال على {EMERGENCY_NUMBER} فوراً أو التوجه إلى أقرب قسم طوارئ. "
            "وقد أبلغت فريق العيادة أيضاً.")


def guess_language(text: str) -> str:
    """'ar' when the message has Arabic letters, otherwise 'en'."""
    return "ar" if re.search(r"[؀-ۿ]", text or "") else "en"
