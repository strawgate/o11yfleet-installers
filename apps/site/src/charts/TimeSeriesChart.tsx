import { useEffect, useRef } from "react";
import uPlot, { type Options as UplotOptions } from "uplot";
import "uplot/dist/uPlot.min.css";
import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { toAlignedData } from "./toAlignedData";
import type { Marker, Series, TimeRange } from "./types";
import { formatTimeTick, formatValue } from "./format";

export type TimeSeriesChartProps = {
  series: Series[];
  timeRange: TimeRange;
  height: number;
  /** Cursor sync key; charts sharing a key get a synchronized crosshair. */
  syncKey?: string;
  /** Fired when the user brush-selects a region. Caller owns the global picker. */
  onBrushZoom?: (range: TimeRange) => void;
  /** Sparkline mode hides axes, grid, legend. */
  showAxes?: boolean;
  /** Vertical line markers (releases, deploys). */
  markers?: Marker[];
  /** When true, the chart wrapper still mounts uPlot with the (empty) data
   * so axes/grid still render — the surrounding ChartShell decides whether
   * to short-circuit with an empty state instead. */
  drawWhenEmpty?: boolean;
};

/**
 * Hand-rolled uPlot wrapper. ~150 LOC because we own:
 *  - two-effect lifecycle (re-init on theme/structure, setData on data)
 *  - ResizeObserver-driven setSize
 *  - brush-zoom captured into onBrushZoom (NOT uPlot's default scale change)
 *  - crosshair sync via uPlot.sync(syncKey)
 *  - canvas-drawn release markers via the `draw` hook
 *  - StrictMode-safe destroy
 *
 * Why not uplot-react: stale (last meaningful work 2022). uPlot's lifecycle
 * is small enough to manage in a real component.
 */
export function TimeSeriesChart(props: TimeSeriesChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const onBrushZoomRef = useRef(props.onBrushZoom);
  onBrushZoomRef.current = props.onBrushZoom;

  const colorScheme = useComputedColorScheme("dark");
  const mantineTheme = useMantineTheme();

  const aligned = toAlignedData(props.series);
  const xs = aligned[0] as number[] | undefined;
  const dataPointCount = xs?.length ?? 0;

  // Effect A: heavy init. Re-runs on theme / structural changes only.
  useEffect(() => {
    if (!hostRef.current) return;
    if (dataPointCount === 0 && !props.drawWhenEmpty) return;

    const isDark = colorScheme === "dark";
    const grayTuple = mantineTheme.colors.gray;
    const fg = (isDark ? grayTuple[1] : grayTuple[8]) ?? "#888";
    const grid = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    const axis = (isDark ? grayTuple[5] : grayTuple[6]) ?? "#666";

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const showAxes = props.showAxes !== false;
    const showLegend = false; // we render our own legend in tooltip / siblings.

    const opts: UplotOptions = {
      width: hostRef.current.clientWidth || 600,
      height: props.height,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), tz),
      scales: {
        x: { time: true },
        y: { auto: true },
      },
      axes: showAxes
        ? [
            {
              stroke: axis,
              grid: { stroke: grid },
              ticks: { stroke: grid },
              values: (_u, splits) => {
                const last = splits[splits.length - 1] ?? 0;
                const first = splits[0] ?? 0;
                const span = last - first;
                return splits.map((s) => formatTimeTick(s, span));
              },
            },
            {
              stroke: axis,
              grid: { stroke: grid },
              ticks: { stroke: grid },
              size: 50,
              values: (_u, splits) => splits.map((s) => formatValue(s, props.series[0]?.unit)),
            },
          ]
        : [{ show: false }, { show: false }],
      series: [
        {},
        ...props.series.map((s, i) => ({
          label: s.name,
          stroke: s.color ?? defaultSeriesColor(i, mantineTheme),
          width: showAxes ? 1.5 : 1,
          spanGaps: false, // gaps are meaningful — never interpolate
          points: { show: dataPointCount < 5 ? true : false, size: 5 },
        })),
      ],
      cursor: {
        drag: { x: true, y: false, setScale: false },
        sync: props.syncKey ? { key: props.syncKey } : undefined,
      },
      legend: { show: showLegend },
      hooks: {
        setSelect: [
          (u) => {
            if (u.select.width > 0 && onBrushZoomRef.current) {
              const fromSec = u.posToVal(u.select.left, "x");
              const toSec = u.posToVal(u.select.left + u.select.width, "x");
              onBrushZoomRef.current({
                from: Math.round(fromSec * 1000),
                to: Math.round(toSec * 1000),
              });
              // Clear visual selection — caller will redraw with new range.
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            }
          },
        ],
        draw:
          props.markers && props.markers.length > 0
            ? [
                (u) => {
                  const ctx = u.ctx;
                  ctx.save();
                  ctx.lineWidth = 1;
                  const brandTuple = mantineTheme.colors.brand;
                  for (const m of props.markers ?? []) {
                    const x = u.valToPos(m.ts / 1000, "x", true);
                    if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
                    ctx.strokeStyle = m.color ?? brandTuple[5];
                    ctx.beginPath();
                    ctx.moveTo(x, u.bbox.top);
                    ctx.lineTo(x, u.bbox.top + u.bbox.height);
                    ctx.stroke();
                  }
                  ctx.restore();
                },
              ]
            : [],
      },
    };

    if (props.syncKey) uPlot.sync(props.syncKey);
    plotRef.current = new uPlot(opts, aligned, hostRef.current);

    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e || !plotRef.current) return;
      plotRef.current.setSize({
        width: Math.max(40, e.contentRect.width),
        height: props.height,
      });
    });
    ro.observe(hostRef.current);
    void fg; // reserved for future legend rendering

    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: data is handled in Effect B
  }, [
    colorScheme,
    props.height,
    props.syncKey,
    props.showAxes,
    props.series.length,
    props.markers?.length,
  ]);

  // Effect B: cheap data updates.
  useEffect(() => {
    if (!plotRef.current) return;
    plotRef.current.setData(aligned, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alignedKey captures content
  }, [alignedKey(aligned)]);

  return <div ref={hostRef} style={{ width: "100%", height: props.height }} />;
}

function defaultSeriesColor(i: number, theme: ReturnType<typeof useMantineTheme>): string {
  const palette = [
    theme.colors.brand[5],
    theme.colors.info[5],
    theme.colors.warn[5],
    theme.colors.err[5],
    theme.colors.gray[5],
  ] as const;
  return palette[i % palette.length] as string;
}

/** Cheap dep key for AlignedData — avoids re-running effect when reference changes
 * but content is identical (e.g., a parent re-render with stable data). */
function alignedKey(d: ReturnType<typeof toAlignedData>): string {
  const xs = d[0] as number[] | undefined;
  if (!xs || xs.length === 0) return "0";
  return `${d.length}:${xs.length}:${xs[0]}:${xs[xs.length - 1]}`;
}
