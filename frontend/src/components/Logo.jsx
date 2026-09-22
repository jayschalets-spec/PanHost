// PanHost logo — a globe with planes/arrows flying outward in different directions.
// Uses currentColor so it inherits the surrounding text color (white inside the
// gradient badge). Pass `size` to scale.
export default function Logo({ size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="PanHost"
    >
      {/* Globe */}
      <circle cx="24" cy="26" r="12" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="24" cy="26" rx="5" ry="12" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
      <line x1="12" y1="26" x2="36" y2="26" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
      <path d="M14.5 19.5 H33.5" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
      <path d="M14.5 32.5 H33.5" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />

      {/* Plane flying up-right + dashed arc trail */}
      <path d="M38 6 l5 1.6 -4.2 2.6 -0.6 -1.6 z" fill="currentColor" />
      <path d="M30 13 q5.5 -5.5 11 -6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" strokeLinecap="round" />

      {/* Plane flying up-left + dashed arc trail */}
      <path d="M10 6 l-5 1.6 4.2 2.6 0.6 -1.6 z" fill="currentColor" />
      <path d="M18 13 q-5.5 -5.5 -11 -6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" strokeLinecap="round" />

      {/* Plane flying down-right + dashed arc trail */}
      <path d="M39 42 l3.5 -3.8 0.4 4.9 -1.7 -0.4 z" fill="currentColor" />
      <path d="M33 39 q6 3 9 -1" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 2" strokeLinecap="round" />
    </svg>
  );
}
