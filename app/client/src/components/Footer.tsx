import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

export default function Footer() {
  const { t } = useI18n();

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link className="wordmark" to="/">
            Limitsiz<span>.</span>
          </Link>
          <p className="muted">{t("footer_tagline")}</p>
        </div>
        <nav aria-label="Footer">
          <Link to="/#solutions">{t("nav_clinic")}</Link>
          <Link to="/#pricing">{t("nav_pricing")}</Link>
          <Link to="/#consulting">{t("nav_consulting")}</Link>
          <Link to="/#faq">{t("nav_faq")}</Link>
          <Link to="/privacy">{t("footer_privacy")}</Link>
          <Link to="/terms">{t("footer_terms")}</Link>
        </nav>
        <address>
          {t("footer_address")}
          <br />
          <a href="mailto:management@limitsiz.si">management@limitsiz.si</a>
          <br />
          <a href="https://wa.me/962795016514">00962-795016514</a>
        </address>
      </div>
      <div className="container copy">
        <p className="credits">
          {t("footer_credits")}{" "}
          <a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer">
            Pexels License
          </a>
        </p>
        {t("copyright")}
      </div>
    </footer>
  );
}
