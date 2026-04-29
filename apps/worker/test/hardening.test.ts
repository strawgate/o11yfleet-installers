import { describe, it, expect } from "vitest";
import { processFrame } from "@o11yfleet/core/state-machine";
import type { AgentState } from "@o11yfleet/core/state-machine";
import { AgentCapabilities } from "@o11yfleet/core/codec";
import {
  AppError,
  AuthError,
  ProtocolError,
  RateLimitError,
  StorageError,
  NotFoundError,
  errorResponse,
  WS_CLOSE_CODES,
} from "../src/errors.js";

// ========================
// Phase 4D: Cost Guardrails
// ========================
describe("Cost Guardrails", () => {
  const baseState: AgentState = {
    instance_uid: new Uint8Array(16),
    tenant_id: "t1",
    config_id: "c1",
    sequence_num: 1,
    generation: 1,
    healthy: true,
    status: "running",
    last_error: "",
    current_config_hash: null,
    desired_config_hash: null,
    effective_config_hash: null,
    effective_config_body: null,
    capabilities: AgentCapabilities.ReportsStatus,
    last_seen_at: Date.now(),
    connected_at: Date.now(),
    agent_description: null,
  };

  it("heartbeat always persists sequence_num + last_seen_at (DO SQLite is ~µs)", () => {
    const result = processFrame(baseState, {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    });
    expect(result.shouldPersist).toBe(true);
  });

  it("no-op heartbeat: zero events emitted (no queue cost)", () => {
    const result = processFrame(baseState, {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
    });
    expect(result.events).toHaveLength(0);
  });

  it("health change: shouldPersist is true", () => {
    const result = processFrame(baseState, {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      health: {
        healthy: false,
        start_time_unix_nano: 0n,
        last_error: "OOM",
        status: "degraded",
        status_time_unix_nano: 0n,
        component_health_map: {},
      },
    });
    expect(result.shouldPersist).toBe(true);
  });

  it("health change: emits event (queue write justified)", () => {
    const result = processFrame(baseState, {
      instance_uid: new Uint8Array(16),
      sequence_num: 2,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      health: {
        healthy: false,
        start_time_unix_nano: 0n,
        last_error: "OOM",
        status: "degraded",
        status_time_unix_nano: 0n,
        component_health_map: {},
      },
    });
    expect(result.events.length).toBeGreaterThan(0);
  });
});

// ========================
// Phase 4C: Error Types
// ========================
describe("Error Types", () => {
  it("AppError serializes to JSON", () => {
    const err = new AppError("test error", "TEST", 500, "req-123");
    const json = err.toJSON();
    expect(json.error).toBe("test error");
    expect(json.code).toBe("TEST");
    expect(json.request_id).toBe("req-123");
  });

  it("AuthError has 401 status", () => {
    const err = new AuthError("unauthorized");
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("AUTH_ERROR");
  });

  it("ProtocolError has 400 status", () => {
    const err = new ProtocolError("bad frame");
    expect(err.statusCode).toBe(400);
  });

  it("RateLimitError has 429 status", () => {
    const err = new RateLimitError("too many requests");
    expect(err.statusCode).toBe(429);
  });

  it("StorageError has 500 status", () => {
    const err = new StorageError("D1 failed");
    expect(err.statusCode).toBe(500);
  });

  it("NotFoundError has 404 status", () => {
    const err = new NotFoundError("not found");
    expect(err.statusCode).toBe(404);
  });

  it("errorResponse returns proper Response", () => {
    const err = new RateLimitError("slow down");
    const res = errorResponse(err);
    expect(res.status).toBe(429);
  });

  it("WS_CLOSE_CODES are defined", () => {
    expect(WS_CLOSE_CODES.RATE_LIMIT).toBe(4029);
    expect(WS_CLOSE_CODES.PROTOCOL_ERROR).toBe(4000);
    expect(WS_CLOSE_CODES.AUTH_ERROR).toBe(4001);
  });

  it("AppError without requestId omits it from JSON", () => {
    const err = new AppError("test", "TEST", 500);
    expect(err.toJSON().request_id).toBeUndefined();
  });
});
