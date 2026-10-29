import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

export default function Header() {
  const { t, lang, toggle } = useI18n();

  return (
    <header className="site-header">
      <div className="container nav-wrap">
        <Link className="wordmark" to="/" aria-label="Limitsiz Clinic home">
          Limitsiz<span>Clinic</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link to="/#solutions">{t("nav_solutions")}</Link>
          <Link to="/#how">{t("nav_how")}</Link>
          <Link to="/#security">{t("nav_security")}</Link>
          <Link to="/#pricing">{t("nav_pricing")}</Link>
          <Link to="/#faq">{t("nav_faq")}</Link>
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
            {t("nav_demo")}
          </Link>
        </div>
      </div>
    </header>
  );
}
