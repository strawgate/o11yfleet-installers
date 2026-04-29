import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLogin } from "../../api/hooks/auth";
import { Logo } from "@/components/common/Logo";

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const login = useLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    <div className="auth-shell admin-auth-shell">
      <div className="auth-card admin-auth-card">
        <Link to="/" className="brand">
          <Logo />
          o11yfleet
          <span className="auth-badge">EMPLOYEE ACCESS</span>
        </Link>

        <h1>O11yFleet employee login</h1>
        <p className="sub">
          Sign in with an O11yFleet admin account to access the internal operations console.
          Activity is logged.
        </p>
        <div className="auth-notice">
          This page is for O11yFleet employees. Tenant workspace users should use the regular
          workspace sign-in page.
        </div>

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
            {login.isPending ? "Signing in\u2026" : "Sign in to admin console"}
          </button>
        </form>

        <p className="foot">
          Not an O11yFleet employee? <Link to="/login">Workspace login</Link>
        </p>
      </div>
    </div>
  );
}
