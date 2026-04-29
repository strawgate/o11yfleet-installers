import { useAdminPlans } from "../../api/hooks/admin";
import { EmptyState } from "../../components/common/EmptyState";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { PlanTag } from "@/components/common/PlanTag";

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function optionalNumber(value: unknown): number | string {
  return typeof value === "number" ? value : "—";
}

export default function PlansPage() {
  const { data: plans, isLoading, error, refetch } = useAdminPlans();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const planList = plans ?? [];

  return (
    <>
      <div className="page-head">
        <h1>Plans</h1>
      </div>

      <div className="dt-card">
        <table className="dt">
          <thead>
            <tr>
              <th>Name</th>
              <th>Max configs</th>
              <th>Agent limit / config</th>
              <th>Tenants</th>
            </tr>
          </thead>
          <tbody>
            {planList.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    icon="box"
                    title="No plans configured"
                    description="Plan definitions will appear here after they are seeded or configured."
                  />
                </td>
              </tr>
            ) : (
              planList.map((p) => (
                <tr key={p.id}>
                  <td>
                    <PlanTag plan={p.name} />
                  </td>
                  <td>{optionalNumber(p["max_configs"])}</td>
                  <td>{optionalNumber(p["max_agents_per_config"])}</td>
                  <td>{numberValue(p["tenant_count"], 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
