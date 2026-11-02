# Limitsiz Clinic: WhatsApp booking agent

Separate from the website in `app/`. It will run as its own service (Python, LangGraph, Claude) with its own
Supabase project, so a problem here never takes the website down.

## Plan

0. Prerequisites: Meta Business verification, WhatsApp Business number, a pilot clinic's real details.
1. **Data model** (this folder, `supabase/`). Done.
2. Booking functions in plain code: free slots, book, reschedule, cancel, my appointments, clinic info, hand over to staff.
3. LangGraph agent: Claude with those functions, a confirmation step before any booking change, a safety step
   for emergencies and medical questions, Arabic and English.
4. Test harness: chat simulator and scripted conversations.
5. WhatsApp Cloud API webhook.
6. Reminders 24 h and 2 h before, with Confirm / Reschedule buttons.
7. Staff side: today's appointments and the handover inbox.
8. Pilot.

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

### Apply to Supabase

In the new project's SQL editor, run `0001_booking_schema.sql`, then `seed_demo_clinic.sql`.
Undo (removes everything this created): drop the twelve tables, the `appointment_status` type and the
`set_updated_at` function, or delete the project.
