import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Observed, Resolution, Series, TimeRange } from "./types";
import { selectResolution } from "./selectResolution";

export type MetricQuery = {
  metric: string;
  /** Optional grouping dimensions (e.g., ["tenant_id"]). */
  groupBy?: string[];
  /** Optional filter expression in worker-side syntax. */
  filter?: Record<string, string>;
};

export type UseMetricSeriesOptions = {
  query: MetricQuery;
  range: TimeRange;
  /** "auto" derives from range; explicit overrides for power users. */
  resolution?: Resolution | "auto";
  /** Override the fetcher — used in tests and SpinePlayground. */
  fetcher?: MetricFetcher;
  /** Disable when the page isn't ready to query yet. */
  enabled?: boolean;
};

export type MetricFetcher = (input: {
  query: MetricQuery;
  range: TimeRange;
  resolution: Resolution;
}) => Promise<Observed<Series[]>>;

/**
 * Single source-of-truth hook for any metric chart. Wraps TanStack Query.
 * The `fetcher` indirection means SpinePlayground and tests can run against
 * synthetic data while production uses the real Analytics Engine wrapper.
 *
 * Returns a TanStack Query result whose `data` is `Observed<Series[]>`. The
 * chart consumer pattern is:
 *
 *   const r = useMetricSeries({ query, range });
 *   <ChartShell loading={r.isLoading} refetching={r.isFetching && !r.isLoading}
 *               error={r.error ? { message: r.error.message } : null}
 *               status={r.data?.status}
 *               pointCount={r.data?.value?.[0]?.data.length ?? 0}>
 *     <TimeSeriesChart series={r.data?.value ?? []} timeRange={range} ... />
 *   </ChartShell>
 */
export function useMetricSeries(opts: UseMetricSeriesOptions): UseQueryResult<Observed<Series[]>> {
  const resolution =
    opts.resolution === "auto" || !opts.resolution
      ? selectResolution(opts.range.to - opts.range.from)
      : opts.resolution;

  const fetcher = opts.fetcher ?? defaultFetcher;

  return useQuery<Observed<Series[]>>({
    queryKey: [
      "metric-series",
      opts.query.metric,
      opts.query.groupBy ?? [],
      opts.query.filter ?? {},
      opts.range.from,
      opts.range.to,
      resolution,
    ],
    queryFn: () => fetcher({ query: opts.query, range: opts.range, resolution }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}

const defaultFetcher: MetricFetcher = async () => {
  // Real implementation lands in a follow-up PR. Until then, callers MUST
  // pass an explicit `fetcher` (SpinePlayground does so).
  throw new Error(
    "useMetricSeries: no `fetcher` provided. Wire the Analytics Engine fetcher " +
      "or pass a fixture-backed fetcher in the calling component.",
  );
};
