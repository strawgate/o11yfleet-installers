import type { Resolution, TimeRange } from "./types";

const HOUR_MS = 3_600_000;

/**
 * Map a time range to a server-side bucket size that returns ~200-700 points.
 * Pure function — easy to test and reuse outside React.
 *
 * Tiers are tuned for Cloudflare Analytics Engine query-time bucketing
 * via `intDiv(toUInt32(timestamp), N) * N`. See ui-data-contract.md.
 */
export function selectResolution(rangeMs: number): Resolution {
  if (rangeMs <= 0) return "15s";
  const hours = rangeMs / HOUR_MS;
  if (hours <= 1) return "15s"; // ~240 points at 15s ticks
  if (hours <= 6) return "1m"; // ~360 points
  if (hours <= 24) return "5m"; // ~288 points
  if (hours <= 24 * 7) return "15m"; // ~672 points
  if (hours <= 24 * 30) return "1h"; // ~720 points
  return "6h"; // ~360 points at 90d
}

export function resolutionToSeconds(r: Resolution): number {
  switch (r) {
    case "15s":
      return 15;
    case "1m":
      return 60;
    case "5m":
      return 300;
    case "15m":
      return 900;
    case "1h":
      return 3600;
    case "6h":
      return 21_600;
  }
}

export function rangeMs(range: TimeRange): number {
  return range.to - range.from;
}

/** Approximate point count for a (range, resolution) — used in sanity checks/tests. */
export function bucketCount(range: TimeRange, resolution: Resolution): number {
  return Math.ceil(rangeMs(range) / 1000 / resolutionToSeconds(resolution));
}
