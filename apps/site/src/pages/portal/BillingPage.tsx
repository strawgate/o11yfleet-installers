import { Link } from "react-router-dom";
import { useTenant, useOverview } from "../../api/hooks/portal";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { hasStatefulOperations, planLabel, policyLimitForPlan } from "../../shared/plans";

export default function BillingPage() {
  const tenant = useTenant();
  const overview = useOverview();

  if (tenant.isLoading || overview.isLoading) return <LoadingSpinner />;
  if (tenant.error) return <ErrorState error={tenant.error} retry={() => void tenant.refetch()} />;
  if (overview.error)
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;

  const t = tenant.data;
  const ov = overview.data;

  const plan = t?.plan ?? "starter";
  const currentPlanLabel = planLabel(plan);
  const maxConfigs =
    typeof t?.["max_configs"] === "number" ? t["max_configs"] : policyLimitForPlan(plan);
  const usedConfigs =
    typeof ov?.configs_count === "number"
      ? ov.configs_count
      : Array.isArray(ov?.configurations)
        ? ov.configurations.length
        : 0;
  const configPct =
    typeof maxConfigs === "number" && maxConfigs > 0
      ? Math.min(100, Math.round((usedConfigs / maxConfigs) * 100))
      : 0;
  const maxConfigsLabel = maxConfigs === null ? "Custom" : maxConfigs;
  const totalAgents =
    typeof ov?.total_agents === "number"
      ? ov.total_agents
      : typeof ov?.agents === "number"
        ? ov.agents
        : 0;

  return (
    <div className="main-wide">
      <div className="page-head">
        <h1>Billing</h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Current plan */}
        <div className="card card-pad">
          <h3>Current plan</h3>
          <div className="mt-6">
            <span className="t-mono text-sm" style={{ color: "var(--accent)" }}>
              {currentPlanLabel}
            </span>
          </div>

          <div className="mt-6">
            <div className="flex-row justify-between text-sm">
              <span>Policies</span>
              <span>
                {usedConfigs} / {maxConfigsLabel}
              </span>
            </div>
            <div className="bar mt-2">
              <i style={{ width: `${configPct}%` }} />
            </div>
          </div>

          <div className="mt-6">
            <div className="flex-row justify-between text-sm">
              <span>Collectors</span>
              <span>{totalAgents}</span>
            </div>
          </div>

          <div className="mt-6">
            <Link to="/pricing" className="btn btn-ghost btn-sm">
              Compare plans
            </Link>
          </div>
        </div>

        <div className="card card-pad">
          <h3>Control mode</h3>
          <p className="meta mt-6">
            Plans should gate more than quotas. They decide whether a workspace has short-lived
            fleet state only, or also gets retained history, rollback, rollout safety, automation,
            team roles, audit export, and governance controls.
          </p>
          <div className="mt-6">
            <span className={`tag ${hasStatefulOperations(plan) ? "tag-ok" : "tag-warn"}`}>
              {hasStatefulOperations(plan)
                ? "stateful operations enabled"
                : "stateless fleet management"}
            </span>
          </div>
        </div>

        <div className="card card-pad">
          <h3>Billing information</h3>
          <p className="meta mt-6">
            Billing management is not yet available. Contact support to update your plan or payment
            details.
          </p>
        </div>
      </div>
    </div>
  );
}
