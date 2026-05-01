/**
 * Fleet Metrics - Analytics Engine column constants
 *
 * Analytics Engine exposes raw column names as double1, double2, ..., blob1, blob2, ...
 * This file is the single source of truth for which metric lives in which column.
 *
 * Usage:
 *   const sql = latestSnapshotForTenant(tenantId);
 *   // or build custom queries using FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENT_COUNT, etc.
 */

export const FLEET_CONFIG_SNAPSHOT_BLOBS = {
  TENANT_ID: "blob1",
  CONFIG_ID: "blob2",
  INTERVAL: "blob3",
} as const;

export const FLEET_CONFIG_SNAPSHOT_INTERVAL = "activity";
export const FLEET_CURRENT_SNAPSHOT_MAX_AGE_DAYS = 7;

export const FLEET_CONFIG_SNAPSHOT_DOUBLES = {
  AGENT_COUNT: "double1",
  CONNECTED_COUNT: "double2",
  DISCONNECTED_COUNT: "double3",
  HEALTHY_COUNT: "double4",
  UNHEALTHY_COUNT: "double5",
  CONNECTED_HEALTHY_COUNT: "double6",
  CONFIG_UP_TO_DATE: "double7",
  CONFIG_PENDING: "double8",
  AGENTS_WITH_ERRORS: "double9",
  AGENTS_STALE: "double10",
  WEBSOCKET_COUNT: "double11",
} as const;

export type FleetConfigSnapshotBlob =
  (typeof FLEET_CONFIG_SNAPSHOT_BLOBS)[keyof typeof FLEET_CONFIG_SNAPSHOT_BLOBS];
export type FleetConfigSnapshotDouble =
  (typeof FLEET_CONFIG_SNAPSHOT_DOUBLES)[keyof typeof FLEET_CONFIG_SNAPSHOT_DOUBLES];

/**
 * Column list for config snapshot metrics - used in SELECT clauses.
 */
export const FLEET_CONFIG_SNAPSHOT_COLUMNS = `
  ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID}  AS tenant_id,
  ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID}  AS config_id,
  ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL}   AS interval,
  timestamp,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENT_COUNT}             AS agent_count,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_COUNT}         AS connected_count,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.DISCONNECTED_COUNT}      AS disconnected_count,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.HEALTHY_COUNT}           AS healthy_count,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.UNHEALTHY_COUNT}         AS unhealthy_count,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_HEALTHY_COUNT} AS connected_healthy_count,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_UP_TO_DATE}       AS config_up_to_date,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_PENDING}          AS config_pending,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_WITH_ERRORS}     AS agents_with_errors,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_STALE}            AS agents_stale,
  ${FLEET_CONFIG_SNAPSHOT_DOUBLES.WEBSOCKET_COUNT}         AS websocket_count
`;

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function boundedInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Latest activity-driven snapshot for all configs of a tenant.
 */
export function latestSnapshotForTenant(
  tenantId: string,
  maxAgeDays = FLEET_CURRENT_SNAPSHOT_MAX_AGE_DAYS,
): string {
  const tenant = sqlStringLiteral(tenantId);
  const windowDays = boundedInteger("maxAgeDays", maxAgeDays, 1, 90);
  return `
    SELECT
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} AS tenant_id,
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} AS config_id,
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} AS interval,
      max(timestamp) AS timestamp,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENT_COUNT}, timestamp) AS agent_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_COUNT}, timestamp) AS connected_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.DISCONNECTED_COUNT}, timestamp) AS disconnected_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.HEALTHY_COUNT}, timestamp) AS healthy_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.UNHEALTHY_COUNT}, timestamp) AS unhealthy_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_HEALTHY_COUNT}, timestamp) AS connected_healthy_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_UP_TO_DATE}, timestamp) AS config_up_to_date,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_PENDING}, timestamp) AS config_pending,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_WITH_ERRORS}, timestamp) AS agents_with_errors,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_STALE}, timestamp) AS agents_stale,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.WEBSOCKET_COUNT}, timestamp) AS websocket_count
    FROM fleet_metrics
    WHERE ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} = ${tenant}
      AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} = '${FLEET_CONFIG_SNAPSHOT_INTERVAL}'
      AND timestamp >= NOW() - INTERVAL '${windowDays}' DAY
    GROUP BY
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID},
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID},
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL}
    ORDER BY ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} ASC
  `;
}

/**
 * Latest activity-driven snapshot for every config in every tenant.
 */
export function latestSnapshotsForAllTenants(
  maxAgeDays = FLEET_CURRENT_SNAPSHOT_MAX_AGE_DAYS,
): string {
  const windowDays = boundedInteger("maxAgeDays", maxAgeDays, 1, 90);
  return `
    SELECT
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} AS tenant_id,
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} AS config_id,
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} AS interval,
      max(timestamp) AS timestamp,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENT_COUNT}, timestamp) AS agent_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_COUNT}, timestamp) AS connected_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.DISCONNECTED_COUNT}, timestamp) AS disconnected_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.HEALTHY_COUNT}, timestamp) AS healthy_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.UNHEALTHY_COUNT}, timestamp) AS unhealthy_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_HEALTHY_COUNT}, timestamp) AS connected_healthy_count,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_UP_TO_DATE}, timestamp) AS config_up_to_date,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_PENDING}, timestamp) AS config_pending,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_WITH_ERRORS}, timestamp) AS agents_with_errors,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_STALE}, timestamp) AS agents_stale,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.WEBSOCKET_COUNT}, timestamp) AS websocket_count
    FROM fleet_metrics
    WHERE ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} = '${FLEET_CONFIG_SNAPSHOT_INTERVAL}'
      AND timestamp >= NOW() - INTERVAL '${windowDays}' DAY
    GROUP BY
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID},
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID},
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL}
    ORDER BY ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} ASC, ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} ASC
  `;
}

/**
 * Current fleet counters across the latest snapshot for every config.
 */
export function currentFleetSummary(): string {
  return `
    WITH latest AS (${latestSnapshotsForAllTenants()})
    SELECT
      sum(agent_count) AS total_agents,
      sum(connected_count) AS connected_agents,
      sum(disconnected_count) AS disconnected_agents,
      sum(healthy_count) AS healthy_agents,
      sum(unhealthy_count) AS unhealthy_agents,
      sum(agents_stale) AS stale_agents,
      countIf(agent_count > 0) AS configurations_with_agents,
      max(timestamp) AS latest_snapshot_at
    FROM latest
  `;
}

/**
 * Current fleet counters per tenant across each config's latest snapshot.
 */
export function currentFleetSummaryByTenant(): string {
  return `
    WITH latest AS (${latestSnapshotsForAllTenants()})
    SELECT
      tenant_id,
      sum(agent_count) AS agent_count,
      sum(connected_count) AS connected_agents,
      sum(healthy_count) AS healthy_agents,
      countIf(agent_count > 0) AS configurations_with_agents,
      max(timestamp) AS latest_snapshot_at
    FROM latest
    GROUP BY tenant_id
    ORDER BY tenant_id ASC
  `;
}

/**
 * Latest activity-driven snapshot for a specific config.
 */
export function latestSnapshotForConfig(tenantId: string, configId: string): string {
  const tenant = sqlStringLiteral(tenantId);
  const config = sqlStringLiteral(configId);
  return `
    SELECT ${FLEET_CONFIG_SNAPSHOT_COLUMNS}
    FROM fleet_metrics
    WHERE ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} = ${tenant}
      AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} = ${config}
      AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} = '${FLEET_CONFIG_SNAPSHOT_INTERVAL}'
    ORDER BY timestamp DESC
    LIMIT 1
  `;
}

/**
 * Time series of activity-driven snapshots for a config over N days.
 */
export function configHistory(tenantId: string, configId: string, days: number): string {
  const tenant = sqlStringLiteral(tenantId);
  const config = sqlStringLiteral(configId);
  const windowDays = boundedInteger("days", days, 1, 90);
  return `
    SELECT ${FLEET_CONFIG_SNAPSHOT_COLUMNS}
    FROM fleet_metrics
    WHERE ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} = ${tenant}
      AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} = ${config}
      AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} = '${FLEET_CONFIG_SNAPSHOT_INTERVAL}'
      AND timestamp >= NOW() - INTERVAL '${windowDays}' DAY
    ORDER BY timestamp ASC
  `;
}

/**
 * Aggregated stats across all configs for a tenant, bucketed hourly.
 */
export function tenantAggregatedHistory(tenantId: string, days: number): string {
  const tenant = sqlStringLiteral(tenantId);
  const windowDays = boundedInteger("days", days, 1, 90);
  return `
    WITH tenant_snapshots AS (
      SELECT
        timestamp,
        sum(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENT_COUNT})         AS total_agents,
        sum(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_COUNT})     AS connected,
        sum(${FLEET_CONFIG_SNAPSHOT_DOUBLES.HEALTHY_COUNT})       AS healthy,
        sum(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_WITH_ERRORS})  AS errors
      FROM fleet_metrics
      WHERE ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} = ${tenant}
        AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} = '${FLEET_CONFIG_SNAPSHOT_INTERVAL}'
        AND timestamp >= NOW() - INTERVAL '${windowDays}' DAY
      GROUP BY timestamp
    )
    SELECT
      toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS t,
      max(total_agents)                            AS total_agents,
      argMax(connected, timestamp)                 AS latest_connected,
      max(connected)                               AS peak_connected,
      argMax(healthy, timestamp)                   AS latest_healthy,
      max(errors)                                  AS peak_errors,
      count()                                      AS snapshot_count
    FROM tenant_snapshots
    GROUP BY t
    ORDER BY t ASC
  `;
}

/**
 * Summary row: current values + min/max over the history window.
 */
export function configSummary(tenantId: string, configId: string, days: number): string {
  const tenant = sqlStringLiteral(tenantId);
  const config = sqlStringLiteral(configId);
  const windowDays = boundedInteger("days", days, 1, 90);
  return `
    SELECT
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} AS config_id,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENT_COUNT}, timestamp)             AS current_agents,
      min(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENT_COUNT})             AS min_agents,
      max(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENT_COUNT})             AS max_agents,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_COUNT}, timestamp)         AS current_connected,
      max(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONNECTED_COUNT})         AS peak_connected,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.HEALTHY_COUNT}, timestamp)           AS current_healthy,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_WITH_ERRORS}, timestamp)     AS current_errors,
      max(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_WITH_ERRORS})     AS peak_errors,
      argMax(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_UP_TO_DATE}, timestamp)       AS current_config_sync,
      min(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_PENDING})          AS min_pending,
      max(${FLEET_CONFIG_SNAPSHOT_DOUBLES.CONFIG_PENDING})          AS max_pending,
      count() AS snapshot_count
    FROM fleet_metrics
    WHERE ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} = ${tenant}
      AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} = ${config}
      AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} = '${FLEET_CONFIG_SNAPSHOT_INTERVAL}'
      AND timestamp >= NOW() - INTERVAL '${windowDays}' DAY
    GROUP BY ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID}
  `;
}

/**
 * Configs sorted by disconnection count - for support triage.
 */
export function configsWithMostDisconnections(tenantId: string, days: number, limit = 5): string {
  const tenant = sqlStringLiteral(tenantId);
  const windowDays = boundedInteger("days", days, 1, 90);
  const resultLimit = boundedInteger("limit", limit, 1, 100);
  return `
    SELECT
      ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID} AS config_id,
      max(${FLEET_CONFIG_SNAPSHOT_DOUBLES.DISCONNECTED_COUNT}) AS max_disconnected,
      max(${FLEET_CONFIG_SNAPSHOT_DOUBLES.AGENTS_STALE})       AS max_stale,
      count()                                     AS snapshot_count
    FROM fleet_metrics
    WHERE ${FLEET_CONFIG_SNAPSHOT_BLOBS.TENANT_ID} = ${tenant}
      AND ${FLEET_CONFIG_SNAPSHOT_BLOBS.INTERVAL} = '${FLEET_CONFIG_SNAPSHOT_INTERVAL}'
      AND timestamp >= NOW() - INTERVAL '${windowDays}' DAY
    GROUP BY ${FLEET_CONFIG_SNAPSHOT_BLOBS.CONFIG_ID}
    ORDER BY max_disconnected DESC
    LIMIT ${resultLimit}
  `;
}
