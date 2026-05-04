import { Link, useSearchParams } from "react-router";
import { apiUrl } from "@/api/client";
import { GitHubMark } from "@/components/common/GitHubMark";
import { Logo } from "@/components/common/Logo";

export default function SignupPage() {
  const [searchParams] = useSearchParams();
  const plan = searchParams.get("plan") ?? "starter";
  const githubUrl = apiUrl(
    `/auth/github/start?mode=signup&plan=${encodeURIComponent(plan)}&site_origin=${encodeURIComponent(window.location.origin)}`,
  );

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="brand">
          <Logo />
          o11yfleet
        </Link>

        <h1>Create your workspace</h1>
        <p className="sub">Use GitHub to create your O11yFleet workspace.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "22px" }}>
          <a className="sso-btn" href={githubUrl}>
            <GitHubMark />
            Continue with GitHub
          </a>
          <a href="mailto:hello@o11yfleet.com" className="btn" style={{ textAlign: "center" }}>
            Contact us for access
          </a>
        </div>

        <p className="foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
