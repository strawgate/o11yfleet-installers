import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Alert, Anchor, Button, PasswordInput, Stack, TextInput } from "@mantine/core";
import { apiUrl, login as apiLogin } from "@/api/client";
import { GitHubMark } from "@/components/common/GitHubMark";
import { Logo } from "@/components/common/Logo";
import { getErrorMessage } from "@/utils/errors";

export default function LoginPage() {
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const githubUrl = apiUrl(
    `/auth/github/start?mode=login&site_origin=${encodeURIComponent(window.location.origin)}&return_to=${encodeURIComponent("/portal/overview")}`,
  );

  async function handlePasswordLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiLogin(email, password);
      window.location.href = "/portal/overview";
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Login failed"));
    } finally {
      setSubmitting(false);
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
            <form onSubmit={(e) => void handlePasswordLogin(e)}>
              <Stack gap="md">
                {error ? (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                ) : null}
                <TextInput
                  id="login-email"
                  label="Email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
                <PasswordInput
                  id="login-password"
                  label="Password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
                <Button type="submit" loading={submitting}>
                  Sign in
                </Button>
              </Stack>
            </form>
            <p className="auth-alt-link">
              <button type="button" onClick={() => setShowPasswordLogin(false)}>
                Sign in with GitHub instead
              </button>
            </p>
          </>
        )}

        <p className="foot">
          Don&rsquo;t have a workspace?{" "}
          <Anchor component={Link} to="/signup">
            Create one
          </Anchor>
        </p>
        <div className="auth-switch">
          <span>O11yFleet employee?</span>
          <Anchor component={Link} to="/admin/login">
            Employee login
          </Anchor>
        </div>
      </div>
    </div>
  );
}
