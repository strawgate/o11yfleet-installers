// Property-based tests for the OpAMP state machine. processFrame is the
// heart of the protocol; these properties pin invariants that must hold
// across the entire input space.

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { processFrame } from "../src/state-machine/processor.js";
import type { AgentState, ProcessContext } from "../src/state-machine/types.js";
import type { AgentToServer } from "../src/codec/types.js";
import { ServerToAgentFlags } from "../src/codec/types.js";

// ─── arbitraries ───────────────────────────────────────────────────────

const uidArb = fc.uint8Array({ minLength: 16, maxLength: 16 });

function makeStateArb(): fc.Arbitrary<AgentState> {
  return fc.record({
    instance_uid: uidArb,
    tenant_id: fc.string({ minLength: 1, maxLength: 16 }),
    config_id: fc.string({ minLength: 1, maxLength: 16 }),
    sequence_num: fc.integer({ min: 0, max: 1_000_000 }),
    generation: fc.integer({ min: 1, max: 1000 }),
    healthy: fc.boolean(),
    status: fc.constantFrom("connected", "disconnected", "unknown"),
    last_error: fc.string({ maxLength: 32 }),
    current_config_hash: fc.option(uidArb, { nil: null }),
    desired_config_hash: fc.option(uidArb, { nil: null }),
    effective_config_hash: fc.option(fc.string({ maxLength: 64 }), { nil: null }),
    effective_config_body: fc.option(fc.string({ maxLength: 256 }), { nil: null }),
    last_seen_at: fc.integer({ min: 0, max: 2_000_000_000 }),
    connected_at: fc.integer({ min: 0, max: 2_000_000_000 }),
    agent_description: fc.option(fc.string({ maxLength: 64 }), { nil: null }),
    capabilities: fc.integer({ min: 0, max: 0xffff }),
    component_health_map: fc.option(fc.constant({}), { nil: null }),
    available_components: fc.option(fc.constant({}), { nil: null }),
  });
}

function makeMsgArb(): fc.Arbitrary<AgentToServer> {
  return fc.record({
    instance_uid: uidArb,
    sequence_num: fc.integer({ min: 0, max: 1_000_000 }),
    capabilities: fc.integer({ min: 0, max: 0xffff }),
    flags: fc.integer({ min: 0, max: 0xff }),
  });
}

function deterministicCtx(now: number): ProcessContext {
  let counter = 0;
  return {
    now,
    randomUid: () => new Uint8Array(16),
    randomId: () => `event-${(counter += 1)}`,
    sha256: async () => "0".repeat(64),
  };
}

// ─── properties ────────────────────────────────────────────────────────

// `event_id` is intentionally non-deterministic (sourced from ctx.randomId),
// so structural compares need to canonicalize it before equality. Everything
// else — including event ordering, payload, and full newState — must match.
function canonicalizeEvents(events: { event_id: string }[]): unknown[] {
  return events.map((e) => ({ ...e, event_id: "<id>" }));
}

function canonicalizeState(s: AgentState): unknown {
  return {
    ...s,
    instance_uid: Array.from(s.instance_uid),
    current_config_hash: s.current_config_hash ? Array.from(s.current_config_hash) : null,
    desired_config_hash: s.desired_config_hash ? Array.from(s.desired_config_hash) : null,
  };
}

describe("property: processFrame purity + determinism", () => {
  it("returns the same result for the same inputs (deterministic)", async () => {
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        // Separate ctxs so randomId counter state can't couple the two
        // runs. If processFrame is genuinely deterministic given the same
        // numeric inputs, the two calls produce structurally-equal
        // results modulo `event_id`.
        const a = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        const b = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));

        // Deep structural compare. Cherry-picking fields hides
        // nondeterminism in event payloads, response.command, and
        // newState fields not on the picklist — JSON-stringify the whole
        // thing instead.
        if (a.shouldPersist !== b.shouldPersist) return false;
        if (
          JSON.stringify(canonicalizeEvents(a.events)) !==
          JSON.stringify(canonicalizeEvents(b.events))
        ) {
          return false;
        }
        if (
          JSON.stringify(canonicalizeState(a.newState)) !==
          JSON.stringify(canonicalizeState(b.newState))
        ) {
          return false;
        }
        if (JSON.stringify(a.response) !== JSON.stringify(b.response)) return false;
        return true;
      }),
      { numRuns: 25 },
    );
  });

  it("does not mutate the input state object", async () => {
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        const before = JSON.stringify({
          ...state,
          instance_uid: Array.from(state.instance_uid),
          current_config_hash: state.current_config_hash
            ? Array.from(state.current_config_hash)
            : null,
          desired_config_hash: state.desired_config_hash
            ? Array.from(state.desired_config_hash)
            : null,
        });
        await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        const after = JSON.stringify({
          ...state,
          instance_uid: Array.from(state.instance_uid),
          current_config_hash: state.current_config_hash
            ? Array.from(state.current_config_hash)
            : null,
          desired_config_hash: state.desired_config_hash
            ? Array.from(state.desired_config_hash)
            : null,
        });
        return before === after;
      }),
      { numRuns: 25 },
    );
  });
});

describe("property: processFrame newState invariants", () => {
  it("newState.sequence_num is always set to the input msg.sequence_num", async () => {
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        return result.newState.sequence_num === msg.sequence_num;
      }),
      { numRuns: 25 },
    );
  });

  it("newState.last_seen_at always equals ctx.now", async () => {
    await fc.assert(
      fc.asyncProperty(
        makeStateArb(),
        makeMsgArb(),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        async (state, msg, now) => {
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            deterministicCtx(now),
          );
          return result.newState.last_seen_at === now;
        },
      ),
      { numRuns: 25 },
    );
  });

  it("newState carries forward all immutable identity fields", async () => {
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        return (
          result.newState.tenant_id === state.tenant_id &&
          result.newState.config_id === state.config_id &&
          arraysEqual(result.newState.instance_uid, state.instance_uid)
        );
      }),
      { numRuns: 25 },
    );
  });
});

describe("property: processFrame response invariants", () => {
  it("when response is non-null, instance_uid echoes the input msg.instance_uid", async () => {
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        if (result.response === null) return true; // disconnect path
        return arraysEqual(result.response.instance_uid, msg.instance_uid);
      }),
      { numRuns: 25 },
    );
  });

  // Note: sequence-gap detection runs *before* disconnect handling in
  // processFrame, so a disconnect frame with a non-contiguous sequence
  // number gets treated as a gap (response with ReportFullState),
  // not as a disconnect. This may be intentional — debatable protocol
  // semantics — so we constrain the property to contiguous sequences.
  // fast-check found this subtle ordering with seq_state=0, seq_msg=2.
  it("contiguous agent_disconnect → response is null and status becomes disconnected", async () => {
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        const contiguousMsg: AgentToServer = {
          ...msg,
          sequence_num: state.sequence_num + 1,
          agent_disconnect: {},
        };
        const result = await processFrame(
          state,
          contiguousMsg,
          undefined,
          undefined,
          deterministicCtx(1),
        );
        return (
          result.response === null &&
          result.newState.status === "disconnected" &&
          result.newState.connected_at === 0
        );
      }),
      { numRuns: 25 },
    );
  });

  it("sequence-gap (msg.seq != state.seq+1, msg.seq != 0) → ReportFullState flag set", async () => {
    await fc.assert(
      fc.asyncProperty(
        makeStateArb().filter((s) => s.sequence_num < 999_998),
        async (state) => {
          // Build a msg with seq deliberately != state.seq+1 and != 0.
          const badSeq = state.sequence_num + 5;
          const msg: AgentToServer = {
            instance_uid: state.instance_uid,
            sequence_num: badSeq,
            capabilities: 0,
            flags: 0,
          };
          const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
          if (result.response === null) return false;
          return (result.response.flags & ServerToAgentFlags.ReportFullState) !== 0;
        },
      ),
      { numRuns: 25 },
    );
  });

  // Documented design: gap-detection takes priority over the
  // disconnect handler so a replayed/forged disconnect frame can't tear
  // down a real session. See the comment in `processor.ts` above the
  // gap check. This property pins that ordering: any disconnect frame
  // that doesn't have a contiguous sequence number must be rejected as
  // a gap (response with ReportFullState), NOT honored as a disconnect.
  it("a disconnect frame with a gap'd sequence is treated as a gap, not a disconnect", async () => {
    await fc.assert(
      fc.asyncProperty(
        makeStateArb()
          .filter((s) => s.sequence_num > 0 && s.sequence_num < 999_990)
          // The gap-vs-disconnect distinction only matters when the agent
          // is still considered connected; if state already says
          // disconnected, the discriminator is moot.
          .filter((s) => s.status !== "disconnected"),
        async (state) => {
          const msg: AgentToServer = {
            instance_uid: state.instance_uid,
            sequence_num: state.sequence_num + 5, // off by 5 from contiguous
            capabilities: 0,
            flags: 0,
            agent_disconnect: {},
          };
          const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
          // Must NOT be honored as a disconnect:
          if (result.response === null) return false;
          if (result.newState.status === "disconnected") return false;
          // Must be a gap response:
          return (result.response.flags & ServerToAgentFlags.ReportFullState) !== 0;
        },
      ),
      { numRuns: 25 },
    );
  });

  it("contiguous, non-hello frames do NOT set ReportFullState", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Exclude `connected_at === 0` (which would make any frame an
        // isHello and legitimately set ReportFullState per OpAMP spec
        // §4.2). Also exclude `sequence_num === 0` to avoid msg.seq=1
        // hitting the seq=0 case path.
        makeStateArb().filter(
          (s) => s.sequence_num > 0 && s.sequence_num < 999_998 && s.connected_at > 0,
        ),
        async (state) => {
          const msg: AgentToServer = {
            instance_uid: state.instance_uid,
            sequence_num: state.sequence_num + 1, // contiguous
            capabilities: 0,
            flags: 0, // not a hello
          };
          const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
          if (result.response === null) return false; // expected a response
          // The point of this property: gap-detection didn't fire (seq
          // was contiguous), and it's not a hello, so ReportFullState
          // must NOT be in the response flags.
          return (result.response.flags & ServerToAgentFlags.ReportFullState) === 0;
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("property: capability tracking (B2 fix)", () => {
  // Pins the fix for: state-machine kept stale capabilities when an
  // agent dropped to capabilities=0. Without the fix, the DO would
  // continue offering remote config to an agent that had relinquished
  // AcceptsRemoteConfig.
  it("newState.capabilities always reflects msg.capabilities (including 0)", async () => {
    await fc.assert(
      fc.asyncProperty(
        makeStateArb(),
        fc.integer({ min: 0, max: 0xffff }),
        async (state, msgCaps) => {
          const msg: AgentToServer = {
            instance_uid: state.instance_uid,
            sequence_num: state.sequence_num + 1,
            capabilities: msgCaps,
            flags: 0,
          };
          const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
          return result.newState.capabilities === msgCaps;
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("property: shouldPersist invariants", () => {
  it("shouldPersist is always a boolean for arbitrary frames", async () => {
    // After the tiered persistence optimization, only frames with real
    // state changes (hello, health, config, capabilities, description)
    // produce shouldPersist=true. No-op heartbeats produce false — the
    // DO tracks seq_num in the WS attachment at zero cost.
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        // shouldPersist must be boolean (structural invariant)
        return typeof result.shouldPersist === "boolean";
      }),
      { numRuns: 25 },
    );
  });

  it("contiguous no-op heartbeats produce shouldPersist=false", async () => {
    // A heartbeat with only sequence_num incremented and no other state
    // changes must not trigger persistence — the DO tracks seq_num in
    // the WS attachment at zero cost.
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100_000 }), async (seqNum) => {
        const state: AgentState = {
          instance_uid: new Uint8Array(16),
          sequence_num: seqNum - 1,
          generation: 1,
          status: "connected",
          healthy: true,
          last_error: "",
          current_config_hash: null,
          effective_config_hash: null,
          capabilities: 0,
          connected_at: Date.now(),
          last_seen_at: Date.now(),
          agent_description: null,
          component_health_map: null,
          available_components: null,
        };
        const msg = {
          sequence_num: seqNum,
          capabilities: 0,
        };
        const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        return result.shouldPersist === false;
      }),
      { numRuns: 50 },
    );
  });

  it("shouldPersist=false always implies dirtyFields is empty", async () => {
    // If nothing is worth persisting, no fields should be marked dirty.
    // Violation here means the tier routing in config-do.ts would skip a
    // write that should have happened (or dirtyFields is being set needlessly).
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        if (!result.shouldPersist) {
          return result.dirtyFields.size === 0;
        }
        return true;
      }),
      { numRuns: 50 },
    );
  });

  it("dirtyFields only contains valid AgentState field names", async () => {
    // Catches typos in dirtyFields.add() calls — a misspelled field name
    // would silently cause the targeted UPDATE to skip writing that column.
    const validFields = new Set<string>([
      "sequence_num",
      "status",
      "healthy",
      "last_error",
      "connected_at",
      "capabilities",
      "component_health_map",
      "agent_description",
      "available_components",
      "effective_config_hash",
      "current_config_hash",
    ]);
    await fc.assert(
      fc.asyncProperty(makeStateArb(), makeMsgArb(), async (state, msg) => {
        const result = await processFrame(state, msg, undefined, undefined, deterministicCtx(1));
        for (const field of result.dirtyFields) {
          if (!validFields.has(field)) return false;
        }
        return true;
      }),
      { numRuns: 50 },
    );
  });
});

// ─── helpers ───────────────────────────────────────────────────────────

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
