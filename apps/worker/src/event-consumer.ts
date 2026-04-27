// Queue Event Consumer
// Analytics-only: writes datapoints to Analytics Engine
// D1 agent_summaries removed — DO SQLite is the source of truth for agent state

import type { AnyFleetEvent } from "@o11yfleet/core/events";

export interface ConsumerEnv {
  FP_ANALYTICS: AnalyticsEngineDataset;
}

export async function handleQueueBatch(
  batch: MessageBatch<AnyFleetEvent>,
  env: ConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const event = message.body;

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

  // ACK all messages (implicit on success)
}
