/**
 * Cloudflare Analytics Engine SQL API runner.
 *
 * The DO writes per-config metric snapshots to FP_ANALYTICS via
 * `writeDataPoint` on each alarm tick. Read paths query those snapshots
 * over the AE SQL HTTP API:
 *
 *   POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/analytics_engine/sql
 *   Authorization: Bearer {API_TOKEN}
 *   Content-Type: text/plain
 *   <SQL>
 *
 * SQL helpers come from `@o11yfleet/core/metrics`. This module owns the
 * HTTP transport.
 */
export interface AnalyticsSqlEnv {
  CLOUDFLARE_METRICS_ACCOUNT_ID?: string;
  CLOUDFLARE_METRICS_API_TOKEN?: string;
}

export interface AnalyticsSqlRow {
  [column: string]: string | number | null;
}

interface AnalyticsSqlResponse {
  data?: AnalyticsSqlRow[];
  meta?: Array<{ name: string; type: string }>;
  rows?: number;
  error?: string;
}

export class AnalyticsSqlError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AnalyticsSqlError";
  }
}

export class AnalyticsSqlNotConfiguredError extends Error {
  constructor() {
    super(
      "Analytics Engine SQL API is not configured (set CLOUDFLARE_METRICS_ACCOUNT_ID and CLOUDFLARE_METRICS_API_TOKEN)",
    );
    this.name = "AnalyticsSqlNotConfiguredError";
  }
}

export function isAnalyticsSqlConfigured(env: AnalyticsSqlEnv): boolean {
  return !!(env.CLOUDFLARE_METRICS_ACCOUNT_ID && env.CLOUDFLARE_METRICS_API_TOKEN);
}

/**
 * Run a SQL query against Analytics Engine and return the data rows.
 *
 * Throws `AnalyticsSqlNotConfiguredError` if the runtime env is missing
 * the AE credentials. Throws `AnalyticsSqlError` on non-2xx responses or
 * malformed payloads. Routes should surface unavailable metrics explicitly
 * rather than fanning out across Durable Objects to rebuild aggregate pages.
 */
export async function runAnalyticsSql<T extends AnalyticsSqlRow = AnalyticsSqlRow>(
  env: AnalyticsSqlEnv,
  sql: string,
): Promise<T[]> {
  if (!env.CLOUDFLARE_METRICS_ACCOUNT_ID || !env.CLOUDFLARE_METRICS_API_TOKEN) {
    throw new AnalyticsSqlNotConfiguredError();
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_METRICS_ACCOUNT_ID}/analytics_engine/sql`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_METRICS_API_TOKEN}`,
      "Content-Type": "text/plain",
    },
    body: sql,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AnalyticsSqlError(
      `Analytics Engine SQL request failed: ${response.status} ${response.statusText} ${body}`,
      response.status,
    );
  }

  const payload = (await response.json().catch(() => null)) as AnalyticsSqlResponse | null;
  if (!payload || !Array.isArray(payload.data)) {
    throw new AnalyticsSqlError("Analytics Engine SQL response did not include a data array", 502);
  }
  return payload.data as T[];
}
