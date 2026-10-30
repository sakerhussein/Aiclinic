import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useInView, useReducedMotion } from "../hooks";

type Msg = { key: string; from: "patient" | "ai"; time: string };

const MESSAGES: Msg[] = [
  { key: "chat_1", from: "patient", time: "chat_time_1" },
  { key: "chat_2", from: "ai", time: "chat_time_2" },
  { key: "chat_3", from: "patient", time: "chat_time_3" },
  { key: "chat_4", from: "ai", time: "chat_time_4" },
];

// Phone mockup that plays a WhatsApp booking conversation on a loop while visible.
export default function WhatsAppDemo() {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const [shown, setShown] = useState(reduced ? MESSAGES.length : 0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (reduced) {
      setShown(MESSAGES.length);
      setTyping(false);
      return;
    }
    if (!inView) return;

    let cancelled = false;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) =>
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn();
        }, ms)
      );

    const play = () => {
      setShown(0);
      setTyping(false);
      at(700, () => setShown(1));
      at(1500, () => setTyping(true));
      at(3100, () => {
        setTyping(false);
        setShown(2);
      });
      at(5000, () => setShown(3));
      at(5700, () => setTyping(true));
      at(7200, () => {
        setTyping(false);
        setShown(4);
      });
      at(12500, play);
    };

    play();
    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [inView, reduced]);

  return (
    <div className="phone" ref={ref}>
      <div className="phone-screen">
        <div className="phone-head">
          <span className="avatar">AI</span>
          <div>
            <strong>{t("chat_name")}</strong>
            <small>{typing ? t("chat_typing") : t("chat_status")}</small>
          </div>
        </div>
        <div className="chat-body">
          {MESSAGES.slice(0, shown).map((m) => (
            <div key={m.key} className={`msg ${m.from}`}>
              <p>{t(m.key)}</p>
              <span className="msg-meta">
                {t(m.time)}
                {m.from === "patient" && <span className="ticks">✓✓</span>}
              </span>
            </div>
          ))}
          {typing && (
            <div className="msg ai typing" aria-label={t("chat_typing")}>
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
        <div className="chat-input" aria-hidden="true">
          <span />
          <i />
        </div>
      </div>
    </div>
  );
}
