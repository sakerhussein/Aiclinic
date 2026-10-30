import { useI18n } from "../i18n";
import { useReducedMotion } from "../hooks";
import Icon, { type IconName } from "./Icons";

const NODES: { icon: IconName; label: string }[] = [
  { icon: "booking", label: "net_booking" },
  { icon: "reception", label: "net_recep" },
  { icon: "followup", label: "net_followup" },
  { icon: "insurance", label: "net_insurance" },
  { icon: "scribe", label: "net_scribe" },
  { icon: "reports", label: "net_reports" },
  { icon: "finance", label: "net_fin" },
  { icon: "assist", label: "net_assist" },
];

const CX = 260;
const CY = 260;
const R = 185;

// Orchestration diagram: the Limitsiz Clinic hub exchanges data pulses with eight agents.
export default function AgentNetwork() {
  const { t } = useI18n();
  const reduced = useReducedMotion();

  const points = NODES.map((node, i) => {
    const angle = ((-90 + i * 45) * Math.PI) / 180;
    return { ...node, i, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
  });

  return (
    <div className="network-wrap" aria-hidden="true">
      <svg viewBox="-10 -10 540 560" className="network">
        <defs>
          <linearGradient id="hubFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1E4FA8" />
            <stop offset="1" stopColor="#0F9D8F" />
          </linearGradient>
        </defs>

        <circle className="net-orbit" cx={CX} cy={CY} r={R} />

        {points.map((p) => (
          <line
            key={`line-${p.i}`}
            className="net-line"
            style={{ animationDelay: `${p.i * 0.2}s` }}
            x1={CX}
            y1={CY}
            x2={p.x}
            y2={p.y}
          />
        ))}

        {!reduced &&
          points.map((p) => (
            <circle key={`packet-${p.i}`} className="net-packet" r={4.5}>
              <animateMotion
                dur={`${2.2 + (p.i % 3) * 0.5}s`}
                begin={`${p.i * 0.35}s`}
                repeatCount="indefinite"
                path={p.i % 2 ? `M${p.x},${p.y} L${CX},${CY}` : `M${CX},${CY} L${p.x},${p.y}`}
              />
            </circle>
          ))}

        <circle className="hub-pulse" cx={CX} cy={CY} r={62} />
        <circle className="hub-pulse d2" cx={CX} cy={CY} r={62} />
        <circle cx={CX} cy={CY} r={62} fill="url(#hubFill)" />
        <text className="hub-text" x={CX} y={CY - 2}>
          Limitsiz
        </text>
        <text className="hub-text sub" x={CX} y={CY + 20}>
          Clinic
        </text>

        {points.map((p) => (
          <g key={`node-${p.i}`} className="net-node" style={{ animationDelay: `${p.i * 0.45}s` }}>
            <circle cx={p.x} cy={p.y} r={30} />
            <Icon name={p.icon} className="net-icon" x={p.x - 13} y={p.y - 13} width={26} height={26} />
            <text className="net-label" x={p.x} y={p.y + 50}>
              {t(p.label)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
