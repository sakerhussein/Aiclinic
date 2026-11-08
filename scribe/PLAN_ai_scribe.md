# Plan: AI Scribe (consultation notes)

Version 2, 2026-11-08: approved, with your answers to the decisions added at the end. Design: `booking/design/ai-scribe.html`.

The business case lists the AI Scribe as Phase 2: "ambient consultation transcription into structured clinical notes (doctor reviews & signs off)".

## What it does

The doctor taps **Start visit note** on the appointment. With the patient's agreement, the phone, tablet or laptop on the desk listens to the consultation. When the doctor stops, a draft note appears in the clinic's format a moment later. The doctor reads it, corrects it, and signs it. Only a signed note becomes part of the patient's record.

| Step | Who | What happens |
|---|---|---|
| Before | Doctor and patient | The patient agrees to the recording, said aloud and ticked by the doctor. With no agreement, the doctor writes the note by hand as today. |
| During | Device on the desk | It records, with a red "Recording" sign and a timer on screen, and pause and stop buttons. |
| After | Scribe | The speech becomes text, then Claude turns the text into a draft note. The audio is deleted. |
| Review | Doctor | The draft opens next to the transcript. Unsure words are marked, and anything not discussed says "not mentioned". The doctor edits, then signs. |
| Record | Booking | The signed note is locked to the appointment and the patient's page. Later changes are dated additions, never silent edits. |

## Where it lives

Inside **Booking**, not a new site. The doctor already has the day's appointments there, and the note belongs to the appointment and the patient.

- **New screens:**
  - **Visit note**, opened from the calendar card or the booking page;
  - **Notes**, on the patient's page;
  - **Settings › AI Scribe**.
- **Who sees what:**
  - a doctor sees and signs only their own patients' notes (the same rule as bookings);
  - secretaries never see note content, only whether a visit has a signed note;
  - new permissions: `booking.notes.write`, `booking.notes.read`, `booking.notes.sign`.
- **Behind the scenes:**
  - the heavy work (speech to text, then the draft) runs as its own small process, so a long recording never slows the calendar;
  - every step is in the audit log: started, consent, stopped, draft made, edited, signed, addition.

## The note

- **Language:** English by default, because doctors in Jordan usually write notes in English while speaking Arabic with patients (the Riyadh study describes the same pattern). Arabic is a setting.
- **Format:** each clinic chooses its sections in Settings. The dermatology default is:
  1. Reason for visit
  2. History of the complaint
  3. Relevant history (medicines, allergies, previous treatments)
  4. Examination: site, size, colour, distribution, as described aloud
  5. Assessment, **only as the doctor said it**
  6. Plan: treatment, advice, tests
  7. Follow-up
- **Safety rules for the draft:**
  - Write only what was said in the room. Never add a diagnosis, a medicine, a dose or advice that the doctor did not say.
  - When something was not discussed, write "not mentioned". Never guess.
  - Mark words the speech service was unsure of, and every medicine name and dose, for the doctor to check.
  - Nothing leaves the note: no message to the patient, no prescription, no insurance claim. Those are later agents (AI Medical Reports, Financials), and they too need the doctor.
  - Never sign by itself, and never send for signature a note the doctor has not opened.

## Speech to text: test first

This is the hard part. A consultation in Amman mixes Jordanian Arabic with English medical words ("عندك eczema على الـ elbow"). Two people talk, and there can be noise in the room.

- **Candidates:** Speechmatics claims an Arabic-English medical model with code-switching. We'll test it against two or three others on our own recordings. The published figures come from vendors and other dialects, not Jordanian clinics.
- **Test recordings:** 20 to 30 role-played dermatology consultations, 5 to 10 minutes each, recorded by your doctors, with a colleague or volunteer playing the patient. No real patients (point 2 under Decisions). They get their own session, separate from the voice assistant's speech test (point 4).
- **How we score:** overall word accuracy, plus, separately, **how many medical terms and medicines come out right**. A wrong drug name matters far more than a wrong "و".
- **Cost:** published third-party prices are a fraction of a cent per minute for general speech. Medical models cost more. The test will give the real figure.

## The AI model

- **Draft quality matters more than cost here.** A 10-minute consultation is roughly 1,500 to 2,500 words, so one note is a small amount of text.
- **First guess:** Opus or Sonnet for the draft, a few cents a note. We'll measure it.
- **The test for the draft:** a doctor writes the "right" note for each test recording. Each draft is graded on:
  - completeness;
  - **anything invented** (must be zero);
  - correct medicines and doses;
  - the clinic's format.

  This is the same kind of test as the 51-case WhatsApp test.

## Rules

- **Consent every time.** The recording button stays locked until the doctor ticks "The patient agreed to this visit being recorded". The text the doctor reads out is in Settings, in Arabic and English. If the patient says no, the doctor writes as usual.
- **The audio is deleted as soon as it becomes text.** The transcript is kept for a number of days set in Settings (default 30, so the doctor can check a note against it), then deleted. The signed note is kept like any medical record.
- **Recording length:** at most 45 minutes by default, set in Settings.
- **A visible red "Recording" sign** stays on screen the whole time. Leaving the page stops the recording.
- **The doctor signs; the AI drafts.** The signed note says "Drafted with AI Scribe, reviewed and signed by Dr …".
- **If the Scribe is down,** the doctor writes the note by hand in the same screen. Nothing blocks the visit.

## Before a real clinic uses it

- **Legal review:**
  - Jordan's Personal Data Protection Law No. 24 of 2023 treats health data as sensitive and generally needs explicit, informed consent. Summaries suggest a data protection officer is needed when sensitive data is processed;
  - sending audio and text to services outside Jordan;
  - the consent wording;
  - how long records are kept;
  - medical liability for notes drafted with AI.
- **Terms from the speech and AI providers** that fit health data, including no training on it.
- **A doctor's sign-off** on the default note format and on the test results.
- **The Supabase paid plan and backups**, already on the earlier "before real patients" list.

## Order of work

| Step | What | Rough size | Needs |
|---|---|---|---|
| 1 | Role-played test recordings and the "right" notes | 1 to 2 weeks | Your doctors' time |
| 2 | Speech test: choose the service | Under 1 week | The recordings, and someone who speaks Jordanian Arabic to correct the transcripts (roughly half an hour each) |
| 3 | Draft test: choose the model, set the format rules | 1 week | API cost, a doctor's grading |
| 4 | Visit note screen: consent, recording, draft, edit, sign | 2 to 3 weeks | Built now on the assumptions below; steps 2 and 3 confirm them |
| 5 | Notes on the patient page, additions, Settings › AI Scribe, audit | 1 week | |
| 6 | Pilot with one doctor at the demo clinic, then one real clinic. The first real consultations, with the patient's agreement | 2 to 4 weeks | Legal review and the providers' terms done |

Each step is tested in English and Arabic before it goes live, and goes live only with your go-ahead.

**Step 1 started 2026-11-08.** The kit for the recording day is in `scribe/test-recordings/`: `kit.html` (guide, agreement, 24 cases and the note template, printing on A4) and `tracking.csv`.

**Steps 4 and 5 start now too** (your decision, 2026-11-08), in a separate session, before steps 2 and 3 finish. They rest on assumptions that steps 2 and 3 then confirm or change:

- **Speech to text:** a switch in Settings, not one fixed service, so the speech test's choice drops in later.
- **The draft:** Claude, with the model as a setting.
- **The note:** the dermatology format and the safety rules in this plan. Step 3 tunes them.
- **Everything else:** the approved design and your decisions below.

If the tests go badly, only the speech switch and the note rules change. The screens stay.

**Steps 4 and 5 built 2026-11-08, on this computer only (not live).** Migration `db/migrations/0016_ai_scribe.sql`; server `booking/server/notes.js` (the doctor's actions) and `booking/server/scribe.js` with `scribe-index.js` (the Scribe's own process); screens `booking/client/src/pages/note.tsx`, the patient page, the booking page and Settings › AI Scribe; tests `booking/test/notes.test.js`. One real draft by Claude Opus 5.5 of the sample consultation took 5 to 8 seconds and about 3 US cents. Going live needs, in order: migration 0016 applied, the code pushed, then the Scribe's own process set up on the server with `bash /root/Aiclinic/deploy/setup-scribe.sh` (PM2 `limitsiz-scribe`; it copies the Anthropic key into `booking/.env` and makes the private recordings folder). Migration and push were done 2026-11-08. It stays off until a clinic administrator switches it on.

## Others doing this in the region

- **Heidi** (Australia) launched in the UAE, with Middle East headquarters in Dubai.
- **Sahl AI** (Saudi Arabia) is a bilingual Arabic-English scribe, with a peer-reviewed 2026 pilot in Riyadh.
- **Augnito / Omni** have a Saudi deal.
- **PureHealth's "Nada"** is in pilot in UAE clinics.
- **Jordan:** we found nothing local.

**Our advantage:** the Scribe sits inside the same booking, WhatsApp and patient record the clinic already uses, it's tuned for Jordanian Arabic, and it's priced for private clinics.

## Decisions for the owner

Your answers, 2026-11-08:

1. **Note language: decided.** English by default, with Arabic as a setting.
2. **Test recordings: decided.** Doctors record role-played consultations for the tests. Real consultations, with the patient's agreement, start at the pilot. See below.
3. **Transcripts: decided.** Kept 30 days by default, then deleted. The number of days is a setting.
4. **Speech tests: decided.** Kept separate. The Scribe's recordings get their own session, apart from the voice assistant's speech test. See below.

### Point 2: role-played tests, real consultations at the pilot

Decided 2026-11-08.

- **Tests (steps 1 and 2):** doctors record role-played consultations. A colleague or volunteer plays the patient. No real patients, so the tests don't wait for the lawyer.
- **Pilot (step 6):** real consultations start here, as you described: the patient enters the examination room and agrees to the recording. This happens only after the legal review and the providers' terms for health data are done.

Why the tests don't use real patients:

- A test sends each recording to three or four speech services, and the text to Claude. With real patients, their health details would go to companies we may never use.
- Jordan's data protection law (No. 24 of 2023) treats health data as sensitive. Two items from "Before a real clinic uses it" must come first: the legal review, which covers the consent wording and sending audio abroad, and the providers' terms for health data, including no training on it.

### Point 4: separate speech tests

Decided 2026-11-08.

- The Scribe's role-played consultations are recorded in their own session. Its speech test chooses a service for consultations only.
- The voice assistant keeps its own speech test (`booking/PLAN_public_link_and_voice.md`, step 4 of its Order of work).
- So the Scribe's tests don't need to wait for the voice assistant's. Step 1 starts when you give the go-ahead.

We considered one shared session for both tests. You chose to keep them separate.

## Sources

- [Clyde & Co: Jordan issues first personal data protection law](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law)
- [DLA Piper: Data protection in Jordan](https://www.dlapiperdataprotection.com/guide.pdf?c=JO)
- [Al Tamimi: Jordan's new data protection law](https://www.tamimi.com/news/jordans-new-data-protection-law-safeguarding-personal-data)
- [JMIR Medical Informatics 2026: A bilingual Arabic-English ambient AI scribe, prospective evaluation (PubMed)](https://pubmed.ncbi.nlm.nih.gov/41875245/)
- [Heidi Health, GCC](https://www.heidihealth.com/en-gb/gcc)
- [Augnito Saudi deal](https://www.speechtechmag.com/Articles/News/Speech-Technology-News/Augnito-Signs-Huge-Saudi-Deal-167870.aspx)
- [PureHealth "Nada"](https://briefglance.com/articles/purehealths-nada-ai-less-typing-more-listening-in-uae-clinics)
- [Speechmatics: Arabic-English medical model (vendor claim)](https://businesswire.com/news/home/20260310752540/en/Speechmatics-Achieves-a-World-First-in-Bilingual-Voice-AI-with-New-ArabicEnglish-Medical-Model)
- [JMIR preprint: Arabic-English medical speech recognition (Egyptian, not peer-reviewed)](https://preprints.jmir.org/preprint/96222)
