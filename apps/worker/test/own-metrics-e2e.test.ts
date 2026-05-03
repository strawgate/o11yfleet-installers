/**
 * E2E test for OpAMP own_metrics/own_traces/own_logs offers.
 *
 * WebSocket delivery requires the DO to be awake when sendOwnMetricsOffer runs.
 * We use the `doAction` callback to invoke the method inside the same DO execution
 * context as the reconnect hello — before the DO hibernates and closes the WS.
 *
 * For codec correctness, we test protobuf round-trips separately.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import { runInDurableObject } from "cloudflare:test";
import { verifyEnrollmentToken } from "@o11yfleet/core/auth";
import {
  setupD1,
  O11YFLEET_CLAIM_HMAC_SECRET,
  createTenant,
  createConfig,
  createEnrollmentToken,
  connectWithEnrollment,
} from "./helpers.js";
import { encodeServerToAgentProto, decodeServerToAgentProto } from "@o11yfleet/core/codec";

describe("OpAMP own_metrics offers", () => {
  let doName: string;
  let enrollmentToken: string;

  beforeAll(async () => {
    await setupD1();
    const tenant = await createTenant("OwnMetrics Corp");
    const config = await createConfig(tenant.id, "own-metrics-collectors");
    const token = await createEnrollmentToken(config.id);
    enrollmentToken = token.token;
    const claim = await verifyEnrollmentToken(enrollmentToken, O11YFLEET_CLAIM_HMAC_SECRET);
    doName = `${claim.tenant_id}:${claim.config_id}`;
  });

  it("sendOwnMetricsOffer sends metrics offer without error", async () => {
    const doStub = env.CONFIG_DO.get(env.CONFIG_DO.idFromName(doName));
    const { ws } = await connectWithEnrollment(enrollmentToken, {
      doAction: async (instanceUid) => {
        await runInDurableObject(
          doStub,
          async (instance: InstanceType<typeof ConfigDurableObject>) => {
            await instance.sendOwnMetricsOffer(
              instanceUid,
              "http://collector.internal/otlp/v1/metrics",
              "test-token-metrics",
              "metrics",
            );
          },
        );
      },
    });
    ws.close();
  });

  it("sendOwnMetricsOffer sends traces offer without error", async () => {
    const doStub = env.CONFIG_DO.get(env.CONFIG_DO.idFromName(doName));
    const { ws } = await connectWithEnrollment(enrollmentToken, {
      doAction: async (instanceUid) => {
        await runInDurableObject(
          doStub,
          async (instance: InstanceType<typeof ConfigDurableObject>) => {
            await instance.sendOwnMetricsOffer(
              instanceUid,
              "http://collector.internal/otlp/v1/traces",
              "test-token-traces",
              "traces",
            );
          },
        );
      },
    });
    ws.close();
  });

  it("sendOwnMetricsOffer sends logs offer without error", async () => {
    const doStub = env.CONFIG_DO.get(env.CONFIG_DO.idFromName(doName));
    const { ws } = await connectWithEnrollment(enrollmentToken, {
      doAction: async (instanceUid) => {
        await runInDurableObject(
          doStub,
          async (instance: InstanceType<typeof ConfigDurableObject>) => {
            await instance.sendOwnMetricsOffer(
              instanceUid,
              "http://collector.internal/otlp/v1/logs",
              "test-token-logs",
              "logs",
            );
          },
        );
      },
    });
    ws.close();
  });

  it("revokeOwnMetricsOffers sends without error", async () => {
    const doStub = env.CONFIG_DO.get(env.CONFIG_DO.idFromName(doName));
    const { ws } = await connectWithEnrollment(enrollmentToken, {
      doAction: async (instanceUid) => {
        await runInDurableObject(
          doStub,
          async (instance: InstanceType<typeof ConfigDurableObject>) => {
            await instance.revokeOwnMetricsOffers(instanceUid);
          },
        );
      },
    });
    ws.close();
  });

  it("codec round-trips own_metrics correctly", () => {
    const msg = {
      instance_uid: new Uint8Array(16),
      flags: 0,
      capabilities: 0x3f,
      connection_settings: {
        hash: new Uint8Array(32),
        own_metrics: {
          destination_endpoint: "https://otel-collector:4318/v1/metrics",
          headers: [{ key: "Authorization", value: "Bearer my-secret-token" }],
          heartbeat_interval_seconds: 60,
        },
      },
    };

    const encoded = encodeServerToAgentProto(msg);
    expect(encoded.byteLength).toBeGreaterThan(0);

    const decoded = decodeServerToAgentProto(encoded);
    expect(decoded.connection_settings).toBeDefined();
    expect(decoded.connection_settings!.own_metrics).toBeDefined();
    expect(decoded.connection_settings!.own_metrics!.destination_endpoint).toBe(
      "https://otel-collector:4318/v1/metrics",
    );
    expect(decoded.connection_settings!.own_metrics!.headers?.[0]?.key).toBe("Authorization");
    expect(decoded.connection_settings!.own_metrics!.headers?.[0]?.value).toBe(
      "Bearer my-secret-token",
    );
    expect(decoded.connection_settings!.own_metrics!.heartbeat_interval_seconds).toBe(60);
    expect(decoded.connection_settings!.own_traces).toBeUndefined();
    expect(decoded.connection_settings!.own_logs).toBeUndefined();
  });

  it("codec round-trips all three signals (metrics + traces + logs)", () => {
    const msg = {
      instance_uid: new Uint8Array(16),
      flags: 0,
      capabilities: 0x3f,
      connection_settings: {
        hash: new Uint8Array(32),
        own_metrics: {
          destination_endpoint: "https://otel-collector:4318/v1/metrics",
          headers: [{ key: "Authorization", value: "Bearer token" }],
          heartbeat_interval_seconds: 30,
        },
        own_traces: {
          destination_endpoint: "https://otel-collector:4318/v1/traces",
          headers: [{ key: "Authorization", value: "Bearer token" }],
          heartbeat_interval_seconds: 30,
        },
        own_logs: {
          destination_endpoint: "https://otel-collector:4318/v1/logs",
          headers: [{ key: "Authorization", value: "Bearer token" }],
          heartbeat_interval_seconds: 45,
        },
      },
    };

    const encoded = encodeServerToAgentProto(msg);
    expect(encoded.byteLength).toBeGreaterThan(0);
    const decoded = decodeServerToAgentProto(encoded);

    expect(decoded.connection_settings!.own_metrics!.destination_endpoint).toBe(
      "https://otel-collector:4318/v1/metrics",
    );
    expect(decoded.connection_settings!.own_traces!.destination_endpoint).toBe(
      "https://otel-collector:4318/v1/traces",
    );
    expect(decoded.connection_settings!.own_logs!.destination_endpoint).toBe(
      "https://otel-collector:4318/v1/logs",
    );
  });
});
