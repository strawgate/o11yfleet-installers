// Queue consumer integration test
// Tests the event consumer that processes fleet events into D1 agent_summaries

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { handleQueueBatch } from "../src/event-consumer.js";
import { FleetEventType } from "@o11yfleet/core/events";
import { setupD1 } from "./helpers.js";

beforeAll(setupD1);

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

describe("Queue Consumer: agent_connected", () => {
  it("creates agent_summaries row on connect event", async () => {
    const uid = `qc-connect-${Date.now()}`;
    const batch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid,
        timestamp: Date.now(),
      },
    ]);

    await handleQueueBatch(batch, {
      FP_DB: env.FP_DB,
      FP_ANALYTICS: env.FP_ANALYTICS,
    });

    const row = await env.FP_DB.prepare(
      `SELECT * FROM agent_summaries WHERE instance_uid = ?`,
    )
      .bind(uid)
      .first();

    expect(row).toBeDefined();
    expect(row!.status).toBe("connected");
    expect(row!.tenant_id).toBe("qt-tenant");
    expect(row!.config_id).toBe("qt-config");
  });
});

describe("Queue Consumer: agent_disconnected", () => {
  it("updates status to disconnected", async () => {
    const uid = `qc-disconnect-${Date.now()}`;

    // First, create the agent
    const connectBatch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid,
        timestamp: Date.now(),
      },
    ]);
    await handleQueueBatch(connectBatch, {
      FP_DB: env.FP_DB,
      FP_ANALYTICS: env.FP_ANALYTICS,
    });

    // Then disconnect
    const disconnectBatch = makeBatch([
      {
        type: FleetEventType.AGENT_DISCONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid,
        timestamp: Date.now(),
        reason: "websocket_close",
      },
    ]);
    await handleQueueBatch(disconnectBatch, {
      FP_DB: env.FP_DB,
      FP_ANALYTICS: env.FP_ANALYTICS,
    });

    const row = await env.FP_DB.prepare(
      `SELECT * FROM agent_summaries WHERE instance_uid = ?`,
    )
      .bind(uid)
      .first();

    expect(row).toBeDefined();
    expect(row!.status).toBe("disconnected");
    expect(row!.disconnected_at).toBeDefined();
  });
});

describe("Queue Consumer: health_changed", () => {
  it("updates healthy flag", async () => {
    const uid = `qc-health-${Date.now()}`;

    // Connect first
    const connectBatch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid,
        timestamp: Date.now(),
      },
    ]);
    await handleQueueBatch(connectBatch, {
      FP_DB: env.FP_DB,
      FP_ANALYTICS: env.FP_ANALYTICS,
    });

    // Health change to unhealthy
    const healthBatch = makeBatch([
      {
        type: FleetEventType.AGENT_HEALTH_CHANGED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid,
        timestamp: Date.now(),
        healthy: false,
        status: "degraded",
        last_error: "OOM",
      },
    ]);
    await handleQueueBatch(healthBatch, {
      FP_DB: env.FP_DB,
      FP_ANALYTICS: env.FP_ANALYTICS,
    });

    const row = await env.FP_DB.prepare(
      `SELECT * FROM agent_summaries WHERE instance_uid = ?`,
    )
      .bind(uid)
      .first();

    expect(row).toBeDefined();
    expect(row!.healthy).toBe(0);
  });
});

describe("Queue Consumer: config_applied", () => {
  it("updates current_config_hash", async () => {
    const uid = `qc-config-${Date.now()}`;

    // Connect first
    const connectBatch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid,
        timestamp: Date.now(),
      },
    ]);
    await handleQueueBatch(connectBatch, {
      FP_DB: env.FP_DB,
      FP_ANALYTICS: env.FP_ANALYTICS,
    });

    // Config applied
    const configBatch = makeBatch([
      {
        type: FleetEventType.CONFIG_APPLIED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid,
        timestamp: Date.now(),
        config_hash: "abc123def456",
      },
    ]);
    await handleQueueBatch(configBatch, {
      FP_DB: env.FP_DB,
      FP_ANALYTICS: env.FP_ANALYTICS,
    });

    const row = await env.FP_DB.prepare(
      `SELECT * FROM agent_summaries WHERE instance_uid = ?`,
    )
      .bind(uid)
      .first();

    expect(row).toBeDefined();
    expect(row!.current_config_hash).toBe("abc123def456");
  });
});

describe("Queue Consumer: batch processing", () => {
  it("processes multiple events in a single batch", async () => {
    const uid1 = `qc-batch1-${Date.now()}`;
    const uid2 = `qc-batch2-${Date.now()}`;

    const batch = makeBatch([
      {
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid1,
        timestamp: Date.now(),
      },
      {
        type: FleetEventType.AGENT_CONNECTED,
        tenant_id: "qt-tenant",
        config_id: "qt-config",
        instance_uid: uid2,
        timestamp: Date.now(),
      },
    ]);

    await handleQueueBatch(batch, {
      FP_DB: env.FP_DB,
      FP_ANALYTICS: env.FP_ANALYTICS,
    });

    const row1 = await env.FP_DB.prepare(
      `SELECT * FROM agent_summaries WHERE instance_uid = ?`,
    )
      .bind(uid1)
      .first();
    const row2 = await env.FP_DB.prepare(
      `SELECT * FROM agent_summaries WHERE instance_uid = ?`,
    )
      .bind(uid2)
      .first();

    expect(row1).toBeDefined();
    expect(row2).toBeDefined();
    expect(row1!.status).toBe("connected");
    expect(row2!.status).toBe("connected");
  });

  it("duplicate connect events are idempotent", async () => {
    const uid = `qc-idempotent-${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      const batch = makeBatch([
        {
          type: FleetEventType.AGENT_CONNECTED,
          tenant_id: "qt-tenant",
          config_id: "qt-config",
          instance_uid: uid,
          timestamp: Date.now(),
        },
      ]);
      await handleQueueBatch(batch, {
        FP_DB: env.FP_DB,
        FP_ANALYTICS: env.FP_ANALYTICS,
      });
    }

    const count = await env.FP_DB.prepare(
      `SELECT COUNT(*) as count FROM agent_summaries WHERE instance_uid = ?`,
    )
      .bind(uid)
      .first<{ count: number }>();

    expect(count!.count).toBe(1);
  });
});
