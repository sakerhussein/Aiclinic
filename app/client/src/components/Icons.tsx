import type { SVGProps } from "react";

// Simple line icons used across the site.
export type IconName =
  | "booking"
  | "reception"
  | "followup"
  | "insurance"
  | "scribe"
  | "reports"
  | "finance"
  | "assist"
  | "check"
  | "audit"
  | "strategy"
  | "implement";

type Props = { name: IconName } & SVGProps<SVGSVGElement>;

export default function Icon({ name, ...rest }: Props) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };

  switch (name) {
    case "booking":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="17" rx="3" />
          <path d="M3 9h18M8 2v4M16 2v4M9 15l2 2 4-4" />
        </svg>
      );
    case "reception":
      return (
        <svg {...common}>
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
        </svg>
      );
    case "followup":
      return (
        <svg {...common}>
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v5h-5" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case "insurance":
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "scribe":
      return (
        <svg {...common}>
          <path d="M4 20h4L19 9l-4-4L4 16v4z" />
          <path d="M13 7l4 4" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );
    case "finance":
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "assist":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case "check":
      return (
        <svg {...common} strokeWidth={2.4}>
          <path d="M5 12l4 4 10-10" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <path d="M6 3h7l4 4v5" />
          <path d="M6 3v18h6" />
          <circle cx="16.5" cy="16.5" r="3.5" />
          <path d="M19 19l2.5 2.5M9 9h4M9 13h3" />
        </svg>
      );
    case "strategy":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.2" />
        </svg>
      );
    case "implement":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </svg>
      );
  }
}
