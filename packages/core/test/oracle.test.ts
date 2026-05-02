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
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  decodeAgentToServerProto,
  decodeServerToAgentProto,
  isProtobufFrame,
} from "../src/codec/protobuf.js";
import type { AgentToServer, ServerToAgent } from "../src/codec/types.js";
import { CommandType, ServerErrorResponseType } from "../src/codec/types.js";
import { AgentToServerSchema, ServerToAgentSchema } from "../src/codec/gen/opamp_pb.js";

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
    // Regenerate fixtures from Go source. Clear the dir first so files
    // written by a different branch's main.go (e.g., the
    // `available-components` and `server-*` fixtures introduced in a
    // sibling PR) don't linger and break consumers like differential.test.ts
    // that load the whole directory. Without the clear, switching
    // branches and re-running tests was producing confusing failures.
    if (existsSync(join(ORACLE_DIR, "go.mod"))) {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
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

  describe("available_components (§5.2.2)", () => {
    let decoded: AgentToServer;

    beforeAll(() => {
      const fixture = loadFixture("available-components");
      decoded = decodeAgentToServerProto(fixture.bin);
    });

    it("decodes available_components", () => {
      expect(decoded.available_components).toBeDefined();
    });

    it("preserves component kinds", () => {
      const ac = decoded.available_components as { components: Record<string, unknown> };
      expect(Object.keys(ac.components).sort()).toEqual(["exporter", "receiver"]);
    });

    it("preserves nested sub_component_map (the receiver kind has otlp + hostmetrics)", () => {
      const ac = decoded.available_components as {
        components: Record<string, { sub_component_map: Record<string, unknown> }>;
      };
      const receiver = ac.components["receiver"]!;
      expect(Object.keys(receiver.sub_component_map).sort()).toEqual(["hostmetrics", "otlp"]);
    });

    it("preserves component metadata (otlp version)", () => {
      const ac = decoded.available_components as {
        components: Record<
          string,
          {
            sub_component_map: Record<
              string,
              { metadata: Array<{ key: string; value: { string_value: string } }> }
            >;
          }
        >;
      };
      const otlp = ac.components["receiver"]!.sub_component_map["otlp"]!;
      const versionAttr = otlp.metadata.find((m) => m.key === "version");
      expect(versionAttr?.value.string_value).toBe("0.123.0");
    });

    it("preserves the hash bytes verbatim", () => {
      const ac = decoded.available_components as { hash: Uint8Array };
      expect(ac.hash[0]).toBe(0xfe);
      expect(ac.hash.length).toBe(8);
    });
  });
});

// ─── Field coverage: every proto field exercised by ≥1 fixture ──────
//
// This is the structural guard that prevents the next available_components-
// shaped gap. When upstream OpAMP adds a field and our proto subset picks
// it up via `buf generate`, the schema descriptor gains a new entry. If
// no fixture exercises the new field, this test fails with the offending
// field name — forcing the contributor to either add a fixture or
// explicitly mark it as not-yet-covered in IGNORE_FIELDS below.

// Fields we deliberately do not exercise in oracle fixtures yet. Add
// here only with a written reason; the goal is to keep this list short.
const AGENT_TO_SERVER_IGNORE = new Set<string>([
  // ConnectionSettingsStatus (agent → server ack of connection_settings):
  // we accept this on the wire but the worker doesn't action the
  // acknowledgement yet. Worth oracling when the worker starts using it.
  "connection_settings_status",
]);

const SERVER_TO_AGENT_IGNORE = new Set<string>([
  // packages_available — we don't offer packages today and the protobuf
  // schema we generate does not include this field, so opamp-go would
  // serialize a field our wire format ignores. Skip until we offer
  // packages.
  "packages_available",
  // heart_beat_interval — opamp-go v0.23.0 (pinned) doesn't model this
  // Go field, so we cannot generate a fixture from the reference lib.
  // Re-add when opamp-go bumps to a version exposing it.
  "heart_beat_interval",
]);

function fieldsCoveredByFixture(decoded: Record<string, unknown>): Set<string> {
  // A field is "covered" when the decoder either populated a sub-object
  // or surfaced a non-default scalar / non-empty bytes value. Empty
  // strings and 0 are accepted as covered for required scalar fields
  // because protobuf can't distinguish "explicit zero" from "absent".
  const covered = new Set<string>();
  for (const [k, v] of Object.entries(decoded)) {
    if (v === undefined) continue;
    if (v === null) continue;
    covered.add(k);
  }
  return covered;
}

describe("Oracle: field coverage", () => {
  it("every AgentToServer proto field is exercised by ≥1 fixture", () => {
    const agentFixtures = [
      "hello",
      "heartbeat",
      "health-report",
      "config-ack",
      "description-report",
      "disconnect",
      "available-components",
    ];
    const allCovered = new Set<string>();
    for (const name of agentFixtures) {
      const decoded = decodeAgentToServerProto(loadFixture(name).bin) as unknown as Record<
        string,
        unknown
      >;
      for (const k of fieldsCoveredByFixture(decoded)) allCovered.add(k);
    }
    const schemaFieldNames = AgentToServerSchema.fields.map((f) => f.name);
    const missing = schemaFieldNames.filter(
      (n) => !allCovered.has(n) && !AGENT_TO_SERVER_IGNORE.has(n),
    );
    expect(
      missing,
      `AgentToServer fields missing from oracle fixtures: ${missing.join(
        ", ",
      )}. Either add a fixture in tests/oracle/main.go that exercises the field, or document the gap in AGENT_TO_SERVER_IGNORE.`,
    ).toEqual([]);
  });

  it("every ServerToAgent proto field is exercised by ≥1 fixture", () => {
    const serverFixtures = [
      "server-command-restart",
      "server-error-response",
      "server-connection-settings",
      "server-agent-identification",
      "server-remote-config-push",
    ];
    const allCovered = new Set<string>();
    for (const name of serverFixtures) {
      const decoded = decodeServerToAgentProto(loadFixture(name).bin) as unknown as Record<
        string,
        unknown
      >;
      for (const k of fieldsCoveredByFixture(decoded)) allCovered.add(k);
    }
    const schemaFieldNames = ServerToAgentSchema.fields.map((f) => f.name);
    const missing = schemaFieldNames.filter(
      (n) => !allCovered.has(n) && !SERVER_TO_AGENT_IGNORE.has(n),
    );
    expect(
      missing,
      `ServerToAgent fields missing from oracle fixtures: ${missing.join(
        ", ",
      )}. Either add a fixture in tests/oracle/main.go that exercises the field, or document the gap in SERVER_TO_AGENT_IGNORE.`,
    ).toEqual([]);
  });
});

// ─── Server→Agent oracle ─────────────────────────────────────────────

describe("Oracle: opamp-go ServerToAgent fixtures", () => {
  describe("command (§5.9 Restart)", () => {
    let decoded: ServerToAgent;

    beforeAll(() => {
      const fixture = loadFixture("server-command-restart");
      decoded = decodeServerToAgentProto(fixture.bin);
    });

    it("decodes command and surfaces Restart type", () => {
      // Regression guard: decoder previously dropped the entire command
      // field even though encoder wrote it. Without this oracle the bug
      // could re-appear if someone refactors the decoder.
      expect(decoded.command).toBeDefined();
      expect(decoded.command!.type).toBe(CommandType.Restart);
    });

    it("does not surface other server fields", () => {
      expect(decoded.error_response).toBeUndefined();
      expect(decoded.remote_config).toBeUndefined();
      expect(decoded.connection_settings).toBeUndefined();
    });
  });

  describe("error_response (§4.5)", () => {
    let decoded: ServerToAgent;

    beforeAll(() => {
      const fixture = loadFixture("server-error-response");
      decoded = decodeServerToAgentProto(fixture.bin);
    });

    it("decodes error_response with BadRequest type", () => {
      expect(decoded.error_response).toBeDefined();
      expect(decoded.error_response!.type).toBe(ServerErrorResponseType.BadRequest);
      expect(decoded.error_response!.error_message).toBe("malformed AgentToServer");
    });

    it("decodes retry_info (was a historical drop)", () => {
      // codec comment notes a previous bug where retry_info silently
      // disappeared on decode; this fixture regression-guards it.
      expect(decoded.error_response!.retry_info).toBeDefined();
      expect(decoded.error_response!.retry_info!.retry_after_nanoseconds).toBe(5_000_000_000n);
    });
  });

  describe("connection_settings (§5.4)", () => {
    let decoded: ServerToAgent;

    beforeAll(() => {
      const fixture = loadFixture("server-connection-settings");
      decoded = decodeServerToAgentProto(fixture.bin);
    });

    it("preserves destination_endpoint, heartbeat, and bearer header", () => {
      // codec comment notes a previous bug where this whole field was
      // dropped by the decoder. This fixture is the regression guard.
      expect(decoded.connection_settings).toBeDefined();
      const cs = decoded.connection_settings!;
      expect(cs.opamp).toBeDefined();
      expect(cs.opamp!.destination_endpoint).toBe("wss://opamp.example.com/v1/opamp");
      expect(cs.opamp!.heartbeat_interval_seconds).toBe(30);
      const auth = cs.opamp!.headers?.find((h) => h.key === "Authorization");
      expect(auth?.value).toBe("Bearer test-claim-xyz");
    });
  });

  describe("agent_identification (§5.1)", () => {
    let decoded: ServerToAgent;

    beforeAll(() => {
      const fixture = loadFixture("server-agent-identification");
      decoded = decodeServerToAgentProto(fixture.bin);
    });

    it("decodes new_instance_uid bytes", () => {
      expect(decoded.agent_identification).toBeDefined();
      const uid = decoded.agent_identification!.new_instance_uid;
      expect(uid.length).toBe(16);
      expect(uid[0]).toBe(0xaa);
    });
  });

  describe("remote_config push (§5.3)", () => {
    let decoded: ServerToAgent;

    beforeAll(() => {
      const fixture = loadFixture("server-remote-config-push");
      decoded = decodeServerToAgentProto(fixture.bin);
    });

    it("preserves config map and hash", () => {
      expect(decoded.remote_config).toBeDefined();
      const rc = decoded.remote_config!;
      expect(rc.config_hash[0]).toBe(0xde);
      const file = rc.config!.config_map[""]!;
      expect(file.content_type).toBe("text/yaml");
      expect(new TextDecoder().decode(file.body)).toContain("processors:");
    });
  });
});
