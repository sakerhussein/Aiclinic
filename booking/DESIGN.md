# Limitsiz Clinic: Booking and Accounts (booking.limitsiz.si, accounts.limitsiz.si)

**Version 2, 2026-11-05.** The owner's decisions D1–D12 and review comments are applied (section 15). **Status: for approval.
Nothing is built.** Visual mockup: [design/mockup.html](design/mockup.html), 27 screens in English and Arabic (Accounts 1–11, Booking 12–20, Settings 21–27).

**Naming.** *Limitsiz Clinic* is the product: the orchestrated AI agents (booking, WhatsApp assistant, and those to come).
*Limitsiz* is the company. Every page uses "Limitsiz Clinic" (top bar, titles, emails, "Sign in to Limitsiz Clinic");
"Limitsiz" appears only in the footer as the company (`Limitsiz · limitsiz.si · Privacy · Terms`). The public website is not
changed.

---

## 1. What we are building

Clinics already get bookings from the WhatsApp assistant (`agent.limitsiz.si`). Secretaries also take bookings by phone and at
the desk, and need one place to see and correct everything. So:

1. **Limitsiz Clinic Accounts** (`accounts.limitsiz.si`): one general sign-in for every Limitsiz Clinic service. Users are
   created by their clinic's administrator, never by self-registration. Today it opens *Booking*; later agents appear as more
   tiles on the same launcher.
2. **Limitsiz Clinic Booking** (`booking.limitsiz.si`): clinic staff **view, create, change, cancel and delete (void)**
   bookings, manage patients, and the clinic administrator manages **Settings**: working hours, doctors, appointment
   intervals, services, booking rules, reminders, security and audit retention. The WhatsApp assistant follows the same settings.
3. **An audit trail** of who did what, when, from where, and what changed, written by the database itself (so the WhatsApp
   assistant is recorded too). Nobody can edit or delete it from the apps, and tampering is detectable.

```
 Browser (secretary, doctor, clinic administrator)
        │ https
        ▼
  Nginx (VPS 5.189.186.49) ── limitsiz.si ───────────► website (Express :3001)        unchanged
        │                 ├─ agent.limitsiz.si ─────► WhatsApp agent (FastAPI :3002)   changes in §10
        │                 ├─ accounts.limitsiz.si ──► Accounts (Express :3003)         NEW
        │                 └─ booking.limitsiz.si ───► Booking (Express :3004)          NEW
        ▼
  Supabase Postgres "limitsiz-booking-agent" (Frankfurt)
     public.*   clinics, doctors, services, patients, appointments, conversations …   (exists, extended)
     accounts.* users, roles, memberships, sessions, invites …                          NEW
     audit.*    events (append-only, hash-chained)                                      NEW
```

**Same technology as the website:** React 18 + Vite 5 + TypeScript front ends, Express 4 (Node) servers, Supabase Postgres,
PM2, Nginx, GitHub Actions with health check and rollback, English/Arabic with right-to-left layout, the Limitsiz colours and fonts.

---

## 2. Users, roles, permissions

| Role | Who | Can do |
|---|---|---|
| **Secretary** | front desk (usually 1–2 per clinic, sharing one computer) | all bookings of the clinic: view, create, change, confirm, cancel, void; patients: view and edit; read the clinic's settings; hand-off chats (see §6.5) |
| **Doctor** | the clinic's doctors, each with their own login | **read-only by default**: opens on *My schedule*, can switch to all doctors; sees patients' contact details. Cannot change anything unless the administrator grants it (below) |
| **Clinic administrator** | owner / manager | everything a secretary can, plus: **Settings**, restore voided bookings, audit log and export, users and roles, sessions |
| **Read-only** | anyone else who needs to look (for example an accountant) | view bookings and patients |
| **Limitsiz administrator** | you / support | create a clinic and its first administrator; support. Cannot read clinic data without a recorded reason (phase D) |

**A doctor who must change bookings:** nobody logs in as someone else. The clinic administrator either gives the doctor the
Secretary role, or switches on **"can also manage bookings"** on the doctor's account (keeps the doctor role, adds booking
changes). The doctor may also simply ask the receptionist. Granting is audited.

Rules enforced by the system, not just by screens:
- Permissions are checked **on the server** for every request.
- Every query is scoped by the clinic from the **session**, never by a value sent from the browser.
- An administrator cannot disable or demote themselves; the last administrator of a clinic cannot be removed; nobody can grant
  more than their own role.
- A doctor account is linked to a doctor record of the clinic; the link decides *My schedule*.

| Permission | Secretary | Doctor | Read-only | Clinic admin |
|---|:-:|:-:|:-:|:-:|
| `booking.appointments.view` | ✅ | ✅ | ✅ | ✅ |
| `…create / edit / cancel / void` | ✅ | only with "can also manage bookings" | ❌ | ✅ |
| `…restore` | ❌ | ❌ | ❌ | ✅ |
| `booking.patients.view` / `edit` | ✅ / ✅ | ✅ / ❌ | ✅ / ❌ | ✅ / ✅ |
| `booking.settings.view` / `edit` | view / ❌ | ❌ | ❌ | ✅ / ✅ |
| `booking.conversations.view` (scope set in Settings) | ✅ | ❌ | ❌ | ✅ |
| `booking.audit.view` / `export` | ❌ | ❌ | ❌ | ✅ |
| `accounts.users.*`, sessions of other users | ❌ | ❌ | ❌ | ✅ |

---

## 3. Accounts: the general sign-in

### 3.1 What the user sees (mockup screens 1–11)
Sign-in → (second step) → launcher or straight into Booking. Also: accept an invitation and choose a password, forgot and reset
password, set up two-step verification (QR code and recovery codes), *My account* (name, language, password, two-step,
my sessions), user administration, sessions of all users (administrator), lock screen and switch user.
There is no "create account" button. The page is generic: the title is "Sign in to Limitsiz Clinic" and it serves every service.

### 3.2 Single sign-on
1. A service (Booking) has no session → redirects to `accounts…/authorize?client=booking&state=…`.
2. Accounts signs the user in (or reuses the Accounts session) and redirects back with a **one-time code** (60 s, single use).
3. Booking's server exchanges the code server-to-server on the VPS (client secret) and receives user, clinic, role and
   permissions; it sets its own session cookie. No service ever sees the password.
4. **Every request** checks the session and user in `accounts.sessions` (one indexed query, read-only database role), so
   disabling a user or "sign out everywhere" works **immediately**. This is why sessions live on the server and not in a JWT.
5. `return_to` must match a registered service address (no open redirect).

### 3.3 Granting access
- No self-registration. A Limitsiz administrator creates the clinic and its first administrator (a script on the server).
- The administrator invites by email: name, email, role (and the doctor record for doctors). The link is one-time, stored as a
  hash, valid 72 hours, bound to that email.
- Role change, "can also manage bookings", disable, sign out everywhere, send password-reset link: administrator only, all
  audited. An administrator never sees or sets another person's password.
- Users are disabled, never deleted (their history stays).

### 3.4 Shared computer (typically two secretaries, one PC)
Each person has **their own account**; a shared login would make the audit log meaningless. To make that practical:
- **Switch user** in the user menu: signs the current person out and shows the sign-in page.
- **Lock screen:** after *N* idle minutes (**default 10, configurable per clinic, can be turned off**) the screen locks. The
  same person unlocks with their password, or taps "Not you? Switch user". Work in progress is kept.
- **Sign-out:** after *M* idle minutes (**default 60, configurable per clinic**) the session ends. There is also an absolute
  limit of 12 hours.
- Locking is enforced **by the server** (a locked session refuses API calls until the password is entered), not just by an
  overlay. Idle time counts keyboard and mouse activity, not just page loads.
- No "remember me" and no saved sessions on shared machines; the cookie ends with the session.
- Two people editing the same booking is handled by the version check in §4.5.

### 3.5 Passwords, sessions, brute force
| Topic | Design |
|---|---|
| Password storage | Argon2id (`@node-rs/argon2`), unique salt |
| Password rules | at least 12 characters, no composition rules, rejected if on a list of common passwords shipped with the app |
| Sign-in errors | one generic message; same response time for unknown emails |
| Rate limits | per IP and per account; 5 wrong attempts lock the account 15 minutes; every failure is audited |
| Session token | 256-bit random, only its hash stored; cookie `__Host-…`: Secure, HttpOnly, SameSite=Lax, host-only |
| Time limits | lock screen and idle sign-out from clinic Settings (defaults 10 / 60 min), absolute 12 h; sensitive actions (change role, export audit, restore, change security settings) re-ask the password if the last check was over 10 min ago |
| Two-step (TOTP + 10 recovery codes) | **always required** for clinic and Limitsiz administrators; a clinic can require it for everyone (Settings → Security) |
| CSRF / browser | SameSite + Origin check on every state-changing request, JSON-only API, strict Content-Security-Policy, HSTS, `frame-ancestors none`, no-store on authenticated pages |

---

## 4. Booking: features

### 4.1 Screens (mockup screens 12–20)
1. **Calendar:** day view, one column per doctor, rows by the doctor's interval, hatched = outside hours / break / leave / closure.
   Cards show patient, service, time, source chip (WhatsApp, Phone, Walk-in), status colour. Click an empty slot to book there.
   Week starts on Saturday. Refreshes by itself every 20 s. Doctors open on **My schedule**.
2. **Booking form:** a full page (also used for edit), see 4.2. On a tablet it stacks into one column.
3. **Bookings list:** search and filters (dates, doctor, status, source, patient).
4. **Patients** and the **Patient form:** contact details only; **no medical records** in this product.
5. **Appointment detail:** fields, actions, **History** from the audit log.
6. **Audit log** (administrator). 7. **Settings** (administrator; secretaries read-only), see §5.

### 4.2 The booking form
| Field | Behaviour |
|---|---|
| Patient | type phone or name; matches show name, phone, last visit; **"+ New patient"** inline: name required, phone optional (see D5), language, WhatsApp-reminder consent (**unchecked by default**) |
| Service | list with duration and price (from Settings → Services) |
| Doctor | only doctors who offer the service; "any available" picks the earliest |
| Date | closed days and closures greyed |
| Time | chips of free times on the **doctor's own interval**, from the same calculation as the WhatsApp assistant. **"Other time"** allows any time with a clear warning, if the clinic's staff rules allow it |
| How it was booked | Phone call / Walk-in (WhatsApp is set by the assistant, shown read-only) |
| Internal note | staff only, 500 characters, "no medical details here" |
| Notify the patient | checkbox **on by default** when changing or cancelling a WhatsApp patient's booking, sent as an approved template (phase D) |

States the mockup shows: normal, "other time" override warning, conflict ("changed by *X* at *time*"), patient without phone.

### 4.3 Statuses and "delete"
```
 booked ──► confirmed ──► completed
   │  ╲         │   ╲──► no_show
   ▼    ╲──► cancelled   (the patient cancelled; reason required; counts in statistics)
 voided   (entered by mistake; reason required; hidden by default; administrator can restore)
```
**"Delete" is Void.** Nothing is physically deleted by the apps (the database permission is removed). A voided booking leaves
the calendar and frees the slot, but record and history stay. **Hard deletion only by a reviewed script** run by a Limitsiz
administrator (for example a legal erasure request), itself logged. Completed and no-show are final; only an administrator can
correct them, with a reason.

### 4.4 Rules for staff bookings
They come from **Settings → Booking rules → Staff** (§5.5), per clinic, separately from the rules for patients on WhatsApp.
Always true, whatever the settings: **two active bookings of one doctor can never overlap** (a database rule; no override, D11).

### 4.5 Concurrency
Each booking has a `row_version` the database increments on every change by anyone. A save sends the version it loaded; if it
changed meanwhile (say the patient moved it on WhatsApp), the save is refused with who and when, and nothing is overwritten.

### 4.6 With the WhatsApp assistant
- WhatsApp bookings are editable like any other and carry their chip.
- Reminders also go to phone and walk-in patients **only with the consent flag**; patients created by the assistant get it
  automatically (they started the conversation).
- Phase D: hand-off chats and replies move into Booking and the basic `/staff` page retires.

---

## 5. Settings (clinic administrator; mockup screens 21–27)

Every clinic differs, so nothing below is hard-coded; each value has a sensible default. Every change is audited with before
and after. The WhatsApp assistant and the Booking app both read these settings.

| Page | What the administrator sets |
|---|---|
| **Clinic profile and information** | names (English and Arabic), phone, address, map link, time zone (default Asia/Amman), default language, week start, and the information the assistant answers with (payment methods, insurance, preparation advice, FAQ) |
| **Working hours** | the clinic's weekly opening hours (several periods a day), closed days, and **closures** (holidays, trips) with a name |
| **Doctors** | names, title, gender, active; **appointment interval per doctor** (5, 10, 15, 20, 30 or 60 min; blank = clinic default); **buffer** after each appointment (0, 5, 10, 15 min); the doctor's weekly hours (must fit inside the clinic's); leave; the services the doctor offers |
| **Services** | name (both languages), duration, price, "from" price, active (today only changeable by SQL) |
| **Booking rules: Patients (WhatsApp)** | see 5.5 |
| **Booking rules: Staff (Booking app)** | see 5.5 |
| **Reminders** | on/off, when they go out (default 24 h and 2 h before; choose from 48 h, 24 h, 12 h, 4 h, 2 h, 1 h), no sending at night (default 21:00–08:00 local) |
| **WhatsApp assistant and conversations** | assistant on/off; message outside working hours; who gets hand-off alert emails; **what staff may see: None / Hand-off chats only (default) / All conversations** |
| **Security** | idle sign-out (default 60 min; 15, 30, 60, 120, 240), lock screen (default 10 min; off, 5, 10, 15, 30), two-step for everyone on/off (always on for administrators) |
| **Audit** | retention period (see §7.4) |

### 5.1 How availability is computed
```
free times for a doctor on a day =
    clinic opening hours  ∩  the doctor's weekly hours
    − clinic closures − the doctor's leave
    − existing active bookings (+ the doctor's buffer after each)
  then:  start times on the doctor's interval grid, whole service must fit, and the audience's rules applied
         (patients via WhatsApp use the Patient rules; staff in Booking use the Staff rules)
```

### 5.2 Options (no free numbers where a pick list is safer; "custom" always available)
| Setting | Choices |
|---|---|
| Minimum notice | none, 30 min, 1 h, 2 h, 4 h, 12 h, 24 h, custom |
| How far ahead | 7, 14, 30, 60, 90 days, custom |
| Change / cancel notice | none, 1 h, 2 h, 4 h, 12 h, 24 h, custom |
| Max upcoming bookings per patient | 1, 2, 3, 5, 10, no limit |
| Appointment interval | 5, 10, 15, 20, 30, 60 min |
| Buffer after each appointment | 0, 5, 10, 15 min |

### 5.3 Defaults
Patients: notice 1 h, 30 days ahead, change/cancel notice 2 h, max 3 upcoming (today's values, so nothing changes for the
existing assistant). Staff: no notice, 365 days ahead, no change limit, outside working hours = *allow with warning*,
walk-ins may be entered up to 2 h back, reason required when cancelling, max upcoming = warn only.

### 5.4 Safe changes
- **Changing hours, closures, intervals or rules never cancels or moves an existing booking.** The page lists the bookings that
  fall outside the new setting ("3 bookings are outside the new hours") so staff can contact those patients.
- A change to the interval applies to new bookings from then on.
- Settings are changed only by administrators; secretaries see the hours, doctors, services and rules read-only.

### 5.5 Booking rules: Patients vs Staff
Two columns with the same fields (notice, how far ahead, change/cancel notice, max upcoming); the **Staff** column adds:
*outside working hours* (block / allow with warning / allow), *enter walk-ins up to N hours back*, *require a reason to cancel*.

### 5.6 Conversation visibility (D8)
Setting `conversation_visibility`: **None**, **Hand-off chats only (default)**, **All conversations**. It gates the permission
`booking.conversations.view`: with *All*, staff can open any patient's WhatsApp chat. **Every time a chat is opened it is
audited**, and the mockup shows a clear notice on that setting. **Pending legal review** (§13) before a clinic may turn it on.

---

## 6. Data model (migrations 0003 onward, in one shared `db/migrations/` folder; the agent's tests and eval read it)

```sql
-- accounts schema (not exposed through Supabase's public API; RLS on, no policies)
accounts.users, apps, roles, role_permissions, memberships (+ doctor_id, can_manage_bookings), sessions
   (+ last_activity_at, locked_at), app_sessions, sso_codes, invites, password_resets, recovery_codes

-- settings
clinics:           existing columns stay as the clinic defaults (slot_step_minutes, timezone, …); + week_start, default_language kept
clinic_hours       (clinic_id, weekday, start_time, end_time)                 -- clinic opening hours, same overlap rule as doctors'
time_off:          + label text, kind 'closure'|'leave'                        -- clinic-wide rows = closures, doctor rows = leave
doctors:           + slot_minutes int null (5,10,15,20,30,60), + buffer_minutes int default 0 (0,5,10,15)
booking_rules      (clinic_id, audience 'patient'|'staff', min_notice_minutes, window_days, change_notice_minutes,
                    max_upcoming null=no limit, outside_hours 'block|warn|allow', walkin_back_minutes, require_cancel_reason)
                   -- patient row backfilled from today's clinics columns; the assistant is switched to read it
clinic_settings    (clinic_id, idle_timeout_minutes 60, lock_after_minutes 10 [0=off], require_2fa_all false,
                    conversation_visibility 'handoff', audit_retention_months null=indefinite (min 12), reminders_enabled,
                    reminder_offsets_minutes {1440,120}, quiet_start 21:00, quiet_end 08:00, assistant_enabled,
                    after_hours_message_en/ar, handoff_alert_emails)

-- booking additions
appointments: source += 'phone','walkin'; + created_by, updated_by, internal_note, row_version (trigger), voided_at/by, void_reason;
              status += 'voided'
patients:     phone_e164 nullable (unique when present); + whatsapp_reminders boolean default false
```

### 6.1 Database roles (least privilege)
Today the agent connects as the database owner. New services use their own logins; the agent moves to one too.

| Role | Used by | Can |
|---|---|---|
| `accounts_app` | Accounts | read/write `accounts.*`; insert-only into `audit.events` |
| `booking_app` | Booking | read/write booking tables, **no DELETE**; read-only on sessions, memberships, permissions; insert-only into audit |
| `audit_reader` | audit page | select on `audit.events` for its clinic |
| owner | migrations only | everything; never used by an app |

---

## 7. The audit trail

### 7.1 What is recorded
| Category | Examples | Written by |
|---|---|---|
| **Data changes** | appointment created, time or status changed, cancelled, voided, restored; patient created or edited; **settings changed** (before and after) | **database triggers** on `appointments`, `patients`, `clinic_settings`, `booking_rules`, `clinic_hours`, `doctors`, `services`, `time_off`: every writer is captured, including the WhatsApp assistant and direct SQL |
| **Security events** | sign-in, failed sign-in, lock-out, screen locked/unlocked, switch user, password change/reset, two-step on/off, invite, role change, "can manage bookings", user disabled, sessions revoked | Accounts |
| **Sensitive reads** | audit viewed or exported, integrity check, **a patient conversation opened** | Booking |

### 7.2 What each entry holds
`seq`, time (UTC), clinic, **who** (user / agent / system / database, id, name then), **from where** (IP, browser, request id),
**what** (entity, id, action), **how it changed** (before and after as JSON, changed fields), **why** (reason: required for cancel,
void, restore, role change, settings that affect security), and `prev_hash`, `hash`. The app tells the database who is acting
inside each transaction (`app.actor_id`, `app.ip`, `app.request_id`, `app.reason`); the trigger reads them. A change with none set
is still recorded, marked **database**, which is a red flag. The WhatsApp assistant is recorded as `agent:whatsapp`.

### 7.3 Hard to change, easy to notice
- The apps can only insert into `audit.events` (no update, delete, truncate).
- Per clinic, `hash = SHA-256(prev_hash ‖ row)`: altering or removing any old row breaks every later hash. **Verify integrity**
  button, plus a nightly check. The latest hash is **emailed daily to the owner**, an anchor outside the system.
- Entries hold ids and changed fields, not medical content (this product holds none).

### 7.4 Retention (D9)
Configurable per clinic by the administrator in Settings → Audit: 1, 2, 5, 7, 10 years or indefinitely (**default indefinitely**).
**Minimum 12 months, which only a Limitsiz administrator can lower**: an administrator is also a person whose actions are
audited and must not be able to shorten retention to erase evidence. Shortening needs the password again and is itself
recorded. A nightly job removes entries past the period and writes a checkpoint (hash of the last removed entry), so the chain
stays verifiable from the checkpoint on.

### 7.5 Who sees it
Secretaries: the **History tab** on each booking ("Rana moved it from 10:00 to 11:00, 14:32"). Administrators: the **Audit log
page**: filters, before/after, CSV export (logged), integrity status, retention shown.

---

## 8. API (JSON; the clinic always comes from the session)
```
Booking
GET /api/lookups                                   doctors, services, hours, rules for the user's role
GET /api/slots?service&doctor&date                 free times (same calculation as the agent; shared test vectors)
GET/POST /api/appointments   PATCH /:id (+expected_version)   POST /:id/status | void | restore   GET /:id/history
GET/POST/PATCH /api/patients
GET /api/conversations (per Settings)              GET /api/conversations/:id (audited)
GET /api/audit  /export  POST /verify
GET/PATCH /api/settings/{profile,hours,closures,doctors,services,rules,reminders,assistant,security,audit}
Accounts
/authorize /token /login /logout /mfa/{setup,verify} /password/{forgot,reset} /invites /invites/accept
/lock /unlock /switch  /users /users/:id (role, can_manage_bookings, disable)  /sessions (mine, all)  /me
```
Input validated with schemas (zod); all SQL parameterised; errors reveal no internals.

---

## 9. Visual design

The website's look: ink `#0A0F14`, paper `#F2F4F3`, mint `#2EE6B5`, accent ink `#0B7A64`, amber `#FFB23E`, error `#B42318`;
fonts Unbounded (headings), Geist (text), Geist Mono (times, ids), IBM Plex Sans Arabic; pill buttons (44 px minimum), 12 px
fields, 18–28 px cards, mint focus ring. Sign-in: dark page with a paper card (as the website's assessment form). App: ink top
bar, paper work area, white cards. **English and Arabic with full right-to-left** (logical CSS), switch on every screen. Motion
subtle and off under `prefers-reduced-motion`. Keyboard-operable, visible focus, status never by colour alone. The form,
list and patients pages work on phones and tablets; the calendar scrolls sideways inside its own box (no page-wide sideways
scroll). Brand tokens move to a shared stylesheet used by Accounts and Booking.

---

## 10. Changes to the existing WhatsApp agent
- Read the settings: clinic and doctor hours, closures, the doctor's interval and buffer, the Patient rules (notice, window,
  change/cancel notice, max upcoming; today fixed at 3), the reminder timing and quiet hours, the assistant on/off and
  after-hours message.
- Set the audit actor (`app.actor_*`) on every transaction; create patients with `whatsapp_reminders = true`; treat `voided`
  as inactive; use its own least-privilege database login.
- The 260 tests stay, with new ones for each point; the eval harness reads the shared migrations, so it needs `--approve-harness` again.

---

## 11. Security and privacy (threat → defence)
| Threat | Defence |
|---|---|
| Guessing passwords | Argon2id, 12+ chars, common-password check, rate limits, lock-out, two-step for administrators |
| Stolen session | HttpOnly, Secure, `__Host-` cookie, lock screen, idle sign-out, instant server-side revocation, session lists |
| A secretary reading another clinic | clinic from the session, composite foreign keys, tests with two clinics |
| Privilege escalation | server-side checks per endpoint, permission matrix tested, cannot grant above own role |
| Shared computer misuse | per-person accounts, lock screen, switch user, audit of who acted |
| Settings abused to hide actions | settings changes audited with before/after; retention minimum 12 months; re-ask password |
| CSRF / XSS / clickjacking | SameSite + Origin check, React escaping, strict CSP, `frame-ancestors none` |
| SQL injection | parameterised queries only |
| Phishing through login redirects | `return_to` only to registered addresses |
| Takeover through email | one-time hashed links, short life, no account enumeration |
| Staff editing then hiding | database-level audit, insert-only, hash chain, daily off-system anchor |
| Leaked database login | per-service least-privilege roles; no app can delete |
| Lost data | paid database plan with backups before real data |
| Third-party code | pinned versions, lockfiles, `npm audit` in CI |

---

## 12. Testing
- **Unit:** permission matrix; password and invite rules; slot calculation (the agent's test cases shared as data) including
  per-doctor intervals, buffers, clinic hours and closures; settings validation.
- **Integration on a throw-away Postgres 17:** sign-in, two-step, invite, reset, single sign-on, **lock and unlock**, idle
  sign-out, instant revocation; every audit trigger **including agent writes and settings changes**; hash-chain verification and
  a deliberate tamper test; the retention purge keeps the chain verifiable; two-clinic isolation; version conflicts; void and
  restore; the database refusing DELETE and overlaps; the agent and Booking giving **identical free times** for the same settings.
- **Browser tests (Playwright):** the main flows in English and Arabic/RTL with screenshots, on desktop and tablet widths;
  accessibility scan.
- **Security pass** before go-live (checklist review, dependency audit, scan of the running site).
- **Pilot:** a dermatology clinic, one or two secretaries on one computer, a week side by side with their current method.

---

## 13. Pending legal review (to confirm with a Jordanian compliance advisor before the first real clinic)
1. Consent wording for WhatsApp reminders (staff checkbox) and the first-message notice of the assistant.
2. The privacy policy at limitsiz.si/privacy: add Booking and Accounts, staff access, and the audit log.
3. **"All conversations" visibility** (§5.6): conditions under which a clinic may enable it.
4. Audit retention periods and the erasure-request process (Jordan's 2023 personal-data law).
5. **Data processors:** conversations are processed by Meta (WhatsApp), Anthropic (the assistant's AI) and Supabase
   (storage in Frankfurt), on a Contabo server; confirm agreements and cross-border rules.
Until then the demo clinic is the only data in the system.

---

> **Refinement made while building Accounts (2026-11-05):** §3.2 step 4 said Booking would check `accounts.sessions` itself with a
> read-only database role. Instead Booking asks Accounts' `POST /introspect` (secret + service-session token) on every request, over
> localhost. Same immediacy, but Booking's database login needs **no access to the `accounts` schema at all**, which is stricter.
> Single sign-on and the service session are as designed otherwise.

> **Refinements made while building Settings (2026-11-06):** closures and leave stay in `time_off` (no new `label`/`kind` columns: `reason` is the
> name, `doctor_id` null means a closure). Reminders are limited to two, so the existing `reminder_24h_at` and `reminder_2h_at` columns stay and
> mean first and second reminder. The buffer applies after a booking and after the new one, and may run past the end of a shift. The grid
> starts at the start of the doctor's hours **inside** the opening hours. A clinic with no opening hours at all has none set: the doctors' hours
> apply alone. The after-hours message goes into the assistant's instructions, passed on once in a conversation; the assistant keeps working.

## 14. Running it
- **DNS** `A` records `accounts` and `booking` → `5.189.186.49` (Spaceship); two new Nginx sites with their own certificates.
- **PM2** `limitsiz-accounts` (:3003) and `limitsiz-booking` (:3004), localhost only (~80 MB each).
- **Deploys:** two new workflows with health check and automatic rollback, each triggered by its own folder; the website and
  agent workflows are unaffected.
- **Migrations:** a numbered runner with a `schema_migrations` table, run in a transaction by the deploy of the service that needs it.
- **Database plan:** the free plan has no backups and pauses after about a week idle; move to a plan with daily backups (Supabase
  Pro, from about $25/month, confirm the current price) **before real patient data**, not before the demo.
- **Monitoring:** UptimeRobot on each service's `/health`; email on failed deploys.

---

## 15. Phases

| Phase | Contents | Done when |
|---|---|---|
| **A. Foundation** | shared migrations; accounts, roles, permissions, audit and triggers; database roles; Accounts: sign-in, sessions, lock and switch user, invite, reset, single sign-on, launcher, my account; shared brand styles; DNS, Nginx, workflows | auth and audit tests pass; the first administrator signs in at `accounts.limitsiz.si` |
| **B. Booking core and Settings** | Settings (hours, closures, doctors, intervals, services, rules); the agent reads them; calendar, booking form, list, patients, history, cancel, void, restore; doctor *My schedule*; Arabic/RTL | the browser flow passes in English and Arabic; the agent and Booking give identical free times; a secretary runs a day on the demo clinic |
| **C. Hardening and administration** | two-step, user and session administration, audit page, export, integrity check and daily anchor, retention job, reminders and conversation settings, security review, backups plan | security review has no open high findings; paid database plan active |
| **D. Integration** | hand-off inbox and chat replies in Booking (retire `/staff`), "tell the patient" with an approved template, week view, support access for Limitsiz | each released on its own |

Later services register in `accounts.apps` and appear on the launcher without their own login.

---

## 16. Decisions recorded (owner, 2026-11-05)
| # | Decision |
|---|---|
| D1 | Accounts is a separate service from day one |
| D2 | We build sign-in ourselves |
| D3 | **Staff rules are Settings per clinic**, with pick-lists; also per-doctor appointment interval, clinic and doctor working hours, services and more (§5) |
| D4 | "Delete" = void; hard delete only by reviewed script |
| D5 | Patients without a phone number allowed |
| D6 | Phase D: "tell the patient" checkbox, on by default, approved template |
| D7 | Idle timeout configurable per clinic (default 60 min); lock screen configurable (default 10 min) |
| D8 | Conversation visibility configurable per clinic: None / Hand-off only (default) / All; legal review pending |
| D9 | Audit retention configurable by the clinic administrator (with a 12-month minimum, §7.4) |
| D10 | Paid database plan before real data |
| D11 | No overlapping bookings in phase 1 |
| D12 | Names confirmed: `accounts.limitsiz.si`, `booking.limitsiz.si` |
| — | Doctors have their own login, **read-only by default**; "can also manage bookings" switch or the Secretary role |
| — | Pilot: a dermatology clinic; one or two secretaries share one computer |

**Still open (small; I will assume these unless you say otherwise):** default audit retention is "indefinitely" until the
clinic chooses; the lock screen unlocks with the person's password; public holidays are entered by the administrator (no
automatic Jordan holiday list in phase 1).
