import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiUrl, login as apiLogin } from "@/api/client";
import { GitHubMark } from "@/components/common/GitHubMark";
import { Logo } from "@/components/common/Logo";

export default function LoginPage() {
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const githubUrl = apiUrl(
    `/auth/github/start?mode=login&site_origin=${encodeURIComponent(window.location.origin)}&return_to=${encodeURIComponent("/portal/overview")}`,
  );

  async function handlePasswordLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiLogin(email, password);
      // Redirect to portal on success
      window.location.href = "/portal/overview";
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

        {!showPasswordLogin ? (
          <>
            <p className="sub">Continue with GitHub to manage your collector fleet.</p>

            <a className="sso-btn" href={githubUrl}>
              <GitHubMark />
              Continue with GitHub
            </a>

            <p className="auth-alt-link">
              <button type="button" onClick={() => setShowPasswordLogin(true)}>
                Sign in with email and password
              </button>
            </p>
          </>
        ) : (
          <>
            {error && (
              <div
                style={{
                  background: "var(--err-soft, #fef2f2)",
                  border: "1px solid var(--err-line, #fecaca)",
                  color: "var(--err, #dc2626)",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  fontSize: "13px",
                }}
              >
                {error}
              </div>
            )}
            <form onSubmit={(e) => void handlePasswordLogin(e)}>
              <div className="field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="input"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button className="btn btn-primary" type="submit">
                Sign in
              </button>
            </form>
            <p className="auth-alt-link">
              <button type="button" onClick={() => setShowPasswordLogin(false)}>
                Sign in with GitHub instead
              </button>
            </p>
          </>
        )}

        <p className="foot">
          Don&rsquo;t have a workspace? <Link to="/signup">Create one</Link>
        </p>
        <div className="auth-switch">
          <span>O11yFleet employee?</span>
          <Link to="/admin/login">Employee login</Link>
        </div>
      </div>
    </div>
  );
}
