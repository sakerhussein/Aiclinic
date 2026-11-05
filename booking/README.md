# Limitsiz Clinic Booking

Appointments, patients and history for clinic staff (design: `DESIGN.md`, mockup: `design/mockup.html`). Node 20+, Express 4,
React 18 + Vite. Will run at `booking.limitsiz.si` on port 3004. **Not deployed yet.**

Sign-in is **Accounts'** (single sign-on); this service has no passwords and **no access to the accounts schema**. It asks Accounts
(`POST /introspect`) about the person's session on every request, so locking, disabling or signing out applies at once.
A locked screen answers 423 and the page goes back through Accounts to the lock screen.

## What is built (first slice of phase B)

- **Calendar** (day view, one column per doctor, hatched outside the doctor's hours, click an empty time to book, refreshes every
  20 s, doctors open on *My schedule*), **booking form** (new and edit: patient search or inline new patient, service, doctor or
  "any available", date, free-time chips, "other time" with a warning, how it was booked, internal note), **bookings list** with
  filters, **booking page** (confirm, complete, no-show, cancel and void with a reason, restore for administrators, History from
  the audit trail), **patients** (search, create, edit, their bookings). English and Arabic (right-to-left), times in the clinic's zone.
- **Free times** are the same as the WhatsApp assistant's: checked against the agent's own code on the demo clinic, 8 doctor/service
  pairs over 14 days with leave, **2416 slots, 0 differences** (a one-off check, not yet an automated test).
- Two active bookings of one doctor can **never overlap** (database rule): no override, "other time" included.
- "Delete" is a **void** (reason, hidden by default, slot freed). The login has no DELETE right.
- Saves carry the version they were based on; a change made meanwhile (a colleague, or the WhatsApp assistant) is refused, nothing overwritten.
- Every change is audited with the signed-in person as actor.

## Not built yet

- **Settings** (hours, closures, per-doctor interval and buffer, services, patient/staff rules, reminders, security times, audit retention)
  and the agent reading them. Until then the staff rules are the defaults of the design (365 days ahead, walk-ins up to 2 h back,
  reason to cancel, outside hours allowed with a warning) in `server/service.js`, and the clinic's existing columns drive the grid.
- Audit page, export and integrity check; the hand-off inbox and chat replies; "tell the patient" template; week view; support access.
- Doctor "My schedule" shows all doctors' bookings only for people with the right to see bookings; it filters the calendar to the own doctor.

## Run and test

```bash
npm install && npm --prefix client install && npm --prefix client run build
node test/dev-server.mjs     # Accounts on 3003 + Booking on 3004 on the throwaway Postgres (agent/evals/pg); open http://localhost:3004
npm test                     # 28 tests; they start the real Accounts app too (../accounts must have its packages installed)
```

The preview signs in as `sec@demo.jo` / `correct horse battery` and has four bookings today.

## Registering with Accounts

```sql
update accounts.apps set redirect_uris = array['https://booking.limitsiz.si/auth/callback'],
       secret_hash = encode(sha256('<BOOKING_CLIENT_SECRET>'::bytea), 'hex') where key = 'booking';
```
