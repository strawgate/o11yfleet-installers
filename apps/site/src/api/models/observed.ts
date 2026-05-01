export type ObservationStatus = "ok" | "partial" | "missing" | "unavailable" | "error";

export interface Observation {
  status: ObservationStatus;
  observed_at: string | null;
  coverage?: {
    expected?: number;
    observed?: number;
  };
  warnings?: string[];
}

export interface Observed<T> {
  value: T | null;
  observation: Observation;
}

export function observed<T>(value: T, observation: Partial<Observation> = {}): Observed<T> {
  return {
    value,
    observation: {
      status: observation.status ?? "ok",
      observed_at: observation.observed_at ?? null,
      coverage: observation.coverage,
      warnings: observation.warnings,
    },
  };
}

export function unavailable<T>(
  status: Exclude<ObservationStatus, "ok">,
  observation: Partial<Observation> = {},
): Observed<T> {
  return {
    value: null,
    observation: {
      status,
      observed_at: observation.observed_at ?? null,
      coverage: observation.coverage,
      warnings: observation.warnings,
    },
  };
}

export function observedAgeMs(observation: Observation, now = Date.now()): number | null {
  if (!observation.observed_at) return null;
  const observedAt = Date.parse(observation.observed_at);
  if (!Number.isFinite(observedAt)) return null;
  return Math.max(0, now - observedAt);
}

export function isObservedUsable<T>(metric: Observed<T>): metric is Observed<T> & { value: T } {
  return (
    metric.value !== null &&
    (metric.observation.status === "ok" || metric.observation.status === "partial")
  );
}
