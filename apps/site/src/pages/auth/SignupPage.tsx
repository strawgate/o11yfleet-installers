import { Link } from "react-router-dom";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";

export default function SignupPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="brand">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
          o11yfleet
        </Link>

        <h1>Create your workspace</h1>
        <p className="sub">Self-service registration coming soon. Contact us to get started.</p>

        <PrototypeBanner message="Account creation is not yet available" />

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "22px" }}>
          <Link to="/login" className="btn btn-primary" style={{ textAlign: "center" }}>
            Sign in to existing workspace
          </Link>
          <a href="mailto:hello@o11yfleet.com" className="btn" style={{ textAlign: "center" }}>
            Contact us for access
          </a>
        </div>

        <p className="foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
