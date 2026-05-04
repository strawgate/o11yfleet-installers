import { Link } from "react-router-dom";
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
        <p className="sub">
          Email <a href="mailto:support@o11yfleet.com">support@o11yfleet.com</a> to reset your
          password. If you signed up with GitHub, sign in with GitHub instead.
        </p>

        <p className="foot">
          <Link to="/login">&larr; Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
