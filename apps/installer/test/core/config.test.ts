/**
 * Tests for config generation utilities.
 */

import { describe, it, expect } from "vitest";
import {
  validateToken,
  getTokenWarning,
  generateSystemdUnit,
  generateLaunchdPlist,
  buildServiceConfig,
  createDefaultConfig,
  shouldPreserveConfig,
} from "../../src/core/config.js";
import { isValidUuid, isLegacyInstanceUid, legacyUidToUuid } from "../../src/core/uuid.js";

describe("validateToken", () => {
  it("accepts valid enrollment tokens", () => {
    expect(validateToken("fp_enroll_abc123")).toBe(true);
    expect(validateToken("fp_enroll_test-token-123")).toBe(true);
  });

  it("rejects invalid tokens", () => {
    expect(validateToken("")).toBe(false);
    expect(validateToken(undefined)).toBe(false);
    expect(validateToken("not_a_valid_token")).toBe(false);
    expect(validateToken("fp_other_prefix")).toBe(false);
  });
});

describe("getTokenWarning", () => {
  it("returns null for valid tokens", () => {
    expect(getTokenWarning("fp_enroll_abc123")).toBeNull();
  });

  it("returns warning for invalid tokens", () => {
    const warning = getTokenWarning("invalid_token");
    expect(warning).toContain("fp_enroll_");
  });

  it("returns null for empty tokens", () => {
    expect(getTokenWarning("")).toBeNull();
    expect(getTokenWarning(undefined)).toBeNull();
  });
});

describe("isValidUuid", () => {
  it("accepts valid UUID v4 format", () => {
    expect(isValidUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects invalid UUIDs", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(false); // v1
    expect(isValidUuid("123e4567-e89b-52d3-a456-426614174000")).toBe(false); // v5
    expect(isValidUuid("123e4567-e89b-42d3-a456")).toBe(false); // too short
  });
});

describe("isLegacyInstanceUid", () => {
  it("accepts 32-character hex strings", () => {
    expect(isLegacyInstanceUid("a1b2c3d4e5f678901234567890123456")).toBe(true);
    expect(isLegacyInstanceUid("12345678901234567890123456789012")).toBe(true);
  });

  it("rejects other formats", () => {
    expect(isLegacyInstanceUid("")).toBe(false);
    expect(isLegacyInstanceUid("1234567890123456789012345678901")).toBe(false); // too short
    expect(isLegacyInstanceUid("123e4567-e89b-42d3-a456-426614174000")).toBe(false); // UUID format
  });
});

describe("legacyUidToUuid", () => {
  it("converts 32-char hex to UUID format", () => {
    const uid = "a1b2c3d4e5f678901234567890123456";
    const uuid = legacyUidToUuid(uid);
    expect(uuid).toBe("a1b2c3d4-e5f6-7890-1234-567890123456");
    // Legacy UIDs don't have version bits set, so won't pass UUID v4 validation
    // Just verify the format is correct (hyphens in right places)
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("leaves valid UUIDs unchanged", () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    expect(legacyUidToUuid(uuid)).toBe(uuid);
  });

  it("leaves invalid formats unchanged", () => {
    const invalid = "not-a-valid-uid";
    expect(legacyUidToUuid(invalid)).toBe(invalid);
  });
});

describe("generateSystemdUnit", () => {
  it("generates valid systemd unit", () => {
    const unit = generateSystemdUnit({
      name: "o11yfleet-collector",
      displayName: "O11yFleet Collector",
      description: "O11yFleet Collector (otelcol-contrib + OpAMP)",
      execStart: "/opt/o11yfleet/bin/otelcol-contrib",
      user: "o11yfleet",
      group: "o11yfleet",
      installDir: "/opt/o11yfleet",
      configFile: "/opt/o11yfleet/config/otelcol.yaml",
      logFile: "/var/log/o11yfleet-collector.log",
    });

    expect(unit).toContain("[Unit]");
    expect(unit).toContain("Description=O11yFleet Collector");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("User=o11yfleet");
    expect(unit).toContain("ExecStart=/opt/o11yfleet/bin/otelcol-contrib");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=multi-user.target");
  });
});

describe("generateLaunchdPlist", () => {
  it("generates valid launchd plist", () => {
    const plist = generateLaunchdPlist({
      name: "com.o11yfleet.collector",
      displayName: "O11yFleet Collector",
      description: "O11yFleet Collector (otelcol-contrib + OpAMP)",
      execStart: "/opt/o11yfleet/bin/otelcol-contrib",
      user: "o11yfleet",
      group: "o11yfleet",
      installDir: "/opt/o11yfleet",
      configFile: "/opt/o11yfleet/config/otelcol.yaml",
      logFile: "/var/log/o11yfleet-collector.log",
    });

    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>com.o11yfleet.collector</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("otelcol-contrib");
  });
});

describe("buildServiceConfig", () => {
  it("builds config for linux", () => {
    const config = buildServiceConfig(
      "/opt/o11yfleet",
      "/opt/o11yfleet/config/otelcol.yaml",
      "/var/log/o11yfleet-collector.log",
      "linux",
    );

    expect(config.name).toBe("o11yfleet-collector");
    expect(config.execStart).toBe("/opt/o11yfleet/bin/otelcol-contrib");
    expect(config.user).toBe("o11yfleet");
  });

  it("builds config for darwin", () => {
    const config = buildServiceConfig(
      "/opt/o11yfleet",
      "/opt/o11yfleet/config/otelcol.yaml",
      "/var/log/o11yfleet-collector.log",
      "darwin",
    );

    expect(config.name).toBe("com.o11yfleet.collector");
  });

  it("builds config for windows", () => {
    const config = buildServiceConfig(
      "C:\\Program Files\\O11yFleet",
      "C:\\Program Files\\O11yFleet\\config\\otelcol.yaml",
      "C:\\Program Files\\O11yFleet\\logs\\collector.log",
      "windows",
    );

    expect(config.name).toBe("o11yfleet-collector");
    expect(config.execStart).toContain(".exe");
  });
});

describe("createDefaultConfig", () => {
  it("creates config with all fields", () => {
    const config = createDefaultConfig(
      "fp_enroll_token",
      "wss://api.example.com/opamp",
      "123e4567-e89b-42d3-a456-426614174000",
    );

    expect(config.token).toBe("fp_enroll_token");
    expect(config.endpoint).toBe("wss://api.example.com/opamp");
    expect(config.instanceUid).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(config.version).toBeDefined();
  });
});

describe("shouldPreserveConfig", () => {
  it("preserves config during upgrade by default", () => {
    expect(shouldPreserveConfig(true)).toBe(true);
    expect(shouldPreserveConfig(true, false)).toBe(true);
  });

  it("doesn't preserve config on fresh install", () => {
    expect(shouldPreserveConfig(false)).toBe(false);
  });

  it("can force config overwrite during upgrade", () => {
    expect(shouldPreserveConfig(true, true)).toBe(false);
  });
});
