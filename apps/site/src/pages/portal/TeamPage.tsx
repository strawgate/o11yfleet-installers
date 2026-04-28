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
        <div>
          <h1>Team</h1>
          <p className="meta">
            Roles should separate read-only fleet visibility from remote-config mutation and
            workspace administration.
          </p>
        </div>
      </div>

      <div className="card card-pad mb-6">
        <h3>Target role model</h3>
        <div
          className="mt-6"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <span className="tag tag-ok">owner</span>
            <p className="meta mt-2">
              Own workspace deletion, billing authority, and highest-risk admin delegation.
            </p>
          </div>
          <div>
            <span className="tag">viewer</span>
            <p className="meta mt-2">Read fleet state, versions, rollouts, and audit history.</p>
          </div>
          <div>
            <span className="tag tag-warn">operator</span>
            <p className="meta mt-2">
              Create versions, roll out config, and manage enrollment tokens.
            </p>
          </div>
          <div>
            <span className="tag tag-warn">admin</span>
            <p className="meta mt-2">
              Manage team, billing, API tokens, and destructive workspace actions.
            </p>
          </div>
        </div>
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
