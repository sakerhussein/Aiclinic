# Limitsiz Clinic Accounts

The general sign-in for every Limitsiz Clinic service (design: `booking/DESIGN.md` §3). Node 20+, Express 4, React 18 + Vite,
Postgres (the `accounts` and `audit` schemas from `db/migrations`). It will run at `accounts.limitsiz.si` on port 3003.
**Not deployed yet**: there is no workflow, DNS record or Nginx site for it.

## What it does

- Sign-in with email and password (Argon2id, 12+ characters, common passwords refused), one generic error, same timing for unknown emails.
- Server-side sessions (token stored only as a hash): lock screen after 10 idle minutes, sign-out after 60, absolute 12 hours.
  Both idle times come from the clinic's Settings (`clinic_settings`), read in `core.js` (`getSecurity`).
- Two-step (TOTP + 10 recovery codes), **required** for clinic and Limitsiz administrators.
- Invitations (72 h, one use), password reset (1 h, one use, ends every session), change password, my sessions.
- Single sign-on for the other services: `GET /authorize` -> one-time code (60 s) -> the service calls `POST /token` with its secret.
  After that the service asks `POST /introspect` on every request (this also records activity with `touch: true`), so disabling
  a person or signing out takes effect at once. `POST /app-logout` ends the service's own session.
  A service has **no database access** to `accounts`; it only talks to this API. `POST /people` gives a service the names for its audit
  page, only for people of the asking session's clinic.
- People and access (administrators): invite, change role, "can also manage bookings", disable, sign out everywhere, send a reset link.
  Sensitive changes re-ask the password if it was last checked over 10 minutes ago. The last administrator of a clinic cannot be removed.
- Everything that matters is in the audit trail (`audit.events`): sign-ins and failures, locks, invitations, role changes.

## Run it locally

```bash
npm install && npm --prefix client install && npm --prefix client run build
node test/dev-server.mjs        # needs the throwaway Postgres (agent/evals/pg, port 54329); open http://localhost:3003
```

The preview creates `admin@demo.jo` and `sara@demo.jo` (password `correct horse battery`). The administrator is asked to set up
two-step first; compute the code with `node -e "import('./server/crypto.js').then(m=>console.log(m.totp('<secret shown>')))"`.

## Tests

```bash
npm test      # the tests on the throwaway Postgres (TEST_DATABASE_URL, default postgresql://postgres:test@localhost:54329/postgres)
```

They create a fresh database, apply every migration and connect as the real least-privilege `accounts_app` login, with a
controllable clock (idle, lock and expiry are tested without waiting).

## Settings (`.env`, see `.env.example`)

`PORT`, `SITE_URL`, `DATABASE_URL` (the `accounts_app` login), `MFA_KEY` (32 random bytes, base64), SMTP settings, `TRUST_PROXY`.

## First administrator

There is no sign-up. On the server, as the owner:

```bash
node server/cli.js invite --clinic demo-derma --email boss@clinic.jo --name "Dr. Boss"
node server/cli.js invite --platform --email you@limitsiz.si --name "Saqqer"
```

It prints a one-time link (72 hours). The person chooses their password and sets up two-step. Nothing is emailed from here.

## Registering a service

A service is a row in `accounts.apps` with its allowed `redirect_uris` and `secret_hash` (SHA-256 of a long random secret):

```sql
update accounts.apps set redirect_uris = array['https://booking.limitsiz.si/auth/callback'], secret_hash = encode(sha256('<secret>'::bytea), 'hex') where key = 'booking';
```

## Notes

- The Arabic text is a working draft for a native reader to review.
- Rate limits are in memory (one process); the account lock after 5 wrong passwords is in the database.
