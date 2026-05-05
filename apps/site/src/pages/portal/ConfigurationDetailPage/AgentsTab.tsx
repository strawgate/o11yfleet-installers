import { useMemo } from "react";
import { Link } from "react-router";
import { Anchor, Box, Button, Group, Text, Title } from "@mantine/core";
import { EmptyState, StatusBadge } from "@/components/app";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { agentLastSeen, agentUid } from "@/utils/agents";
import { relTime } from "@/utils/format";
import { agentHealthView, agentStatusView, agentSyncView } from "@/pages/portal/agent-view-model";
import type { Agent } from "@/api/hooks/portal";
import { useConfigurationDetailContext } from "./configuration-detail-context";

export default function AgentsTab() {
  const {
    configId,
    agentList,
    agentsQuery,
    agentCursor,
    setAgentCursor,
    desiredHash,
    openEnrollDialog,
  } = useConfigurationDetailContext();
  const columns = useMemo(
    () => configurationAgentColumns(configId, desiredHash),
    [configId, desiredHash],
  );

  return (
    <Box
      id="configuration-tab-agents"
      role="tabpanel"
      aria-labelledby="configuration-tab-agents-trigger"
      mt="md"
    >
      {agentsQuery.isLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          <Title order={3} size="sm" fw={500} mb="xs">
            Collectors
          </Title>
          <DataTable
            columns={columns}
            data={agentList}
            getRowId={(agent) => agentUid(agent)}
            ariaLabel="Collectors for this configuration"
            empty={
              <EmptyState
                icon="plug"
                title="No agents connected"
                description="Create an enrollment token and run the installer on a host to attach a collector to this configuration."
              >
                <Button size="xs" onClick={openEnrollDialog}>
                  Enroll agent
                </Button>
              </EmptyState>
            }
          />
        </>
      )}
      <Group gap="xs" mt="xs">
        <Button
          variant="subtle"
          size="xs"
          disabled={!agentCursor}
          onClick={() => setAgentCursor(undefined)}
        >
          First page
        </Button>
        <Button
          variant="default"
          size="xs"
          disabled={!agentsQuery.data?.pagination?.has_more}
          onClick={() => setAgentCursor(agentsQuery.data?.pagination?.next_cursor ?? undefined)}
        >
          Next page
        </Button>
      </Group>
    </Box>
  );
}

function configurationAgentColumns(
  configurationId: string,
  desiredHash: string | null,
): ColumnDef<Agent>[] {
  return [
    {
      id: "instance_uid",
      header: "Instance UID",
      cell: ({ row }) => {
        const uid = agentUid(row.original);
        return (
          <Anchor
            component={Link}
            to={`/portal/agents/${configurationId}/${uid}`}
            size="xs"
            ff="monospace"
          >
            {uid}
          </Anchor>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = agentStatusView(row.original.status);
        return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
      },
    },
    {
      id: "health",
      header: "Health",
      cell: ({ row }) => {
        const health = agentHealthView(row.original);
        return <StatusBadge tone={health.tone}>{health.label}</StatusBadge>;
      },
    },
    {
      id: "config_sync",
      header: "Config sync",
      cell: ({ row }) => {
        const sync = agentSyncView(row.original, desiredHash);
        return <StatusBadge tone={sync.tone}>{sync.label}</StatusBadge>;
      },
    },
    {
      id: "current_hash",
      header: "Current hash",
      cell: ({ row }) => {
        const sync = agentSyncView(row.original, desiredHash);
        return (
          <Text size="xs" c="dimmed" ff="monospace">
            {sync.hashLabel}
          </Text>
        );
      },
    },
    {
      id: "last_seen",
      header: "Last seen",
      cell: ({ row }) => (
        <Text size="sm" c="dimmed">
          {relTime(agentLastSeen(row.original))}
        </Text>
      ),
    },
  ];
}
