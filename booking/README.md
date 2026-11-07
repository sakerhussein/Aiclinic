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

## Online booking link

Patients book at `book.limitsiz.si/<clinic>` with no account (plan: `PLAN_public_link_and_voice.md`, feature 1; migration 0011).

- **Its own process and login.** `server/public-index.js` (PM2 `limitsiz-public`, 127.0.0.1:3005) runs as the `public_app` database login, which
  cannot read patients at all; a patient is found or added only through `public.online_patient()`. Its page is its own build
  (`client/book.html`, `src/book/`, output `client/dist-public`), so the public site never serves the staff app's code.
- **Settings > Online booking** holds the switch (off by default) and every limit and text: staff check, prices, any doctor, cancel and
  change by the private link, booking for someone else, the reminders tick box, country code, limits per number and per connection,
  days per page, the intro, arrival note, WhatsApp message and privacy link. Notice, window, change notice and the upcoming limit are the
  Patient rules, shared with the WhatsApp assistant.
- **Online, not checked.** Until WhatsApp proves who owns a number, each online booking is marked until a secretary presses Mark as
  checked (Bookings filter, calendar edge). An existing number never changes the patient record; staff see a warning when the typed name
  differs. Every refusal tied to a number gets the same answer.
- **Private link** `/<clinic>/manage#<token>`: only the token's SHA-256 is stored; it works only on its own clinic's page.
- **Send booking link** on Bookings and the patient page opens WhatsApp with the clinic's message; Limitsiz sends nothing itself.
- **Find my booking** (migration 0013, design `design/find-my-booking.html`): `/<clinic>/find`. The patient types a number;
  `public.online_find()` queues each upcoming online booking of that number and returns nothing, so the page says the same for
  every number. The WhatsApp assistant (`agent/limitsiz_agent/whatsapp/links.py`) makes the new link when it sends it (template
  `booking_link`), and the old link answers "replaced". Off by default; can be switched on only once the clinic's WhatsApp number is
  connected. Limits per number per day and per connection per hour, and the message text, are in Settings > Online booking.
- **Talk to the assistant** (migration 0014, design `design/assistant-chat.html`): `/<clinic>/chat`. The WhatsApp assistant's
  web mode (`agent/limitsiz_agent/agent/web.py`), reached by `public-index.js` at `AGENT_INTERNAL_URL` with `WEB_CHAT_SECRET`
  (made on the VPS by `deploy/setup-web-chat.sh`). It can only book: it proposes a free time, the page asks for the name and number in
  a small form, and `book()` makes the booking when the patient presses Yes, so the details never reach the AI and every online
  rule applies. No access to existing bookings. Call-back requests and emergencies go to `web_callbacks` and are emailed like
  hand-offs. Limits per chat, per connection, per clinic per day, and how long chats are kept, are in Settings > Online booking.
  `test/dev-server.mjs` uses a scripted stand-in for the assistant.
- **A patient's new time** (migration 0012): back to Booked and "Time changed by patient" until staff press Confirm; the check of the
  person stays. Any move restarts the reminders.
- Audit: the page's bookings, changes and cancellations are recorded with the actor type `patient` and the connection address.
- Settings for the server (`.env`): `PUBLIC_SITE_URL` (also read by Booking for the link), `PUBLIC_PORT`, `PUBLIC_DATABASE_URL`.
- **First setup on the VPS**, once, after the push has deployed and migration 0011 is applied: `bash deploy/setup-online-booking.sh`.
  It sets the `public_app` password (made on the server, never shown), adds the settings above, starts `limitsiz-public`, adds the
  Nginx site and certificate for `book.limitsiz.si`, and from then on `deploy-platform.yml` restarts and checks it with Booking.
  Health: `GET /api/health/db` (200 when the database answers).

## Not built yet

- The hand-off inbox and chat replies; "tell the patient" template; week view; support access.
- Changing security settings, or shortening audit retention, should re-ask the password (design §3.5, §7.4). Booking cannot check that yet, so it does not.

## Run and test

```bash
npm install && npm --prefix client install && npm --prefix client run build
node test/dev-server.mjs     # Accounts 3003 + Booking 3004 + online booking 3005 on the throwaway Postgres (agent/evals/pg); open http://localhost:3004
                             # and http://localhost:3005/demo-derma
npm test                     # tests; they start the real Accounts app too (../accounts must have its packages installed)
```

The preview signs in as `sec@demo.jo` / `correct horse battery` and has four bookings today.

## Registering with Accounts

```sql
update accounts.apps set redirect_uris = array['https://booking.limitsiz.si/auth/callback'],
       secret_hash = encode(sha256('<BOOKING_CLIENT_SECRET>'::bytea), 'hex') where key = 'booking';
```
