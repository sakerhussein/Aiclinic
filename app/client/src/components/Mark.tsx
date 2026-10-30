// The Limitsiz mark: an open infinity loop with a dot where the line breaks off.
export default function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 20" aria-hidden="true">
      <path
        d="M20 10 C16.6 5.5 13.2 2 8.8 2 A8 8 0 0 0 8.8 18 C13.2 18 16.6 14.5 20 10 C23.4 5.5 26.8 2 31.2 2 A8 8 0 0 1 38.4 12.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="33.6" cy="17.2" r="1.8" fill="currentColor" />
    </svg>
  );
}
