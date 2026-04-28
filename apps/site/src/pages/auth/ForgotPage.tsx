import { Link } from "react-router-dom";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";
import { Logo } from "@/components/common/Logo";

export default function ForgotPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="brand">
          <Logo />
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
