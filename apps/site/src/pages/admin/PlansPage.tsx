import { useAdminPlans } from "../../api/hooks/admin";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";

export default function PlansPage() {
  const { data: plans, isLoading, error, refetch } = useAdminPlans();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const planList = plans ?? [];

  const planTag = (name: string) => {
    const isPremium = name === "pro" || name === "enterprise";
    return (
      <span
        className="tag"
        style={
          isPremium ? { color: "var(--accent)", borderColor: "var(--accent-line)" } : undefined
        }
      >
        {name}
      </span>
    );
  };

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
              <th>Max agents</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {planList.length === 0 ? (
              <tr>
                <td colSpan={4} className="meta" style={{ textAlign: "center", padding: 32 }}>
                  No plans configured.
                </td>
              </tr>
            ) : (
              planList.map((p) => (
                <tr key={p.id}>
                  <td>{planTag(p.name)}</td>
                  <td>{(p["max_configs"] as number) ?? "—"}</td>
                  <td>{(p["max_agents_per_config"] as number) ?? "—"}</td>
                  <td>{(p["price"] as string | number) ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
