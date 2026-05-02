import { useMemo, useState } from "react";
import { Badge, Container, Divider, Grid, Group, Stack, Text, Title } from "@mantine/core";
import {
  ChartShell,
  TimeRangePicker,
  TimeSeriesChart,
  resolveTimeRange,
  selectResolution,
  bucketCount,
  type TimeRangeSpec,
  type Series,
} from "@/charts";
import { generateSeries, generateSeriesGroup, DENSITY_CASES } from "@/charts/fixtures/generators";

/**
 * Dev-only validation page for the chart spine. Exercises:
 *   - 7-density matrix (0/1/4/100/10k/100k + gaps)
 *   - Multi-chart cursor sync
 *   - Brush-zoom updating a shared TimeRangePicker
 *   - Live theme/range/resolution display
 *   - Sparkline mode
 *   - Markers
 *
 * Mounted at /playground/spine, gated by import.meta.env.DEV in routes.tsx.
 */
export function SpinePlayground() {
  const [spec, setSpec] = useState<TimeRangeSpec>({ kind: "relative", preset: "24h" });
  const range = useMemo(() => resolveTimeRange(spec), [spec]);
  const resolution = selectResolution(range.to - range.from);

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Stack gap={4}>
          <Title order={2}>Chart spine playground</Title>
          <Text c="dimmed" size="sm">
            Validates uPlot wrapper, ChartShell states, time-range picker, cursor sync and
            brush-zoom. Dev-only.
          </Text>
        </Stack>

        <Group justify="space-between">
          <Group gap="xs">
            <Badge variant="default">resolution: {resolution}</Badge>
            <Badge variant="default">
              ~{bucketCount(range, resolution).toLocaleString()} buckets
            </Badge>
          </Group>
          <TimeRangePicker value={spec} onChange={setSpec} />
        </Group>

        <Divider label="Density matrix" labelPosition="center" />
        <Grid>
          {DENSITY_CASES.map((c) => (
            <Grid.Col key={c.label} span={{ base: 12, md: 6, lg: 4 }}>
              <DensityCard
                label={c.label}
                count={c.count}
                gapEvery={"gapEvery" in c ? c.gapEvery : undefined}
              />
            </Grid.Col>
          ))}
        </Grid>

        <Divider label="Cursor sync + brush zoom" labelPosition="center" />
        <SyncedRow spec={spec} setSpec={setSpec} />

        <Divider label="Sparkline mode" labelPosition="center" />
        <Group>
          <SparklineSample />
          <SparklineSample />
          <SparklineSample />
        </Group>
      </Stack>
    </Container>
  );
}

function DensityCard({
  label,
  count,
  gapEvery,
}: {
  label: string;
  count: number;
  gapEvery?: number;
}) {
  const range: { from: number; to: number } = useMemo(() => {
    const now = Date.now();
    return { from: now - 3_600_000, to: now };
  }, []);
  const series: Series[] = useMemo(() => {
    if (count === 0) return [];
    return [generateSeries(label, { range, count, seed: count, gapEvery, min: 0, max: 1000 })];
  }, [count, gapEvery, range, label]);

  return (
    <Stack gap={4}>
      <Group justify="space-between" gap={2}>
        <Text size="xs" fw={500}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {count.toLocaleString()} pts
        </Text>
      </Group>
      <ChartShell height={140} pointCount={series[0]?.data.length ?? 0}>
        <TimeSeriesChart series={series} timeRange={range} height={140} />
      </ChartShell>
    </Stack>
  );
}

function SyncedRow({
  spec,
  setSpec,
}: {
  spec: TimeRangeSpec;
  setSpec: (s: TimeRangeSpec) => void;
}) {
  const range = useMemo(() => resolveTimeRange(spec), [spec]);
  const seriesA = useMemo(
    () =>
      generateSeriesGroup({
        range,
        count: 600,
        seedBase: 11,
        series: [
          { name: "accepted", min: 100, max: 1000 },
          { name: "sent", min: 80, max: 950 },
        ],
      }),
    [range],
  );
  const seriesB = useMemo(
    () => [generateSeries("queue depth", { range, count: 600, seed: 99, min: 0, max: 200 })],
    [range],
  );

  const onBrush = (next: { from: number; to: number }) =>
    setSpec({ kind: "absolute", from: next.from, to: next.to });

  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <ChartShell
          height={220}
          title={
            <Text fw={500} size="sm">
              Throughput
            </Text>
          }
          subtitle={<>resolution: {selectResolution(range.to - range.from)}</>}
          pointCount={seriesA[0]?.data.length ?? 0}
        >
          <TimeSeriesChart
            series={seriesA}
            timeRange={range}
            height={220}
            syncKey="play-row"
            onBrushZoom={onBrush}
          />
        </ChartShell>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <ChartShell
          height={220}
          title={
            <Text fw={500} size="sm">
              Queue depth
            </Text>
          }
          subtitle="brush either chart →"
          pointCount={seriesB[0]?.data.length ?? 0}
        >
          <TimeSeriesChart
            series={seriesB}
            timeRange={range}
            height={220}
            syncKey="play-row"
            onBrushZoom={onBrush}
          />
        </ChartShell>
      </Grid.Col>
    </Grid>
  );
}

function SparklineSample() {
  const range = useMemo(() => {
    const now = Date.now();
    return { from: now - 3_600_000, to: now };
  }, []);
  const series = useMemo(
    () => [generateSeries("ingest", { range, count: 60, seed: Math.floor(Math.random() * 1000) })],
    [range],
  );
  return (
    <div style={{ width: 120, height: 28 }}>
      <TimeSeriesChart series={series} timeRange={range} height={28} showAxes={false} />
    </div>
  );
}
