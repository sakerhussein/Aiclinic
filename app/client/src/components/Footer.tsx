import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import Mark from "./Mark";

export default function Footer() {
  const { t } = useI18n();

  return (
    <footer className="site-footer">
      <div className="wrap footer-row">
        <Link className="brand" to="/">
          <Mark />
          <span>Limitsiz</span>
        </Link>
        <nav aria-label="Footer">
          <Link to="/privacy">{t("footer_privacy")}</Link>
          <Link to="/terms">{t("footer_terms")}</Link>
          <a href="mailto:management@limitsiz.si">management@limitsiz.si</a>
          <a href="https://wa.me/962795016514" dir="ltr">
            00962-795016514
          </a>
        </nav>
        <span>{t("copyright")}</span>
      </div>
      <p className="wrap credits">
        {t("footer_credits")}{" "}
        <a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer">
          Pexels License
        </a>
      </p>
    </footer>
  );
}
