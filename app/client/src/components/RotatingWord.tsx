import { useEffect, useState } from "react";
import { useReducedMotion } from "../hooks";

// Cycles through a list of words with a soft slide-in. Static when motion is reduced.
export default function RotatingWord({ words }: { words: string[] }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setIndex((n) => (n + 1) % words.length), 2600);
    return () => window.clearInterval(id);
  }, [reduced, words.length]);

  const word = words[reduced ? 0 : index % words.length];
  return (
    <span className="rotator" aria-hidden="true">
      <span key={`${index}-${word}`} className="rot-word">
        {word}
      </span>
    </span>
  );
}
