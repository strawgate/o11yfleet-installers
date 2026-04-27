// Queue Event Consumer
// Batch D1 upserts to agent_summaries
// Idempotent: duplicate events harmless

import type { AnyFleetEvent } from "@o11yfleet/core/events";
import { FleetEventType } from "@o11yfleet/core/events";

export interface ConsumerEnv {
  FP_DB: D1Database;
  FP_ANALYTICS: AnalyticsEngineDataset;
}

export async function handleQueueBatch(
  batch: MessageBatch<AnyFleetEvent>,
  env: ConsumerEnv,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];

  for (const message of batch.messages) {
    const event = message.body;
    const stmt = eventToStatement(env.FP_DB, event);
    if (stmt) {
      statements.push(stmt);
    }

    // Write analytics datapoint
    try {
      env.FP_ANALYTICS.writeDataPoint({
        blobs: [event.type, event.tenant_id, event.config_id, event.instance_uid],
        doubles: [event.timestamp],
        indexes: [event.tenant_id],
      });
    } catch {
      // Analytics write failure should never block event processing
    }
  }

  if (statements.length > 0) {
    // Batch execute all statements
    await env.FP_DB.batch(statements);
  }

  // ACK all messages (implicit on success)
}

function eventToStatement(
  db: D1Database,
  event: AnyFleetEvent,
): D1PreparedStatement | null {
  switch (event.type) {
    case FleetEventType.AGENT_CONNECTED:
      return db
        .prepare(
          `INSERT INTO agent_summaries (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at, created_at, updated_at)
           VALUES (?, ?, ?, 'connected', 1, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
           ON CONFLICT(instance_uid) DO UPDATE SET
             status = 'connected',
             last_seen_at = datetime('now'),
             connected_at = datetime('now'),
             updated_at = datetime('now')`,
        )
        .bind(event.instance_uid, event.tenant_id, event.config_id);

    case FleetEventType.AGENT_DISCONNECTED:
      return db
        .prepare(
          `UPDATE agent_summaries SET
             status = 'disconnected',
             disconnected_at = datetime('now'),
             updated_at = datetime('now')
           WHERE instance_uid = ?`,
        )
        .bind(event.instance_uid);

    case FleetEventType.AGENT_HEALTH_CHANGED:
      return db
        .prepare(
          `UPDATE agent_summaries SET
             healthy = ?,
             last_seen_at = datetime('now'),
             updated_at = datetime('now')
           WHERE instance_uid = ?`,
        )
        .bind(event.healthy ? 1 : 0, event.instance_uid);

    case FleetEventType.CONFIG_APPLIED:
      return db
        .prepare(
          `UPDATE agent_summaries SET
             current_config_hash = ?,
             last_seen_at = datetime('now'),
             updated_at = datetime('now')
           WHERE instance_uid = ?`,
        )
        .bind(event.config_hash, event.instance_uid);

    case FleetEventType.CONFIG_REJECTED:
      return db
        .prepare(
          `UPDATE agent_summaries SET
             last_seen_at = datetime('now'),
             updated_at = datetime('now')
           WHERE instance_uid = ?`,
        )
        .bind(event.instance_uid);

    case FleetEventType.AGENT_ENROLLED:
      return db
        .prepare(
          `INSERT INTO agent_summaries (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, created_at, updated_at)
           VALUES (?, ?, ?, 'connected', 1, datetime('now'), datetime('now'), datetime('now'))
           ON CONFLICT(instance_uid) DO UPDATE SET
             status = 'connected',
             last_seen_at = datetime('now'),
             updated_at = datetime('now')`,
        )
        .bind(event.instance_uid, event.tenant_id, event.config_id);

    default:
      return null;
  }
}
