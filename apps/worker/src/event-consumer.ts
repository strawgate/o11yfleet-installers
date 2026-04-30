// Queue Event Consumer
// Analytics-only: writes datapoints to Analytics Engine
// D1 agent_summaries removed — DO SQLite is the source of truth for agent state

import type { AnyFleetEvent } from "@o11yfleet/core/events";

export interface ConsumerEnv {
  FP_ANALYTICS?: AnalyticsEngineDataset;
}

const ANALYTICS_BLOB_MAX_CHARS = 4096;

function analyticsBlob(value: string | undefined): string {
  if (!value) return "";
  return value.length > ANALYTICS_BLOB_MAX_CHARS ? value.slice(0, ANALYTICS_BLOB_MAX_CHARS) : value;
}

export async function handleQueueBatch(
  batch: MessageBatch<AnyFleetEvent>,
  env: ConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const event = message.body;

    // Write analytics datapoint (best-effort/lossy):
    // - queue messages are ACKed even when analytics writes fail,
    // - event identity is preserved in message.body for downstream consumers.
    try {
      env.FP_ANALYTICS?.writeDataPoint({
        blobs: [
          analyticsBlob(event.type),
          analyticsBlob(event.tenant_id),
          analyticsBlob(event.config_id),
          analyticsBlob(event.instance_uid),
          analyticsBlob(event.event_id),
          analyticsBlob(event.dedupe_key),
        ],
        doubles: [event.timestamp],
        indexes: [event.tenant_id],
      });
    } catch {
      // Analytics write failure should never block event processing
    }
  }

  // ACK all messages (implicit on success)
}
