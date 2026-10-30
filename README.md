# Limitsiz Clinic: Website (HTML, CSS, JavaScript)

Static multi-page site in English and Arabic (RTL). Version 1, to be ported to React.js and Node.js later.

## Files

| File | Purpose |
|---|---|
| `index.html` | Home page: hero, problem, agents, in practice (photos), how it works, a day in the clinic, security, targets, pricing, FAQ, contact form |
| `privacy.html` | Privacy Policy (draft, pending legal review) |
| `terms.html` | Terms of Use (draft, pending legal review) |
| `css/styles.css` | "Infinite intelligence" theme (dark ink + mint), layout, animations, responsive rules, RTL support |
| `assets/img/` | Photos for the "In practice" section |
| `assets/logo/` | Limitsiz mark (open infinity loop) and favicon |
| `js/config.js` | Supabase URL and publishable key (fill in) |
| `js/i18n.js` | English and Arabic text, language switch |
| `js/main.js` | Demo form validation, spam check, "fix first" topic chips, saves leads to Supabase |
| `supabase/leads.sql` | Creates the `leads` table with row-level security |

## Setup

1. **Supabase.** Open the "Ai clinic" project, go to **SQL Editor**, paste `supabase/leads.sql`, and run it.
2. **Keys.** In **Project Settings > API**, copy the Project URL and the publishable key into `js/config.js`.
3. **Preview.** Open `index.html` in a browser. For the form to work, the page must be served over `http://` or `https://`, not opened as a file. In VS Code, use the "Live Server" extension, or run `npx serve .` in the folder.
4. **Deploy.** Upload the whole folder to any static host (for example Netlify, Vercel, or cPanel).

## Leads

Each demo request is saved to the `leads` table. Visitors can only insert rows. Signed-in team members can read them in the Supabase Table Editor. Email alerts for new leads can be added later with a Supabase database webhook or Edge Function.

## Before publishing

- Replace `[To be confirmed by counsel]` in `terms.html` and check the Privacy Policy.
- Confirm the data-handling and encryption statements on the home page.
- Keep the "Target Outcomes" label until you have pilot data.
- Confirm the pricing and the "Request a Trial" offer.

## Design notes (October 2026 redesign)

- Fonts: Unbounded (headings), Geist (text), Geist Mono (labels), IBM Plex Sans Arabic (Arabic), loaded from Google Fonts.
- Colors: ink `#0A0F14`, paper `#F2F4F3`, mint accent `#2EE6B5` (text on light uses `#0B7A64`). All tokens are CSS variables at the top of `css/styles.css`.
- Motion is slow and stops for visitors who turn on "reduce motion". Scroll reveals use CSS scroll-driven animations (Chrome/Edge); other browsers show the content without them.
- The topic chosen in "What should we fix first?" is saved at the start of the lead's message (`[Focus: ...]`) until the `leads` table gets its own column.
- Before launch: replace the reception photo (its wall sign shows an old logo) and remove the generated slogans in the photos.
