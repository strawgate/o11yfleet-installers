interface ErrorStateProps {
  error: Error | null;
  retry?: () => void;
}

export function ErrorState({ error, retry }: ErrorStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
        gap: "16px",
        color: "var(--fg-3)",
        textAlign: "center",
      }}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        width="32"
        height="32"
        style={{ color: "var(--err)" }}
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3.5M8 11v.01" strokeLinecap="round" />
      </svg>
      <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--fg)" }}>Something went wrong</p>
      {error && <p style={{ fontSize: "13px", maxWidth: "44ch" }}>{error.message}</p>}
      {retry && (
        <button className="btn btn-ghost btn-sm" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
