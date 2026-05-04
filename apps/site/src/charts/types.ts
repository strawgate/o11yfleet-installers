/**
 * Shared types for the chart spine. Every chart and metric hook
 * speaks these shapes — keeps the data contract single-sourced.
 */

export type Resolution = "15s" | "1m" | "5m" | "15m" | "1h" | "6h";

/** Inclusive ms timestamps. */
export type TimeRange = { from: number; to: number };

/**
 * Relative ranges anchor to "now"; absolute ranges are pinned. URL state
 * persists `kind` so refresh keeps a relative preset alive (Grafana pattern).
 */
export type TimeRangeSpec =
  | { kind: "relative"; preset: RelativePreset }
  | { kind: "absolute"; from: number; to: number };

export type RelativePreset = "1h" | "6h" | "24h" | "7d" | "30d" | "90d";

export type Unit = "bytes" | "count" | "percent" | "duration";

export type Series = {
  name: string;
  /** [tsMs, value] tuples. Sparse data (one point) is fine; gaps are nulls. */
  data: Array<[number, number | null]>;
  color?: string;
  unit?: Unit;
  yAxis?: "left" | "right";
};

/**
 * Observation status for a metric value. Distinguishes "we have no data" from
 * "we couldn't query" from "data is partial". Renders a different chrome.
 */
export type ObservationStatus = "ok" | "partial" | "missing" | "unavailable" | "error";

export type Marker = {
  ts: number;
  label: string;
  color?: string;
};
