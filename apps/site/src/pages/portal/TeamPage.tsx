import { useMemo } from "react";
import { useTeam, type TeamMember } from "@/api/hooks/portal";
import {
  DataTable,
  EmptyState,
  PageHeader,
  PageShell,
  StatusBadge,
  type ColumnDef,
  type StatusTone,
} from "@/components/app";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { relTime } from "@/utils/format";
import { initials, memberDisplayName, roleTone } from "./team-model";

const roleCards: Array<{
  role: string;
  tone: StatusTone;
  description: string;
}> = [
  {
    role: "owner",
    tone: "warn",
    description: "Workspace deletion, billing authority, and highest-risk admin delegation.",
  },
  {
    role: "admin",
    tone: "info",
    description: "Team, billing, enrollment policy, and destructive workspace actions.",
  },
  {
    role: "operator",
    tone: "ok",
    description: "Configuration versions, rollout operations, and enrollment tokens.",
  },
  {
    role: "viewer",
    tone: "neutral",
    description: "Read fleet state, versions, rollouts, and audit history.",
  },
];

export default function TeamPage() {
  const { data: members, isLoading, error, refetch } = useTeam();
  const columns = useMemo(() => teamColumns(), []);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorState error={error} retry={() => void refetch()} />;

  const memberList = members ?? [];

  return (
    <PageShell width="wide">
      <PageHeader
        title="Team"
        description="Roles separate read-only fleet visibility from remote-config mutation and workspace administration."
      />

      <section className="mb-6 rounded-md border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Target role model</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {roleCards.map((item) => (
            <div key={item.role} className="grid content-start gap-2">
              <StatusBadge tone={item.tone}>{item.role}</StatusBadge>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      <DataTable
        columns={columns}
        data={memberList}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            icon="users"
            title="No team members found"
            description="Team members will appear here after they are invited or provisioned."
          />
        }
      />
    </PageShell>
  );
}

function teamColumns(): ColumnDef<TeamMember>[] {
  return [
    {
      id: "member",
      header: "Member",
      cell: ({ row }) => {
        const displayName = memberDisplayName(row.original);
        return (
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-full border border-border bg-muted font-mono text-xs text-muted-foreground">
              {initials(displayName)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{displayName}</div>
              <div className="truncate text-sm text-muted-foreground">{row.original.email}</div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const role = row.original.role ?? "member";
        return <StatusBadge tone={roleTone(role)}>{role}</StatusBadge>;
      },
    },
    {
      id: "joined",
      header: "Joined",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {relTime(row.original["created_at"] as string | undefined)}
        </span>
      ),
    },
  ];
}
