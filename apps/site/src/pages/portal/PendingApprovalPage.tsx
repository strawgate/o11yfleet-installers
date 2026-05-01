import { Link } from "react-router-dom";
import { useLogout } from "@/api/hooks/auth";
import { Logo } from "@/components/common/Logo";

export default function PendingApprovalPage() {
  const logout = useLogout();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/";
      },
    });
  };

  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ textAlign: "center", maxWidth: 480 }}>
        <Link to="/" className="brand">
          <Logo />
          o11yfleet
        </Link>

        <div
          style={{
            width: 64,
            height: 64,
            margin: "32px auto 24px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <h1 style={{ marginBottom: 12 }}>Pending approval</h1>
        <p
          className="sub"
          style={{ marginBottom: 24, lineHeight: 1.6 }}
        >
          Your workspace is awaiting review. We typically approve new signups
          within 1-2 business days.
        </p>

        <div
          style={{
            background: "#1a1d24",
            borderRadius: 8,
            padding: 20,
            marginBottom: 24,
            textAlign: "left",
          }}
        >
          <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 500 }}>
            What happens next?
          </h4>
          <ul
            style={{
              margin: 0,
              padding: "0 0 0 20px",
              color: "#b9c0cc",
              fontSize: 14,
              lineHeight: 1.8,
            }}
          >
            <li>Our team reviews your signup request</li>
            <li>You&apos;ll receive an email when approved</li>
            <li>Once approved, you can access the full portal</li>
          </ul>
        </div>

        <div
          style={{
            background: "#101318",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            fontSize: 13,
            color: "#8993a3",
          }}
        >
          <strong style={{ color: "#f4f7fb" }}>Need faster access?</strong>
          <br />
          Email us at{" "}
          <a href="mailto:support@o11yfleet.com" style={{ color: "#4fd27b" }}>
            support@o11yfleet.com
          </a>{" "}
          with your GitHub username and we&apos;ll prioritize your request.
        </div>

        <button
          className="btn btn-secondary"
          onClick={() => handleLogout()}
          disabled={logout.isPending}
          style={{ marginRight: 12 }}
        >
          {logout.isPending ? "Signing out..." : "Sign out"}
        </button>
        <a href="/" className="btn btn-ghost">
          Back to home
        </a>
      </div>
    </div>
  );
}
