import { Link } from "react-router-dom";
import { useAuth } from "../api/hooks/auth";

export default function NotFoundPage() {
  const { user } = useAuth();
  const dest = user ? "/portal/overview" : "/";

  return (
    <div className="auth-shell" style={{ minHeight: "100vh" }}>
      <div className="auth-card" style={{ textAlign: "center" }}>
        <p style={{ fontSize: "4rem", fontWeight: 700, margin: "0 0 8px" }}>404</p>
        <h1>Page not found</h1>
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
