import type { Configuration, Overview } from "@/api/hooks/portal";
import { observed, unavailable, type Observed } from "./observed";

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

/**
 * Adapt the typed `OverviewResponse` into the view-model the portal pages
 * consume — wrapping each metric in `Observed<number>` with status/warning so
 * the UI can render "unavailable" badges, error states, and freshness in one
 * pass. This is *not* shape defense — the response shape is enforced by
 * `overviewResponseSchema`. It's mapping flat numbers into a state-aware
 * presentation primitive.
 */
export function normalizeFleetOverview(payload: Overview): FleetOverviewView {
  const rows = payload.configurations;
  const metricsWarning = stringValue(payload.metrics_error);
  const metricsStatus = metricsObservationStatus(payload);

  return {
    configurations: {
      rows,
      total: observed(payload.configs_count, { observed_at: null }),
    },
    agents: {
      total: observedMetric(payload.total_agents, {
        status: metricsStatus,
        warning: metricsWarning,
      }),
      connected: observedMetric(payload.connected_agents, {
        status: metricsStatus,
        warning: metricsWarning,
      }),
      healthy: observedMetric(payload.healthy_agents, {
        status: metricsStatus,
        warning: metricsWarning,
      }),
    },
    rollouts: {
      active: observedMetric(payload.active_rollouts ?? null, {
        status: metricsStatus !== "ok" ? metricsStatus : undefined,
        warning: metricsWarning,
      }),
    },
  };
}

function observedMetric(
  value: number | null,
  options: {
    status?: "ok" | "partial" | "missing" | "unavailable" | "error";
    warning: string | null;
  },
): Observed<number> {
  if (value === null) {
    const status = options.status && options.status !== "ok" ? options.status : "missing";
    return unavailable(status, {
      observed_at: null,
      warnings: options.warning ? [options.warning] : undefined,
    });
  }
  return observed(value, {
    status: options.status && options.status !== "missing" ? options.status : "ok",
    observed_at: null,
    warnings: options.warning ? [options.warning] : undefined,
  });
}

function metricsObservationStatus(
  payload: Overview,
): "ok" | "partial" | "missing" | "unavailable" | "error" {
  if (payload.metrics_error) return "error";
  if (payload.metrics_source === "unavailable") return "unavailable";
  return "ok";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
