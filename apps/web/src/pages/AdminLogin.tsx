import { useState, type FormEvent } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

export function AdminLoginPage() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/admin/overview";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role !== "admin") {
        await logout();
        setError("This account does not have admin access");
        return;
      }
      navigate(from, { replace: true });
    } catch {
      setError("Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-3xl">⚡</span>
          <h1 className="mt-3 text-xl font-semibold text-fg">Admin Login</h1>
          <p className="mt-1 text-sm text-fg-3">O11yFleet staff access</p>
        </div>

        <div className="rounded-lg border border-err/20 bg-err/5 px-4 py-2 text-xs text-err mb-4">
          Staff accounts only — customer accounts will be rejected.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-err/20 bg-err/5 px-4 py-2.5 text-sm text-err">
              {error}
            </div>
          )}

          <Input
            label="Staff email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@o11yfleet.com"
            required
            autoFocus
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in as Admin"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-fg-4">
          Customer?{" "}
          <Link to="/login" className="text-brand hover:underline">
            Customer login
          </Link>
        </p>
      </div>
    </div>
  );
}
