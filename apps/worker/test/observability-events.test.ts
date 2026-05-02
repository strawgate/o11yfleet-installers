import { describe, expect, it, vi } from "vitest";
import { FleetEventType } from "@o11yfleet/core/events";
import { logTransitionEvents } from "../src/observability-events.js";

function makeLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

describe("transition event observability", () => {
  it("logs config rejections with the rejection message", () => {
    const logger = makeLogger();

    logTransitionEvents(
      [
        {
          type: FleetEventType.CONFIG_REJECTED,
          tenant_id: "tenant-1",
          config_id: "config-1",
          instance_uid: "agent-1",
          event_id: "event-1",
          dedupe_key: "dedupe-1",
          timestamp: 123,
          config_hash: "bad-hash",
          error_message: "invalid receiver",
        },
      ],
      logger,
    );

    expect(logger.warn).toHaveBeenCalledWith({
      event: "config_rejected",
      tenant_id: "tenant-1",
      config_id: "config-1",
      instance_uid: "agent-1",
      config_hash: "bad-hash",
      error_message: "invalid receiver",
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs CONFIG_STUCK at error level with the fail count", () => {
    const logger = makeLogger();

    logTransitionEvents(
      [
        {
          type: FleetEventType.CONFIG_STUCK,
          tenant_id: "tenant-1",
          config_id: "config-1",
          instance_uid: "agent-1",
          event_id: "event-1",
          dedupe_key: "dedupe-1",
          timestamp: 123,
          config_hash: "bad-hash",
          fail_count: 3,
          error_message: "still failing",
        },
      ],
      logger,
    );

    expect(logger.error).toHaveBeenCalledWith({
      event: "config_stuck",
      tenant_id: "tenant-1",
      config_id: "config-1",
      instance_uid: "agent-1",
      config_hash: "bad-hash",
      fail_count: 3,
      error_message: "still failing",
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("sanitizes and bounds rejection messages before logging", () => {
    const logger = makeLogger();
    const longSuffix = "x".repeat(900);

    logTransitionEvents(
      [
        {
          type: FleetEventType.CONFIG_REJECTED,
          tenant_id: "tenant-1",
          config_id: "config-1",
          instance_uid: "agent-1",
          event_id: "event-1",
          dedupe_key: "dedupe-1",
          timestamp: 123,
          config_hash: "bad-hash",
          error_message:
            "failed at /Users/bill/secrets/config.yaml and C:\\Users\\bill\\secret.yaml " +
            "and \\\\host\\share\\secret.yaml from 10.1.2.3 token=abc123\n" +
            "Bearer sk-cp-supersecretvalue1234567890 " +
            longSuffix,
        },
      ],
      logger,
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const logged = logger.warn.mock.calls[0]?.[0] as { error_message?: string } | undefined;
    expect(logged?.error_message).toContain("[redacted-path]");
    expect(logged?.error_message).toContain("[redacted-ip]");
    expect(logged?.error_message).toContain("token=[redacted]");
    expect(logged?.error_message).toContain("Bearer [redacted]");
    expect(logged?.error_message).toContain("[truncated]");
    expect(logged?.error_message).not.toContain("10.1.2.3");
    expect(logged?.error_message).not.toContain("/Users/bill/secrets/config.yaml");
    expect(logged?.error_message).not.toContain("C:\\Users\\bill\\secret.yaml");
    expect(logged?.error_message).not.toContain("\\\\host\\share\\secret.yaml");
    expect(logged?.error_message?.length).toBeLessThanOrEqual(512);
  });

  it("does not log high-volume non-rejection transitions", () => {
    const logger = makeLogger();

    logTransitionEvents(
      [
        {
          type: FleetEventType.AGENT_HEALTH_CHANGED,
          tenant_id: "tenant-1",
          config_id: "config-1",
          instance_uid: "agent-1",
          event_id: "event-1",
          dedupe_key: "dedupe-1",
          timestamp: 123,
          healthy: false,
          status: "degraded",
        },
      ],
      logger,
    );

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
