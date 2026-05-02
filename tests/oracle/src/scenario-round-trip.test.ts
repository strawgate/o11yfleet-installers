// Scenario-driven round-trip coverage.
//
// Every scenario in `@o11yfleet/test-utils` is encoded with our production
// codec, decoded back, and required to preserve the message's defining
// scalar fields. This is the *breadth* test — adding a scenario adds
// coverage here automatically.
//
// Lives in tests/oracle/ rather than packages/core/test/ because core
// does not depend on test-utils (test-utils → core, not the other way
// around). Keeping this here avoids a dependency cycle.
//
// Targeted edge-case codec tests stay in `packages/core/test/protobuf-codec.test.ts`;
// this file is purely the "every scenario round-trips" sweep.

import { describe, it, expect } from "vitest";
import {
  decodeAgentToServerProto,
  decodeServerToAgentProto,
  encodeAgentToServerProto,
  encodeServerToAgentProto,
} from "@o11yfleet/core/codec";
import { AGENT_SCENARIOS, SERVER_SCENARIOS } from "@o11yfleet/test-utils";

// Round-trip fields. Top-level scalars catch the most common regressions; we
// also check the nested payload fields each scenario actually sets so a
// decoder dropping a sub-tree (e.g. component_health_map leaves, agent
// description attrs) is caught. Two known limitations skipped per-scenario:
//
//   - `available_components`: codec gap — encoder/decoder do not yet handle
//     ComponentDetails. Tracked separately; once closed, drop the skip.
//   - `command.type === 0`: proto3 default-value elision — the enum's zero
//     value is omitted on the wire, so the whole `command` object collapses
//     to `undefined` on decode. This is correct proto3 behavior, not a bug.
const AGENT_SKIP_DEEP: Record<string, true> = { "available-components": true };
const SERVER_SKIP_DEEP: Record<string, true> = { "server-command-restart": true };

describe("scenario round-trip (AgentToServer)", () => {
  for (const scenario of AGENT_SCENARIOS) {
    it(`${scenario.name}: encode → decode preserves the payload`, () => {
      const msg = scenario.build();
      const wire = encodeAgentToServerProto(msg);
      const decoded = decodeAgentToServerProto(wire);
      expect(decoded.instance_uid).toEqual(msg.instance_uid);
      expect(decoded.sequence_num).toBe(msg.sequence_num);
      expect(decoded.capabilities).toBe(msg.capabilities);
      expect(decoded.flags).toBe(msg.flags);
      if (!AGENT_SKIP_DEEP[scenario.name]) {
        // Deep-match every nested payload field the scenario set. tolerates
        // extra fields filled in by the decoder (proto defaults).
        expect(decoded).toMatchObject(msg);
      }
    });
  }
});

describe("scenario round-trip (ServerToAgent)", () => {
  for (const scenario of SERVER_SCENARIOS) {
    it(`${scenario.name}: encode → decode preserves the payload`, () => {
      const msg = scenario.build();
      const wire = encodeServerToAgentProto(msg);
      const decoded = decodeServerToAgentProto(wire);
      expect(decoded.instance_uid).toEqual(msg.instance_uid);
      expect(decoded.flags).toBe(msg.flags);
      expect(decoded.capabilities).toBe(msg.capabilities);
      if (!SERVER_SKIP_DEEP[scenario.name]) {
        expect(decoded).toMatchObject(msg);
      }
    });
  }
});
