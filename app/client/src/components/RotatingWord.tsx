import { useEffect, useState } from "react";
import { useReducedMotion } from "../hooks";

// Cycles through a list of words with a soft slide-in. Static when motion is reduced.
// All words sit in the same grid cell, so the box is always as tall and wide as the
// longest word: the heading never changes height and the page below never jumps.
export default function RotatingWord({ words }: { words: string[] }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setIndex((n) => (n + 1) % words.length), 2600);
    return () => window.clearInterval(id);
  }, [reduced, words.length]);

  const active = reduced ? 0 : index % words.length;
  return (
    <span className="rotator" aria-hidden="true">
      {words.map((word, i) => (
        <span key={`${i}-${i === active ? index : "idle"}`} className={i === active ? "rot-word" : "rot-word idle"}>
          {word}
        </span>
      ))}
    </span>
  );
}
