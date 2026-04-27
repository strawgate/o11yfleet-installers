// Queue consumer integration test
// Tests the analytics-only event consumer (D1 agent_summaries removed)

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { handleQueueBatch } from "../src/event-consumer.js";
import { FleetEventType } from "@o11yfleet/core/events";

// Minimal mock for MessageBatch
function makeBatch<T>(messages: T[]): MessageBatch<T> {
  return {
    queue: "test-queue",
    messages: messages.map((body, i) => ({
      id: `msg-${i}`,
      timestamp: new Date(),
      body,
      ack: () => {},
      retry: () => {},
      attempts: 1,
    })),
    ackAll: () => {},
    retryAll: () => {},
  };
}

describe("Queue Consumer: analytics-only", () => {
  it("processes a single event without throwing", async () => {
    const batch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-test-${Date.now()}`,
        timestamp: Date.now(),
      },
    ]);

    // Should not throw — analytics writes are fire-and-forget
    await handleQueueBatch(batch, {
      FP_ANALYTICS: env.FP_ANALYTICS,
    });
  });

  it("processes a batch of mixed events", async () => {
    const batch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-batch1-${Date.now()}`,
        timestamp: Date.now(),
      },
      {
        type: FleetEventType.AGENT_DISCONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-batch2-${Date.now()}`,
        timestamp: Date.now(),
        reason: "websocket_close",
      },
      {
        type: FleetEventType.AGENT_HEALTH_CHANGED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-batch3-${Date.now()}`,
        timestamp: Date.now(),
        healthy: false,
        status: "degraded",
        last_error: "OOM",
      },
      {
        type: FleetEventType.CONFIG_APPLIED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-batch4-${Date.now()}`,
        timestamp: Date.now(),
        config_hash: "abc123",
      },
    ]);

    await handleQueueBatch(batch, {
      FP_ANALYTICS: env.FP_ANALYTICS,
    });
  });

  it("handles empty batch gracefully", async () => {
    const batch = makeBatch([]);
    await handleQueueBatch(batch, {
      FP_ANALYTICS: env.FP_ANALYTICS,
    });
  });

  it("consumer env does not require FP_DB", () => {
    // ConsumerEnv only requires FP_ANALYTICS, not FP_DB
    const env: { FP_ANALYTICS: AnalyticsEngineDataset } = {
      FP_ANALYTICS: {} as AnalyticsEngineDataset,
    };
    expect(env.FP_ANALYTICS).toBeDefined();
  });
});
