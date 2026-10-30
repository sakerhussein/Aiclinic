import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "../i18n";
import Mark from "./Mark";

const LINKS = [
  { to: "/#agents", key: "nav_agents" },
  { to: "/#how", key: "nav_how" },
  { to: "/#security", key: "nav_security" },
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
    <header className="site-header on-ink">
      <div className="wrap nav-wrap">
        <Link className="brand" to="/" aria-label="Limitsiz Clinic home">
          <Mark />
          <span>Limitsiz</span>
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
          <Link className="btn btn-accent btn-sm" to="/#contact">
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
