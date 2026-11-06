# Limitsiz Clinic: status and next steps

Last updated: 2026-11-06. Update this file whenever a step below finishes or a new one appears.

## What is built

- **WhatsApp booking agent** (`agent/`, Python/LangGraph): live at agent.limitsiz.si, with its own process and booking database. WhatsApp itself is still off (step 2 below).
- **Accounts** (`accounts/`): live at accounts.limitsiz.si. Single sign-on for all services, with roles, invitations and two-step sign-in.
- **Booking** (`booking/`): live at booking.limitsiz.si. Calendar, patients, history and Settings; the agent reads the same Settings.
- **Audit log**: tamper-evident log with a nightly check. The owner confirmed the nightly email arrives.
- **Doctor limits**: doctors see only their own bookings and patients. The owner confirmed this on live.
- **Excel export**: Bookings and Patients pages, for clinic administrators (commit `02e8551`).

## Security update, 2026-11-06

`npm audit` found high-severity advisories in `nodemailer` and `zod` while ExcelJS was being added.

| Service | nodemailer | zod |
|---|---|---|
| Accounts | 6.9.16 to 10.3.1 | 3.23.8 to 4.6.7 |
| Booking | 6.9.16 to 10.3.1 | 3.23.8 to 4.6.7 |
| Website (`app/`) | 6.9.16 to 10.3.1 | not used |

What changed besides the versions:

- Zod 4's `.uuid()` refuses ids outside RFC 9562, so ids are checked with `z.guid()`, which accepts what zod 3 accepted.
- Integers past 2^53 are now refused; that is harmless here.
- The deprecated `.merge` in the export routes became `.extend`.
- `accounts/test/mail.test.js` and `booking/test/mail.test.js` send through the real library to a small local SMTP server, because nothing tested nodemailer before.

Deployed 2026-11-06 at `3fef10a`: the Accounts and Booking run and the website run both succeeded, and all live health checks passed afterwards.

Results before deploying:

- Accounts: 45 of 45 tests pass.
- Booking: 84 of 85 tests pass, 1 skipped (see "Known gaps").
- `npm audit --omit=dev`: no high findings in any service.
- Client type-check and build pass for Accounts and Booking.

## Next steps

1. **Check the nightly audit email**: the owner confirmed on 2026-11-06 that a real email from Accounts arrived on nodemailer 10.3.1. The nightly audit email from Booking and the website's alert emails have not been seen on the new version yet.
2. **Turn on WhatsApp**: the owner adds `WA_TOKEN`, `WA_APP_SECRET` and `WA_VERIFY_TOKEN` from Meta, and the `appointment_reminder` template must be approved. See `agent/META_SETUP.md`.
3. **Finish the agent evaluation**: run the full 51 cases in `agent/evals/booking_chats` and get the owner's grading sign-off. The harness changed, so the run needs `--approve-harness` from the owner first.
4. **Build the hand-off inbox**: where staff take over from the agent. Not built yet.
5. **Confirm the remaining live checks**: the owner still needs to check the audit page and the Arabic version.
6. **Decide on the `exceljs` warning**: `npm audit` reports 2 moderate findings in Booking, from the old `uuid` inside `exceljs` 4.4.0 (GHSA-w5hq-g745-h8pq). The only offered fix downgrades `exceljs` to 3.4.0.

## Known gaps

- The test "free times are identical to the WhatsApp assistant's" is skipped where the agent's Python is not installed, so run it where Python is available.
- Tests share one throwaway database, `accounts_test` on port 54329. Starting the local preview resets it, and any test run at that moment fails with connection errors.

## How deploys work

- Pushing `main` deploys by folder: `app/**` runs `deploy.yml`, `agent/**` runs `deploy-agent.yml`, and `accounts/**` or `booking/**` runs `deploy-platform.yml`.
- Each workflow checks health after restarting and rolls back on failure. Markdown files deploy nothing.
- Every push needs the owner's go-ahead.
