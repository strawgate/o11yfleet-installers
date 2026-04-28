import { Link } from "react-router-dom";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { Logo } from "@/components/common/Logo";

export default function SignupPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="brand">
          <Logo />
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
