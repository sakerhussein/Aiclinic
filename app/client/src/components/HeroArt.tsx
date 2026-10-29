// Abstract "orchestration" graphic: one hub connected to six agents.
export default function HeroArt() {
  const nodes = [
    [200, 50],
    [342, 129],
    [342, 271],
    [200, 350],
    [58, 271],
    [58, 129],
  ];

  return (
    <div className="hero-art" aria-hidden="true">
      <svg viewBox="0 0 400 400" role="img">
        <defs>
          <linearGradient id="hubGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1E4FA8" />
            <stop offset="1" stopColor="#0F9D8F" />
          </linearGradient>
        </defs>
        <circle cx="200" cy="200" r="150" fill="none" stroke="#CFE0F5" strokeWidth={2} strokeDasharray="4 8" />
        <circle cx="200" cy="200" r="100" fill="none" stroke="#BDEBE5" strokeWidth={2} />
        <g stroke="#1E4FA8" strokeOpacity={0.35} strokeWidth={2}>
          {nodes.map(([x, y]) => (
            <line key={`l-${x}-${y}`} x1={200} y1={200} x2={x} y2={y} />
          ))}
        </g>
        <g fill="#ffffff" stroke="#1E4FA8" strokeWidth={2.5}>
          {nodes.map(([x, y]) => (
            <circle key={`n-${x}-${y}`} cx={x} cy={y} r={18} />
          ))}
        </g>
        <circle cx="200" cy="200" r="52" fill="url(#hubGradient)" />
        <circle cx="200" cy="200" r="8" fill="#ffffff" />
      </svg>
    </div>
  );
}
