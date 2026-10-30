import { useI18n } from "../i18n";
import Photo from "./Photo";
import Icon, { type IconName } from "./Icons";

const CARDS: { n: number; icon: IconName }[] = [
  { n: 1, icon: "booking" },
  { n: 2, icon: "scribe" },
  { n: 3, icon: "followup" },
];

// Clinic photo with AI status cards that appear one by one and float gently.
export default function HeroVisual() {
  const { t } = useI18n();

  return (
    <div className="hero-visual">
      <svg className="hero-ring" viewBox="0 0 400 400" aria-hidden="true">
        <circle cx="200" cy="200" r="196" />
      </svg>
      <div className="hero-photo">
        <Photo id="hero" alt={t("alt_hero")} eager sizes="(max-width: 900px) 90vw, 520px" />
      </div>
      {CARDS.map((c) => (
        <div key={c.n} className={`float-card fc-${c.n}`}>
          <span className="fc-icon">
            <Icon name={c.icon} />
          </span>
          <span>
            <strong>{t(`card_${c.n}_title`)}</strong>
            <small>{t(`card_${c.n}_meta`)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
