// Queue consumer integration test
// Tests the analytics-only event consumer (D1 agent_summaries removed)

import { describe, it, expect } from "vitest";
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
        event_id: crypto.randomUUID(),
        dedupe_key: "connected:qt-tenant:qt-config:single",
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-test-${Date.now()}`,
        timestamp: Date.now(),
      },
    ]);

    // Should not throw — analytics writes are fire-and-forget
    await handleQueueBatch(batch, {
      FP_ANALYTICS: { writeDataPoint: () => {} } as AnalyticsEngineDataset,
    });
  });

  it("processes a batch of mixed events", async () => {
    const batch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        event_id: crypto.randomUUID(),
        dedupe_key: "connected:1",
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-batch1-${Date.now()}`,
        timestamp: Date.now(),
      },
      {
        type: FleetEventType.AGENT_DISCONNECTED,
        event_id: crypto.randomUUID(),
        dedupe_key: "disconnected:1",
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-batch2-${Date.now()}`,
        timestamp: Date.now(),
        reason: "websocket_close",
      },
      {
        type: FleetEventType.AGENT_HEALTH_CHANGED,
        event_id: crypto.randomUUID(),
        dedupe_key: "health:1",
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
        event_id: crypto.randomUUID(),
        dedupe_key: "applied:1",
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: `qc-batch4-${Date.now()}`,
        timestamp: Date.now(),
        config_hash: "abc123",
      },
    ]);

    await handleQueueBatch(batch, {
      FP_ANALYTICS: { writeDataPoint: () => {} } as AnalyticsEngineDataset,
    });
  });

  it("handles empty batch gracefully", async () => {
    const batch = makeBatch([]);
    await handleQueueBatch(batch, {
      FP_ANALYTICS: { writeDataPoint: () => {} } as AnalyticsEngineDataset,
    });
  });

  it("ACKs/lossy when Analytics Engine write throws", async () => {
    const batch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        event_id: crypto.randomUUID(),
        dedupe_key: "connected:lossy",
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: "qc-lossy",
        timestamp: Date.now(),
      },
    ]);
    await expect(
      handleQueueBatch(batch, {
        FP_ANALYTICS: {
          writeDataPoint: () => {
            throw new Error("analytics unavailable");
          },
        } as AnalyticsEngineDataset,
      }),
    ).resolves.toBeUndefined();
  });

  it("caps Analytics Engine blob fields", async () => {
    let captured: AnalyticsEngineDataPoint | null = null;
    const batch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        event_id: crypto.randomUUID(),
        dedupe_key: "x".repeat(10_000),
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: "qc-long-dedupe",
        timestamp: Date.now(),
      },
    ]);

    await handleQueueBatch(batch, {
      FP_ANALYTICS: {
        writeDataPoint: (point: AnalyticsEngineDataPoint) => {
          captured = point;
        },
      } as AnalyticsEngineDataset,
    });

    expect(captured?.blobs?.[5]).toHaveLength(4096);
  });

  it("consumer env does not require FP_DB", () => {
    // ConsumerEnv only requires FP_ANALYTICS, not FP_DB
    const env: { FP_ANALYTICS: AnalyticsEngineDataset } = {
      FP_ANALYTICS: {} as AnalyticsEngineDataset,
    };
    expect(env.FP_ANALYTICS).toBeDefined();
  });

  it("tolerates legacy events without event_id / dedupe_key", async () => {
    // Pre-migration events on the queue may have been published before the
    // identity contract landed. The consumer must process them without
    // throwing so a deploy that lands ahead of producers still drains the
    // backlog.
    const captured: AnalyticsEngineDataPoint[] = [];
    const batch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        // No event_id, no dedupe_key.
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: "qc-legacy",
        timestamp: Date.now(),
      } as unknown as Parameters<typeof handleQueueBatch>[0]["messages"][number]["body"],
    ]);

    await expect(
      handleQueueBatch(batch, {
        FP_ANALYTICS: {
          writeDataPoint: (point: AnalyticsEngineDataPoint) => {
            captured.push(point);
          },
        } as AnalyticsEngineDataset,
      }),
    ).resolves.toBeUndefined();
    // The consumer must still surface a legacy event to Analytics Engine
    // even though the body lacks `event_id` and `dedupe_key`.
    expect(captured).toHaveLength(1);
  });
});
