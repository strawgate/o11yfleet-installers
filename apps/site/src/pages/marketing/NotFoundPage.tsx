import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16,
        textAlign: "center",
        padding: "0 24px",
      }}
    >
      <h1 style={{ fontSize: "4rem", margin: 0 }}>404</h1>
      <p style={{ fontSize: "1.25rem", color: "var(--text-muted, #666)" }}>Page not found</p>
      <Link to="/" className="btn btn-primary">
        Back to home
      </Link>
    </div>
  );
}
