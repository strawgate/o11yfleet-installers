import type { Env } from "./index.js";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const SQL_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

type UsageEnv = Env & {
  CLOUDFLARE_USAGE_ACCOUNT_ID?: string;
  CLOUDFLARE_USAGE_API_TOKEN?: string;
  CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME?: string;
  CLOUDFLARE_USAGE_D1_DATABASE_ID?: string;
  CLOUDFLARE_USAGE_R2_BUCKET_NAME?: string;
  CLOUDFLARE_USAGE_ANALYTICS_DATASET?: string;
};

type ServiceId = "workers" | "durable_objects" | "d1" | "r2" | "queues";

export interface UsageLineItem {
  label: string;
  quantity: number;
  unit: string;
  included: number;
  billable: number;
  unit_price_usd: number;
  estimated_spend_usd: number;
}

export interface DailyUsage {
  date: string;
  estimated_spend_usd: number;
  units: Record<string, number>;
}

export interface UsageService {
  id: ServiceId;
  name: string;
  status: "ready" | "not_configured" | "error";
  source: string;
  daily: DailyUsage[];
  line_items: UsageLineItem[];
  month_to_date_estimated_spend_usd: number;
  projected_month_estimated_spend_usd: number;
  notes: string[];
  error?: string;
}

export interface CloudflareUsageResponse {
  configured: boolean;
  currency: "USD";
  generated_at: string;
  window: {
    start_date: string;
    end_date: string;
    days_elapsed: number;
    days_in_month: number;
  };
  pricing: {
    source: string;
    notes: string[];
  };
  required_env: string[];
  services: UsageService[];
  month_to_date_estimated_spend_usd: number;
  projected_month_estimated_spend_usd: number;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface WorkersInvocationRow {
  sum?: { requests?: number; errors?: number; subrequests?: number };
  quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number };
  dimensions?: { datetime?: string };
}

interface WorkersAccountData {
  workersInvocationsAdaptive?: WorkersInvocationRow[];
}

interface WorkersQueryData {
  viewer?: {
    accounts?: WorkersAccountData[];
  };
}

interface D1AnalyticsRow {
  sum?: {
    readQueries?: number;
    writeQueries?: number;
    rowsRead?: number;
    rowsWritten?: number;
  };
  dimensions?: { date?: string };
}

interface D1StorageRow {
  max?: { databaseSizeBytes?: number };
  dimensions?: { date?: string };
}

interface D1AccountData {
  d1AnalyticsAdaptiveGroups?: D1AnalyticsRow[];
  d1StorageAdaptiveGroups?: D1StorageRow[];
}

interface D1QueryData {
  viewer?: {
    accounts?: D1AccountData[];
  };
}

interface DurableObjectInvocationRow {
  sum?: { requests?: number; responseBodySize?: number };
  dimensions?: { date?: string };
}

interface DurableObjectStorageRow {
  max?: { storedBytes?: number };
  dimensions?: { date?: string };
}

interface DurableObjectAccountData {
  durableObjectsInvocationsAdaptiveGroups?: DurableObjectInvocationRow[];
  durableObjectsStorageGroups?: DurableObjectStorageRow[];
}

interface DurableObjectQueryData {
  viewer?: {
    accounts?: DurableObjectAccountData[];
  };
}

interface R2OperationRow {
  sum?: { requests?: number; responseObjectSize?: number };
  dimensions?: { datetime?: string; actionType?: string };
}

interface R2StorageRow {
  max?: { objectCount?: number; payloadSize?: number; metadataSize?: number };
  dimensions?: { datetime?: string };
}

interface R2AccountData {
  r2OperationsAdaptiveGroups?: R2OperationRow[];
  r2StorageAdaptiveGroups?: R2StorageRow[];
}

interface R2QueryData {
  viewer?: {
    accounts?: R2AccountData[];
  };
}

interface AnalyticsSqlResponse {
  data?: Array<Record<string, unknown>>;
}

interface DailySpendAllocation {
  unitKey: string;
  lineItem: UsageLineItem;
}

const PRICING = {
  workers: {
    included_requests: 10_000_000,
    request_per_million_usd: 0.3,
    included_cpu_ms: 30_000_000,
    cpu_per_million_ms_usd: 0.02,
  },
  d1: {
    included_rows_read: 25_000_000_000,
    rows_read_per_million_usd: 0.001,
    included_rows_written: 50_000_000,
    rows_written_per_million_usd: 1,
    included_storage_gb_month: 5,
    storage_gb_month_usd: 0.75,
  },
  durable_objects: {
    included_requests: 1_000_000,
    requests_per_million_usd: 0.15,
    included_storage_gb_month: 5,
    storage_gb_month_usd: 0.2,
  },
  r2: {
    included_storage_gb_month: 10,
    storage_gb_month_usd: 0.015,
    included_class_a_operations: 1_000_000,
    class_a_per_million_usd: 4.5,
    included_class_b_operations: 10_000_000,
    class_b_per_million_usd: 0.36,
  },
  queues: {
    included_operations: 1_000_000,
    operations_per_million_usd: 0.4,
  },
} as const;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateKey(value: string | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function currentWindow(now = new Date()): {
  startDate: string;
  endDate: string;
  startDatetime: string;
  endDatetime: string;
  daysElapsed: number;
  daysInMonth: number;
} {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return {
    startDate: isoDate(start),
    endDate: isoDate(end),
    startDatetime: `${isoDate(start)}T00:00:00Z`,
    endDatetime: now.toISOString(),
    daysElapsed: now.getUTCDate(),
    daysInMonth,
  };
}

function monthProjection(
  monthToDateSpend: number,
  daysElapsed: number,
  daysInMonth: number,
): number {
  if (daysElapsed <= 0) return 0;
  return (monthToDateSpend / daysElapsed) * daysInMonth;
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function billable(quantity: number, included: number): number {
  return Math.max(0, quantity - included);
}

function item(
  label: string,
  quantity: number,
  unit: string,
  included: number,
  unitPriceUsd: number,
  unitDivisor = 1,
): UsageLineItem {
  const billableQuantity = billable(quantity, included);
  return {
    label,
    quantity,
    unit,
    included,
    billable: billableQuantity,
    unit_price_usd: unitPriceUsd,
    estimated_spend_usd: roundMoney((billableQuantity / unitDivisor) * unitPriceUsd),
  };
}

function emptyService(
  id: ServiceId,
  name: string,
  status: UsageService["status"],
  source: string,
  notes: string[],
  error?: string,
): UsageService {
  return {
    id,
    name,
    status,
    source,
    daily: [],
    line_items: [],
    month_to_date_estimated_spend_usd: 0,
    projected_month_estimated_spend_usd: 0,
    notes,
    ...(error ? { error } : {}),
  };
}

async function graphql<T>(
  env: UsageEnv,
  query: string,
  variables: Record<string, string>,
): Promise<T> {
  const token = apiToken(env);
  if (!token) throw new Error("Cloudflare analytics API token is not configured");
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as GraphqlResponse<T>;
  if (!response.ok || body.errors?.length) {
    const detail = body.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new Error(detail);
  }
  if (!body.data) throw new Error("Cloudflare GraphQL response did not include data");
  return body.data;
}

function account<T extends { viewer?: { accounts?: unknown[] } }>(data: T): unknown {
  return data.viewer?.accounts?.[0];
}

function configuredBase(env: UsageEnv): boolean {
  return Boolean(env.CLOUDFLARE_USAGE_ACCOUNT_ID && apiToken(env));
}

function apiToken(env: UsageEnv): string | undefined {
  return env.CLOUDFLARE_USAGE_API_TOKEN;
}

function analyticsDatasetIdentifier(value: string): string {
  const dataset = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dataset)) {
    throw new Error("CLOUDFLARE_USAGE_ANALYTICS_DATASET must be a valid SQL identifier");
  }
  return dataset;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function addDaily(
  map: Map<string, Record<string, number>>,
  date: string | null,
  values: Record<string, number>,
): void {
  if (!date) return;
  const row = map.get(date) ?? {};
  for (const [key, value] of Object.entries(values)) {
    row[key] = (row[key] ?? 0) + value;
  }
  map.set(date, row);
}

function dailyRows(
  map: Map<string, Record<string, number>>,
  allocations: DailySpendAllocation[],
): DailyUsage[] {
  const totalsByKey = new Map<string, number>();
  for (const units of map.values()) {
    for (const allocation of allocations) {
      totalsByKey.set(
        allocation.unitKey,
        (totalsByKey.get(allocation.unitKey) ?? 0) + (units[allocation.unitKey] ?? 0),
      );
    }
  }
  const totalBillableByKey = new Map<string, number>();
  const remainingIncludedByKey = new Map<string, number>();
  for (const allocation of allocations) {
    const totalUnits = totalsByKey.get(allocation.unitKey) ?? 0;
    totalBillableByKey.set(
      allocation.unitKey,
      Math.max(0, totalUnits - allocation.lineItem.included),
    );
    remainingIncludedByKey.set(allocation.unitKey, allocation.lineItem.included);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, units]) => {
      const estimatedSpend = allocations.reduce((sum, allocation) => {
        const unitsToday = units[allocation.unitKey] ?? 0;
        const remainingIncluded = remainingIncludedByKey.get(allocation.unitKey) ?? 0;
        const billableToday = Math.max(0, unitsToday - remainingIncluded);
        remainingIncludedByKey.set(allocation.unitKey, Math.max(0, remainingIncluded - unitsToday));
        const totalBillable = totalBillableByKey.get(allocation.unitKey) ?? 0;
        if (totalBillable <= 0 || billableToday <= 0) return sum;
        return sum + allocation.lineItem.estimated_spend_usd * (billableToday / totalBillable);
      }, 0);
      return { date, units, estimated_spend_usd: roundMoney(estimatedSpend) };
    });
}

function addStorageGbMonthDaily<T>(
  daily: Map<string, Record<string, number>>,
  rows: T[],
  dateOf: (row: T) => string | null,
  bytesOf: (row: T) => number,
  window: ReturnType<typeof currentWindow>,
): number {
  const snapshots = rows.map((row) => ({
    date: dateOf(row),
    storageGb: bytesOf(row) / 1_000_000_000,
  }));
  const totalStorageGb = snapshots.reduce((sum, row) => sum + row.storageGb, 0);
  if (snapshots.length === 0 || totalStorageGb <= 0) return 0;

  const averageDailyGb = totalStorageGb / snapshots.length;
  const storageGbMonth = (averageDailyGb * window.daysElapsed) / window.daysInMonth;
  for (const snapshot of snapshots) {
    addDaily(daily, snapshot.date, {
      storage_gb_month: storageGbMonth * (snapshot.storageGb / totalStorageGb),
    });
  }
  return storageGbMonth;
}

async function workersUsage(
  env: UsageEnv,
  window: ReturnType<typeof currentWindow>,
): Promise<UsageService> {
  if (!configuredBase(env) || !env.CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME) {
    return emptyService(
      "workers",
      "Workers",
      "not_configured",
      "Cloudflare GraphQL Analytics API",
      [
        "Set CLOUDFLARE_USAGE_ACCOUNT_ID, CLOUDFLARE_USAGE_API_TOKEN, and CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME to query Worker usage.",
      ],
    );
  }

  const query = `
    query WorkerDaily($accountTag: string!, $scriptName: string!, $start: string!, $end: string!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 10000
            filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }
            orderBy: [datetime_ASC]
          ) {
            sum { requests errors subrequests }
            quantiles { cpuTimeP50 cpuTimeP99 }
            dimensions { datetime }
          }
        }
      }
    }`;

  try {
    const data = await graphql<WorkersQueryData>(env, query, {
      accountTag: env.CLOUDFLARE_USAGE_ACCOUNT_ID!,
      scriptName: env.CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME,
      start: window.startDatetime,
      end: window.endDatetime,
    });
    const rows =
      (account(data) as WorkersAccountData | undefined)?.workersInvocationsAdaptive ?? [];
    const daily = new Map<string, Record<string, number>>();
    let requests = 0;
    let subrequests = 0;
    let errors = 0;
    let cpuMsEstimated = 0;
    for (const row of rows) {
      const rowRequests = row.sum?.requests ?? 0;
      requests += rowRequests;
      subrequests += row.sum?.subrequests ?? 0;
      errors += row.sum?.errors ?? 0;
      cpuMsEstimated += rowRequests * (row.quantiles?.cpuTimeP50 ?? 0);
      addDaily(daily, dateKey(row.dimensions?.datetime), {
        requests: rowRequests,
        cpu_ms_estimated: rowRequests * (row.quantiles?.cpuTimeP50 ?? 0),
        subrequests: row.sum?.subrequests ?? 0,
        errors: row.sum?.errors ?? 0,
      });
    }
    const requestLineItem = item(
      "Requests",
      requests,
      "requests",
      PRICING.workers.included_requests,
      PRICING.workers.request_per_million_usd,
      1_000_000,
    );
    const cpuLineItem = item(
      "Estimated CPU time",
      cpuMsEstimated,
      "ms",
      PRICING.workers.included_cpu_ms,
      PRICING.workers.cpu_per_million_ms_usd,
      1_000_000,
    );
    const lineItems = [requestLineItem, cpuLineItem];
    const spend = roundMoney(lineItems.reduce((sum, entry) => sum + entry.estimated_spend_usd, 0));
    return {
      id: "workers",
      name: "Workers",
      status: "ready",
      source: "Cloudflare GraphQL Analytics API / workersInvocationsAdaptive",
      daily: dailyRows(daily, [
        { unitKey: "requests", lineItem: requestLineItem },
        { unitKey: "cpu_ms_estimated", lineItem: cpuLineItem },
      ]),
      line_items: lineItems,
      month_to_date_estimated_spend_usd: spend,
      projected_month_estimated_spend_usd: roundMoney(
        monthProjection(spend, window.daysElapsed, window.daysInMonth),
      ),
      notes: [
        `Script: ${env.CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME}`,
        `Subrequests: ${subrequests.toLocaleString()}`,
        `Errors: ${errors.toLocaleString()}`,
        "CPU spend uses p50 CPU time multiplied by requests because the public adaptive query returns quantiles, not exact monthly CPU sum.",
      ],
    };
  } catch (error) {
    return emptyService(
      "workers",
      "Workers",
      "error",
      "Cloudflare GraphQL Analytics API / workersInvocationsAdaptive",
      [],
      error instanceof Error ? error.message : "Unknown Workers analytics error",
    );
  }
}

async function d1Usage(
  env: UsageEnv,
  window: ReturnType<typeof currentWindow>,
): Promise<UsageService> {
  if (!configuredBase(env) || !env.CLOUDFLARE_USAGE_D1_DATABASE_ID) {
    return emptyService("d1", "D1", "not_configured", "Cloudflare GraphQL Analytics API", [
      "Set CLOUDFLARE_USAGE_ACCOUNT_ID, CLOUDFLARE_USAGE_API_TOKEN, and CLOUDFLARE_USAGE_D1_DATABASE_ID to query D1 usage.",
    ]);
  }

  const query = `
    query D1Daily($accountTag: string!, $databaseId: string!, $start: Date, $end: Date) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1AnalyticsAdaptiveGroups(
            limit: 10000
            filter: { databaseId: $databaseId, date_geq: $start, date_leq: $end }
            orderBy: [date_ASC]
          ) {
            sum { readQueries writeQueries rowsRead rowsWritten }
            dimensions { date }
          }
          d1StorageAdaptiveGroups(
            limit: 10000
            filter: { databaseId: $databaseId, date_geq: $start, date_leq: $end }
            orderBy: [date_ASC]
          ) {
            max { databaseSizeBytes }
            dimensions { date }
          }
        }
      }
    }`;

  try {
    const data = await graphql<D1QueryData>(env, query, {
      accountTag: env.CLOUDFLARE_USAGE_ACCOUNT_ID!,
      databaseId: env.CLOUDFLARE_USAGE_D1_DATABASE_ID,
      start: window.startDate,
      end: window.endDate,
    });
    const accountData = account(data) as D1AccountData | undefined;
    const analyticsRows = accountData?.d1AnalyticsAdaptiveGroups ?? [];
    const storageRows = accountData?.d1StorageAdaptiveGroups ?? [];
    const daily = new Map<string, Record<string, number>>();
    let rowsRead = 0;
    let rowsWritten = 0;
    let readQueries = 0;
    let writeQueries = 0;
    for (const row of analyticsRows) {
      const date = row.dimensions?.date ?? null;
      rowsRead += row.sum?.rowsRead ?? 0;
      rowsWritten += row.sum?.rowsWritten ?? 0;
      readQueries += row.sum?.readQueries ?? 0;
      writeQueries += row.sum?.writeQueries ?? 0;
      addDaily(daily, date, {
        rows_read: row.sum?.rowsRead ?? 0,
        rows_written: row.sum?.rowsWritten ?? 0,
        read_queries: row.sum?.readQueries ?? 0,
        write_queries: row.sum?.writeQueries ?? 0,
      });
    }
    const storageGbMonth = addStorageGbMonthDaily(
      daily,
      storageRows,
      (row) => row.dimensions?.date ?? null,
      (row) => row.max?.databaseSizeBytes ?? 0,
      window,
    );
    const rowsReadLineItem = item(
      "Rows read",
      rowsRead,
      "rows",
      PRICING.d1.included_rows_read,
      PRICING.d1.rows_read_per_million_usd,
      1_000_000,
    );
    const rowsWrittenLineItem = item(
      "Rows written",
      rowsWritten,
      "rows",
      PRICING.d1.included_rows_written,
      PRICING.d1.rows_written_per_million_usd,
      1_000_000,
    );
    const storageLineItem = item(
      "Storage",
      storageGbMonth,
      "GB-month",
      PRICING.d1.included_storage_gb_month,
      PRICING.d1.storage_gb_month_usd,
    );
    const lineItems = [rowsReadLineItem, rowsWrittenLineItem, storageLineItem];
    const spend = roundMoney(lineItems.reduce((sum, entry) => sum + entry.estimated_spend_usd, 0));
    return {
      id: "d1",
      name: "D1",
      status: "ready",
      source:
        "Cloudflare GraphQL Analytics API / d1AnalyticsAdaptiveGroups + d1StorageAdaptiveGroups",
      daily: dailyRows(daily, [
        { unitKey: "rows_read", lineItem: rowsReadLineItem },
        { unitKey: "rows_written", lineItem: rowsWrittenLineItem },
        { unitKey: "storage_gb_month", lineItem: storageLineItem },
      ]),
      line_items: lineItems,
      month_to_date_estimated_spend_usd: spend,
      projected_month_estimated_spend_usd: roundMoney(
        monthProjection(spend, window.daysElapsed, window.daysInMonth),
      ),
      notes: [
        `Database id: ${env.CLOUDFLARE_USAGE_D1_DATABASE_ID}`,
        `Read queries: ${readQueries.toLocaleString()}`,
        `Write queries: ${writeQueries.toLocaleString()}`,
      ],
    };
  } catch (error) {
    return emptyService(
      "d1",
      "D1",
      "error",
      "Cloudflare GraphQL Analytics API / D1 datasets",
      [],
      error instanceof Error ? error.message : "Unknown D1 analytics error",
    );
  }
}

async function durableObjectUsage(
  env: UsageEnv,
  window: ReturnType<typeof currentWindow>,
): Promise<UsageService> {
  if (!configuredBase(env)) {
    return emptyService(
      "durable_objects",
      "Durable Objects",
      "not_configured",
      "Cloudflare GraphQL Analytics API",
      [
        "Set CLOUDFLARE_USAGE_ACCOUNT_ID and CLOUDFLARE_USAGE_API_TOKEN to query Durable Object namespace usage.",
      ],
    );
  }

  const query = `
    query DurableObjectDaily($accountTag: string!, $start: Date, $end: Date) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          durableObjectsInvocationsAdaptiveGroups(
            limit: 10000
            filter: { date_geq: $start, date_leq: $end }
            orderBy: [date_ASC]
          ) {
            sum { requests responseBodySize }
            dimensions { date }
          }
          durableObjectsStorageGroups(
            limit: 10000
            filter: { date_geq: $start, date_leq: $end }
            orderBy: [date_ASC]
          ) {
            max { storedBytes }
            dimensions { date }
          }
        }
      }
    }`;

  try {
    const data = await graphql<DurableObjectQueryData>(env, query, {
      accountTag: env.CLOUDFLARE_USAGE_ACCOUNT_ID!,
      start: window.startDate,
      end: window.endDate,
    });
    const accountData = account(data) as DurableObjectAccountData | undefined;
    const invocationRows = accountData?.durableObjectsInvocationsAdaptiveGroups ?? [];
    const storageRows = accountData?.durableObjectsStorageGroups ?? [];
    const daily = new Map<string, Record<string, number>>();
    let requests = 0;
    let responseBytes = 0;
    for (const row of invocationRows) {
      requests += row.sum?.requests ?? 0;
      responseBytes += row.sum?.responseBodySize ?? 0;
      addDaily(daily, row.dimensions?.date ?? null, {
        requests: row.sum?.requests ?? 0,
        response_bytes: row.sum?.responseBodySize ?? 0,
      });
    }
    const storageGbMonth = addStorageGbMonthDaily(
      daily,
      storageRows,
      (row) => row.dimensions?.date ?? null,
      (row) => row.max?.storedBytes ?? 0,
      window,
    );
    const requestLineItem = item(
      "Requests",
      requests,
      "requests",
      PRICING.durable_objects.included_requests,
      PRICING.durable_objects.requests_per_million_usd,
      1_000_000,
    );
    const storageLineItem = item(
      "Stored data",
      storageGbMonth,
      "GB-month",
      PRICING.durable_objects.included_storage_gb_month,
      PRICING.durable_objects.storage_gb_month_usd,
    );
    const lineItems = [requestLineItem, storageLineItem];
    const spend = roundMoney(lineItems.reduce((sum, entry) => sum + entry.estimated_spend_usd, 0));
    return {
      id: "durable_objects",
      name: "Durable Objects",
      status: "ready",
      source:
        "Cloudflare GraphQL Analytics API / durableObjectsInvocationsAdaptiveGroups + durableObjectsStorageGroups",
      daily: dailyRows(daily, [
        { unitKey: "requests", lineItem: requestLineItem },
        { unitKey: "storage_gb_month", lineItem: storageLineItem },
      ]),
      line_items: lineItems,
      month_to_date_estimated_spend_usd: spend,
      projected_month_estimated_spend_usd: roundMoney(
        monthProjection(spend, window.daysElapsed, window.daysInMonth),
      ),
      notes: [
        `Response bytes: ${responseBytes.toLocaleString()}`,
        "Compute duration is not included in this first estimate because the query needs exact duration/GB-second data, not CPU time.",
      ],
    };
  } catch (error) {
    return emptyService(
      "durable_objects",
      "Durable Objects",
      "error",
      "Cloudflare GraphQL Analytics API / Durable Object datasets",
      [],
      error instanceof Error ? error.message : "Unknown Durable Objects analytics error",
    );
  }
}

function classifyR2Operation(actionType: string | undefined): "class_a" | "class_b" {
  const value = (actionType ?? "").toLowerCase();
  if (
    value.includes("put") ||
    value.includes("post") ||
    value.includes("copy") ||
    value.includes("list")
  ) {
    return "class_a";
  }
  return "class_b";
}

async function r2Usage(
  env: UsageEnv,
  window: ReturnType<typeof currentWindow>,
): Promise<UsageService> {
  if (!configuredBase(env) || !env.CLOUDFLARE_USAGE_R2_BUCKET_NAME) {
    return emptyService("r2", "R2", "not_configured", "Cloudflare GraphQL Analytics API", [
      "Set CLOUDFLARE_USAGE_ACCOUNT_ID, CLOUDFLARE_USAGE_API_TOKEN, and CLOUDFLARE_USAGE_R2_BUCKET_NAME to query R2 usage.",
    ]);
  }

  const query = `
    query R2Daily($accountTag: string!, $bucketName: string!, $start: Time, $end: Time) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 10000
            filter: { bucketName: $bucketName, datetime_geq: $start, datetime_leq: $end }
            orderBy: [datetime_ASC]
          ) {
            sum { requests responseObjectSize }
            dimensions { datetime actionType }
          }
          r2StorageAdaptiveGroups(
            limit: 10000
            filter: { bucketName: $bucketName, datetime_geq: $start, datetime_leq: $end }
            orderBy: [datetime_ASC]
          ) {
            max { objectCount payloadSize metadataSize }
            dimensions { datetime }
          }
        }
      }
    }`;

  try {
    const data = await graphql<R2QueryData>(env, query, {
      accountTag: env.CLOUDFLARE_USAGE_ACCOUNT_ID!,
      bucketName: env.CLOUDFLARE_USAGE_R2_BUCKET_NAME,
      start: window.startDatetime,
      end: window.endDatetime,
    });
    const accountData = account(data) as R2AccountData | undefined;
    const operationRows = accountData?.r2OperationsAdaptiveGroups ?? [];
    const storageRows = accountData?.r2StorageAdaptiveGroups ?? [];
    const daily = new Map<string, Record<string, number>>();
    let classA = 0;
    let classB = 0;
    let responseBytes = 0;
    for (const row of operationRows) {
      const requests = row.sum?.requests ?? 0;
      const key = classifyR2Operation(row.dimensions?.actionType);
      if (key === "class_a") classA += requests;
      else classB += requests;
      responseBytes += row.sum?.responseObjectSize ?? 0;
      addDaily(daily, dateKey(row.dimensions?.datetime), {
        [key]: requests,
        response_bytes: row.sum?.responseObjectSize ?? 0,
      });
    }
    const objectCount = storageRows.reduce(
      (max, row) => Math.max(max, row.max?.objectCount ?? 0),
      0,
    );
    const storageGbMonth = addStorageGbMonthDaily(
      daily,
      storageRows,
      (row) => dateKey(row.dimensions?.datetime),
      (row) => (row.max?.payloadSize ?? 0) + (row.max?.metadataSize ?? 0),
      window,
    );
    const storageLineItem = item(
      "Storage",
      storageGbMonth,
      "GB-month",
      PRICING.r2.included_storage_gb_month,
      PRICING.r2.storage_gb_month_usd,
    );
    const classALineItem = item(
      "Class A operations",
      classA,
      "operations",
      PRICING.r2.included_class_a_operations,
      PRICING.r2.class_a_per_million_usd,
      1_000_000,
    );
    const classBLineItem = item(
      "Class B operations",
      classB,
      "operations",
      PRICING.r2.included_class_b_operations,
      PRICING.r2.class_b_per_million_usd,
      1_000_000,
    );
    const lineItems = [storageLineItem, classALineItem, classBLineItem];
    const spend = roundMoney(lineItems.reduce((sum, entry) => sum + entry.estimated_spend_usd, 0));
    return {
      id: "r2",
      name: "R2",
      status: "ready",
      source:
        "Cloudflare GraphQL Analytics API / r2OperationsAdaptiveGroups + r2StorageAdaptiveGroups",
      daily: dailyRows(daily, [
        { unitKey: "storage_gb_month", lineItem: storageLineItem },
        { unitKey: "class_a", lineItem: classALineItem },
        { unitKey: "class_b", lineItem: classBLineItem },
      ]),
      line_items: lineItems,
      month_to_date_estimated_spend_usd: spend,
      projected_month_estimated_spend_usd: roundMoney(
        monthProjection(spend, window.daysElapsed, window.daysInMonth),
      ),
      notes: [
        `Bucket: ${env.CLOUDFLARE_USAGE_R2_BUCKET_NAME}`,
        `Objects: ${objectCount.toLocaleString()}`,
        `Response bytes: ${responseBytes.toLocaleString()}`,
        "R2 operation class mapping is inferred from GraphQL actionType names.",
      ],
    };
  } catch (error) {
    return emptyService(
      "r2",
      "R2",
      "error",
      "Cloudflare GraphQL Analytics API / R2 datasets",
      [],
      error instanceof Error ? error.message : "Unknown R2 analytics error",
    );
  }
}

async function queuesUsage(
  env: UsageEnv,
  window: ReturnType<typeof currentWindow>,
): Promise<UsageService> {
  if (!configuredBase(env) || !env.CLOUDFLARE_USAGE_ANALYTICS_DATASET) {
    return emptyService("queues", "Queues", "not_configured", "Workers Analytics Engine SQL API", [
      "Set CLOUDFLARE_USAGE_ACCOUNT_ID, CLOUDFLARE_USAGE_API_TOKEN, and CLOUDFLARE_USAGE_ANALYTICS_DATASET to estimate Queue usage from consumed event datapoints.",
    ]);
  }

  try {
    const token = apiToken(env);
    if (!token) throw new Error("Cloudflare analytics API token is not configured");
    const dataset = analyticsDatasetIdentifier(env.CLOUDFLARE_USAGE_ANALYTICS_DATASET);
    const sql = `
      SELECT
        toDate(timestamp) AS date,
        sum(_sample_interval) AS events
      FROM ${dataset}
      WHERE timestamp >= ${sqlStringLiteral(window.startDatetime)}
        AND timestamp <= ${sqlStringLiteral(window.endDatetime)}
      GROUP BY date
      ORDER BY date
      FORMAT JSON`;
    const response = await fetch(
      `${SQL_API_BASE}/${env.CLOUDFLARE_USAGE_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        body: sql,
      },
    );
    const body = (await response.json()) as AnalyticsSqlResponse;
    if (!response.ok) throw new Error(response.statusText);
    const daily = new Map<string, Record<string, number>>();
    let events = 0;
    for (const row of body.data ?? []) {
      const date = typeof row["date"] === "string" ? row["date"] : null;
      const value = typeof row["events"] === "number" ? row["events"] : Number(row["events"] ?? 0);
      events += Number.isFinite(value) ? value : 0;
      addDaily(daily, date, { events: value, estimated_queue_operations: value * 3 });
    }
    const estimatedOperations = events * 3;
    const operationLineItem = item(
      "Estimated Queue operations",
      estimatedOperations,
      "operations",
      PRICING.queues.included_operations,
      PRICING.queues.operations_per_million_usd,
      1_000_000,
    );
    const lineItems = [operationLineItem];
    const spend = roundMoney(lineItems.reduce((sum, entry) => sum + entry.estimated_spend_usd, 0));
    return {
      id: "queues",
      name: "Queues",
      status: "ready",
      source: "Workers Analytics Engine SQL API / FP_ANALYTICS consumed event datapoints",
      daily: dailyRows(daily, [
        { unitKey: "estimated_queue_operations", lineItem: operationLineItem },
      ]),
      line_items: lineItems,
      month_to_date_estimated_spend_usd: spend,
      projected_month_estimated_spend_usd: roundMoney(
        monthProjection(spend, window.daysElapsed, window.daysInMonth),
      ),
      notes: [
        `Dataset: ${env.CLOUDFLARE_USAGE_ANALYTICS_DATASET}`,
        "Queue operations are estimated as one write, one read, and one delete per consumed event.",
      ],
    };
  } catch (error) {
    return emptyService(
      "queues",
      "Queues",
      "error",
      "Workers Analytics Engine SQL API",
      [],
      error instanceof Error ? error.message : "Unknown Analytics Engine SQL error",
    );
  }
}

export async function buildCloudflareUsage(
  env: Env,
  now = new Date(),
): Promise<CloudflareUsageResponse> {
  const usageEnv = env as UsageEnv;
  const window = currentWindow(now);
  const services = await Promise.all([
    workersUsage(usageEnv, window),
    durableObjectUsage(usageEnv, window),
    d1Usage(usageEnv, window),
    r2Usage(usageEnv, window),
    queuesUsage(usageEnv, window),
  ]);
  const monthToDate = roundMoney(
    services.reduce((sum, service) => sum + service.month_to_date_estimated_spend_usd, 0),
  );
  const projectedMonth = roundMoney(
    services.reduce((sum, service) => sum + service.projected_month_estimated_spend_usd, 0),
  );
  const requiredEnv = [
    "CLOUDFLARE_USAGE_ACCOUNT_ID",
    "CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME",
    "CLOUDFLARE_USAGE_D1_DATABASE_ID",
    "CLOUDFLARE_USAGE_R2_BUCKET_NAME",
    "CLOUDFLARE_USAGE_ANALYTICS_DATASET",
  ].filter((key) => !usageEnv[key as keyof UsageEnv]);
  if (!apiToken(usageEnv)) {
    requiredEnv.unshift("CLOUDFLARE_USAGE_API_TOKEN");
  }

  return {
    configured: requiredEnv.length === 0,
    currency: "USD",
    generated_at: now.toISOString(),
    window: {
      start_date: window.startDate,
      end_date: window.endDate,
      days_elapsed: window.daysElapsed,
      days_in_month: window.daysInMonth,
    },
    pricing: {
      source:
        "Cloudflare public pricing pages as of 2026-04-29; estimates apply included usage before billable units.",
      notes: [
        "This endpoint estimates spend from usage metrics instead of reading Cloudflare billing totals.",
        "Usage inside free-tier allowances correctly appears as $0 estimated spend.",
        "Cloudflare Billing Usage API is lagging and may omit in-free-tier usage, so it is not used for projections.",
      ],
    },
    required_env: requiredEnv,
    services,
    month_to_date_estimated_spend_usd: monthToDate,
    projected_month_estimated_spend_usd: projectedMonth,
  };
}
