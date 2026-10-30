# Limitsiz website (featuring Limitsiz Clinic): React + Node.js

Company site for **Limitsiz**. The main focus is the first product, **Limitsiz Clinic** (AI agents for private clinics), with a secondary section on AI consulting and implementation (financial audits).
Built with React (Vite + TypeScript) and an Express API in Node.js. English and Arabic (RTL).

## Version 2 changes

- Outcome-led hero with rotating headline, clinic photo, and animated AI status cards
- Animated orchestration diagram (hub and eight agents with data pulses)
- Live WhatsApp booking demo (loops while on screen)
- Free AI Clinic Assessment section with an animated opportunity score
- Eight agents, including Patient Follow-Up and Insurance Verification
- Specialties with photos; consulting section; scroll-in and count-up animations
- Form: area of interest, clinic size, specialty (needs `supabase/leads_v2.sql`)
- All motion stops for visitors who choose "reduce motion"
- Photos: Pexels (free license), loaded from images.pexels.com; credits in the footer

**Before deploying v2, run `supabase/leads_v2.sql` in the Supabase SQL Editor.** Until then the server still saves requests, but it puts the new fields into the message text.

## Version 3 changes (October 2026 redesign: "infinite intelligence")

- New look: dark ink hero with the open-loop Limitsiz mark, mint accent, Unbounded / Geist / IBM Plex Sans Arabic fonts (Google Fonts)
- Hero "Your clinic, without limits." with an animated infinity loop of six agents
- "Never miss another patient call / booking / follow-up" section with photo and floating status cards
- Agents bento with all eight agents; WhatsApp-style live booking demo; How it works = Assess → Implement → Expand
- Specialties (Dermatology first), A day in the clinic, In practice photos (`client/public/photos/`), security, target results
- Pricing cards are selectable; **Starter is selected by default** and the choice carries into the form
- Consulting section ("AI for financial audits", "AI readiness and strategy"); its button opens the form with consulting selected (`/?interest=consulting#contact`)
- Form: interest, "what should we fix first", clinic size, specialty (one) or specialties (several, for 2+ doctors), package; **email OR phone/WhatsApp is required**
- Motion is calm and stops for visitors who choose "reduce motion"

**Before deploying v3, run `supabase/leads_v3.sql` in the Supabase SQL Editor.** It makes email optional (email or phone is required instead) and adds the `specialties`, `package` and `focus` columns. Until it runs, the server still saves requests that include an email, with the new fields written into the message; requests with only a phone number need the update.

## Structure

```
package.json            Server scripts and dependencies (Express)
.env.example            Copy to .env and fill in
server/index.js         Express server: POST /api/leads, health check, serves the built site
client/                 React app (Vite + TypeScript)
  src/App.tsx           Routes: /, /privacy, /terms
  src/i18n.tsx          English/Arabic switch (RTL) with a context provider
  src/translations.ts   All text, English and Arabic
  src/components/       Header, Footer, DemoForm, HeroArt, Icons
  src/pages/            Home (all sections), Legal (privacy and terms)
  src/styles.css        Blue and teal theme, same as the HTML version
```

## Run it locally

Requires **Node.js 18.18 or newer**.

```bash
# 1. Install everything
npm install
npm --prefix client install

# 2. Configure the server
cp .env.example .env        # Windows: copy .env.example .env
# Values are already filled in for the "Ai clinic" project. Keep the file private.

# 3. Development: two terminals
npm run dev:server          # API on http://localhost:3001
npm run dev:client          # Website on http://localhost:5173 (proxies /api to 3001)

# 4. Production build, then run on one port
npm run build               # creates client/dist
npm start                   # website and API on http://localhost:3001
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Returns `{ "ok": true }` |
| POST | `/api/leads` | Saves an assessment or consulting request. Body: `name`, `clinic`, `email` and/or `phone` (one is required), `message`, `language`, `page`, `interest`, `focus`, `clinic_size`, `specialties` (array), `package`. Returns `201`, `400` (bad input), `429` (rate limit), `502` (Supabase error), or `503` (not configured). |

The endpoint is rate limited to 10 requests per IP every 15 minutes, and it ignores requests with the hidden `website` field filled in (spam bots).

## Security notes

- Keep `.env` out of version control. `.gitignore` already excludes it.
- The publishable key can only insert leads, because of the Row Level Security policy in `supabase/leads.sql`. Never put a secret or service-role key in the React code or in `.env` files that get shared.
- Set `TRUST_PROXY=1` when the server runs behind a proxy, so rate limiting sees each visitor's real IP.

## Deploy

Any Node.js host works (Render, Railway, a VPS, or cPanel with Node support). Set the environment variables from `.env.example` in the host's settings, run `npm run build`, then start with `npm start`.

## Not included yet

- Email alerts for new leads.
- An admin dashboard for leads.
- The clinic product itself (WhatsApp booking agent, receptionist, etc.). This version is the marketing website only.
