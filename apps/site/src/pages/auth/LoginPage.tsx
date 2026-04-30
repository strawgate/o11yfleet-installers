import { Link } from "react-router-dom";
import { apiUrl } from "@/api/client";
import { GitHubMark } from "@/components/common/GitHubMark";
import { Logo } from "@/components/common/Logo";

export default function LoginPage() {
  const githubUrl = apiUrl(
    `/auth/github/start?mode=login&site_origin=${encodeURIComponent(window.location.origin)}&return_to=${encodeURIComponent("/portal/overview")}`,
  );

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="brand">
          <Logo />
          o11yfleet
        </Link>

        <h1>Sign in to your workspace</h1>
        <p className="sub">Continue with GitHub to manage your collector fleet.</p>

        <a className="sso-btn" href={githubUrl}>
          <GitHubMark />
          Continue with GitHub
        </a>

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
