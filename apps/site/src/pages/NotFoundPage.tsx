import { Link } from "react-router-dom";
import { useAuth } from "../api/hooks/auth";

export default function NotFoundPage() {
  const { user } = useAuth();
  const dest = user ? "/portal/overview" : "/";

  return (
    <div className="auth-shell" style={{ minHeight: "100vh" }}>
      <div className="auth-card" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "4rem", fontWeight: 700, margin: 0 }}>404</h1>
        <p className="sub">
          The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
        </p>
        <Link to={dest} className="btn btn-primary">
          {user ? "Back to portal" : "Back to home"}
        </Link>
      </div>
    </div>
  );
}
