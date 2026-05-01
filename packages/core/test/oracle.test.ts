// Oracle tests — verify our protobuf codec decodes identically to opamp-go.
//
// The Go program in tests/oracle/ uses the canonical opamp-go library to
// construct AgentToServer messages and serialize them to protobuf binary
// (with the standard 0x00 data-type header). Each fixture has a .bin file
// (protobuf wire bytes) and a .json file (expected decoded values).
//
// This test reads each fixture, decodes it with our codec, and verifies
// the decoded fields match the opamp-go expected values — proving our
// TypeScript codec is wire-compatible with the reference Go implementation.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { decodeAgentToServerProto, isProtobufFrame } from "../src/codec/protobuf.js";
import type { AgentToServer } from "../src/codec/types.js";

const FIXTURE_DIR = resolve(__dirname, "../../../tests/oracle/fixtures");
const ORACLE_DIR = resolve(__dirname, "../../../tests/oracle");

interface FixtureExpected {
  sequence_num?: number;
  capabilities?: number;
  flags?: number;
  has_health?: boolean;
  has_description?: boolean;
  has_effective_config?: boolean;
  has_disconnect?: boolean;
  health?: {
    healthy: boolean;
    start_time_unix_nano: number;
    last_error: string;
    status: string;
    status_time_unix_nano: number;
    has_component_health: boolean;
  };
  agent_description?: {
    identifying_attributes: Array<{ key: string; value: { string_value: string } }>;
    non_identifying_attributes: Array<{ key: string; value: { string_value: string } }>;
  };
  remote_config_status?: {
    status: number;
    error_message: string;
  };
  effective_config_key?: string;
  effective_config_content_type?: string;
}

function loadFixture(name: string): { bin: ArrayBuffer; expected: FixtureExpected } {
  const binPath = join(FIXTURE_DIR, `${name}.bin`);
  const jsonPath = join(FIXTURE_DIR, `${name}.json`);
  const bin = readFileSync(binPath);
  const expected = JSON.parse(readFileSync(jsonPath, "utf-8")) as FixtureExpected;
  return {
    bin: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    expected,
  };
}

// Known UID: bytes 0x01..0x10
const KNOWN_UID = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

describe("Oracle: opamp-go protobuf fixtures", () => {
  beforeAll(() => {
    // Regenerate fixtures from Go source (ensures they're fresh)
    if (existsSync(join(ORACLE_DIR, "go.mod"))) {
      execSync("go run .", { cwd: ORACLE_DIR, timeout: 60_000 });
    }
  }, 60_000);

  it("fixture directory exists with expected files", () => {
    const files = readdirSync(FIXTURE_DIR);
    expect(files).toContain("hello.bin");
    expect(files).toContain("hello.json");
    expect(files).toContain("heartbeat.bin");
    expect(files).toContain("config-ack.bin");
    expect(files).toContain("health-report.bin");
    expect(files).toContain("description-report.bin");
    expect(files).toContain("disconnect.bin");
  });

  describe("format detection", () => {
    it("all fixtures are detected as protobuf", () => {
      for (const name of [
        "hello",
        "heartbeat",
        "health-report",
        "config-ack",
        "description-report",
        "disconnect",
      ]) {
        const { bin } = loadFixture(name);
        expect(isProtobufFrame(bin), `${name} should be detected as protobuf`).toBe(true);
      }
    });
  });

  describe("hello (full report)", () => {
    let decoded: AgentToServer;
    let expected: FixtureExpected;

    beforeAll(() => {
      const fixture = loadFixture("hello");
      decoded = decodeAgentToServerProto(fixture.bin);
      expected = fixture.expected;
    });

    it("decodes instance_uid", () => {
      expect(decoded.instance_uid).toEqual(KNOWN_UID);
    });

    it("decodes scalar fields", () => {
      expect(decoded.sequence_num).toBe(expected.sequence_num);
      expect(decoded.capabilities).toBe(expected.capabilities);
      expect(decoded.flags).toBe(expected.flags);
    });

    it("decodes agent_description identifying_attributes", () => {
      expect(decoded.agent_description).toBeDefined();
      const desc = decoded.agent_description!;
      const expectedDesc = expected.agent_description!;

      expect(desc.identifying_attributes).toHaveLength(expectedDesc.identifying_attributes.length);
      for (let i = 0; i < expectedDesc.identifying_attributes.length; i++) {
        const expAttr = expectedDesc.identifying_attributes[i]!;
        const gotAttr = desc.identifying_attributes[i]!;
        expect(gotAttr.key).toBe(expAttr.key);
        expect(gotAttr.value.string_value).toBe(expAttr.value.string_value);
      }
    });

    it("decodes agent_description non_identifying_attributes", () => {
      const desc = decoded.agent_description!;
      const expectedDesc = expected.agent_description!;

      expect(desc.non_identifying_attributes).toHaveLength(
        expectedDesc.non_identifying_attributes.length,
      );
      for (let i = 0; i < expectedDesc.non_identifying_attributes.length; i++) {
        const expAttr = expectedDesc.non_identifying_attributes[i]!;
        const gotAttr = desc.non_identifying_attributes[i]!;
        expect(gotAttr.key).toBe(expAttr.key);
        expect(gotAttr.value.string_value).toBe(expAttr.value.string_value);
      }
    });

    it("decodes health", () => {
      expect(decoded.health).toBeDefined();
      const h = decoded.health!;
      const eh = expected.health!;
      expect(h.healthy).toBe(eh.healthy);
      expect(h.last_error).toBe(eh.last_error);
      expect(h.status).toBe(eh.status);
      expect(h.start_time_unix_nano).toBe(BigInt(eh.start_time_unix_nano));
      expect(h.status_time_unix_nano).toBe(BigInt(eh.status_time_unix_nano));
    });

    it("decodes component_health_map", () => {
      const h = decoded.health!;
      expect(Object.keys(h.component_health_map).length).toBeGreaterThan(0);
      const pipeline = h.component_health_map["pipeline:traces"];
      expect(pipeline).toBeDefined();
      expect(pipeline!.healthy).toBe(true);
      expect(pipeline!.status).toBe("StatusOK");
      // Nested components
      const nested = pipeline!.component_health_map;
      expect(nested["receiver:otlp"]).toBeDefined();
      expect(nested["processor:batch"]).toBeDefined();
      expect(nested["exporter:debug"]).toBeDefined();
    });

    it("decodes effective_config", () => {
      expect(decoded.effective_config).toBeDefined();
      const configMap = decoded.effective_config!.config_map!.config_map;
      expect(configMap[""]).toBeDefined();
      expect(configMap[""]!.content_type).toBe(expected.effective_config_content_type);
      const body = new TextDecoder().decode(configMap[""]!.body);
      expect(body).toContain("receivers:");
    });
  });

  describe("heartbeat (minimal)", () => {
    let decoded: AgentToServer;
    let expected: FixtureExpected;

    beforeAll(() => {
      const fixture = loadFixture("heartbeat");
      decoded = decodeAgentToServerProto(fixture.bin);
      expected = fixture.expected;
    });

    it("decodes scalar fields", () => {
      expect(decoded.instance_uid).toEqual(KNOWN_UID);
      expect(decoded.sequence_num).toBe(expected.sequence_num);
      expect(decoded.capabilities).toBe(expected.capabilities);
      expect(decoded.flags).toBe(expected.flags);
    });

    it("has no optional fields", () => {
      expect(decoded.health).toBeUndefined();
      expect(decoded.agent_description).toBeUndefined();
      expect(decoded.effective_config).toBeUndefined();
      expect(decoded.remote_config_status).toBeUndefined();
      expect(decoded.agent_disconnect).toBeUndefined();
    });
  });

  describe("health report (unhealthy)", () => {
    let decoded: AgentToServer;
    let expected: FixtureExpected;

    beforeAll(() => {
      const fixture = loadFixture("health-report");
      decoded = decodeAgentToServerProto(fixture.bin);
      expected = fixture.expected;
    });

    it("decodes scalar fields", () => {
      expect(decoded.sequence_num).toBe(expected.sequence_num);
      expect(decoded.capabilities).toBe(expected.capabilities);
    });

    it("decodes unhealthy status", () => {
      expect(decoded.health).toBeDefined();
      const h = decoded.health!;
      const eh = expected.health!;
      expect(h.healthy).toBe(false);
      expect(h.last_error).toBe("OOM killed");
      expect(h.status).toBe("degraded");
      expect(h.start_time_unix_nano).toBe(BigInt(eh.start_time_unix_nano));
    });
  });

  describe("config ack", () => {
    let decoded: AgentToServer;
    let expected: FixtureExpected;

    beforeAll(() => {
      const fixture = loadFixture("config-ack");
      decoded = decodeAgentToServerProto(fixture.bin);
      expected = fixture.expected;
    });

    it("decodes scalar fields", () => {
      expect(decoded.sequence_num).toBe(expected.sequence_num);
      expect(decoded.capabilities).toBe(expected.capabilities);
    });

    it("decodes remote_config_status", () => {
      expect(decoded.remote_config_status).toBeDefined();
      const rcs = decoded.remote_config_status!;
      expect(rcs.status).toBe(expected.remote_config_status!.status);
      expect(rcs.error_message).toBe(expected.remote_config_status!.error_message);
      // Verify the hash bytes survived the round-trip
      expect(rcs.last_remote_config_hash).toEqual(
        new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89]),
      );
    });
  });

  describe("description report", () => {
    let decoded: AgentToServer;
    let expected: FixtureExpected;

    beforeAll(() => {
      const fixture = loadFixture("description-report");
      decoded = decodeAgentToServerProto(fixture.bin);
      expected = fixture.expected;
    });

    it("decodes identifying attributes", () => {
      const desc = decoded.agent_description!;
      const expDesc = expected.agent_description!;
      expect(desc.identifying_attributes).toHaveLength(expDesc.identifying_attributes.length);
      for (let i = 0; i < expDesc.identifying_attributes.length; i++) {
        expect(desc.identifying_attributes[i]!.key).toBe(expDesc.identifying_attributes[i]!.key);
        expect(desc.identifying_attributes[i]!.value.string_value).toBe(
          expDesc.identifying_attributes[i]!.value.string_value,
        );
      }
    });

    it("decodes non_identifying attributes", () => {
      const desc = decoded.agent_description!;
      const expDesc = expected.agent_description!;
      expect(desc.non_identifying_attributes).toHaveLength(
        expDesc.non_identifying_attributes.length,
      );
      // Verify os.description comes through (including the space)
      const osDesc = desc.non_identifying_attributes.find((a) => a.key === "os.description");
      expect(osDesc).toBeDefined();
      expect(osDesc!.value.string_value).toBe("Ubuntu 22.04");
    });

    it("has no health or config", () => {
      expect(decoded.health).toBeUndefined();
      expect(decoded.effective_config).toBeUndefined();
    });
  });

  describe("disconnect", () => {
    let decoded: AgentToServer;

    beforeAll(() => {
      const fixture = loadFixture("disconnect");
      decoded = decodeAgentToServerProto(fixture.bin);
    });

    it("decodes agent_disconnect", () => {
      expect(decoded.agent_disconnect).toBeDefined();
    });

    it("preserves scalar fields", () => {
      expect(decoded.sequence_num).toBe(99);
      expect(decoded.instance_uid).toEqual(KNOWN_UID);
    });
  });
});
