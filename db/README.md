# Database migrations (shared by the WhatsApp agent, Limitsiz Clinic Accounts and Booking)

One numbered folder for the booking Supabase project (`limitsiz-booking-agent`). Every service's tests build the database
from these files in order, then add the demo clinic (`agent/supabase/seed_demo_clinic.sql`).

| Migration | What |
|---|---|
| 0001, 0002 | clinics, doctors, services, hours, patients, appointments, conversations; WhatsApp, reminders, staff screen |
| 0003 | `accounts` schema: users, roles, permissions, memberships, sessions, single-sign-on codes, invitations |
| 0004 | `audit` schema: append-only, hash-chained events; triggers on appointments, patients, memberships, users |
| 0005, 0006 | Booking additions: `voided` status and reason rule, `row_version`, internal note, phone optional, reminder consent |
| 0007 | database logins `accounts_app`, `booking_app`, `audit_reader` with least privilege and explicit policies |
| 0008 | Settings: `clinic_hours`, `booking_rules`, `clinic_settings`, doctor interval and buffer, week start; defaults trigger for new clinics; audit triggers on the settings tables |
| 0009 | The nightly audit job: `audit.checkpoints`, `audit.anchors`, `audit.nightly`; `audit.verify` starts after the latest checkpoint |

## Rules
- **The agent code after commit `372f0bd` needs migration 0008, and Booking needs 0009.** Apply them to Supabase before pushing that code: without it the assistant cannot read a clinic.
- Changes only add; they must keep the running services working (the code that needs a change is deployed **after** it).
- A new enum value cannot be used in the migration that adds it: put what uses it in the next file.
- Apply to Supabase in order, each as its own migration. **Passwords** of the service logins are set by the owner outside
  git (`alter role booking_app password '…';`) and kept in each service's `.env`.
- Tests: `TEST_DATABASE_URL=… python -m pytest` in `agent/` (a throw-away Postgres 17, see `agent/evals/pg`).
