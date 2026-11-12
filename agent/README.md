# Limitsiz Clinic: WhatsApp booking agent

Separate from the website in `app/`. It will run as its own service (Python, LangGraph, Claude) with its own
Supabase project, so a problem here never takes the website down.

## Plan

0. Prerequisites: Meta Business verification, WhatsApp Business number, a pilot clinic's real details.
1. **Data model** (`supabase/`). Done.
2. **Booking functions** (`limitsiz_agent/booking/`). Done.
3. **LangGraph agent** (`limitsiz_agent/agent/`). Done; works against the real Claude API.
4. **Eval** (`evals/booking_chats/`): 51 approved cases plus 4 for online visits (tag `online`), runner and grader. Pilot of 5 passed; the full baseline
   run and the grading sign-off are still to do.
5. **WhatsApp** (`limitsiz_agent/whatsapp/`, `server.py`). Built and tested offline; goes live with the steps below.
6. **Reminders** (`limitsiz_agent/whatsapp/reminders.py`). Built; needs the approved template.
7. **Staff screen** (`limitsiz_agent/staff.py`). Built; at `/staff`.
8. Pilot.

## Agent (`limitsiz_agent/agent/`)

LangGraph handles the flow and remembers each conversation (one per clinic and WhatsApp number); Claude is
called through the official Anthropic SDK (`claude-opus-5-5`, effort `medium`, server-side refusal fallback on).

```
intake ──> agent ──> tools ──> agent ... ──> reply
  │                    └──> finish (more than 6 tool rounds: hand to staff)
  └──> reply without AI (emergency words, or staff are handling the chat)
```

- **intake** (no AI): stays silent while the conversation is handed to staff; answers clear emergency words with a
  fixed "call 911" message and alerts staff; settles a waiting change (`safety.py` decides yes/no from the
  patient's exact reply, in Arabic or English, or the WhatsApp button payload); adds the current clinic time.
- **agent**: one Claude call. The system prompt (`prompt.py`) holds the rules and the clinic's details only, so it is
  the same on every request and cached. Per-turn facts go in as system messages patients cannot fake. Every
  response is stored exactly as returned (thinking blocks included) and the history is append-only.
- **tools** (`tools.py`): the patient's phone and clinic come from the conversation, never from Claude.
  Book, cancel and reschedule are checked (and rolled back), then held until the patient replies yes; only a clear
  yes runs them. Anything else drops the waiting change.

Talk to it in the terminal (needs `ANTHROPIC_API_KEY` and `DATABASE_URL` in `.env`; bookings are real rows):

```bash
.venv/Scripts/python -m limitsiz_agent.chat
```

In the service (`server.py`) conversations are saved in Postgres (`langgraph-checkpoint-postgres`) and survive
restarts; the terminal chat keeps them in memory only.

## WhatsApp service: steps 5-7 (`server.py`)

One process (port 3002, behind Nginx):

- `GET/POST /whatsapp/webhook`: Meta's webhook. Every POST must carry Meta's signature (`WA_APP_SECRET`); it is
  answered at once and the messages are queued for one worker thread, so a patient's messages are handled in order.
  Each incoming message is saved once (`messages.wa_message_id`), then: while staff handle the chat nothing is sent;
  voice notes get "please type"; photos and documents go to staff; text and the Yes / No buttons go to the agent.
  When a change waits for the patient's yes, the reply carries **Yes / No buttons**.
- Every minute: **reminders** (template `appointment_reminder`, 24 h and 2 h before, once each, buttons Confirm /
  Change; Confirm is handled without AI, Change goes to the agent) and **email alerts** for new hand-offs.
- **Online visits on Microsoft Teams** (phase 2, migration 0025; design `booking/design/online-visits.html`): when a clinic
  has them on (Booking › Settings › Online visits), the assistant and the web chat book them (`visit: "online"`) under
  the clinic's rules, which the database checks (`online_visit_check`). On WhatsApp the clinic's consent text goes under
  the yes message, so that yes is the patient's agreement. Every minute, `whatsapp/visit_links.py` sends the "Join the
  visit" link of each confirmed online visit whose patient chose WhatsApp (template `WA_VISIT_LINK_TEMPLATE`), and online
  visits get the online reminder with a new Join link (`WA_ONLINE_REMINDER_TEMPLATE`). Both stay off until set; see
  `META_SETUP.md`. Only a link's hash is stored.
- `/staff` (user `staff`, password `STAFF_PASSWORD`): today's appointments (Done / No-show), the hand-off inbox,
  each chat with a reply box (only within WhatsApp's 24-hour window), "Take over" and "Hand back to the AI".
- `GET /health`.

### Going live (owner's steps)

1. **Meta** (developers.facebook.com): create a Business app, add WhatsApp, add and verify the clinic's number.
   Note the *Phone number ID*, the *App secret*, and create a permanent token (Business settings > System users,
   permission `whatsapp_business_messaging`).
2. **Reminder template** (WhatsApp Manager > Message templates), category *Utility*, name `appointment_reminder`,
   in Arabic and English, two *Quick reply* buttons:
   - ar: `تذكير بموعدك في العيادة: {{1}} مع {{2}}، يوم {{3}} الساعة {{4}}. هل ستحضر؟` buttons `تأكيد الموعد`, `تغيير الموعد`
   - en: `Reminder of your clinic appointment: {{1}} with {{2}} on {{3}} at {{4}}. Will you attend?` buttons `Confirm`, `Change`
3. **Database**: `update clinics set wa_phone_number_id = '<Phone number ID>', staff_alert_email = '<email>' where slug = '<clinic>';`
4. **Server** (VPS, Python 3.12): `cd /root/Aiclinic/agent && python3 -m venv .venv && .venv/bin/pip install -e .`,
   create `agent/.env` from `.env.example`, then `pm2 start ".venv/bin/python -m limitsiz_agent.server" --name limitsiz-agent`.
5. **Address**: DNS `agent.limitsiz.si` → the VPS, an Nginx site proxying to `127.0.0.1:3002`, and a certificate
   (certbot). Keep it separate from the website's Nginx site.
6. **Webhook** in the Meta app: URL `https://agent.limitsiz.si/whatsapp/webhook`, verify token = `WA_VERIFY_TOKEN`,
   subscribe to the `messages` field. Then send the number a WhatsApp message.

Not handled yet: voice-note transcription, viewing photos inside the staff screen (staff open WhatsApp Business),
staff logins per clinic (one shared password for now), and a separate name for family members booked from one number.

## Booking functions (`limitsiz_agent/booking/`)

Plain Python, no AI: the agent chooses which function to call, these decide what is allowed.

| Function | What it does |
|---|---|
| `clinic_info` | Clinic details, services and prices, doctors with their weekly hours, FAQs |
| `find_slots` | Free start times for a service, for all doctors, one doctor, or female/male doctors |
| `book` | Books a free slot; creates the patient from their WhatsApp number |
| `my_appointments` | The patient's upcoming appointments |
| `cancel` / `reschedule` | Only the patient's own appointments, and not later than the clinic's notice (2 h in the demo) |
| `hand_off` | Passes the conversation to staff (emergency, medical question, request, complaint, unsure) |

Rules: whole appointment inside a shift and on the 15-minute grid; no leave, holidays or other bookings in the
way; at least 1 hour notice and at most 30 days ahead (per clinic); a patient cannot be in two appointments at
once or hold more than 3 upcoming ones. A refused request raises `BookingError` with a short code
(`slot_unavailable`, `slot_taken`, `too_soon`, `too_late_to_change`, `not_found`, …) for the agent to explain.
Phone numbers are accepted as `+962…`, `00962…`, `962…` or `07…`.

Connections should be opened with `autocommit=True`; each change runs in its own transaction.

### Run the tests

```bash
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"
.venv/Scripts/python -m pytest
```

Without `TEST_DATABASE_URL` only the slot tests run (the database tests are skipped). With it pointing at a
throwaway Postgres 17 (for example the embedded one used for `supabase/tests`), all 72 run, including the agent graph end to end with a scripted stand-in for Claude (no API calls, no cost). Never point it at
the real project: the tests create and drop a `booking_test` database.

## Data model (`supabase/`)

- `db/migrations/0001_booking_schema.sql` (now in the shared `db/migrations/` folder, see `db/README.md`): clinics, FAQs, doctors, services, which doctor offers which service,
  weekly hours, time off, patients (contact details only, no medical records), appointments, conversations,
  messages, handovers.
- `seed_demo_clinic.sql`: a made-up dermatology clinic (2 doctors, 5 services, hours, FAQs) for building and
  testing. Replace with a real pilot clinic later.

Rules the database enforces, so the agent cannot break them:

- one doctor can never have two active appointments that overlap, even if two patients book the same slot at
  the same moment (`no_overlapping_appointments`); cancelled appointments free the slot;
- an appointment can only use a doctor, service and patient of its own clinic;
- a phone number is unique per clinic and must be in `+9627…` form;
- a WhatsApp message ID is stored once, so a webhook delivered twice is handled once;
- Row Level Security is on for every table with no policies: the public key can do nothing.
  Only the agent server (secret key or direct database connection) reads and writes.

Times are stored as `timestamptz`; weekly hours are in the clinic's local time (`Asia/Amman`), with
weekday 0 = Sunday … 6 = Saturday.

### Test

`supabase/tests/test_schema.mjs` runs the migration and seed on a throwaway Postgres 17 and checks the rules
above (19 checks). From an empty folder outside the repo:

```bash
npm init -y && npm install embedded-postgres@17.5.0-beta.15 pg@8.13.1
node "<repo>/agent/supabase/tests/test_schema.mjs" ./node_modules "<repo>/db/migrations/0001_booking_schema.sql" "<repo>/agent/supabase/seed_demo_clinic.sql" ./pgdata
```

### Supabase project

- Project `limitsiz-booking-agent`, id `qwnujxelgzmzoblrenkk`, region eu-central-1 (Frankfurt),
  organization "iintelligenz Org", free plan. Created 2026-11-02 with `0001_booking_schema` and the demo seed.
- URL: `https://qwnujxelgzmzoblrenkk.supabase.co`. The agent server will use the secret key (never in git);
  the publishable key can read and write nothing.
- Free plan: no automatic backups, and the project pauses after about a week without activity.
  Upgrade or add a nightly export before real patient data goes in.

To set it up again: in the SQL editor, run `0001_booking_schema.sql`, then `seed_demo_clinic.sql`.
Undo (removes everything this created): drop the twelve tables, the `appointment_status` type and the
`set_updated_at` function, or delete the project.
