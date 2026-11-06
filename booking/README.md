# Limitsiz Clinic Booking

Appointments, patients and history for clinic staff (design: `DESIGN.md`, mockup: `design/mockup.html`). Node 20+, Express 4,
React 18 + Vite. Runs at `booking.limitsiz.si` on port 3004. First setup on the VPS: `deploy/setup-platform.sh`; after that `.github/workflows/deploy-platform.yml` deploys every push.

Sign-in is **Accounts'** (single sign-on); this service has no passwords and **no access to the accounts schema**. It asks Accounts
(`POST /introspect`) about the person's session on every request, so locking, disabling or signing out applies at once.
A locked screen answers 423 and the page goes back through Accounts to the lock screen.

## What is built

- **Calendar** (day view, one column per doctor, hatched outside the doctor's hours, click an empty time to book, refreshes every
  20 s, doctors open on *My schedule*), **booking form** (new and edit: patient search or inline new patient, service, doctor or
  "any available", date, free-time chips, "other time" with a warning, how it was booked, internal note), **bookings list** with
  filters, **booking page** (confirm, complete, no-show, cancel and void with a reason, restore for administrators, History from
  the audit trail), **patients** (search, create, edit, their bookings). English and Arabic (right-to-left), times in the clinic's zone.
- **Free times** are the same as the WhatsApp assistant's, compared automatically against the agent's own code (see Settings below).
- Two active bookings of one doctor can **never overlap** (database rule): no override, "other time" included.
- "Delete" is a **void** (reason, hidden by default, slot freed). The login has no DELETE right.
- Saves carry the version they were based on; a change made meanwhile (a colleague, or the WhatsApp assistant) is refused, nothing overwritten.
- Every change is audited with the signed-in person as actor.

## Export to Excel

**Export to Excel** on the Bookings and Patients pages, for clinic administrators (`booking.data.export`): `GET /api/export/bookings` and
`/api/export/patients` (`server/export.js`). The file holds every row matching the page's filters, up to 50,000, in the screen's language
and clinic time. Internal notes stay out. Each export is recorded in the audit log as `data_exported` before the file is made.

## Audit log

`/audit`, for clinic administrators (`booking.audit.view`, export `booking.audit.export`): integrity status with **Verify now**, filters
(dates, person, type, search), every entry with who, what, the change and from where, a click opens the full before and after, CSV export.
It reads through the `audit_reader` login, which sees only its own clinic. Looking is recorded too: exports and checks every time,
viewing at most every 15 minutes per person. People's names come from Accounts (`POST /people`), limited to this clinic.
A failed sign-in of a known person, automatic locks and idle sign-outs, disabling a user and password resets go into the clinic's own log,
so its administrator sees them. A failed sign-in with an unknown email stays in the platform's log.

### The nightly job

Runs inside this service at 02:00 Amman time (`NIGHTLY_HOUR`, `NIGHTLY_TZ`), once a day. It checks 30 seconds after starting and every 10 minutes, so a service that was down catches up when it returns.
`npm run nightly` runs it by hand. For every clinic and the platform (`audit.nightly`, migration 0009):

1. checks the hash chain, and that last night's newest entry is still there (hashes alone cannot show entries removed from the end);
2. removes entries past the clinic's retention, never under 12 months, leaving a checkpoint so the chain still verifies. **A chain that fails is not touched**;
3. records the result in the log, and emails the newest hashes to `AUDIT_ANCHOR_EMAIL`, with `ALERT` in the subject if anything failed.

Without SMTP settings the check still runs, the email is skipped and the server log says so. Only `audit.nightly` can remove entries; no service can
choose what or when.

## Settings

Clinic administrators change them; secretaries read them; every change is audited with before and after. Pages: clinic profile and the
answers the assistant gives, working hours and closures, doctors (interval, buffer, weekly hours, services, leave), services, booking
rules for patients and for staff, reminders, WhatsApp assistant, security, audit retention. Stored in `clinic_hours`, `booking_rules`,
`clinic_settings` and new columns on `doctors` (migration 0008).

- Changing hours, closures or rules **never moves or cancels a booking**: the page lists the upcoming bookings that no longer fit.
- The WhatsApp assistant reads the same settings; `test/settings.test.js` compares its free times with Booking's, using the agent's own
  code, with opening hours, intervals, buffers, closures and leave in play. Skipped when the agent's Python is not installed.
- Accounts reads the lock and sign-out times and "two-step for everyone".
- Stored but not acted on yet: `conversation_visibility` (no conversation screen in Booking yet).

## Not built yet

- The hand-off inbox and chat replies; "tell the patient" template; week view; support access.
- Changing security settings, or shortening audit retention, should re-ask the password (design §3.5, §7.4). Booking cannot check that yet, so it does not.

## Run and test

```bash
npm install && npm --prefix client install && npm --prefix client run build
node test/dev-server.mjs     # Accounts on 3003 + Booking on 3004 on the throwaway Postgres (agent/evals/pg); open http://localhost:3004
npm test                     # tests; they start the real Accounts app too (../accounts must have its packages installed)
```

The preview signs in as `sec@demo.jo` / `correct horse battery` and has four bookings today.

## Registering with Accounts

```sql
update accounts.apps set redirect_uris = array['https://booking.limitsiz.si/auth/callback'],
       secret_hash = encode(sha256('<BOOKING_CLIENT_SECRET>'::bytea), 'hex') where key = 'booking';
```
