# Connecting the booking agent to WhatsApp (Meta setup)

The agent already runs at `https://agent.limitsiz.si`. This guide connects it to WhatsApp through Meta's
**WhatsApp Cloud API**. Meta changes its screens often: if a button has moved, look for the same words nearby.

Do it in two rounds:

- **Round 1 — Meta's free test number (about 30 minutes, no business verification).** Meta gives every new app a
  test WhatsApp number that can message up to 5 phone numbers you add (yours, a colleague's). Use it to check the
  whole flow end to end with the demo clinic.
- **Round 2 — the clinic's real number.** Needs a number that is not on WhatsApp yet, the business verified, and
  the display name approved. Can take a few days on Meta's side; start the verification early.

---

## Round 1: test number

### 1. Business portfolio and app

1. Go to **business.facebook.com** and create (or pick) the business portfolio for *Limitsiz*.
2. Go to **developers.facebook.com** → **My Apps** → **Create app**.
   - Use case: **Connect with customers through WhatsApp** (older screens: *Other* → app type *Business*).
   - App name: `Limitsiz Clinic Agent`. Link it to the Limitsiz business portfolio.
3. In the app, open **WhatsApp** → **API Setup** (sometimes *Quickstart*). Meta creates a **test number**.

### 2. Collect four values (keep this page open)

| Value | Where | Goes to |
|---|---|---|
| **Phone number ID** | WhatsApp → API Setup, under the "From" test number | the database (clinic) |
| **App secret** | App settings → **Basic** → App secret → **Show** | server `WA_APP_SECRET` |
| **Permanent token** | see step 3 | server `WA_TOKEN` |
| **Verify token** | made up by our helper (step 4) | server and Meta webhook |

Also in API Setup: under **To**, add your own WhatsApp number as a test recipient and confirm the code Meta sends.

### 3. Permanent token (the temporary one on API Setup expires after 24 hours)

1. **business.facebook.com** → **Settings** (gear) → **Users** → **System users** → **Add**.
   Name `limitsiz-agent`, role **Admin**.
2. Select it → **Assign assets**: the **app** (full control) and the **WhatsApp account** (full control).
3. **Generate token** → choose the app → expiry **Never** → permissions **`whatsapp_business_messaging`** and
   **`whatsapp_business_management`** → **Generate**. Copy it once; Meta does not show it again.
   Treat it like a password: never paste it in chat, email or the repo.

### 4. Save the settings on the server

Run the helper from your PC (it asks for the VPS password, hides what you paste, generates the verify token and
shows it once, links the Phone number ID to the **demo clinic**, and restarts the agent):

```powershell
scp C:\Users\User\AppData\Local\Temp\claude\C--Users-User-Desktop-Limitsiz-Ai-Clinic\3e803f54-fe03-43e3-91f3-435b9f69844b\scratchpad\set_wa_env.py root@5.189.186.49:/root/set_wa_env.py; ssh -t root@5.189.186.49 /root/Aiclinic/agent/.venv/bin/python /root/set_wa_env.py
```

(If that path no longer exists, ask Claude to recreate the helper.) Afterwards
`https://agent.limitsiz.si/health` shows `"whatsapp": true`.

### 5. Webhook (Meta → our server)

1. In the app: **WhatsApp** → **Configuration** → **Webhook** → **Edit**.
2. **Callback URL:** `https://agent.limitsiz.si/whatsapp/webhook`
3. **Verify token:** the one the helper showed you → **Verify and save**. (It fails with "could not be
   validated" if step 4 is not done yet.)
4. Under **Webhook fields**, **Subscribe** to **`messages`**.

### 6. Test

From the phone you added as a recipient, send a WhatsApp message to the **test number**, for example
`مرحبا بدي احجز استشارة بكرا`. The agent answers. Book a time, tap **نعم، أكّد**, then look at
`https://agent.limitsiz.si/staff` (Today) to see the booking. Try `بدي احكي مع حدا من العيادة` to see a hand-off
in the Inbox, reply from the staff screen, then **Hand back to the AI**.

Note: with the test number, Meta only lets the first message to a new recipient be a template. The agent only
replies to messages patients send, so this does not matter here.

---

## Reminder template (do it in round 1; approval takes minutes to a day)

**WhatsApp Manager** (business.facebook.com → WhatsApp accounts → WhatsApp Manager) → **Message templates** →
**Create template**:

- Category **Utility**, name **`appointment_reminder`**, language **Arabic**.
- Body:
  `تذكير بموعدك في العيادة: {{1}} مع {{2}}، يوم {{3}} الساعة {{4}}. هل ستحضر؟`
  Sample values: `استشارة جلدية`, `د. لينا حداد`, `الاثنين 07/12`, `16:30`.
- Buttons → **Quick reply** ×2: `تأكيد الموعد`, `تغيير الموعد`.
- **Submit**. Then **Add language** → **English** with the same name:
  `Reminder of your clinic appointment: {{1}} with {{2}} on {{3}} at {{4}}. Will you attend?`
  buttons `Confirm`, `Change`.

The button order matters: first Confirm, then Change. Reminders start working as soon as the template is
approved; nothing to change on the server.

---

## Round 2: the clinic's real number

1. **Business verification:** business.facebook.com → Settings → **Security center** → **Start verification**
   (company documents). Without it Meta limits how many new people you can message per day.
2. **A number not on WhatsApp:** a new SIM or landline that can receive an SMS or a call. If it is on the WhatsApp
   app now, delete that WhatsApp account first (the number moves to the API and can no longer use the app).
3. **WhatsApp Manager** → **Phone numbers** → **Add phone number**: display name (must match the clinic's
   business name; Meta reviews it), category *Medical and health*, verify the code.
4. **Payment method:** WhatsApp Manager → **Payment settings**. Replies to patients within 24 hours of their last
   message are free; reminder templates are charged per message by Meta.
5. **Go live:** in the app, switch **App mode** to **Live**. Meta asks for a privacy policy URL:
   `https://limitsiz.si/privacy`.
6. Run the helper again with the new **Phone number ID** (it asks which clinic). For a real clinic, its details,
   doctors, services and hours replace the demo clinic first.

---

## If something does not work

| Symptom | Check |
|---|---|
| Meta says the callback URL could not be validated | `https://agent.limitsiz.si/health` shows `"whatsapp": true`; the verify token matches exactly |
| Messages arrive but no reply | `pm2 logs limitsiz-agent` on the VPS; the Phone number ID in the database matches the number |
| Reply works, reminders do not | template approved, name exactly `appointment_reminder`, both languages, buttons in order |
| `401` errors in the log | token expired or missing permissions: generate the system-user token again (step 3) |
