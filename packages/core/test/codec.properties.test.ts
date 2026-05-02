// Property-based tests for the OpAMP protobuf codec.
//
// Round-trip identity is the killer property here — if `decode(encode(x))`
// doesn't equal `x`, an entire class of protocol bugs is possible. The
// `connection_settings` decoder gap discovered during PR #422's review
// was an instance of exactly this; these tests would have caught it.
//
// Generators only construct messages composed of the fields our codec
// preserves. We don't try to round-trip every protobuf field — only
// the ones the internal types expose. That keeps the property cleanly
// expressible without leaking proto-level details.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  decodeAgentToServerProto,
  encodeAgentToServerProto,
  decodeServerToAgentProto,
  encodeServerToAgentProto,
  isProtobufFrame,
} from "../src/codec/protobuf.js";
import type { AgentToServer, ServerToAgent, ServerErrorResponseType } from "../src/codec/types.js";
import { CommandType, ConnectionSettingsStatuses } from "../src/codec/types.js";

const uidArb = fc.uint8Array({ minLength: 16, maxLength: 16 });
const u32Arb = fc.integer({ min: 0, max: 0x7fff_ffff });
const seqArb = fc.integer({ min: 0, max: 1_000_000 });

// ─── AgentToServer round-trips ─────────────────────────────────────────

const minimalAgentToServerArb: fc.Arbitrary<AgentToServer> = fc.record({
  instance_uid: uidArb,
  sequence_num: seqArb,
  capabilities: u32Arb,
  flags: u32Arb,
});

describe("property: encoder is deterministic", () => {
  // Repeat encodes of identical input must produce byte-identical
  // output. Without this property, the connection_settings hash
  // contract (where the agent's hash is recomputed by both sides)
  // would silently diverge.
  //
  // We assert TWO things:
  //   1. byte-identity of the two encodings — pins "no hidden
  //      timestamp / random / order-of-iteration in the encoder"
  //   2. that decoding both produces semantically-equal results —
  //      pins "deterministic output" rather than just "same bytes"
  //      (a degenerate encoder that always returned the same bytes
  //      regardless of input would pass #1 but fail #2).
  it("encodeAgentToServerProto is deterministic and reflects input", () => {
    fc.assert(
      fc.property(
        fc.record({
          instance_uid: uidArb,
          sequence_num: seqArb,
          capabilities: u32Arb,
          flags: u32Arb,
        }),
        (msg) => {
          const a = new Uint8Array(encodeAgentToServerProto(msg));
          const b = new Uint8Array(encodeAgentToServerProto(msg));
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
          // Output reflects input — guards against a degenerate
          // "always returns the same bytes" encoder.
          const round = decodeAgentToServerProto(a.buffer);
          return (
            round.sequence_num === msg.sequence_num &&
            round.capabilities === msg.capabilities &&
            round.flags === msg.flags
          );
        },
      ),
    );
  });

  it("encodeServerToAgentProto is deterministic and reflects input", () => {
    fc.assert(
      fc.property(
        fc.record({
          instance_uid: uidArb,
          flags: u32Arb,
          capabilities: u32Arb,
        }),
        (msg) => {
          const a = new Uint8Array(encodeServerToAgentProto(msg));
          const b = new Uint8Array(encodeServerToAgentProto(msg));
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
          const round = decodeServerToAgentProto(a.buffer);
          return round.flags === msg.flags && round.capabilities === msg.capabilities;
        },
      ),
    );
  });
});

describe("property: AgentToServer round-trip", () => {
  it("decode(encode(msg)) preserves all minimal fields", () => {
    fc.assert(
      fc.property(minimalAgentToServerArb, (msg) => {
        const round = decodeAgentToServerProto(encodeAgentToServerProto(msg));
        return (
          uidEq(round.instance_uid, msg.instance_uid) &&
          round.sequence_num === msg.sequence_num &&
          round.capabilities === msg.capabilities &&
          round.flags === msg.flags
        );
      }),
    );
  });

  it("encoded bytes start with the 0x00 protobuf data-type header", () => {
    fc.assert(
      fc.property(minimalAgentToServerArb, (msg) => {
        const buf = encodeAgentToServerProto(msg);
        const u8 = new Uint8Array(buf);
        return u8.length > 0 && u8[0] === 0x00;
      }),
    );
  });

  // Pins the byte[4]=0x7b false-negative fix. Before that fix, a valid
  // opamp-go protobuf frame whose 5th byte happened to equal '{' (0x7b)
  // was misclassified as JSON framing.
  it("isProtobufFrame returns true for any encoded AgentToServer frame", () => {
    fc.assert(
      fc.property(minimalAgentToServerArb, (msg) => isProtobufFrame(encodeAgentToServerProto(msg))),
    );
  });

  // Field 15 (agent → server) was decoded but never encoded. Bug found
  // during a codec audit on PR #497's follow-up; the encoder branch was
  // missing entirely. Without this property, in-process callers
  // (FakeAgent, future state-machine tests) that round-trip a
  // connection_settings_status acknowledgement would silently lose it.
  it("connection_settings_status round-trips hash + status + error_message", () => {
    fc.assert(
      fc.property(
        minimalAgentToServerArb,
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.constantFrom(
          ConnectionSettingsStatuses.UNSET,
          ConnectionSettingsStatuses.APPLIED,
          ConnectionSettingsStatuses.APPLYING,
          ConnectionSettingsStatuses.FAILED,
        ),
        // `?? ""` fallback in the encoder is exercised by including
        // undefined as a possible error_message value. Stryker flagged
        // this branch as surviving when the property used only fc.string.
        fc.option(fc.string({ minLength: 0, maxLength: 64 }), { nil: undefined }),
        (base, hash, status, errMsg) => {
          const msg: AgentToServer = {
            ...base,
            connection_settings_status: {
              last_connection_settings_hash: hash,
              status,
              error_message: errMsg,
            },
          };
          const round = decodeAgentToServerProto(encodeAgentToServerProto(msg));
          const css = round.connection_settings_status;
          if (!css) return false;
          if (!uidEq(css.last_connection_settings_hash, hash)) return false;
          if (css.status !== status) return false;
          // proto3 strings default to "", so an undefined input round-trips
          // through the `?? ""` encoder fallback to "" on the wire.
          const expected = errMsg ?? "";
          if (css.error_message !== expected) return false;
          return true;
        },
      ),
    );
  });

  // available_components (proto3 field 14) decoder branch was previously
  // unreached by core's own test suite (only oracle/scenarios round-trip
  // it). Stryker flagged the if-branch in `pbAgentToServerToInternal` as
  // [NoCoverage]. Cover with an explicit property: any non-empty
  // components map round-trips through encode → decode.
  it("available_components round-trips hash + components + nested metadata", () => {
    // Restrict to ASCII identifiers/values: fc.string can yield strings
    // containing lone surrogate halves which aren't valid UTF-8 and don't
    // round-trip through proto3 string fields. The property under test is
    // "the codec preserves the shape", not "every Unicode codepoint
    // round-trips" — the latter is a TextEncoder concern, not a codec one.
    const safeStringArb = fc.stringMatching(/^[a-zA-Z0-9._-]{1,16}$/);
    const safeValueArb = fc.stringMatching(/^[a-zA-Z0-9._: -]{0,32}$/);
    const hashArb = fc.uint8Array({ minLength: 8, maxLength: 32 });
    fc.assert(
      fc.property(
        minimalAgentToServerArb,
        hashArb,
        safeStringArb, // component kind name
        safeStringArb, // sub-component name
        safeStringArb, // metadata key
        safeValueArb, // metadata value
        (base, hash, kind, name, metaKey, metaVal) => {
          const msg: AgentToServer = {
            ...base,
            available_components: {
              hash,
              components: {
                [kind]: {
                  metadata: [],
                  sub_component_map: {
                    [name]: {
                      metadata: [{ key: metaKey, value: { string_value: metaVal } }],
                      sub_component_map: {},
                    },
                  },
                },
              },
            },
          };
          const round = decodeAgentToServerProto(encodeAgentToServerProto(msg));
          const ac = round.available_components as
            | { hash: Uint8Array; components: Record<string, unknown> }
            | undefined;
          if (!ac) return false;
          if (!uidEq(ac.hash, hash)) return false;
          const kindEntry = ac.components[kind] as
            | { sub_component_map: Record<string, unknown> }
            | undefined;
          if (!kindEntry) return false;
          const subEntry = kindEntry.sub_component_map[name] as
            | { metadata?: Array<{ key: string; value: { string_value?: string } }> }
            | undefined;
          if (!subEntry || !subEntry.metadata) return false;
          const meta = subEntry.metadata.find((m) => m.key === metaKey);
          if (!meta) return false;
          return meta.value.string_value === metaVal;
        },
      ),
    );
  });

  it("agent_description with identifying_attributes round-trips key/value", () => {
    const attrArb = fc.record({
      key: fc.string({ minLength: 1, maxLength: 32 }),
      value: fc.record({ string_value: fc.string({ minLength: 0, maxLength: 32 }) }),
    });
    fc.assert(
      fc.property(
        minimalAgentToServerArb,
        fc.array(attrArb, { minLength: 1, maxLength: 5 }),
        (base, attrs) => {
          const msg: AgentToServer = {
            ...base,
            agent_description: {
              identifying_attributes: attrs,
              non_identifying_attributes: [],
            },
          };
          const round = decodeAgentToServerProto(encodeAgentToServerProto(msg));
          const got = round.agent_description?.identifying_attributes ?? [];
          if (got.length !== attrs.length) return false;
          for (let i = 0; i < attrs.length; i += 1) {
            if (got[i]!.key !== attrs[i]!.key) return false;
            if (got[i]!.value.string_value !== attrs[i]!.value.string_value) return false;
          }
          return true;
        },
      ),
    );
  });
});

// ─── ServerToAgent round-trips ─────────────────────────────────────────

const minimalServerToAgentArb: fc.Arbitrary<ServerToAgent> = fc.record({
  instance_uid: uidArb,
  flags: u32Arb,
  capabilities: u32Arb,
});

describe("property: ServerToAgent round-trip", () => {
  it("decode(encode(msg)) preserves all minimal fields", () => {
    fc.assert(
      fc.property(minimalServerToAgentArb, (msg) => {
        const round = decodeServerToAgentProto(encodeServerToAgentProto(msg));
        return (
          uidEq(round.instance_uid, msg.instance_uid) &&
          round.flags === msg.flags &&
          round.capabilities === msg.capabilities
        );
      }),
    );
  });

  // The connection_settings decoder gap (silently dropped during decode)
  // was the bug discovered in PR #422 review. This property pins it.
  it("connection_settings round-trips opamp headers + heartbeat", () => {
    const headerArb = fc.record({
      key: fc.string({ minLength: 1, maxLength: 32 }),
      value: fc.string({ minLength: 0, maxLength: 64 }),
    });
    fc.assert(
      fc.property(
        minimalServerToAgentArb,
        fc.array(headerArb, { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 1, max: 86_400 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (base, headers, heartbeat, hash) => {
          const msg: ServerToAgent = {
            ...base,
            connection_settings: {
              hash,
              opamp: {
                headers,
                heartbeat_interval_seconds: heartbeat,
              },
            },
          };
          const round = decodeServerToAgentProto(encodeServerToAgentProto(msg));
          const cs = round.connection_settings;
          if (!cs) return false;
          // Assert hash round-trips byte-for-byte. The hash is the
          // identity of the settings — agents use it to detect when
          // the offered settings have changed. Dropping or corrupting
          // the hash would silently break that contract.
          if (!uidEq(cs.hash, hash)) return false;
          if (!cs.opamp) return false;
          if (cs.opamp.heartbeat_interval_seconds !== heartbeat) return false;
          const got = cs.opamp.headers ?? [];
          if (got.length !== headers.length) return false;
          for (let i = 0; i < headers.length; i += 1) {
            if (got[i]!.key !== headers[i]!.key) return false;
            if (got[i]!.value !== headers[i]!.value) return false;
          }
          return true;
        },
      ),
    );
  });

  it("error_response round-trips type + message", () => {
    const errorTypeArb = fc.constantFrom<ServerErrorResponseType>(0, 1, 2);
    fc.assert(
      fc.property(
        minimalServerToAgentArb,
        errorTypeArb,
        fc.string({ minLength: 0, maxLength: 128 }),
        (base, type, errorMessage) => {
          const msg: ServerToAgent = {
            ...base,
            error_response: { type, error_message: errorMessage },
          };
          const round = decodeServerToAgentProto(encodeServerToAgentProto(msg));
          return (
            round.error_response?.type === type &&
            round.error_response?.error_message === errorMessage
          );
        },
      ),
    );
  });

  // Regression test: error_response.retry_info was previously dropped
  // on decode. Catches the bug class where a sub-field is encoded but
  // not picked up by the corresponding decoder.
  //
  // The two-level assertion — first that `retry_info` exists at all,
  // then that the field matches — is deliberate: an encoder that
  // *also* dropped the field would yield `retry_info: undefined`, and
  // an `undefined?.retry_after_nanoseconds === ns` predicate would
  // resolve to `undefined === <bigint>` (false), correctly failing.
  // But explicit "exists" check makes that defense intentional rather
  // than incidental.
  it("error_response.retry_info round-trips retry_after_nanoseconds", () => {
    fc.assert(
      fc.property(
        minimalServerToAgentArb,
        fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
        (base, ns) => {
          const msg: ServerToAgent = {
            ...base,
            error_response: {
              type: 2 as ServerErrorResponseType, // Unavailable
              error_message: "rate limited",
              retry_info: { retry_after_nanoseconds: ns },
            },
          };
          const round = decodeServerToAgentProto(encodeServerToAgentProto(msg));
          if (!round.error_response) return false;
          if (!round.error_response.retry_info) return false;
          return round.error_response.retry_info.retry_after_nanoseconds === ns;
        },
      ),
    );
  });

  it("agent_identification round-trips new_instance_uid", () => {
    fc.assert(
      fc.property(minimalServerToAgentArb, uidArb, (base, newUid) => {
        const msg: ServerToAgent = {
          ...base,
          agent_identification: { new_instance_uid: newUid },
        };
        const round = decodeServerToAgentProto(encodeServerToAgentProto(msg));
        return uidEq(round.agent_identification?.new_instance_uid ?? new Uint8Array(), newUid);
      }),
    );
  });

  // The §5.9 `command` field decoder bug shipped because this property
  // was missing. The encoder wrote `command` but the decoder silently
  // dropped it; round-trip identity broke without any test catching it.
  // CommandType today only has Restart (=0); the property still pins the
  // contract that whatever the encoder writes, the decoder reads back.
  it("command round-trips every known CommandType", () => {
    // Auto-cover future enum values by deriving the arbitrary from the
    // enum itself. When a new CommandType lands the encoder will need a
    // mapping (it throws on unknown), but this property fires on the
    // additional value without test edits.
    const knownCommandTypes = Object.values(CommandType).filter(
      (v): v is CommandType => typeof v === "number",
    );
    const commandTypeArb = fc.constantFrom(...knownCommandTypes);
    fc.assert(
      fc.property(minimalServerToAgentArb, commandTypeArb, (base, type) => {
        const msg: ServerToAgent = {
          ...base,
          command: { type },
        };
        const round = decodeServerToAgentProto(encodeServerToAgentProto(msg));
        return round.command !== undefined && round.command.type === type;
      }),
    );
  });

  // Top-level `heart_beat_interval` (ServerToAgent field 12) is distinct
  // from `connection_settings.opamp.heartbeat_interval_seconds`. The
  // worker uses both: the connection-settings one is offered at enrollment,
  // the top-level one is the per-frame current recommendation. Both
  // need round-trip coverage; the connection-settings one is covered above.
  it("top-level heart_beat_interval round-trips", () => {
    fc.assert(
      fc.property(minimalServerToAgentArb, fc.integer({ min: 0, max: 86_400_000 }), (base, hb) => {
        const msg: ServerToAgent = { ...base, heart_beat_interval: hb };
        const round = decodeServerToAgentProto(encodeServerToAgentProto(msg));
        return round.heart_beat_interval === hb;
      }),
    );
  });
});

// ─── isProtobufFrame ───────────────────────────────────────────────────

describe("property: isProtobufFrame", () => {
  it("recognizes any frame produced by encodeServerToAgentProto", () => {
    fc.assert(
      fc.property(minimalServerToAgentArb, (msg) => isProtobufFrame(encodeServerToAgentProto(msg))),
    );
  });

  it("recognizes any frame produced by encodeAgentToServerProto", () => {
    fc.assert(
      fc.property(minimalAgentToServerArb, (msg) => isProtobufFrame(encodeAgentToServerProto(msg))),
    );
  });

  it("rejects empty buffers", () => {
    expect(isProtobufFrame(new ArrayBuffer(0))).toBe(false);
  });

  // Negative discriminator: a JSON-framed message (4-byte BE length, then
  // a JSON payload starting with '{') must be classified as NOT protobuf.
  // Sized 100 bytes here, well under the 16 MB ambiguity threshold.
  it("rejects a typical JSON-framed message", () => {
    const json = `{"hello":"world"}`;
    const jsonBytes = new TextEncoder().encode(json);
    const frame = new Uint8Array(4 + jsonBytes.length);
    // 4-byte BE length
    frame[0] = 0;
    frame[1] = 0;
    frame[2] = (jsonBytes.length >> 8) & 0xff;
    frame[3] = jsonBytes.length & 0xff;
    frame.set(jsonBytes, 4);
    expect(isProtobufFrame(frame.buffer)).toBe(false);
  });

  // Pins the historical bug: an opamp-go protobuf frame whose 5th byte
  // happens to be '{' (0x7b) — for instance, instance_uid[1] = 123 —
  // must NOT be classified as JSON framing.
  it("does not misclassify a protobuf frame whose byte[4] happens to be 0x7b", () => {
    const uid = new Uint8Array(16);
    uid[1] = 0x7b; // would have triggered the old byte[4] heuristic
    const buf = encodeAgentToServerProto({
      instance_uid: uid,
      sequence_num: 0,
      capabilities: 0,
      flags: 0,
    });
    expect(isProtobufFrame(buf)).toBe(true);
  });
});

// ─── helpers ───────────────────────────────────────────────────────────

function uidEq(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
