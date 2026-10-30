import { useI18n } from "../i18n";
import Icon, { type IconName } from "./Icons";
import Photo from "./Photo";
import RotatingWord from "./RotatingWord";

const CARDS: { n: number; icon: IconName }[] = [
  { n: 1, icon: "booking" },
  { n: 2, icon: "scribe" },
  { n: 3, icon: "followup" },
];

// "Never miss another patient call / booking / follow-up." with a clinic photo and floating AI status cards.
export default function NeverMiss() {
  const { t } = useI18n();

  return (
    <section className="wrap hero-grid section">
      <div>
        <p className="kicker">{t("nm_kicker")}</p>
        <h2 className="display nm-title">
          {t("nm_prefix")} <RotatingWord words={[t("nm_rot_1"), t("nm_rot_2"), t("nm_rot_3")]} />
          <span className="sr-only">{t("nm_sr")}</span>
        </h2>
        <p className="nm-text">{t("nm_text")}</p>
        <div className="btn-row" style={{ marginTop: 32 }}>
          <a className="btn btn-ink" href="#contact">
            {t("cta_assessment")}
            <Icon name="arrow" />
          </a>
          <a className="btn btn-outline" href="#how">
            {t("cta_how")}
          </a>
        </div>
        <p className="nm-markets">{t("nm_markets")}</p>
      </div>

      <div className="nm-visual">
        <svg className="nm-ring" viewBox="0 0 400 400" aria-hidden="true">
          <circle cx="200" cy="200" r="196" fill="none" stroke="#0B7A64" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 10" />
        </svg>
        <div className="nm-photo">
          <Photo id="hero" alt={t("alt_hero")} eager sizes="(max-width: 960px) 90vw, 520px" />
          <span className="scan" aria-hidden="true" />
        </div>
        {CARDS.map((c) => (
          <div key={c.n} className={`fc fc${c.n}`}>
            <span className="ico">
              <Icon name={c.icon} />
            </span>
            <span>
              <b>{t(`nm_card_${c.n}_title`)}</b>
              <small>{t(`nm_card_${c.n}_meta`)}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
