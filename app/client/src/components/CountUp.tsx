import { useEffect, useState } from "react";
import { useInView, useReducedMotion } from "../hooks";

// Counts every number in the text up from zero when it scrolls into view.
// Example: "50–70%" animates 0–0% to 50–70%.
export default function CountUp({ text, animate = true }: { text: string; animate?: boolean }) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLSpanElement>(0.6);
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState(0);
  const active = animate && !reduced;

  useEffect(() => {
    if (inView) setStarted(true);
  }, [inView]);

  useEffect(() => {
    if (!started || !active) return;
    let raf = 0;
    const start = performance.now();
    const duration = 1400;
    const tick = (now: number) => {
      const x = Math.min(1, (now - start) / duration);
      setProgress(1 - Math.pow(1 - x, 3));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, active]);

  const p = active ? progress : 1;
  const shown = p >= 1 ? text : text.replace(/\d+/g, (m) => String(Math.round(Number(m) * p)));
  return <span ref={ref}>{shown}</span>;
}
