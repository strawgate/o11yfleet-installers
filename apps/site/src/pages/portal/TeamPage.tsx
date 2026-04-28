import { useTeam } from "../../api/hooks/portal";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";

function initials(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TeamPage() {
  const { data: members, isLoading, error, refetch } = useTeam();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const memberList = members ?? [];

  return (
    <div className="main-wide">
      <div className="page-head">
        <h1>Team</h1>
      </div>

      <div className="dt-card">
        <table className="dt">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {memberList.length === 0 ? (
              <tr>
                <td colSpan={3} className="meta" style={{ textAlign: "center", padding: 32 }}>
                  No team members found.
                </td>
              </tr>
            ) : (
              memberList.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="flex-row gap-sm">
                      <span className="avatar">
                        {initials(m["display_name"] as string | undefined)}
                      </span>
                      <div>
                        <div className="name">{(m["display_name"] as string) ?? m.email}</div>
                        <div className="meta">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className="tag"
                      style={
                        m.role === "admin"
                          ? { color: "var(--accent)", borderColor: "var(--accent)" }
                          : undefined
                      }
                    >
                      {m.role ?? "member"}
                    </span>
                  </td>
                  <td className="meta">{relTime(m["created_at"] as string | undefined)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
