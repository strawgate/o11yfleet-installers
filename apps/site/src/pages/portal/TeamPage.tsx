import { useMemo } from "react";
import { Avatar, Group, Stack, Text } from "@mantine/core";
import { useTeam, type TeamMember } from "@/api/hooks/portal";
import { EmptyState, PageHeader, PageShell, StatusBadge } from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { relTime } from "@/utils/format";
import { initials, memberDisplayName, roleTone } from "./team-model";

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

      <DataTable
        columns={columns}
        data={memberList}
        getRowId={(row) => row.id}
        ariaLabel="Team members"
        empty={
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
          <Group gap="sm" wrap="nowrap">
            <Avatar size="sm" radius="xl">
              {initials(displayName)}
            </Avatar>
            <Stack gap={0} miw={0}>
              <Text size="sm" fw={500} truncate>
                {displayName}
              </Text>
              <Text size="sm" c="dimmed" truncate>
                {row.original.email}
              </Text>
            </Stack>
          </Group>
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
        <Text size="sm" c="dimmed">
          {relTime(row.original["created_at"] as string | undefined)}
        </Text>
      ),
    },
  ];
}
