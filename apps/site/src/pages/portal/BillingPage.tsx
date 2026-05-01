import { Link } from "react-router-dom";
import { useOverview, useTenant } from "@/api/hooks/portal";
import { PageHeader, PageShell, StatusBadge } from "@/components/app";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { buildBillingView } from "./billing-model";

export default function BillingPage() {
  const tenant = useTenant();
  const overview = useOverview();

  if (tenant.isLoading || overview.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  const view = buildBillingView(tenant.data, overview.data);

  return (
    <PageShell width="wide">
      <PageHeader title="Billing" />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground">Current plan</h3>
          <div className="mt-5">
            <StatusBadge tone="info">{view.planLabel}</StatusBadge>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3 text-sm text-foreground">
              <span>Policies</span>
              <span className="font-mono text-muted-foreground">
                {view.usedConfigs} / {view.maxConfigsLabel}
              </span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={view.configPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${view.usedConfigs} of ${view.maxConfigsLabel} policies used`}
            >
              <span className="block h-full bg-primary" style={{ width: `${view.configPct}%` }} />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 text-sm text-foreground">
            <span>Collectors</span>
            <span className="font-mono text-muted-foreground">{view.totalAgents}</span>
          </div>

          <div className="mt-6">
            <Button asChild variant="ghost" size="sm">
              <Link to="/pricing">Compare plans</Link>
            </Button>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground">Control mode</h3>
          <p className="mt-4 text-sm text-muted-foreground">
            Plans gate quotas and control-plane behavior: retained history, rollback, rollout
            safety, automation, team roles, audit export, and governance controls.
          </p>
          <div className="mt-5">
            <StatusBadge tone={view.stateful ? "ok" : "warn"}>
              {view.stateful ? "stateful operations enabled" : "stateless fleet management"}
            </StatusBadge>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground">Billing information</h3>
          <p className="mt-4 text-sm text-muted-foreground">
            Billing management is not yet available. Contact support to update your plan or payment
            details.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
