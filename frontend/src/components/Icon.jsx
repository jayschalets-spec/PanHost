// Minimal Lucide-style line icons (stroke = currentColor). Keeps the UI clean
// and consistent instead of emoji.
const P = {
  dashboard: 'M3 13h8V3H3v10Zm10 8h8V3h-8v18ZM3 21h8v-6H3v6Z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6l3-7Z',
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  calendarCheck: 'M8 2v4M16 2v4M3 9h18M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 11 2 2 4-4',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11',
  calendar: 'M8 2v4M16 2v4M3 9h18M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  plug: 'M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v6',
  star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18.8 6.2 21l1.1-6.5L2.6 9.8l6.5-.9L12 3Z',
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm2 0V7a5 5 0 0 1 10 0v4',
  tag: 'M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01',
  radar: 'M4.9 19.1A10 10 0 1 1 19.1 4.9M12 12l6-6M12 2v4M2 12h4',
  wallet: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-6M18 12a2 2 0 0 0 0 4h4v-4Z',
  card: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm-1 5h20',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M9 13h6M9 17h6',
  chart: 'M3 3v18h18M8 15v3M13 10v8M18 6v12',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15 2H9l-.3 2.4a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6A8 8 0 0 0 4 12c0 .4 0 .9.1 1.3l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3L9 22h6l.3-2.4a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
};

export default function Icon({ name, size = 18, ...rest }) {
  const d = P[name] || P.dashboard;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}
