# Limitsiz Clinic Records

The patient's chart, at `records.limitsiz.si`, signed in through Accounts (single sign-on, as Booking). Design and the owner's
decisions: `booking/design/emr.html`. Database: migration `db/migrations/0020_records.sql` (undo: `db/rollback/0020_down.sql`).

## Phase A (this code)

- **Patients** and **Today's patients** (a doctor's bookings for today, with the number of alerts on each chart).
- **The chart:** details (file number, date of birth, sex, national ID, insurance, emergency contact), allergies, current
  medicines, conditions, past procedures, family history, the clinic's specialty fields, and a timeline of visits and changes.
- **Alerts:** allergies always, and any entry marked as an alert, under the name on every tab and on Booking's visit note.
- **Nothing is deleted.** A wrong entry is marked "entered in error" with a reason and a name, and is locked by the database.
- **Every opening of a record is written down** and goes into the audit trail; administrators see "Who opened this record".
  The audit trail never holds clinical words.
- **Settings › Chart:** which doctors can open a chart, which lists are shown, the specialty fields, file numbers, and which
  details are required.

Who sees what follows the person's role in Accounts: doctors the whole chart; secretaries and administrators the details only
(administrators also settings and openings); Read-only nothing. Visit notes stay in Booking, under their own rule.

## Running it

- Locally: `node booking/test/dev-server.mjs` starts Accounts (3003), Booking (3004), the booking page (3005) and Records (3006)
  on the throwaway Postgres, with a filled-in chart for the first demo patient. Build the pages first: `cd records/client && npm run build`.
- Tests: `npm test` here (the throwaway Postgres on port 54329).
- Server: `bash deploy/setup-records.sh` once, after migration 0020 is applied. From then on the "Deploy Accounts and Booking"
  workflow also deploys Records.

## Phase B (design: `booking/design/records-phase-b.html`; database: migration `0022_records_files.sql`)

- **Photos** (doctors only, after the patient's photo consent): by body area, two side by side, taken from this computer or with
  the clinic phone (a one-time code shown as a QR code, a few minutes, no sign-in on the phone; the last photo shows faintly over
  the camera). Location data is removed from every photo.
- **Documents**: results, letters, reports, ID and insurance cards. Secretaries add any kind but open only the kinds marked
  "secretaries can open". Results added by someone else wait for the doctor's "Mark reviewed" (also counted on Today's patients).
- Files are opened through links that work for a few minutes; every opening is recorded; nothing is deleted (entered in error).
  Files live in the private bucket `records`, reached only by this server (`STORAGE=supabase`); until set up, uploads are refused.
- **Nightly backup** (`server/backup.js`): new files and a dump of the record tables, AES-256-GCM encrypted with the key made on
  the VPS; kept by Settings' days and months; a weekly restore check; a retry and an email when a night fails.
- **Emergency contact** in three parts (name, relationship from the clinic's list, phone).
- Server: `bash deploy/setup-records-files.sh` once, after migration 0022 is applied and the code is deployed.

## Later phases

C: forms before the visit, prescriptions, treatment courses, the AI summary.
