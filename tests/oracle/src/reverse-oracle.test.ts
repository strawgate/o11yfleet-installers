// Reverse oracle: TS scenarios → our codec → protobuf bytes → Go opamp-go verifies.
//
// Proves our TypeScript encoder produces protobuf binary that the canonical
// Go opamp-go library can decode field-by-field.
//
// Flow:
// 1. Pull scenarios from `@o11yfleet/test-utils`
// 2. Encode each with our production codec (`encodeAgentToServerProto`)
// 3. Write as .bin files to tests/oracle/ts-fixtures/
// 4. Invoke `go run . verify ts-fixtures/` — Go decodes and asserts fields
// 5. Round-trip a representative scenario through encode → decode → field check
//
// Why scenarios + production encoder (not hand-rolled): previously this file
// duplicated ~80 LOC of encoder logic that paralleled the codec. Drift
// between the two encoders was a real risk (e.g., the codec gained
// `available_components` support but the parallel encoder didn't). Routing
// through `encodeAgentToServerProto` makes the reverse oracle a true test
// of our production wire format.

import { describe, it, expect, beforeAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  decodeAgentToServerProto,
  encodeAgentToServerProto,
  RemoteConfigStatuses,
} from "@o11yfleet/core/codec";
import {
  AGENT_SCENARIOS,
  KNOWN_UID,
  agentScenario,
  buildConfigAck,
  buildHello,
  buildHeartbeat,
} from "@o11yfleet/test-utils";

const ORACLE_DIR = resolve(__dirname, "..");
const TS_FIXTURE_DIR = resolve(ORACLE_DIR, "ts-fixtures");

// Scenarios the Go `verify` mode knows how to assert against. The Go side
// pins specific field expectations per fixture name in tests/oracle/main.go;
// keep this list in sync when scenarios are renamed or new ones gain Go
// verifiers.
const VERIFY_NAMES = [
  "hello",
  "heartbeat",
  "health-report",
  "config-ack",
  "description-report",
  "disconnect",
] as const;

function writeFixture(name: string, bytes: ArrayBuffer): void {
  writeFileSync(join(TS_FIXTURE_DIR, `${name}.bin`), new Uint8Array(bytes));
}

describe("Reverse oracle: TS scenarios → our encoder → opamp-go verifies", () => {
  beforeAll(() => {
    // Wipe the fixture dir before regenerating: stale files from prior
    // branches/scenarios would otherwise survive a checkout and skew Go
    // verification (Go iterates the directory, not the VERIFY_NAMES list).
    rmSync(TS_FIXTURE_DIR, { recursive: true, force: true });
    mkdirSync(TS_FIXTURE_DIR, { recursive: true });
    for (const name of VERIFY_NAMES) {
      const scenario = agentScenario(name);
      const wire = encodeAgentToServerProto(scenario.build());
      writeFixture(name, wire);
    }
  });

  it("Go oracle successfully decodes and verifies all TS-encoded scenarios", () => {
    const result = execSync(`go run . verify ${TS_FIXTURE_DIR}`, {
      cwd: ORACLE_DIR,
      timeout: 30_000,
      encoding: "utf-8",
    });
    for (const name of VERIFY_NAMES) {
      expect(result, `expected PASS line for ${name}`).toContain(`PASS ${name}`);
    }
    expect(result).toContain(`${VERIFY_NAMES.length}/${VERIFY_NAMES.length} verified`);
  });

  // Sanity: every scenario the test-utils library exposes can at least be
  // encoded with our codec without throwing. Catches scenario authors
  // building messages our encoder can't serialise (e.g., a new field added
  // to the type but missing from `internal*ToPb` mappers).
  it("every scenario in AGENT_SCENARIOS round-trips encode → decode without throwing", () => {
    for (const scenario of AGENT_SCENARIOS) {
      expect(() => {
        const msg = scenario.build();
        const wire = encodeAgentToServerProto(msg);
        decodeAgentToServerProto(wire);
      }, `scenario ${scenario.name}`).not.toThrow();
    }
  });

  it("hello scenario round-trip preserves identifying fields", () => {
    // Spot-check one scenario in detail — round-trip identity of every
    // critical field. Equivalent to the previous hand-built round-trip
    // test, but anchored on the scenario library's canonical hello.
    const original = agentScenario("hello").build();
    const wire = encodeAgentToServerProto(original);
    const decoded = decodeAgentToServerProto(wire);

    expect(decoded.instance_uid).toEqual(original.instance_uid);
    expect(decoded.sequence_num).toBe(original.sequence_num);
    expect(decoded.capabilities).toBe(original.capabilities);

    expect(decoded.agent_description).toBeDefined();
    const svcName = decoded.agent_description!.identifying_attributes.find(
      (a) => a.key === "service.name",
    );
    expect(svcName?.value.string_value).toBe("oracle-test-agent");

    expect(decoded.health).toBeDefined();
    expect(decoded.health!.healthy).toBe(true);

    expect(decoded.effective_config).toBeDefined();
    const cfg = decoded.effective_config!.config_map!.config_map[""];
    expect(cfg).toBeDefined();
    expect(cfg!.content_type).toBe("text/yaml");
  });

  it("heartbeat scenario has no optional fields after round-trip", () => {
    const original = agentScenario("heartbeat").build();
    const wire = encodeAgentToServerProto(original);
    const decoded = decodeAgentToServerProto(wire);

    expect(decoded.instance_uid).toEqual(KNOWN_UID);
    expect(decoded.health).toBeUndefined();
    expect(decoded.agent_description).toBeUndefined();
    expect(decoded.effective_config).toBeUndefined();
    expect(decoded.remote_config_status).toBeUndefined();
  });

  it("config-ack scenario preserves hash bytes and APPLIED status", () => {
    const original = agentScenario("config-ack").build();
    const wire = encodeAgentToServerProto(original);
    const decoded = decodeAgentToServerProto(wire);

    expect(decoded.remote_config_status).toBeDefined();
    expect(decoded.remote_config_status!.status).toBe(RemoteConfigStatuses.APPLIED);
    expect(decoded.remote_config_status!.last_remote_config_hash).toEqual(
      new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89]),
    );
  });

  // Imports `buildConfigAck`, `buildHello`, `buildHeartbeat` are kept so
  // call-site lints don't strip them while migrations are in progress —
  // referenced here as a no-op assertion to keep them live.
  it("test-utils continues to export legacy builders alongside scenarios", () => {
    expect(typeof buildHello).toBe("function");
    expect(typeof buildHeartbeat).toBe("function");
    expect(typeof buildConfigAck).toBe("function");
  });
});
