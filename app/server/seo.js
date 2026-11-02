// Per-language page details for search engines and link previews (WhatsApp, LinkedIn, X).
// Link previews do not run JavaScript, so the server writes these tags into the HTML itself.

const SITE_URL = (process.env.SITE_URL || "https://limitsiz.si").replace(/\/+$/, "");

const PAGES = {
  "/": {
    en: {
      title: "Limitsiz Clinic | AI Agents for Private Clinics",
      description:
        "AI agents that answer calls and WhatsApp messages, book appointments, follow up with patients and draft clinical notes, in Arabic and English. Get your free AI Clinic Assessment.",
    },
    ar: {
      title: "Limitsiz Clinic | وكلاء ذكاء اصطناعي للعيادات الخاصة",
      description:
        "وكلاء ذكاء اصطناعي يردّون على المكالمات ورسائل واتساب، ويحجزون المواعيد، ويتابعون المرضى، ويُعدّون الملاحظات الطبية، بالعربية والإنجليزية. احصل على تقييمك المجاني للعيادة.",
    },
  },
  "/privacy": {
    en: { title: "Privacy Policy | Limitsiz", description: "How Limitsiz collects and uses personal information." },
    ar: { title: "سياسة الخصوصية | Limitsiz", description: "كيف تجمع Limitsiz المعلومات الشخصية وتستخدمها." },
  },
  "/terms": {
    en: { title: "Terms of Use | Limitsiz", description: "The terms for using the Limitsiz website." },
    ar: { title: "شروط الاستخدام | Limitsiz", description: "شروط استخدام موقع Limitsiz." },
  },
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// "/ar/privacy" -> { lang: "ar", base: "/privacy" }
export function parsePath(pathname) {
  const ar = pathname === "/ar" || pathname.startsWith("/ar/");
  let base = ar ? pathname.slice(3) || "/" : pathname;
  base = base.replace(/\/+$/, "") || "/";
  return { lang: ar ? "ar" : "en", base: PAGES[base] ? base : "/" };
}

const urlFor = (lang, base) => `${SITE_URL}${lang === "ar" ? (base === "/" ? "/ar" : `/ar${base}`) : base}`;

function headTags(lang, base) {
  const page = PAGES[base][lang];
  const url = urlFor(lang, base);
  const image = `${SITE_URL}/og/og-${lang}.jpg`;
  const tags = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" hreflang="en" href="${urlFor("en", base)}" />`,
    `<link rel="alternate" hreflang="ar" href="${urlFor("ar", base)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${urlFor("en", base)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Limitsiz" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="${lang === "ar" ? "ar_JO" : "en_US"}" />`,
    `<meta property="og:locale:alternate" content="${lang === "ar" ? "en_US" : "ar_JO"}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ];

  const gsc = (process.env.GOOGLE_SITE_VERIFICATION || "").trim();
  if (gsc) tags.push(`<meta name="google-site-verification" content="${esc(gsc)}" />`);

  // Privacy-friendly visitor stats (no cookies, no consent banner needed). Use one of them.
  const umami = (process.env.UMAMI_WEBSITE_ID || "").trim();
  const umamiSrc = (process.env.UMAMI_SRC || "https://cloud.umami.is/script.js").trim();
  if (umami) tags.push(`<script defer src="${esc(umamiSrc)}" data-website-id="${esc(umami)}"></script>`);
  const plausible = (process.env.PLAUSIBLE_DOMAIN || "").trim();
  if (plausible) tags.push(`<script defer data-domain="${esc(plausible)}" src="https://plausible.io/js/script.js"></script>`);

  // Microsoft Clarity (heatmaps and session recordings; it sets cookies). The ID must be letters and digits only.
  const clarity = (process.env.CLARITY_PROJECT_ID || "").trim();
  if (/^[a-z0-9]+$/i.test(clarity)) {
    tags.push(
      `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarity}");</script>`
    );
  }

  return tags.join("\n    ");
}

// Returns the page HTML for a path, with the right language, title, description and preview tags.
export function renderPage(template, pathname) {
  const { lang, base } = parsePath(pathname);
  let html = template.replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, `<!-- seo:start -->\n    ${headTags(lang, base)}\n    <!-- seo:end -->`);
  if (lang === "ar") html = html.replace('<html lang="en" dir="ltr">', '<html lang="ar" dir="rtl">');
  return html;
}

export function robotsTxt() {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

export function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const entries = Object.keys(PAGES).flatMap((base) =>
    ["en", "ar"].map(
      (lang) => `  <url>
    <loc>${urlFor(lang, base)}</loc>
    <lastmod>${today}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="${urlFor("en", base)}" />
    <xhtml:link rel="alternate" hreflang="ar" href="${urlFor("ar", base)}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFor("en", base)}" />
  </url>`
    )
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
}
