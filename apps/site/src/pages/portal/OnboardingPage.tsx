import { Link } from "react-router-dom";
import { PageHeader, PageShell } from "@/components/app";
import { PrototypeBanner } from "@/components/common/PrototypeBanner";
import { Button } from "@/components/ui/button";

export default function OnboardingPage() {
  return (
    <PageShell width="narrow">
      <PrototypeBanner message="Onboarding wizard is under development." />

      <PageHeader className="mt-6" title="Onboarding" />

      <section className="rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Welcome to o11yfleet</h3>
        <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
          <p>
            The onboarding wizard will guide you through the core model: workspace, configuration
            group, enrollment token, collector install, and first successful connection.
          </p>
          <p>
            Your workspace is the isolation boundary. A configuration group is the desired state
            target for collectors. An enrollment token is only the bootstrap secret that places a
            collector into that group.
          </p>
          <p>
            In the meantime, you can use the getting started guide to set up your first
            configuration and connect a collector.
          </p>
        </div>
        <Button asChild className="mt-6">
          <Link to="/portal/getting-started">Go to getting started</Link>
        </Button>
      </section>
    </PageShell>
  );
}
