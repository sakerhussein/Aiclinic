# Limitsiz Clinic: WhatsApp booking agent

Separate from the website in `app/`. It will run as its own service (Python, LangGraph, Claude) with its own
Supabase project, so a problem here never takes the website down.

## Plan

0. Prerequisites: Meta Business verification, WhatsApp Business number, a pilot clinic's real details.
1. **Data model** (`supabase/`). Done.
2. **Booking functions** (`limitsiz_agent/booking/`). Done.
3. LangGraph agent: Claude with those functions, a confirmation step before any booking change, a safety step
   for emergencies and medical questions, Arabic and English.
4. Test harness: chat simulator and scripted conversations.
5. WhatsApp Cloud API webhook.
6. Reminders 24 h and 2 h before, with Confirm / Reschedule buttons.
7. Staff side: today's appointments and the handover inbox.
8. Pilot.

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
throwaway Postgres 17 (for example the embedded one used for `supabase/tests`), all 39 run. Never point it at
the real project: the tests create and drop a `booking_test` database.

## Data model (`supabase/`)

- `migrations/0001_booking_schema.sql`: clinics, FAQs, doctors, services, which doctor offers which service,
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
node "<repo>/agent/supabase/tests/test_schema.mjs" ./node_modules "<repo>/agent/supabase/migrations/0001_booking_schema.sql" "<repo>/agent/supabase/seed_demo_clinic.sql" ./pgdata
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
