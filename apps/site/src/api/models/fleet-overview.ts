import type { Configuration, Overview } from "@/api/hooks/portal";
import { observed, unavailable, type Observed } from "./observed";

type LegacyOverviewFields = {
  agents?: unknown;
  metrics_observed_at?: unknown;
  observed_at?: unknown;
  snapshot_at?: unknown;
};

export interface FleetOverviewView {
  configurations: {
    rows: Configuration[];
    total: Observed<number>;
  };
  agents: {
    total: Observed<number>;
    connected: Observed<number>;
    healthy: Observed<number>;
  };
  rollouts: {
    active: Observed<number>;
  };
}

export function normalizeFleetOverview(payload: Overview): FleetOverviewView {
  const rows = Array.isArray(payload.configurations) ? payload.configurations : [];
  const legacy = legacyOverviewFields(payload);
  const observedAt = timestampValue(
    legacy.metrics_observed_at ?? legacy.observed_at ?? legacy.snapshot_at,
  );
  const metricsWarning = stringValue(payload.metrics_error);
  const metricsStatus = metricsObservationStatus(payload);

  return {
    configurations: {
      rows,
      total: observed(numberValue(payload.configs_count) ?? rows.length, {
        observed_at: observedAt,
      }),
    },
    agents: {
      total: observedMetric(numberValue(payload.total_agents ?? legacy.agents), {
        status: metricsStatus,
        observedAt,
        warning: metricsWarning,
      }),
      connected: observedMetric(numberValue(payload.connected_agents), {
        status: metricsStatus,
        observedAt,
        warning: metricsWarning,
      }),
      healthy: observedMetric(numberValue(payload.healthy_agents), {
        status: metricsStatus,
        observedAt,
        warning: metricsWarning,
      }),
    },
    rollouts: {
      active: observedMetric(numberValue(payload.active_rollouts), {
        status: metricsStatus !== "ok" ? metricsStatus : undefined,
        observedAt,
        warning: metricsWarning,
      }),
    },
  };
}

function observedMetric(
  value: number | null,
  options: {
    status?: "ok" | "partial" | "missing" | "unavailable" | "error";
    observedAt: string | null;
    warning: string | null;
  },
): Observed<number> {
  if (value === null) {
    const status = options.status && options.status !== "ok" ? options.status : "missing";
    return unavailable(status, {
      observed_at: options.observedAt,
      warnings: options.warning ? [options.warning] : undefined,
    });
  }
  return observed(value, {
    status: options.status && options.status !== "missing" ? options.status : "ok",
    observed_at: options.observedAt,
    warnings: options.warning ? [options.warning] : undefined,
  });
}

function metricsObservationStatus(
  payload: Overview,
): "ok" | "partial" | "missing" | "unavailable" | "error" {
  const legacy = legacyOverviewFields(payload);
  if (typeof payload.metrics_error === "string" && payload.metrics_error.length > 0) {
    return "error";
  }
  if (payload.metrics_source === "unavailable") return "unavailable";
  if (
    typeof payload.total_agents === "number" ||
    typeof legacy.agents === "number" ||
    typeof payload.connected_agents === "number" ||
    typeof payload.healthy_agents === "number"
  ) {
    return "ok";
  }
  return "missing";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timestampValue(value: unknown): string | null {
  const text = stringValue(value);
  if (text) return text;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const timestampMs = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(timestampMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function legacyOverviewFields(payload: Overview): Overview & LegacyOverviewFields {
  return payload as Overview & LegacyOverviewFields;
}
