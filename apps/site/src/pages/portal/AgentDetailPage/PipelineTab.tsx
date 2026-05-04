import { Badge, Box, Card, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { EmptyState, StatusBadge as AppStatusBadge } from "@/components/app";
import { DataTable, type ColumnDef } from "@/components/data-table";
import type { PipelineComponent } from "@/utils/pipeline";
import { pipelineRows, type PipelineRow } from "@/pages/portal/agent-detail-model";
import { useAgentDetailContext } from "./agent-detail-context";

export default function PipelineTab() {
  const { topology } = useAgentDetailContext();

  if (!topology) {
    return (
      <Box id="agent-tab-pipeline" role="tabpanel" mt="md">
        <EmptyState
          icon="file"
          title="No pipeline to visualize"
          description="This agent has not reported an effective configuration yet."
        />
      </Box>
    );
  }

  const rows = pipelineRows(topology);
  const columns = pipelineColumns();

  return (
    <Stack id="agent-tab-pipeline" role="tabpanel" mt="md" gap="md">
      <Card>
        <Title order={3} size="sm" mb="md">
          Pipeline Flow
        </Title>
        {topology.pipelines.length === 0 ? (
          <Text size="sm" c="dimmed">
            No pipelines defined in service configuration.
          </Text>
        ) : (
          <Stack gap="md">
            {topology.pipelines.map((pipeline) => (
              <Paper key={pipeline.name} withBorder p="md">
                <Text size="xs" fw={500} c="dimmed" tt="uppercase" ff="monospace" mb="xs">
                  {pipeline.name}
                </Text>
                <Group align="flex-start" gap="sm" wrap="wrap">
                  <ComponentGroup
                    label="Receivers"
                    names={pipeline.receivers}
                    components={topology.receivers}
                  />
                  <PipelineArrow />
                  <ComponentGroup
                    label="Processors"
                    names={pipeline.processors}
                    components={topology.processors}
                  />
                  <PipelineArrow />
                  <ComponentGroup
                    label="Exporters"
                    names={pipeline.exporters}
                    components={topology.exporters}
                  />
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Card>

      {topology.extensions.length > 0 && (
        <Card>
          <Title order={3} size="sm" mb="md">
            Extensions
          </Title>
          <Group gap="xs">
            {topology.extensions.map((ext) => (
              <ComponentChip key={ext.name ?? ext.type} component={ext} />
            ))}
          </Group>
        </Card>
      )}

      <Title order={3} size="sm" fw={500} mb="xs">
        All components
      </Title>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.category}-${row.name}`}
        ariaLabel="All components"
      />
    </Stack>
  );
}

function ComponentGroup({
  label,
  names,
  components,
}: {
  label: string;
  names: string[];
  components: PipelineComponent[];
}) {
  // Pipeline references a component by its name (e.g. "otlp/auth"); fall
  // back to type for older configs that don't name distinct instances.
  // Without the name lookup, two `otlphttp` exporters would collapse onto
  // the same chip and report the wrong health.
  const matched = names.map(
    (name) =>
      components.find((c) => c.name === name || c.type === name) ?? {
        name,
        type: name,
        healthy: null,
      },
  );

  return (
    <Stack gap={6} style={{ flex: 1, minWidth: 120 }}>
      <Text size="xs" fw={500} c="dimmed" tt="uppercase" ff="monospace">
        {label}
      </Text>
      <Stack gap={4}>
        {matched.map((c) => (
          <ComponentChip key={c.name ?? c.type} component={c} />
        ))}
      </Stack>
    </Stack>
  );
}

function ComponentChip({ component }: { component: PipelineComponent }) {
  const color = component.healthy === false ? "red" : component.healthy === true ? "green" : "gray";
  return (
    <Badge
      variant="light"
      color={color}
      size="sm"
      tt="none"
      leftSection={<ComponentHealthDot healthy={component.healthy} />}
      title={component.lastError ?? component.status ?? component.type}
    >
      {component.type}
    </Badge>
  );
}

function ComponentHealthDot({ healthy }: { healthy: boolean | null }) {
  const color =
    healthy === true
      ? "var(--mantine-color-green-6)"
      : healthy === false
        ? "var(--mantine-color-red-6)"
        : "var(--mantine-color-gray-5)";
  return (
    <Box
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        display: "inline-block",
      }}
    />
  );
}

function PipelineArrow() {
  return (
    <Text c="dimmed" pt={26} aria-hidden>
      →
    </Text>
  );
}

function pipelineColumns(): ColumnDef<PipelineRow>[] {
  return [
    {
      id: "category",
      header: "Type",
      cell: ({ row }) => (
        <Text size="sm" c="dimmed">
          {row.original.category}
        </Text>
      ),
    },
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => (
        <Text size="xs" ff="monospace">
          {row.original.name}
        </Text>
      ),
    },
    {
      id: "health",
      header: "Health",
      cell: ({ row }) => {
        const healthy = row.original.healthy;
        return (
          <AppStatusBadge tone={healthy === true ? "ok" : healthy === false ? "error" : "neutral"}>
            {healthy === true ? "healthy" : healthy === false ? "unhealthy" : "unknown"}
          </AppStatusBadge>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <Text size="sm">{row.original.status ?? "—"}</Text>,
    },
  ];
}
