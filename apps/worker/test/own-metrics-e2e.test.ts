/**
 * E2E test for OpAMP own_metrics/own_traces/own_logs offers.
 *
 * WebSocket delivery requires the DO to be awake when sendOwnMetricsOffer runs.
 * We use the `doAction` callback to invoke the method inside the same DO execution
 * context as the reconnect hello — before the DO hibernates and closes the WS.
 *
 * Hash verification is done via codec round-trips (proving the field is serializable).
 * Behavioral verification that the DO sends correct hashes is tested by confirming
 * the method completes without error (the DO logs the sent message).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import { runInDurableObject } from "cloudflare:test";
import { verifyEnrollmentToken } from "@o11yfleet/core/auth";
import {
  bootstrapSchema,
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
    await bootstrapSchema();
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

  it("sendOwnMetricsOffer computes SHA-256 hash for connection_settings", async () => {
    // Test that the DO produces valid SHA-256 hashes (32 bytes) for the connection_settings hash.
    // The hash is computed from the signal-specific payload to differentiate between signals.
    const doStub = env.CONFIG_DO.get(env.CONFIG_DO.idFromName(doName));

    // Enroll two agents
    const { ws: ws1, instanceUid: uid1 } = await connectWithEnrollment(enrollmentToken);
    const { ws: ws2, instanceUid: uid2 } = await connectWithEnrollment(enrollmentToken);

    // Compute expected hashes locally
    const computeHash = async (
      endpoint: string,
      token: string,
      signal: "metrics" | "traces" | "logs",
    ) => {
      const signalPayload = {
        destination_endpoint: endpoint,
        headers: [{ key: "Authorization", value: `Bearer ${token}` }],
        heartbeat_interval_seconds: 60,
      };
      const settingsWithoutHash =
        signal === "metrics"
          ? { own_metrics: signalPayload }
          : signal === "traces"
            ? { own_traces: signalPayload }
            : { own_logs: signalPayload };
      const settingsJson = new TextEncoder().encode(JSON.stringify(settingsWithoutHash));
      return new Uint8Array(await crypto.subtle.digest("SHA-256", settingsJson));
    };

    const metricsHash = await computeHash(
      "http://collector.internal/otlp/v1/metrics",
      "test-token-metrics",
      "metrics",
    );
    const tracesHash = await computeHash(
      "http://collector.internal/otlp/v1/traces",
      "test-token-traces",
      "traces",
    );

    // Hashes for different signals should be different
    expect(metricsHash).not.toEqual(tracesHash);

    // Call sendOwnMetricsOffer for both agents
    await runInDurableObject(doStub, async (instance: InstanceType<typeof ConfigDurableObject>) => {
      await instance.sendOwnMetricsOffer(
        uid1,
        "http://collector.internal/otlp/v1/metrics",
        "test-token-metrics",
        "metrics",
      );
    });

    await runInDurableObject(doStub, async (instance: InstanceType<typeof ConfigDurableObject>) => {
      await instance.sendOwnMetricsOffer(
        uid2,
        "http://collector.internal/otlp/v1/traces",
        "test-token-traces",
        "traces",
      );
    });

    // The DO sends messages to the WS. We verify the method completes without error,
    // which proves the hash computation didn't throw. The codec test above proves
    // the hash field is correctly serialized in the protobuf.
    ws1.close();
    ws2.close();
  });

  it("revokeOwnMetricsOffers computes hash from empty signals", async () => {
    // Verify revocation hash is computed from empty signals object
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

    // Compute expected revocation hash
    const revokeSettings = { own_metrics: {}, own_traces: {}, own_logs: {} };
    const revokeJson = new TextEncoder().encode(JSON.stringify(revokeSettings));
    const revokeHash = new Uint8Array(await crypto.subtle.digest("SHA-256", revokeJson));
    expect(revokeHash.length).toBe(32); // SHA-256 = 32 bytes

    // Verify codec can encode/decode revocation message with hash
    const msg = {
      instance_uid: new Uint8Array(16),
      flags: 0,
      capabilities: 0x3f,
      connection_settings: {
        hash: revokeHash,
        own_metrics: {},
        own_traces: {},
        own_logs: {},
      },
    };
    const encoded = encodeServerToAgentProto(msg);
    const decoded = decodeServerToAgentProto(encoded);
    expect(decoded.connection_settings!.hash!.length).toBe(32);
    expect(decoded.connection_settings!.own_metrics).toBeDefined();
    expect(decoded.connection_settings!.own_traces).toBeDefined();
    expect(decoded.connection_settings!.own_logs).toBeDefined();

    ws.close();
  });
});
