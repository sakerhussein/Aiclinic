import { useI18n } from "../i18n";

// The infinity loop path, shared by the track, the flowing dashes and the travelling dots (see .traveler in animations.css).
const LOOP =
  "M510 210 L506.3 237.2 L495.7 261.6 L479.7 281 L460.3 294.3 L439.3 301.6 L418.3 303.5 L398.1 300.8 L379.1 294.7 L361.7 286 L345.7 275.4 L331 263.6 L317.3 250.8 L304.4 237.5 L292.1 223.8 L280 210 L267.9 196.2 L255.6 182.5 L242.7 169.2 L229 156.4 L214.3 144.6 L198.3 134 L180.9 125.3 L161.9 119.2 L141.7 116.5 L120.7 118.4 L99.7 125.7 L80.3 139 L64.3 158.4 L53.7 182.8 L50 210 L53.7 237.2 L64.3 261.6 L80.3 281 L99.7 294.3 L120.7 301.6 L141.7 303.5 L161.9 300.8 L180.9 294.7 L198.3 286 L214.3 275.4 L229 263.6 L242.7 250.8 L255.6 237.5 L267.9 223.8 L280 210 L292.1 196.2 L304.4 182.5 L317.3 169.2 L331 156.4 L345.7 144.6 L361.7 134 L379.1 125.3 L398.1 119.2 L418.3 116.5 L439.3 118.4 L460.3 125.7 L479.7 139 L495.7 158.4 L506.3 182.8 Z";

const NODES = [
  { x: 510, y: 210, ty: 246, key: "loop_booking", fill: "#2EE6B5", delay: "0s" },
  { x: 418, y: 117, ty: 92, key: "loop_reception", fill: "#E8EEF0", delay: "5s" },
  { x: 418, y: 303, ty: 338, key: "loop_scribe", fill: "#E8EEF0", delay: "1s" },
  { x: 142, y: 117, ty: 92, key: "loop_reports", fill: "#E8EEF0", delay: "4s" },
  { x: 142, y: 303, ty: 338, key: "loop_financials", fill: "#E8EEF0", delay: "2s" },
  { x: 50, y: 210, ty: 246, key: "loop_assistant", fill: "#FFB23E", delay: "3s" },
];

// Six agents on one continuous infinity loop, with a breathing hub and two travelling dots.
export default function HeroLoop() {
  const { t } = useI18n();

  return (
    <div className="hero-art">
      <svg viewBox="0 0 560 420" role="img" aria-label={t("hero_art_label")}>
        <path d={LOOP} fill="none" stroke="#1E2A33" strokeWidth={22} strokeLinejoin="round" />
        <path className="flow" d={LOOP} fill="none" stroke="#2EE6B5" strokeWidth={2} strokeDasharray="2 9" strokeLinecap="round" />
        <circle className="traveler" cx={0} cy={0} r={5} fill="#2EE6B5" />
        <circle className="traveler" cx={0} cy={0} r={4} fill="#FFB23E" style={{ animationDelay: "-6s" }} />
        <circle className="breathe" cx={280} cy={210} r={44} fill="none" stroke="#2EE6B5" strokeWidth={1.5} />
        <circle cx={280} cy={210} r={30} fill="#0A0F14" stroke="#2EE6B5" strokeWidth={2} />
        <circle className="node" cx={280} cy={210} r={7} fill="#2EE6B5" />
        <g textAnchor="middle">
          {NODES.map((n) => (
            <g key={n.key}>
              <circle className="node" cx={n.x} cy={n.y} r={9} fill={n.fill} style={{ animationDelay: n.delay }} />
              <text x={n.x} y={n.ty}>
                {t(n.key)}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <div className="hero-card rise d5">
        <p className="label">{t("hero_card_label")}</p>
        <p>{t("hero_card_text")}</p>
      </div>
    </div>
  );
}
