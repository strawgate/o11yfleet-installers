export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width={size} height={size}>
      <path
        d="M3 6.5L12 2L21 6.5V13C21 17.5 17 20.5 12 22C7 20.5 3 17.5 3 13V6.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2.2" fill="currentColor" />
      <path
        d="M7 11H9.5M14.5 11H17M12 6V8.5M12 13.5V16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
