import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "../i18n";

const LINKS = [
  { to: "/#solutions", key: "nav_clinic" },
  { to: "/#how", key: "nav_how" },
  { to: "/#specialties", key: "nav_specialties" },
  { to: "/#pricing", key: "nav_pricing" },
  { to: "/#consulting", key: "nav_consulting" },
  { to: "/#faq", key: "nav_faq" },
];

export default function Header() {
  const { t, lang, toggle } = useI18n();
  const { pathname, hash } = useLocation();
  const [open, setOpen] = useState(false);

  // Close the mobile menu after navigating.
  useEffect(() => setOpen(false), [pathname, hash]);

  return (
    <header className="site-header">
      <div className="container nav-wrap">
        <Link className="wordmark" to="/" aria-label="Limitsiz home">
          Limitsiz<span>.</span>
        </Link>
        <nav id="main-nav" className={`nav${open ? " open" : ""}`} aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.key} to={l.to}>
              {t(l.key)}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          <button
            type="button"
            className="lang-toggle"
            onClick={toggle}
            aria-label={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
          >
            {lang === "ar" ? "English" : "العربية"}
          </button>
          <Link className="btn btn-primary btn-sm" to="/#contact">
            {t("nav_cta")}
          </Link>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={open}
            aria-controls="main-nav"
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
            <span className="sr-only">{t("menu")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
