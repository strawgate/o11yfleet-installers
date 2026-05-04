import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Anchor, Button, PasswordInput, Stack, TextInput } from "@mantine/core";
import { useLogin } from "../../api/hooks/auth";
import { Logo } from "@/components/common/Logo";
import { getErrorMessage } from "@/utils/errors";

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
        void navigate("/admin/overview");
      } else {
        setError("Admin access required");
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Login failed"));
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
        <aside className="auth-notice" aria-label="Notice">
          This page is for O11yFleet employees. Workspace users should use the regular workspace
          sign-in page.
        </aside>

        <form onSubmit={(event) => void handleSubmit(event)}>
          <Stack gap="md">
            {error ? (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            ) : null}
            <TextInput
              id="admin-email"
              label="Email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <PasswordInput
              id="admin-password"
              label="Password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" loading={login.isPending}>
              Sign in to admin console
            </Button>
          </Stack>
        </form>

        <p className="foot">
          Not an O11yFleet employee?{" "}
          <Anchor component={Link} to="/login">
            Workspace login
          </Anchor>
        </p>
      </div>
    </div>
  );
}
