import type { AlignedData } from "uplot";
import type { Series } from "./types";

/**
 * Convert our Series[] (each carrying its own [tsMs, value][]) into uPlot's
 * AlignedData = [xs, ys1, ys2, ...]. uPlot expects all series on a shared
 * x-axis, in seconds, sorted ascending. Missing values become null, which
 * uPlot renders as gaps (we never interpolate — gaps are meaningful for
 * "agent went offline" semantics).
 *
 * Strategy: union of all timestamps across input series (cheap when series
 * share a bucket grid, which they do when populated by `useMetricSeries`),
 * then for each series produce one value per timestamp.
 */
export function toAlignedData(seriesList: Series[]): AlignedData {
  if (seriesList.length === 0) {
    return [[]];
  }

  // Union sorted-ascending of all x values (in seconds).
  const xSet = new Set<number>();
  for (const s of seriesList) {
    for (const [ts] of s.data) xSet.add(Math.floor(ts / 1000));
  }
  const xs = Array.from(xSet).sort((a, b) => a - b);

  // Index from x → row for each series.
  const ys: Array<Array<number | null>> = seriesList.map((s) => {
    const map = new Map<number, number | null>();
    for (const [ts, v] of s.data) map.set(Math.floor(ts / 1000), v);
    return xs.map((x) => map.get(x) ?? null);
  });

  return [xs, ...ys] as AlignedData;
}
