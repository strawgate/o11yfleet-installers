import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Code,
  Container,
  Divider,
  Group,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  DataTable,
  SparklineCell,
  useDeferredFilter,
  type ColumnDef,
} from "@/components/data-table";
import { generateSeries } from "@/charts/fixtures/generators";

type Agent = {
  id: string;
  hostname: string;
  status: "connected" | "disconnected" | "error" | "configuring" | "pending";
  health: "ok" | "warn" | "err";
  version: string;
  lastSeenSec: number;
  configHash: string;
  trend: Array<[number, number | null]>;
};

const STATUSES: Agent["status"][] = [
  "connected",
  "disconnected",
  "error",
  "configuring",
  "pending",
];
const HEALTHS: Agent["health"][] = ["ok", "warn", "err"];

function generate(n: number): Agent[] {
  const now = Date.now();
  const range = { from: now - 3_600_000, to: now };
  const out: Agent[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const status = STATUSES[i % STATUSES.length] ?? "connected";
    const health = HEALTHS[i % HEALTHS.length] ?? "ok";
    out[i] = {
      id: `agent-${i.toString().padStart(6, "0")}`,
      hostname: `host-${(i + 1).toString().padStart(5, "0")}.example.com`,
      status,
      health,
      version: `0.${108 + (i % 6)}.${i % 10}`,
      lastSeenSec: Math.floor((now - (i % 3600) * 1000) / 1000),
      configHash: `sha256:${(i * 7919).toString(16).padStart(8, "0")}`,
      trend: generateSeries(`agent-${i}`, { range, count: 60, seed: i + 1, min: 0, max: 1000 })
        .data,
    };
  }
  return out;
}

const colors = {
  connected: "var(--mantine-color-brand-5)",
  disconnected: "var(--mantine-color-gray-6)",
  error: "var(--mantine-color-err-5)",
  configuring: "var(--mantine-color-info-5)",
  pending: "var(--mantine-color-warn-5)",
};

const SIZES = [10, 100, 10_000, 50_000];

export function DataTablePlayground() {
  const [size, setSize] = useState<number>(10_000);
  const [virtualize, setVirtualize] = useState(true);
  const [showSparkline, setShowSparkline] = useState(true);
  const [filterImmediate, setFilterImmediate] = useState("");
  const filter = useDeferredFilter(filterImmediate, 250);

  const allAgents = useMemo(() => generate(size), [size]);
  const filtered = useMemo(() => {
    if (!filter) return allAgents;
    const f = filter.toLowerCase();
    return allAgents.filter(
      (a) => a.hostname.toLowerCase().includes(f) || a.id.toLowerCase().includes(f),
    );
  }, [allAgents, filter]);

  // Use plain `ColumnDef<Agent>` literals rather than `createColumnHelper`
  // — the helper's strongly-typed accessor returns specialise the value
  // type (e.g. `ColumnDef<Agent, string>`) which doesn't widen to
  // `ColumnDef<Agent, unknown>` in strict TS, forcing per-element casts
  // that defeat the type checker.
  const columns = useMemo<ColumnDef<Agent>[]>(() => {
    const cols: ColumnDef<Agent>[] = [
      {
        id: "hostname",
        accessorKey: "hostname",
        header: "Hostname",
        size: 240,
        cell: ({ row }) => (
          <Code style={{ background: "transparent" }}>{row.original.hostname}</Code>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        size: 130,
        cell: ({ row }) => (
          <Badge size="sm" variant="light" color={statusColor(row.original.status)}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "health",
        accessorKey: "health",
        header: "Health",
        size: 90,
        cell: ({ row }) => {
          const h = row.original.health;
          return (
            <Group gap={4}>
              <Box
                w={8}
                h={8}
                style={{ borderRadius: "50%", background: `var(--mantine-color-${h}-5)` }}
              />
              <Text size="sm">{h}</Text>
            </Group>
          );
        },
      },
      {
        id: "version",
        accessorKey: "version",
        header: "Version",
        size: 100,
      },
      {
        id: "lastSeenSec",
        accessorKey: "lastSeenSec",
        header: "Last seen",
        size: 130,
        cell: ({ row }) => {
          const ago = Math.floor(Date.now() / 1000 - row.original.lastSeenSec);
          return <Text size="sm">{ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`}</Text>;
        },
      },
      {
        id: "configHash",
        accessorKey: "configHash",
        header: "Config",
        size: 170,
        cell: ({ row }) => (
          <Code style={{ background: "transparent" }}>{row.original.configHash.slice(0, 14)}…</Code>
        ),
      },
    ];
    if (showSparkline) {
      cols.push({
        id: "trend",
        header: "Last 1h",
        size: 100,
        cell: ({ row }) => (
          <SparklineCell data={row.original.trend} color={colors[row.original.status]} />
        ),
      });
    }
    return cols;
  }, [showSparkline]);

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={2}>DataTable playground</Title>
          <Text c="dimmed" size="sm">
            Stress-tests the new TanStack Table v8 + react-virtual shell at 10k+ rows. Toggle
            virtualization, sparklines, and dataset size to compare. Dev-only.
          </Text>
        </Stack>

        <Group justify="space-between">
          <Group gap="xs">
            {SIZES.map((n) => (
              <Button
                key={n}
                size="xs"
                variant={size === n ? "filled" : "default"}
                onClick={() => setSize(n)}
              >
                {n.toLocaleString()} rows
              </Button>
            ))}
          </Group>
          <Group gap="md">
            <Switch
              size="xs"
              label="Virtualize"
              checked={virtualize}
              onChange={(e) => setVirtualize(e.currentTarget.checked)}
            />
            <Switch
              size="xs"
              label="Sparklines"
              checked={showSparkline}
              onChange={(e) => setShowSparkline(e.currentTarget.checked)}
            />
          </Group>
        </Group>

        <Divider />

        <DataTable<Agent>
          columns={columns}
          data={filtered}
          getRowId={(a) => a.id}
          virtualizeRows={virtualize}
          estimatedRowHeight={virtualize ? 44 : 44}
          height={600}
          enableColumnPinning
          persistKey="playground-data-table"
          rowCount={filtered.length}
          ariaLabel="Synthetic agents"
          toolbar={
            <TextInput
              size="xs"
              placeholder="Filter hostname / id…"
              value={filterImmediate}
              onChange={(e) => setFilterImmediate(e.currentTarget.value)}
              style={{ flex: 1, maxWidth: 320 }}
            />
          }
        />
      </Stack>
    </Container>
  );
}

function statusColor(status: Agent["status"]): string {
  switch (status) {
    case "connected":
      return "brand";
    case "error":
      return "err";
    case "configuring":
      return "info";
    case "pending":
      return "warn";
    case "disconnected":
      return "gray";
  }
}
