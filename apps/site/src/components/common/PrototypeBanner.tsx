export function PrototypeBanner({ message }: { message: string }) {
  return (
    <div role="note" aria-label="Prototype notice" className="prototype-banner">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M8 2L1.5 13.5h13z" />
        <path d="M8 6.5v3M8 11.5v.01" strokeLinecap="round" />
      </svg>
      <div>
        <span className="pb-title">Prototype</span>
        <span className="pb-sub"> — {message}</span>
      </div>
    </div>
  );
}
