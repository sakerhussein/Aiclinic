# Plan: online booking link, voice assistant and brochures

Status: **for the owner's approval, nothing built yet.** Written 2026-11-07, version 2 (voice is now a conversation with the clinic's assistant, and brochures are added). Background: `reports/Clinic booking competitive analysis.md`.

## Where this puts us against competitors

- **The link alone does not put us ahead.** The analysis found patient self-booking is standard among direct peers (rank 17). What it gives us is a way to take bookings **without waiting for Meta**, so it can become the first patient route that actually works.
- **Voice on WhatsApp brings us level.** Iyadati AI already claims it (rank 15).
- **A voice conversation on the web link could be the real difference.** No competitor in the research claims it. That is absence of evidence, so check it before saying it in sales.

## Feature 1: online booking link

### How patients reach it

One address per clinic, for example `book.limitsiz.si/derma`, reached three ways:

| Route | How it works |
|---|---|
| QR code | Printed on the brochures below, and available to download from Settings |
| Typed | The address is short on purpose, and every brochure prints it under the code |
| WhatsApp from reception | A **Send booking link** button on the Bookings and patient pages opens WhatsApp with the message and the link ready. Staff press send |

Each route adds a small tag (`?from=qr`, `?from=wa`), so the clinic can see which one brings bookings.

### What the patient sees

Works on a phone, Arabic or English, no account and no password. The first screen offers two ways to book:

- **Talk to the assistant:** a chat like WhatsApp (Feature 2).
- **Choose it yourself:** service, doctor or "any", day and free time, then name and phone.

Both end the same way: a summary, Add to calendar, and a private link to change or cancel.

Free times come from the same code as staff and the WhatsApp agent, under the clinic's **patient** rules in Settings (notice, how far ahead, change notice, upcoming limit). The database rule that a doctor can never be double-booked covers this route too. If two people take the same time, the second is told and shown the next free times.

### Protecting the clinic

The main risk: **anyone can type anyone's phone number.** So:

- **Until WhatsApp is connected:** the booking is made, and shows in the calendar marked **Online, not checked** until a secretary checks it. One unchecked booking per phone.
- **Once WhatsApp is connected:** the patient also gets a one-time code on WhatsApp, and checked bookings need no staff step.
- **An existing number never changes the patient's record.** The name given is kept on the booking, and staff see a warning if it differs. This also covers a mother booking for her child, with a "booking for someone else" option.
- **The page never says whether a number is already a patient,** and never shows other patients' details.
- Hidden spam field, limits per connection and per phone, and each clinic turns the link on itself (off by default).
- Booking and cancelling are written to the audit log as made by the patient online, with the connection address.

### How it is built

- **Its own small process and login** (`limitsiz-public`, port 3005), from the `booking/` folder, reusing the same free-time code. Public traffic then cannot slow the staff app, and its database login can do only what this page needs. The staff sign-in cookie is on a different address, so the two pages cannot touch each other.
- **Migration 0011:** online booking settings, the booking's online fields, the private change-or-cancel link stored only as a hash, the new login, web chats in the conversations table, and "patient" as a type of actor in the audit log. With an undo script, as usual.
- **Staff side:** Settings > Online booking (on or off, link, clinic logo, show prices or not, brochures), the mark on the calendar, a Mark as checked button, and a filter on Bookings.
- **Server:** DNS record, Nginx site, certificate, PM2 process. Each is a live step that gets its own go-ahead.

## Feature 2: voice assistant

The patient talks to the clinic's AI assistant the way they would on WhatsApp: voice notes or typing, and the assistant answers with text and a voice reply they can play. It is **the same agent** as WhatsApp, with the same rules, tools and safety checks, not a second one to maintain.

| Where | What happens |
|---|---|
| **Web link** | A chat that looks like WhatsApp. Hold the microphone to send a voice note, or type |
| **WhatsApp** | A voice note becomes text and goes to the agent. This replaces today's "please type" reply |
| **Staff booking form** | A microphone button. The secretary says "Hala, Tuesday at 4, laser, Dr Lina", the form fills in, and she checks and saves |

### How one voice message travels

1. The patient's audio is sent to a speech service and becomes text. The audio is then deleted.
2. The text goes through the agent's existing checks: emergency words first, then Claude with the booking tools.
3. The written reply appears at once. The voice version follows a moment later, and the patient can play it.

### Rules

- **Booking always needs a clear yes.** The assistant writes the service, doctor, day and time on the screen, and the patient presses Yes. Speech tools have been reported to invent words now and then, so a spoken detail is never trusted alone.
- **Every reply is written as well as spoken.** Dates, times and doctors must be readable, and patients may be in a waiting room.
- **On the web, the assistant can book but cannot look up or change existing bookings.** On WhatsApp the number is proven by WhatsApp itself. On the web it is only typed, so `my_appointments`, cancel and reschedule stay off there. Changes use the private link. This is the most important safety difference between the two.
- **The phone number is collected in a small form inside the chat,** so it never passes through the AI.
- **The assistant says it is an AI,** as it does on WhatsApp, and offers a person: staff chat through the hand-off screen, or the clinic's phone number when nobody is available.
- **Limits:** 60 seconds a note, a limit on messages per chat and per connection, and a daily cap per clinic, so nobody can run up the bill. The assistant stays on booking only.
- **If voice fails, typing still works. If the assistant is down, Choose it yourself still works.**

### Which AI model: Haiku 5.5

Haiku 5.5 is your suggestion, and it is the cheapest Claude model on Anthropic's current list, so there is no cheaper Claude option to consider.

| Model | Input, per million tokens | Output, per million tokens |
|---|---|---|
| Opus 5.5 (the agent today) | $4.00 | $20.00 |
| Sonnet 5.5 | $2.00 | $10.00 |
| Haiku 5.5 | $0.10 | $0.50 |

That is 40 times cheaper than today. My rough estimate is under 2 cents for a whole booking chat, against roughly 25 to 40 cents on Opus before caching. The test run below will measure the real figure.

- **The switch itself is one setting** (`AGENT_MODEL`), and each channel can have its own.
- **It must pass the test first.** The agent's quality was checked on Opus only. A cheaper model may be weaker with Jordanian Arabic or with the safety rules. We run the full 51-case test on Haiku and the owner signs off, as already planned. That run costs money and needs your `--approve-harness`.
- **One built-in safeguard differs.** On Opus, a refused answer falls back automatically on Anthropic's side. Haiku has no such fallback, so a refusal goes to staff instead.
- **If Haiku fails the test,** the next step is Sonnet 5.5 at $2 and $10.

### Speech services: test before choosing

Claude does not appear to accept audio directly, so two extra services are needed: speech to text, and text to speech.

- **Speech to text:** no published test covers Jordanian dialect, and the only Levantine figures come from a vendor. We score three or four services on 30 to 50 real Jordanian recordings. Cost looks small at about $0.003 to $0.006 a minute on third-party price trackers, or under a cent per note.
- **Text to speech:** Jordanian voices appear on reseller sites, but I could not confirm a provider or a price from official pages. A flat foreign accent would hurt trust, so clinic staff should listen to samples and choose. If nothing sounds right, launch with text replies and add the voice later.
- **Privacy for both:** audio is deleted straight after use, and only the text is kept. The services must offer terms that fit health data, including no training on it. Voice can carry health details, so this goes to the lawyer with the WhatsApp clause.

## Feature 3: brochures for patients

Print-ready files made from the clinic's own details, so each clinic gets its name, logo, QR code and short address filled in automatically.

| Design | Size | Where it goes |
|---|---|---|
| Reception flyer | A5 | Desk and waiting room, Arabic on one side, English on the other |
| Table stand | A6 folded | Reception desk and doctor's room |
| Take-away card | Business card | Handed over at checkout, for the next booking |
| Next-visit card | Business card | A space to write the follow-up date, with the QR code to book it |

Staff download a PDF from Settings and print it anywhere. Each design uses its own QR tag, so the clinic sees which one works.

**Wording needs care.** Jordan Medical Association instructions bar offers and discounts without committee approval, and advertising must be in Arabic. So brochures carry booking instructions only, with no prices, offers or claims about results, and Arabic stays the lead language. They should say the assistant is an AI. The lawyer should confirm whether a clinic brochure counts as advertising.

## Order of work

| Step | What | Rough size | Needs Meta? |
|---|---|---|---|
| 1 | Link with Choose it yourself, staff marks, Settings, Send link button | 2 to 3 weeks | No |
| 2 | Brochures | 3 to 5 days, plus design approval | No |
| 3 | 51-case test on Haiku 5.5 | Days, plus API cost and your sign-off | No |
| 4 | Speech test: Jordanian recordings, staff listen to voices, choose services | Under 1 week, plus recordings from you | No |
| 5 | Assistant chat on the web link, typing first, then voice notes, then voice replies | 2 to 3 weeks | No |
| 6 | Voice on the staff form | 2 to 3 days | No |
| 7 | Voice on WhatsApp, and the one-time code on the link | 1 week | **Yes** |

Each step is tested in English and Arabic on a phone before it goes live, and goes live only on the owner's go-ahead. Tests cover: double booking, the patient rules, a stranger typing someone's number, the private link, agreement with the agent's free times, and that the web chat cannot reach existing bookings.

## Before a real clinic uses it

This takes real patient data from the public, so the earlier "before real patients" list applies in full:

- Supabase paid plan and backups.
- Legal review: the notice patients see, who is responsible for the data, sending audio abroad, the WhatsApp health clause, and the brochures.
- Native Arabic review of every patient-facing word, written and spoken.
- The hand-off inbox in Booking (rank 1), because more chats will need a person.
- The demo clinic stays the only clinic with the link on until these are done.

## Not in this plan

Live phone calls with the assistant, payments or deposits, patient accounts, group booking, and rooms and devices (rank 5). When rooms and devices are built, the shared free-time code covers this page too.
