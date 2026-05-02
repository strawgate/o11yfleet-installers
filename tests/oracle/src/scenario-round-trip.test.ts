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

// Deep round-trip: top-level scalars catch the most common regressions, and
// `toMatchObject` then asserts every nested payload field the scenario set
// also survives encode → decode. Tolerates extra fields the decoder fills
// with proto defaults (e.g. omitted optionals coming back as undefined or 0).
//
// Both previously-skipped scenarios — `available-components` (encoder/decoder
// gap for ComponentDetails) and `server-command-restart` (proto3 default-
// value elision swallowing `command.type=0`) — are closed by #494 and now
// round-trip cleanly. Removing the skip lists is the regression guard.

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
      expect(decoded).toMatchObject(msg);
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
      expect(decoded).toMatchObject(msg);
    });
  }
});
