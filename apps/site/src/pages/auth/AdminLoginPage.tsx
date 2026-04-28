import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, useLogin } from "../../api/hooks/auth";

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { user, isLoading, isAdmin } = useAuth();
  const login = useLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && user && isAdmin) {
      navigate("/admin/overview", { replace: true });
    }
  }, [user, isLoading, isAdmin, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await login.mutateAsync({ email, password });
      if (res.user.role === "admin") {
        navigate("/admin/overview");
      } else {
        setError("Admin access required");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="admin-stripe" />

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
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              letterSpacing: "0.1em",
              padding: "2px 6px",
              borderRadius: "4px",
              background: "var(--accent-soft)",
              color: "var(--accent)",
              border: "1px solid var(--accent-line)",
              marginLeft: "4px",
            }}
          >
            ADMIN
          </span>
        </Link>

        <h1>Staff sign in</h1>
        <p className="sub">Internal operations console. Access is logged.</p>

        {error && (
          <div
            style={{
              background: "var(--err-soft, #fef2f2)",
              border: "1px solid var(--err-line, #fecaca)",
              color: "var(--err, #dc2626)",
              padding: "10px 14px",
              borderRadius: "var(--radius, 8px)",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={login.isPending}>
            {login.isPending ? "Signing in\u2026" : "Sign in"}
          </button>
        </form>

        <p className="foot">
          Not a staff member? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
