import { Link } from "react-router-dom";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";

export default function ForgotPage() {
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

        <h1>Reset your password</h1>
        <p className="sub">Password reset is not yet available.</p>

        <PrototypeBanner message="Password reset is not yet available" />

        <p className="foot">
          <Link to="/login">&larr; Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
