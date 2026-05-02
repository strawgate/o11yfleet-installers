import { memo, useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export type SparklineCellProps = {
  data: Array<[number, number | null]>;
  color: string;
  width?: number;
  height?: number;
  /** Optional shared y-domain so cells across rows are comparable. */
  yDomain?: [number, number];
};

/**
 * Per-row uPlot sparkline. Mounts/unmounts on virtualizer scroll — uPlot
 * init is ~1ms so the ~30 visible cells re-render cheaply. Memoized on
 * data identity so unchanged rows skip re-init.
 *
 * Pattern reference: GitHub Insights, Linear project list. Both use Canvas
 * for the same reason — SVG sparklines fall apart past ~100 rows.
 */
function SparklineCellImpl({ data, color, width = 80, height = 24, yDomain }: SparklineCellProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;

    // Convert [tsMs, val][] → AlignedData; uPlot wants seconds on x.
    const xs: number[] = [];
    const ys: Array<number | null> = [];
    for (const [t, v] of data) {
      xs.push(Math.floor(t / 1000));
      ys.push(v);
    }

    const u = new uPlot(
      {
        width,
        height,
        legend: { show: false },
        cursor: { show: false, drag: { x: false } },
        scales: {
          x: { time: true },
          y: yDomain ? { range: yDomain, auto: false } : { auto: true },
        },
        axes: [{ show: false }, { show: false }],
        series: [
          {},
          {
            stroke: color,
            width: 1,
            spanGaps: false,
            points: { show: false },
          },
        ],
        padding: [2, 2, 2, 2],
      },
      [xs, ys],
      ref.current,
    );
    return () => u.destroy();
  }, [data, color, width, height, yDomain]);

  return (
    <div
      ref={ref}
      style={{ width, height, display: "inline-block" }}
      aria-label="trend"
      role="img"
    />
  );
}

export const SparklineCell = memo(SparklineCellImpl);
