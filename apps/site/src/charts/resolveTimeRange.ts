import type { RelativePreset, TimeRange, TimeRangeSpec } from "./types";

const PRESET_MS: Record<RelativePreset, number> = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  "90d": 90 * 24 * 3_600_000,
};

/**
 * Turn a (relative or absolute) range spec into a concrete from/to window.
 * Relative ranges anchor to `now` so callers control freshness for snapshot tests.
 */
export function resolveTimeRange(spec: TimeRangeSpec, now: number = Date.now()): TimeRange {
  if (spec.kind === "absolute") {
    return { from: spec.from, to: spec.to };
  }
  const span = PRESET_MS[spec.preset];
  return { from: now - span, to: now };
}

export function presetSpan(preset: RelativePreset): number {
  return PRESET_MS[preset];
}

export const RELATIVE_PRESETS: RelativePreset[] = ["1h", "6h", "24h", "7d", "30d", "90d"];

export function presetLabel(preset: RelativePreset): string {
  switch (preset) {
    case "1h":
      return "Last hour";
    case "6h":
      return "Last 6 hours";
    case "24h":
      return "Last 24 hours";
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
  }
}
