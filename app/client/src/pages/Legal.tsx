import { useI18n } from "../i18n";

interface Props {
  kind: "privacy" | "terms";
}

// Section keys: privacy uses priv_h1..8 / priv_p1..8, terms uses terms_h1..7 / terms_p1..7.
const COUNTS = { privacy: 8, terms: 7 } as const;

export default function Legal({ kind }: Props) {
  const { t } = useI18n();
  const prefix = kind === "privacy" ? "priv" : "terms";
  const titleKey = kind === "privacy" ? "priv_title" : "terms_title";
  const sections = Array.from({ length: COUNTS[kind] }, (_, i) => i + 1);

  return (
    <section className="legal">
      <div className="container narrow">
        <p className="draft-banner">{t("draft_banner")}</p>
        <h1>{t(titleKey)}</h1>
        <p className="muted">{t("priv_updated")}</p>
        {sections.map((n) => (
          <div key={n}>
            <h2>{t(`${prefix}_h${n}`)}</h2>
            <p>{t(`${prefix}_p${n}`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
