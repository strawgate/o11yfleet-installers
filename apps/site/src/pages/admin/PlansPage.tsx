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

function yesNo(value: unknown): string {
  return value === true ? "Yes" : value === false ? "No" : "—";
}

function trackLabel(value: unknown): string {
  if (value === "personal") return "Individual";
  if (value === "business") return "Organization";
  return typeof value === "string" ? value : "—";
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
              <th>Track</th>
              <th>Users</th>
              <th>Collectors</th>
              <th>Policies</th>
              <th>History</th>
              <th>API / GitOps</th>
              <th>Tenants</th>
            </tr>
          </thead>
          <tbody>
            {planList.length === 0 ? (
              <tr>
                <td colSpan={8}>
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
                    <PlanTag plan={p.id} />
                  </td>
                  <td>{trackLabel(p["audience"])}</td>
                  <td>{optionalNumber(p["max_users"])}</td>
                  <td>{optionalNumber(p["max_collectors"])}</td>
                  <td>{optionalNumber(p["max_policies"] ?? p["max_configs"])}</td>
                  <td>
                    {typeof p["history_retention"] === "string" ? p["history_retention"] : "—"}
                  </td>
                  <td>
                    {yesNo(p["supports_api"])} / {yesNo(p["supports_gitops"])}
                  </td>
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
