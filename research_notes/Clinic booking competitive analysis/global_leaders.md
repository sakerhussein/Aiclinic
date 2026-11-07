# Global leaders in clinic scheduling and practice management for small private clinics (as of November 2026)

Research date: 6 November 2026. "Page checked 6 Nov 2026" means the vendor page was fetched that day; most vendor pages carry no publication date of their own.

Evidence labels used below:
- **Fetched**: the page itself was read.
- **Search excerpt**: seen only through a search-result extract, so wording and date are less certain.
- **Competitor source**: published by a rival vendor. Use with care.

Link caution: search summaries did not always say which result a statement came from. For these items the link is my best match and should be checked before quoting: Phreesia's Grady figure, Luma's Gastro Health figure, the La Fabrique du Net Trustpilot summary, the schedulingkit note on Jane, the Weave AI link, and the RFP.wiki NexHealth summary.

Scope note on fit:
- **Direct peers for a small clinic:** Jane, Cliniko, SimplePractice, Doctolib (Europe), Practo Ray (India and emerging markets), Zanda, Pabau.
- **Add-on engagement layers that sit on top of a practice system or health record:** Weave, NexHealth.
- **Marketplace:** Zocdoc.
- **Mostly large groups and health systems:** Luma Health, Phreesia. They matter here as a view of where the market is going, not as direct competitors.

## What scheduling features do the leading products offer?

### Takeaway
Reminders, online self-booking, recurring appointments, intake forms and basic reporting are universal among direct peers. The features that actually separate products are automated waitlist fill, card-on-file or deposit enforcement, two-way patient messaging, and recall. Vendors often hold these back for top tiers or leave them to partners. Since 2026 the leading edge has been AI receptionists that book and then hand off to staff with context, which is the closest comparison for the Limitsiz WhatsApp agent. Those products are voice-first and SMS-first; I found no vendor documentation of native WhatsApp booking in any of them.

### Cited Findings

#### Feature matrix
Legend:
- Y = confirmed
- T = confirmed but limited to a paid tier
- P = through a third-party partner
- L = limited or manual
- N = not found in native docs
- ? = not confirmed in this research (this does not mean absent)

Sources are in the per-vendor lists below.

| Feature | Jane | Cliniko | SimplePractice | Doctolib | Practo Ray | NexHealth | Weave | Luma | Phreesia |
|---|---|---|---|---|---|---|---|---|---|
| Online self-booking | Y | Y | L (requests by default in the portal) | Y | ? | Y | Y | Y | Y |
| Patient cancels or reschedules self-serve | ? | Cancel Y; reschedule ? | Cancel Y | Cancel Y (cut-off 4 hours) | Y | ? | ? | Y | Y |
| Waitlist (any form) | Y | Y (manual) | T (Plus) | Y (detail unconfirmed) | ? | Y | ? | Y | ? |
| Automated waitlist fill | T (Thrive) | N | ? | ? | ? | Y | ? | Y | ? |
| Recurring appointments | ? | Y | ? | ? | L (one-click treatment course) | ? | n/a | ? | ? |
| Group appointments | Y (no waitlist alerts) | Y | T (Plus) | ? | ? | ? | n/a | ? | ? |
| Rooms and equipment | T (Thrive) | ? | ? | ? | ? | ? | n/a | ? | ? |
| Intake forms | Y | ? | ? | ? | ? | Y | Y | ? | ? |
| Reminders (SMS, email, voice) | SMS on Practice and up | SMS and email | Email, text, voice | SMS and email | SMS | ? | Y | Y | Text, email, voice |
| Confirm or cancel from the reminder | ? | Cancel link in SMS | Y | ? | Y | ? | ? | ? | Y |
| Deposit or card on file | Y | Deposit Y | Late-cancel fee Y | ? | Prepayment | Y | ? | ? | ? |
| No-show or late-cancel fee automation | Y | ? | Y | n/a (see France) | ? | ? | ? | ? | ? |
| Packages and memberships | T (Thrive) | L (reviewers say no membership tool) | ? | ? | ? | ? | n/a | ? | ? |
| Two-way messaging | Secure messaging | P (for SMS replies) | Secure messaging | Y | Follow-up chats | ? | Y | Y | ? |
| Recall | T (return visit reminders) | ? | ? | ? | ? | Y | ? | Y | ? |
| Multi-location | Y (unlimited) | Y (unlimited) | ? | Y (centres) | L | ? | ? | Y | ? |
| Mobile app | Client app | Mobile-friendly web | Clinician and client apps | Pro app | Practo Pro | ? | ? | ? | ? |
| Calendar sync | Y (2 one-way syncs) | Not native in results | T (Plus, per third party) | ? | ? | ? | n/a | ? | ? |
| AI receptionist | P | P | ? | Y (phone) | ? | Conflicting | Y | Y | ? |
| Staff hand-off with context | P | P | ? | Y | ? | ? | Y | ? | ? |

#### Jane (Canada; allied health, multidisciplinary)
- Every plan includes unlimited admins and locations, online booking, 1:1 telehealth, secure messaging, email reminders, intake forms, and invoices (Fetched) — [Jane pricing](https://jane.app/pricing)
- SMS reminders are unlimited and free on Practice and above, with availability varying by region. Thrive adds rooms and equipment, availability tagging, self check-in, automated waitlist management, return visit reminders, packages and memberships, and ratings (Fetched) — [Jane pricing](https://jane.app/pricing)
- Waitlist behaviour (Fetched):
  - Waitlists are on all plans, but Waitlist Notifications require Thrive or a legacy plan.
  - Clients add themselves through online booking with preferred times.
  - When a spot is cancelled, deleted, no-showed or moved, Jane holds it for matching clients. Staff can notify all matches, book a specific client, or release the spot.
  - Notifications go after an admin buffer: 15 minutes if the visit is under 24 hours away, 2 hours otherwise.
  - An "Exclusive Access" window then applies before the slot opens to everyone.
  - Notifications do not work for classes or groups.
  - Source: [Jane guide](https://jane.app/guide/setting-up-your-wait-list-notifications)
- Clinics are not alerted when a client joins the waitlist themselves; staff check it on the Schedule tab (Search excerpt) — [Jane guide](https://jane.app/guide/using-wait-list-notifications)
- Payment rules for online booking: no payment, saved card (Jane's recommendation), full payment, or a fixed deposit, with a per-patient override. A saved card is not charged unless used for a late-cancel or no-show fee. Card data is held by Stripe (Search excerpt) — [Jane guide](https://jane.app/guide/online-booking-pre-payments)
- Marking a visit No Show or Late Cancellation auto-generates an invoice (Search excerpt) — [Jane guide](https://jane.app/guide/adding-no-show-fees)
- Calendar: two separate one-way syncs. The Jane schedule goes out through a private iCal link, and Google events come in as busy blocks (Search excerpt) — [Jane integrations](https://integrations.jane.app/integrations/external-calendar-management.md)
- Jane also sells human virtual assistants and receptionists; its AI Scribe is for charting, not scheduling (Fetched) — [Jane features](https://jane.app/features)

#### Cliniko (Australia; allied health)
- All features are on every plan, with no tier gating; unlimited admin and reception users, locations and patients (Fetched) — [Cliniko pricing](https://www.cliniko.com/pricing/)
- Waitlist is manual. It records availability, preferred practitioner and business, urgency and expiry, and staff book from it. Booking a waitlisted patient can archive their later appointment (Search excerpt). I found no automatic notification in native docs — [Cliniko help](https://help.cliniko.com/en/articles/1402450-using-the-wait-list)
- Group appointments: set max patients above 1, reserve the space first, and online booking shows spots until full (Search excerpt) — [Cliniko help](https://help.cliniko.com/en/articles/9668605-group-appointments-an-overview)
- Recurring appointments at chosen intervals, SMS and email reminders, patient self-cancel, arrival notifications, and a mobile-friendly calendar (Fetched) — [Cliniko appointments](https://www.cliniko.com/features/appointments/)
- Confirmations and cancellations are email-only. SMS reminders can include a cancel link. Deposits can be paid during online booking (Search excerpt) — [Cliniko help](https://help.cliniko.com/en/articles/1023945-let-patients-cancel-their-appointments)
- Two-way SMS and AI reception come from partners, not Cliniko:
  - [Lyngo](https://www.cliniko.com/connected-apps/lyngo-ai/) describes replies to reschedule or cancel, and Stripe deposit links.
  - [BookedSolid](https://www.cliniko.com/connected-apps/bookedsolid/) describes similar functions.

#### SimplePractice (US; solo therapists and mental health)
- Clients request times through the Client Portal, and staff accept, decline or reschedule on a Requests page (Search excerpt) — [SimplePractice help](https://support.simplepractice.com/hc/en-us/articles/41929603998605-Managing-appointment-requests)
- The waitlist is Plus-only (Search excerpt) — [SimplePractice help](https://support.simplepractice.com/hc/en-us/articles/33726366744589-Navigating-the-Inquiries-page)
- Plus also carries group appointments, group telehealth, advanced analytics and the ability to add practitioners (Fetched) — [SimplePractice pricing](https://www.simplepractice.com/pricing/)
- Reminders go by email, text or voice, and are included on Essential and Plus. Clients can confirm or cancel from the reminder (Search excerpt) — [Help: reminders](https://support.simplepractice.com/hc/en-us/articles/42052535058957-Setting-up-appointment-reminders); [Help: confirm or cancel](https://support.simplepractice.com/hc/en-us/articles/42052510111629-Adding-a-confirm-or-cancel-option-in-text-and-voice-reminders)
- Cancellation policy windows are 24, 48 or 72 hours, or a required phone call. Cancellations outside the window become Late Canceled and bill by default (Search excerpt) — [Help: cancellation policy](https://support.simplepractice.com/hc/en-us/articles/360046771271-Setting-up-your-practice-s-cancellation-policy)
- Two-way Google sync reported as Plus-only, with bugs around out-of-office blocks (Competitor source) — [Upheal](https://www.upheal.io/blog/therapy-calenar-sync-how-to-fix-booking-gaps)
- Client Portal mobile app exists — [SimplePractice help](https://support.simplepractice.com/hc/en-us/articles/9651784620045-The-SimplePractice-Client-Portal-mobile-app)

#### Doctolib (France, Germany, Italy, Netherlands)
- Agenda, online booking, waiting list, public directory visibility, teleconsultation, patient records, Pro mobile app, remote secretary service, and automatic SMS and email reminders (third-party guide updated 23 Sept 2026, not a Doctolib page) — [Lona Santé](https://www.lonasante.com/?p=11708)
- AI phone assistant (Search excerpts of Doctolib's own community posts):
  - Books appointments autonomously, answers some administrative questions, and passes requests through patient messaging, including out of hours — [Spring 2026](https://community.doctolib.fr/t/medecins-decouvrez-les-innovations-du-printemps-2026/168806)
  - Summer 2026 added direct urgent booking and configurable qualifying questions, with answers added to the call summary. Secretaries as well as practitioners can reach its messages and settings — [Summer 2026](https://community.doctolib.fr/t/assistant-telephonique-decouvrez-les-nouvelles-fonctionnalites-et-ameliorations-de-lete-2026/199097)
  - For multi-specialty health centres it detects the specialty and routes to the right agenda. Patients blocked from online booking are also refused by the assistant — [Apr–Jun 2026](https://community.doctolib.fr/t/les-details-qui-font-la-difference-avril-a-juin-2026/184920)
  - An AI call summary opens from the appointment card, and a new Pro mobile app was released — [Jul–Sep 2026](https://community.doctolib.fr/t/les-details-qui-font-la-difference-juillet-a-septembre-2026/202176)
- Anti-no-show rules: patients can cancel online up to 4 hours before, practitioners can block online booking for repeat no-shows, and confirmation for new patients was under study (Search excerpt, date unconfirmed) — [Le Quotidien du Médecin](https://medecine-generale.lequotidiendumedecin.fr/liberal-soins-de-ville/gestion-cabinet/doctolib-annonce-des-mesures-supplementaires-contre-les-rendez-vous-non-honores)

#### Practo Ray (India)
- Automated SMS with reschedule or cancel and directions, online prepayment, one-click scheduling for a full treatment course, post-consultation chats, record sharing, two-factor login, IP allow-listing, Practo Pro mobile app, and Indian ABDM compliance (Fetched) — [Practo Ray](https://www.practo.com/ray)
- Limited scalability for multi-location use, per a competitor's guide (Competitor source) — [Zoho](https://www.zoho.com/healthcare/resources/guides/best-practice-management-software-2026.html?src=dd)

#### NexHealth (US; dental-led, runs on top of a health record)
- Online booking synced to the health record, availability updates in 10–15 seconds for most integrations, double-booking prevention, booking from Google (Fetched) — [NexHealth scheduling](https://www.nexhealth.com/features/scheduling)
- Waitlist: notifies patients, first to book wins, others are told the slot is filled (Fetched). It can pull ASAP lists from the record — [NexHealth scheduling](https://www.nexhealth.com/features/scheduling)
- Recall: rules based on care codes, appointment history or type, with one-click rebook links (Fetched) — [NexHealth scheduling](https://www.nexhealth.com/features/scheduling)
- Card required or deposit by appointment type and by new or existing patient (Fetched), though the same page's comparison table marks this "Limited" — [NexHealth scheduling](https://www.nexhealth.com/features/scheduling)
- Sources conflict on an AI receptionist: [NexHealth developer docs](https://docs.nexhealth.com/docs/whats-possible-with-nexhealth) describe an AI voice receptionist as something that can be built; [a third-party review](https://practice-edge-blog.netlify.app/articles/nexhealth-review-2026) says there is no AI voice agent.

#### Weave (US; dental, optometry, vet; phones plus texting)
- Plans are Pro, Elite and Ultimate. Listed features include VoIP phones (up to 15 on Ultimate), bulk texting (1,500, 3,000 and 15,000 messages a month), reminders, two-way texting, online scheduling, digital forms, Text to Pay, reviews, and AI "Call Intelligence". Per-plan inclusion is not shown (Fetched) — [Weave pricing](https://www.getweave.com/pricing/)
- Omnichannel AI Receptionist, announced 28 May 2026 (Fetched):
  - Handles voice and text with context kept across channels.
  - Can be deployed on the main line, after hours, overflow, or for specific call types.
  - Escalates to staff with context, and practices define escalation paths.
  - Conversations appear in one thread with transcription and analytics.
  - The release does not say the AI itself books appointments.
  - Source: [Weave press release](https://www.getweave.com/press-releases/weave-unveils-enterprise-grade-omnichannel-ai-receptionist-built-with-google-clouds-gemini-enterprise-agent-platform-to-transform-healthcare-front-offices/)
- A later 2026 update added behaviour configured by working hours and contact type, plus escalation paths (Search excerpt) — [Weave investor news](https://investors.getweave.com/news/news-details/2026/Weave-Expands-Enterprise-Ready-Platform-to-Deliver-Greater-Security-AI-powered-Automation-and-Streamlined-Front-office-Workflows/default.aspx)

#### Luma Health (US; health systems and large groups)
- Smart Waitlist is rules-based and offers only matching slots. Self-scheduling runs from the web, Google, SMS and voice (Search excerpts) — [Luma scheduling](https://go.lumahealth.io/patient-success-platform/patient-scheduling/)
- Navigator is a conversational agent for calls and texts covering scheduling, cancellations and refills, and can switch between phone and SMS. After a cancellation or no-show it offers new times with the same provider and keeps following up (Search excerpts) — [Luma Navigator](https://go.lumahealth.io/patient-success-platform/ai-navigator/); [Luma AI agents](https://www.lumahealth.io/new-ai-agents-run-patient-outreach-and-book-appointments/)

#### Phreesia (US; medical groups)
- Text, email and voice reminders in 20+ languages. Patients confirm, cancel or reschedule from the reminder on any channel. The reminders page does not mention a waitlist (Fetched) — [Phreesia reminders](https://www.phreesia.com/patient-appointment-reminders/)
- A 2021 "Appointment Accelerator" product addressed earlier-slot offers (Search excerpt) — [Business Wire](https://www.businesswire.com/news/home/20210709005225/en)

#### Zocdoc (US marketplace)
- A patient-acquisition marketplace that pays per new-patient booking. Separate "Practice Solutions" tools carry a monthly per-provider fee (Competitor source) — [NexHealth vs Zocdoc](https://www.nexhealth.com/compare/zocdoc)

#### Others worth tracking
- **Pabau (UK; aesthetics and multidisciplinary):** deposits as a percentage, fixed amount or full payment, policy-wide or per service; memberships and session credits shown on the client card (vendor's own blog) — [Pabau](https://pabau.com/blog/best-medical-spa-software/)
- **Zanda (formerly Power Diary; Australia):** "Advanced Waitlist" listed among plan inclusions (Search excerpt) — [Capterra](https://www.capterra.com/p/180530/Power-Diary/pricing/)
- **Tebra (US):** reminders listed in tiers on G2. I found no evidence of a waitlist (absence not confirmed) — [G2](https://www.g2.com/products/tebra-previously-kareo-patientpop/pricing)

### Inferences

**Table stakes for a small clinic:**
- Automated reminders, with a cancel link or reply action.
- Online self-booking or a booking channel.
- Staff calendar with practitioner and service rules.
- Recurring appointments.
- Basic reports and export.
- Role-based staff access.
- A mobile-usable calendar.

Limitsiz has reminders, booking through WhatsApp, the calendar, Excel export, and roles. Recurring appointments are not in the product description you gave me. A week view is very likely expected, but my sources did not test it directly (see Gaps).

**Common but tiered (the "pay more" line):**
- Waitlist automation, recall, rooms, packages, and calendar sync sit on top tiers at Jane and SimplePractice.
- This suggests vendors see them as worth paying for, and a smaller team could use them as upsell levers.

**Differentiators today:**
- **Automated waitlist fill.** Only Jane (Thrive), NexHealth and Luma are confirmed here. Cliniko's native version is manual.
- **AI agent booking with staff hand-off.** Confirmed at Doctolib and Luma, and at Weave for the conversation and hand-off side. Cliniko and Jane depend on partners.

**Against the Limitsiz gaps:**
- The hand-off inbox is not an optional extra in this category. Weave's and Doctolib's designs both pair the agent with a staff view: a unified thread or call summary, escalation paths, and qualifying answers. An agent without a hand-off inbox is behind these two on its main selling point.
- Doctolib's blocked-patient rule, which applies to both online booking and the phone agent, shows that booking rules should be shared between staff app and agent. Limitsiz's shared free times are the same principle, and blocking a repeat no-show could be an inexpensive addition.
- Deposits or card capture depend on payment rails that may be harder in Jordan. Whether this applies is outside this notes file and is a question for the regional research.

**Possible white space:**
- Arabic and English RTL with an agent working on WhatsApp was not found in any of these products.
- This rests on limited searching, so verify before using it in marketing.

### Gaps
- **Native WhatsApp booking:** my one search returned no vendor documentation for Doctolib, Jane, Cliniko, Weave or Practo. A low-quality post claims [Jane has no WhatsApp or virtual receptionist](https://hashnode.com/posts/why-canadian-clinics-are-switching-from-jane-app-in-2026-1/69ae58b6a7bc5712f20e5632). A Practo-WhatsApp claim appeared in a generic blog only. Absence is unproven.
- **Arabic or RTL support:** not checked for any vendor. Phreesia's "20+ languages" claim does not say which languages.
- **Week view:** not specifically verified at any vendor. Cliniko's page says only that the calendar offers adjustable display. Screenshots or help articles would settle it.
- **Unconfirmed matrix cells:** the "?" cells were not tested individually. Do not read them as absence. Weakest areas are recurring appointments outside Cliniko, rooms outside Jane, and intake forms at Doctolib and Luma.
- **Doctolib's waitlist:** a third party lists it as included, and a [Doctolib webinar PDF](https://res.cloudinary.com/doctolib/image/upload/v1596121805/walkme/Email%20assets/pdf/Webinaire_R%C3%A9duire_les_appels.pdf) names an "activate the waiting list" section, but I could not confirm automatic alerts. Its help centre was not reached.
- **Jane Payments:** a claim that all clinics are being moved to Jane Payments in May 2026 appears only in the Hashnode post above. Unverified.

## Which features are advertised as reducing no-shows or front-desk work, and with what figures?

### Takeaway
Reminders with a cancel or confirm action, deposits or cards, and waitlist fill are the three levers vendors sell. Almost every figure is vendor-produced, usually from a single customer or an undefined average. The biggest claims lack a baseline, and the most useful real-world reference is Doctolib's published network no-show rates of about 3–4%, which are also vendor data.

### Cited Findings

All figures in this table were produced by the vendor or its customer unless stated.

| Figure | Claim | Producer | Reliability note | Source |
|---|---|---|---|---|
| 79% | Reduction in no-shows | Phreesia | Page gives no baseline, period or sample. Another Phreesia page and a search excerpt add wording that narrows it (within 30 days of launch, or among patients who confirm), which I could not confirm on the fetched page | [Phreesia](https://www.phreesia.com/patient-appointment-reminders/) |
| 46% | More confirmations | Phreesia | No footnote | [Phreesia](https://www.phreesia.com/patient-appointment-reminders/) |
| 3.5% | No-show reduction across departments, year over year, Grady Memorial | Phreesia case study (Search excerpt) | Much smaller than the headline figure. Hospital, not a small clinic | [Phreesia](https://www.phreesia.com/?p=7975) |
| Over 70% | Fewer no-shows from reminders | Smile Dental Clinic testimonial on Practo's site | One customer | [Practo Ray](https://www.practo.com/ray) |
| 50% | Fewer no-shows and cancellations, The Dermatology Specialists | NexHealth | Named customer, no method | [NexHealth](https://www.nexhealth.com/features/scheduling) |
| $150K+ a year | Revenue from waitlist gap-filling, Norbo Dental | NexHealth | Case title separately says $3,000 a week. Also claims 3 staff hours saved a day (Search excerpt) | [NexHealth](https://www.nexhealth.com/features/scheduling); [Case study](https://www.casestudies.com/company/nexhealth/case-study/norbo-dental-gains-3000-in-weekly-revenue-with-nexhealth-waitlist) |
| "Zero" | No-shows from online booking when new patients must put a card down | Dentist testimonial | Anecdote | [NexHealth](https://www.nexhealth.com/resources/benjamin-turnwald-dentistry) |
| 73% and 82% | Appointments booked after hours; patients booking on mobile | NexHealth | Audience unknown | [NexHealth](https://www.nexhealth.com/features/scheduling) |
| 36% | Clients booking after hours | SimplePractice | No source given. Far below NexHealth's 73%, showing how much these figures vary | [SimplePractice blog](https://www.simplepractice.com/blog/ehr-scheduling-software/) |
| 0.52% (from 2.25%) | No-show rate, Village Dermatology, and over 36% of waitlist patients took earlier slots | Luma | The most relevant size and specialty match, but a case study | [Case study](https://www.casestudies.com/company/luma-health/case-study/village-dermatology-now-has-a-052-no-show-rate-with-luma) |
| 42.41% and 21% | Waitlist offer fill rate and fewer no-shows, First Choice Health Centers | Luma | Revenue reported as both $125k and $127k | [Case study](https://www.casestudies.com/company/luma-health/case-study/first-choice-health-centers-gained-127k-in-additional-revenue-from-lumas-smart-waitlist) |
| About 45% | Last-minute openings filled, Gastro Health | Luma | Large group | [Luma](https://www.lumahealth.io/) |
| 20% | No-show reduction, Mile Bluff Medical Center | Luma | Medical centre | [Luma PDF](https://lumahealth.io/wp-content/uploads/2025/02/Mile-Bluff-Medical-Center-Luma-Case-Study.pdf) |
| Up to 50%, 25%, 20% | Less admin time, more medical time, more revenue | Doctolib, as reported by a third party | The third party itself labels these as publisher figures | [Lona Santé](https://www.lonasante.com/?p=11708) |
| Up to 4 hours a week | Time saved per doctor | Doctolib marketing headline (Search excerpt) | Headline only | [Doctolib](https://info.doctolib.fr/guides/medecins-generalistes-specialistes-gain-de-temps/) |
| 20–30% and 75% | Calls missed; callers who never try again | TrueLark, on a Weave page | No source found | [Weave](https://www.getweave.com/truelark/) |

**Baselines (network data, vendor-produced):**
- Doctolib: 3.3% no-shows across specialties, 2.6% for GPs, 3.1% for specialists; published 3 July 2024, and credited by the article to features added in 2023 — [Le Quotidien du Médecin](https://cardiologie.lequotidiendumedecin.fr/liberal-soins-de-ville/exercice/baisse-generale-des-rendez-vous-non-honores-33-de-taux-de-lapins-toutes-specialites-revele-doctolib)
- Earlier Doctolib survey: 4.1% on about 30 million appointments (2022), with new patients at 5.2% at GPs (Search excerpt) — [Le Quotidien du Médecin](https://medecine-generale.lequotidiendumedecin.fr/liberal-soins-de-ville/gestion-cabinet/doctolib-annonce-des-mesures-supplementaires-contre-les-rendez-vous-non-honores)

**Vendors that state no number:**
- Weave's reminder and texting pages talk about fewer no-shows without a figure (Search excerpt) — [Weave AI](https://www.getweave.com/ai/)
- SimplePractice says confirm-or-cancel "can help reduce no shows" without a figure (Search excerpt) — [SimplePractice help](https://support.simplepractice.com/hc/en-us/articles/42052510111629-Adding-a-confirm-or-cancel-option-in-text-and-voice-reminders)
- Jane promotes a webinar on the topic — [Jane guide](https://jane.app/guide/on-demand-webinar-no-more-no-shows-simple-steps-to-reduce-missed-appointments-in-your-practice)

### Inferences
- Treat 79% and 70% as marketing ceilings. The evidence pattern is a 20–50% reduction for named customers (vendor-reported) and a network floor of around 3–4% in France. The French baseline may not transfer to other markets.
- New patients show up less reliably than existing ones at Doctolib, and vendors target this group for cards and deposits (NexHealth, Jane). A rule applied to new patients only is a focused, low-friction design.
- A waitlist fill rate of 40–45% (Luma, vendor-reported) is the most useful target to compare against if Limitsiz builds this. The WhatsApp channel might do better or worse; no data exists here.
- Front-desk savings are the weakest evidence: few figures, little method. If Limitsiz publishes numbers, a stated baseline and sample would stand out in this market.

### Gaps
- I found no independent, controlled study of any named product's no-show effect.
- General research figures on SMS reminders appeared in search results (a Cochrane range of 29–39% and a UK study at 38%), but I did not trace them to the original papers, so verify before use.
- Two studies said to be cited on a SimplePractice blog (18.55% to 7.01%, and 3% vs 24%) could not be found on the two blog pages I checked. Do not use them.
- [Doctolib's press release on missed appointments](https://media.doctolib.com/image/upload/mkg/file/cp_rdv_non_honores.pdf) could not be read, because the PDF's text was not extractable.
- Luma's [Mile Bluff case study page](https://www.lumahealth.io/resource/mile-bluff-medical-center-drives-200k-in-additional-annual-revenue-with-luma/) returned 404; the 20% figure comes from a search excerpt of the PDF.

## What are the pricing models and price points?

### Takeaway
Four models exist:
- Published flat or per-practitioner subscriptions for direct peers: about US$45–100 a month for a solo practitioner.
- Quote-based engagement layers: from about US$199–350 a month per location.
- Per-booking marketplace fees: historically $35–110.
- Regional subscriptions, such as Doctolib at about €135–199 a month per doctor.

Messaging is commonly bundled (Jane Practice and up, SimplePractice) or metered (Cliniko at 10¢ per SMS).

### Cited Findings

| Vendor | Model | Price (date) | Notes | Source |
|---|---|---|---|---|
| Jane | Per plan plus licences | CAD 59 Balance (20 appointments a month), CAD 79 Practice, CAD 99 Thrive; each includes 1 practitioner (page checked 6 Nov 2026) | AI Scribe CAD 15, Group Telehealth CAD 15, Insurance Billing CAD 20 plus licence fees, Payroll CAD 40 plus CAD 6 per staff, Websites CAD 59. Extra licence rates did not appear in the fetched text | [Jane pricing](https://jane.app/pricing) |
| Jane | Price change | Balance rose 9% from $54 to $59, captured 28 Sept–5 Oct 2026 (third-party tracker; not confirmed by Jane) | Practice and Thrive unchanged | [Pulse](https://getpulsesignal.com/changes/jane) |
| Cliniko | Banded by practitioner count, all features | US$45 (1), $95 (2–5), $145 (6–8), $195 (9–12), $295 (13–25), $395 (26–200) (page checked 6 Nov 2026) | SMS 10¢ prepaid. One free month on annual billing. Vendor says prices are unchanged since June 2011 | [Cliniko pricing](https://www.cliniko.com/pricing/) |
| SimplePractice | Per plan and per clinician | US$49 Starter, $79 Essential, $99 Plus; extra clinician on Plus $74 (page checked 6 Nov 2026) | 50% off for 3 months. Care Aide $59, Note Taker $35, ePrescribe $49 plus $89 setup, Insurance Navigator $1.79 per claim. 6+ practitioners go to sales | [SimplePractice pricing](https://www.simplepractice.com/pricing/) |
| Doctolib (France) | Monthly per practitioner, by profession | €135 (doctor, clinical and financial), €199 with AI assistants, €274 (doctor, clinical and patient management), €139 (dentist and others), €69 (physio, billing) (guide updated 23 Sept 2026) | Third-party figures. The guide calls them an order of magnitude and is internally inconsistent: it also cites €135–139 annual and €149 monthly. Installation fee not stated | [Lona Santé](https://www.lonasante.com/?p=11708) |
| Zocdoc | Per new-patient booking | $35–110 at the 2019 launch. Vendor no longer publishes a range, per a rival | Fee applies even on no-show or cancellation unless waived. One customer cites $73 a booking (date unclear) | [NexHealth](https://www.nexhealth.com/compare/zocdoc); [Zocdoc via Emitrr, updated 13 Aug 2026](https://emitrr.com/blog/zocdoc-pricing/) |
| Weave | Quote by plan | "Starting from $199 per month" (page checked 6 Nov 2026) | No per-plan prices. The page does not say whether the figure is per location | [Weave pricing](https://www.getweave.com/pricing/) |
| NexHealth | Quote, modular | No current official price found. Third parties say about $350 a month; an unofficial-looking mirror shows $300 for online booking (undated) | "No fee per patient" (vendor). Capterra describes three tiers | [Mirror](https://nexhealth-live-site.pages.dev/pricing); [Capterra](https://www.capterra.com/p/182271/NexHealth/) |
| Phreesia | Quote | $250 a month starting figure from SelectHub (undated, third-party) | Vendor says pricing follows practice volume and staffing | [SelectHub](https://www.selecthub.com/p/patient-engagement-software/phreesia/) |
| Luma Health | Quote | None published | Third party calls the pricing opaque | [RFP.wiki](https://www.rfp.wiki/vendors/luma-health) |
| Practo Ray | Monthly | ₹1,499–1,999 a month with 8,000 SMS (TechJockey, undated); from ₹999 (FitGap, undated) | Practo's page links to a plans page and offers a 7-day trial | [TechJockey](https://www.techjockey.com/detail/practo-ray); [FitGap](https://us.fitgap.com/products/ray-by-practo); [Practo](https://www.practo.com/ray) |
| Zanda | First practitioner plus add-ons | US$49 plus $19 per extra practitioner (2026, competitor source) | Legacy plans moved to a value-based model in April 2026 (vendor) | [Pabau](https://pabau.com/blog/zanda-pricing/); [Zanda FAQ](https://support.zandahealth.com/upcoming-pricing-changes-faqs) |
| Pabau | Per location by team size | $104 solo, $187 for 2–3 users, $271 for 4–5, $386 for 6–15 (2026 vendor blog). Other Pabau posts say from $62 | Figures conflict across its own blogs | [Pabau](https://pabau.com/blog/best-medical-spa-software/) |

Add-on and pass-through costs:
- Partner AI receptionist for Jane from $109 a month (vendor claim) — [AgentZap](https://agentzap.ai/blog/best-answering-service-for-jane-app-ai-vs-live-vs-hybrid-2026)
- Practo Prime charges a one-time fee to the clinic on a patient's first use, and requires a Ray subscription (Fetched) — [Practo](https://www.practo.com/ray)

### Inferences
- A "small clinic" reference price is about US$50–100 for one practitioner and about US$100–250 for three, depending on the vendor. A three-practitioner Cliniko account is $95; Jane Thrive is CAD 99 plus licences (amount unknown); SimplePractice Plus is $247.
- Only Cliniko publishes "everything included" pricing, and reviewers praise its value. SimplePractice shows the opposite experience (see the reviews section).
- Per-booking fees that apply regardless of attendance are a clear point of pain. Flat pricing with no per-booking fee is a credible position; NexHealth already markets it.
- AI is becoming an explicit price step: Doctolib's €64 difference between €135 and €199, and Jane and SimplePractice add-ons of CAD 15 and US$35–59. Those are all for documentation AI, not for booking agents.

### Gaps
- Zocdoc's current fee schedule is not public. A third-party search extract mentioned a free basic profile and a $250-per-provider "Advanced" tier; I could not attribute it to a specific page, so verify before use.
- Weave quotes vary. Search results gave $249–$399 starting figures, reported totals of $400–$700 per location, and setup fees of $499–$1,500. These came from third-party blogs I did not individually check.
- Tebra publishes no tiers. Third-party estimates ran from about $99 to $499 per provider a month, and Capterra shows $49 per user. Unverified.
- Jane's per-licence rates were blank in the fetched text.
- Doctolib prices need checking against a Doctolib quote or contract.
- Prices for Germany, the Gulf, and other regions were not checked.

## What do users praise or complain about most in reviews?

### Takeaway
Users praise ease of use, good support and transparent value. They complain about price rises that move features to higher tiers, weak support after acquisition, opaque quotes, sync and reliability bugs, and being billed for bookings that never become visits. Review bases differ greatly in size and in who is reviewing, so comparisons across vendors are rough.

### Cited Findings
- **Jane:**
  - About 4.8/5 on Capterra, from roughly 490–538 reviews depending on the page (Search excerpt) — [Capterra](https://capterra.com/p/178984/Jane-App/)
  - Praise: easy scheduling, prompt and friendly support. Complaints: browser-specific bugs, limited invoice customization, a time-zone scheduling error (Search excerpts) — [Capterra](https://www.capterra.com/p/178984/Jane-App/reviews/?page=3)
  - General summaries also mention insurance billing limits and a dated interface — [schedulingkit](https://schedulingkit.com/pricing-guides/jane-app-pricing)
- **Cliniko:**
  - Ease of use 4.9 and customer service 4.7 on Capterra, across only 23 reviews (Search excerpt) — [Capterra](https://www.capterra.com/p/180878/Cliniko/reviews/)
  - Praise: easy online booking, staff diary views, fair pricing. Complaints: website booking embed is awkward, no recurring invoices, no membership management, thin accounting integration, some reports not detailed enough — [Capterra](https://www.capterra.com/p/180878/Cliniko/reviews/)
- **SimplePractice:**
  - Capterra 4.6 from 2,827 reviews, G2 4.1 from 125 (Search excerpts) — [Capterra](https://www.capterra.com/p/130710/SimplePractice/reviews/?page=8); [G2](https://www.g2.com/products/simplepractice/reviews?page=5)
  - Main complaint: a price increase that moved popular features to the top tier — [Capterra](https://www.capterra.com/p/130710/SimplePractice/reviews/?page=8)
  - One review from 2022 cites a 50% rise — [Softwarefinder](https://softwarefinder.com/emr-software/simplepractice/reviews?page=14)
  - Reported early-2025 move from $29 to $49+, plus difficulty reaching live support and slow billing responses (alternatives-focused source) — [EHR Source](https://ehrsource.com/articles/simplepractice-problems-2026/)
- **Doctolib:**
  - Thin English-language data: 13 verified reviews on the main Capterra listing, last updated 13 April 2026 (Search excerpt) — [Capterra](https://www.capterra.com/p/184480/Doctolib/reviews/)
  - Practitioner-side complaints: high cost for a small practice, repeated price rises, disputed support quality, dependence on a dominant player — [Lona Santé](https://www.lonasante.com/?p=11708)
  - Aggregated reports of Trustpilot complaints: login problems, document bugs, weak search, hard-to-reach support (not confirmed on Trustpilot) — [La Fabrique du Net](https://www.lafabriquedunet.fr/logiciel/doctolib)
- **Zocdoc:**
  - The two audiences differ. Patient-side Trustpilot volume is large, about 13,900+ reviews, and summaries describe it as high overall — [Trustpilot](https://www.trustpilot.com/review/www.zocdoc.com?page=9)
  - Providers complain of fees for no-shows and cancellations, false insurance details, and refused credits (individual reviews) — [Trustpilot](https://www.trustpilot.com/review/www.zocdoc.com?page=4)
  - One provider review on TrustRadius, headed "High Cost and Many No Shows" — [TrustRadius](https://www.trustradius.com/reviews/zocdoc-2022-04-07-12-47-15)
  - TrustRadius overall is 1 out of 10 on 3 reviews, far too few to weigh — [TrustRadius](https://www.trustradius.com/products/zocdoc)
  - A customer quoted by a competitor reports 14 no-shows among 42 April bookings, billed either way (Competitor source) — [NexHealth](https://www.nexhealth.com/compare/zocdoc)
- **Weave:**
  - Capterra 4.3 from 668 reviews (Search excerpt) — [Capterra](https://capterra.com/p/141842/Weave/pricing/)
  - Software Advice lists customer service and glitches as cons, with a 4.7 rating from 672 reviews; the extract may mix products, so verify — [Software Advice](https://www.softwareadvice.com/medical/weave-profile/)
  - Friction around pricing and call quality or reliability, according to a competitor — [DemandHub](https://www.demandhub.co/articles/weave-alternatives/)
- **NexHealth:**
  - 4.7/5 on GetApp (Search excerpt) — [GetApp](https://www.getapp.com/healthcare-pharmaceuticals-software/a/nexhealth/)
  - Liked once live, but pricing feels high for small offices; opaque pricing, setup complexity, EHR sync delays; billing continuing after cancellation (third-party summary) — [RFP.wiki](https://www.rfp.wiki/vendors/nexhealth)
- **Practo Ray:** thin data; G2 4.8 from 15 reviews — [G2](https://www.g2.com/products/ray-by-practo/pricing)
- **Phreesia:** small practices may find the price exceeds the savings; not suited to very small solo practices (independent review) — [AI Health Guide](https://ai-health-global.pages.dev/reviews/phreesia-review/)
- **Luma Health:** opaque services pricing, with integration dominating rollout cost (third-party summary) — [RFP.wiki](https://www.rfp.wiki/vendors/luma-health)
- **Zanda:** described as expensive for smaller practices on G2 (Search excerpt) — [G2](https://www.g2.com/products/zanda-formerly-power-diary/reviews)

### Inferences
- Trust themes matter more than features in these reviews. The products with the best sentiment here (Jane, Cliniko) are simple to learn and have reachable support.
- Limitsiz should avoid the SimplePractice pattern: keep prices stable and do not move existing features to a higher tier after customers depend on them.
- Charging for outcomes the clinic did not get is a reputational risk. If Limitsiz prices the agent by booking, the Zocdoc complaints suggest charging only for attended visits, or using a flat fee.
- Sync reliability is a recurring complaint for layered products. Limitsiz's shared free times are a real advantage as long as agent and staff app never disagree. It is worth keeping this visible in the product and sales story.
- Reporting and invoicing gaps show up even in loved products. Small clinics notice them, but they do not appear to cause churn in the reviews I saw.

### Gaps
- I could not fetch Capterra or G2 review pages directly (403 errors), so review findings rest on search excerpts and small samples. They show themes, not frequency counts.
- No Trustpilot data was collected for SimplePractice, and Doctolib's practitioner-side Trustpilot data was secondhand.
- No user reviews were found on AI booking agents specifically (Doctolib's phone assistant, Weave's AI Receptionist, Luma's Navigator). This is the most relevant review gap for Limitsiz, and French physician forums or the Doctolib community threads would be a next step.
- Software Advice was only seen as search excerpts for most vendors.
