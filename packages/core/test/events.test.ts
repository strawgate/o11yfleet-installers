import { describe, expect, it } from "vitest";
import { FleetEventType, makeFleetEvent } from "../src/events.js";

describe("makeFleetEvent", () => {
  it("populates a non-empty dedupe_key when caller omits one", () => {
    const event = makeFleetEvent({
      type: FleetEventType.AGENT_CONNECTED,
      tenant_id: "tenant-1",
      config_id: "config-1",
      instance_uid: "agent-1",
    });
    expect(event.dedupe_key.length).toBeGreaterThan(0);
    expect(event.dedupe_key).toContain("tenant-1");
    expect(event.dedupe_key).toContain("config-1");
    expect(event.dedupe_key).toContain("agent-1");
  });

  it("treats an empty caller-supplied dedupe_key as missing", () => {
    const event = makeFleetEvent({
      type: FleetEventType.AGENT_DISCONNECTED,
      tenant_id: "tenant-1",
      config_id: "config-1",
      instance_uid: "agent-1",
      dedupe_key: "",
    });
    // Empty string must not survive — downstream consumers rely on a
    // non-empty dedupe_key for idempotency.
    expect(event.dedupe_key.length).toBeGreaterThan(0);
    expect(event.dedupe_key).not.toBe("");
  });

  it("preserves a caller-supplied non-empty dedupe_key verbatim", () => {
    const explicit = "disconnected:tenant-1:config-1:agent-1:websocket_close:1700000000";
    const event = makeFleetEvent({
      type: FleetEventType.AGENT_DISCONNECTED,
      tenant_id: "tenant-1",
      config_id: "config-1",
      instance_uid: "agent-1",
      dedupe_key: explicit,
    });
    expect(event.dedupe_key).toBe(explicit);
  });

  it("assigns a fresh event_id per event", () => {
    const a = makeFleetEvent({
      type: FleetEventType.AGENT_CONNECTED,
      tenant_id: "tenant-1",
      config_id: "config-1",
      instance_uid: "agent-1",
    });
    const b = makeFleetEvent({
      type: FleetEventType.AGENT_CONNECTED,
      tenant_id: "tenant-1",
      config_id: "config-1",
      instance_uid: "agent-1",
    });
    expect(a.event_id).not.toBe(b.event_id);
    expect(a.event_id.length).toBeGreaterThan(0);
  });
});
