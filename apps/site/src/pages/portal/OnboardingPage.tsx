import { Link } from "react-router-dom";
import { PrototypeBanner } from "../../components/common/PrototypeBanner";

export default function OnboardingPage() {
  return (
    <div className="main-narrow">
      <PrototypeBanner message="Onboarding wizard is under development." />

      <div className="page-head mt-6">
        <h1>Onboarding</h1>
      </div>

      <div className="card card-pad">
        <h3>Welcome to o11yfleet</h3>
        <p className="meta mt-2">
          The onboarding wizard will guide you through setting up your workspace, choosing a
          monitoring mode, installing your first collector, and verifying the connection.
        </p>
        <p className="meta mt-2">
          In the meantime, you can use the{" "}
          <Link to="/portal/getting-started">getting started guide</Link> to set up your first
          configuration and connect a collector.
        </p>
        <Link to="/portal/getting-started" className="btn btn-primary mt-6">
          Go to getting started
        </Link>
      </div>
    </div>
  );
}
