import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, useLogin } from "../../api/hooks/auth";
import { Logo } from "@/components/common/Logo";

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const login = useLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && user) navigate("/portal/overview", { replace: true });
  }, [user, isLoading, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      navigate("/portal/overview");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="brand">
          <Logo />
          o11yfleet
        </Link>

        <h1>Sign in to your workspace</h1>
        <p className="sub">Welcome back. Continue with your identity provider, or use email.</p>

        <button className="sso-btn" disabled title="Coming soon">
          <span>Sign in with SSO</span>
        </button>

        <div className="divider">or</div>

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
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">
              Password
              <Link
                to="/forgot"
                style={{
                  marginLeft: "auto",
                  fontSize: "12px",
                  color: "var(--accent)",
                }}
              >
                Forgot?
              </Link>
            </label>
            <input
              id="password"
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
          Don&rsquo;t have a workspace? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
