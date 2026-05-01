// Property-based tests for the OpAMP state machine (processFrame).
// Uses fast-check to generate random message sequences and verify
// that invariants always hold — no matter what the agent sends.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { processFrame } from "../src/state-machine/processor.js";
import type { AgentState, ProcessContext } from "../src/state-machine/types.js";
import type { AgentToServer } from "../src/codec/types.js";
import { AgentCapabilities, RemoteConfigStatuses } from "../src/codec/types.js";
import { FleetEventType } from "../src/events.js";

// ─── Arbitraries ────────────────────────────────────────────────────

const arbUint8Array = (len: number) => fc.uint8Array({ minLength: len, maxLength: len });

const arbCapabilities = fc.constantFrom(
  0,
  AgentCapabilities.ReportsStatus,
  AgentCapabilities.AcceptsRemoteConfig,
  AgentCapabilities.ReportsHealth,
  AgentCapabilities.ReportsStatus |
    AgentCapabilities.AcceptsRemoteConfig |
    AgentCapabilities.ReportsHealth,
  AgentCapabilities.ReportsStatus |
    AgentCapabilities.AcceptsRemoteConfig |
    AgentCapabilities.ReportsEffectiveConfig |
    AgentCapabilities.ReportsHealth |
    AgentCapabilities.ReportsRemoteConfig |
    AgentCapabilities.ReportsHeartbeat,
);

const arbConfigStatus = fc.constantFrom(
  RemoteConfigStatuses.UNSET,
  RemoteConfigStatuses.APPLIED,
  RemoteConfigStatuses.APPLYING,
  RemoteConfigStatuses.FAILED,
);

const arbHealth = fc.record({
  healthy: fc.boolean(),
  start_time_unix_nano: fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }),
  last_error: fc.string({ maxLength: 100 }),
  status: fc.constantFrom("running", "degraded", "stopped", "starting"),
  status_time_unix_nano: fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }),
  component_health_map: fc.constant({}),
});

const arbMessage = (seq: number): fc.Arbitrary<AgentToServer> =>
  fc.record({
    instance_uid: arbUint8Array(16),
    sequence_num: fc.constant(seq),
    capabilities: arbCapabilities,
    flags: fc.constant(0),
    health: fc.option(arbHealth, { nil: undefined }),
    remote_config_status: fc.option(
      fc.record({
        last_remote_config_hash: arbUint8Array(32),
        status: arbConfigStatus,
        error_message: fc.string({ maxLength: 100 }),
      }),
      { nil: undefined },
    ),
    agent_disconnect: fc.option(fc.constant({}), { nil: undefined }),
  });

function makeInitialState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    instance_uid: new Uint8Array(16),
    tenant_id: "tenant-prop",
    config_id: "config-prop",
    sequence_num: 0,
    generation: 1,
    healthy: true,
    status: "unknown",
    last_error: "",
    current_config_hash: null,
    desired_config_hash: null,
    effective_config_hash: null,
    effective_config_body: null,
    last_seen_at: 0,
    connected_at: 0,
    agent_description: null,
    capabilities: 0,
    component_health_map: null,
    available_components: null,
    ...overrides,
  };
}

// ─── Deterministic context for reproducible tests ───────────────────
let deterministicIdCounter = 0;
function makeDeterministicCtx(): ProcessContext {
  return {
    now: 1700000000000,
    randomUid: () => new Uint8Array(16).fill(0x42),
    randomId: () => `test-event-id-${deterministicIdCounter++}`,
    sha256: async (input: string) => {
      const data = new TextEncoder().encode(input);
      const buf = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
  };
}

// ─── Property Tests ─────────────────────────────────────────────────

describe("state-machine property tests", () => {
  it("processFrame never throws on any valid message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 1000 }).chain((seq) => arbMessage(seq)),
        fc.option(arbUint8Array(32), { nil: undefined }),
        async (msg, desiredHash) => {
          const state = makeInitialState({
            desired_config_hash: desiredHash ?? null,
            capabilities: AgentCapabilities.AcceptsRemoteConfig,
          });
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            makeDeterministicCtx(),
          );
          expect(result).toBeDefined();
          expect(result.newState).toBeDefined();
          expect(result.events).toBeInstanceOf(Array);
          expect(typeof result.shouldPersist).toBe("boolean");
        },
      ),
      { numRuns: 500 },
    );
  });

  it("last_seen_at never decreases across a message sequence", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 3, max: 20 }), async (msgCount) => {
        let state = makeInitialState();
        let prevLastSeen = 0;

        for (let i = 0; i < msgCount; i++) {
          const msg: AgentToServer = {
            instance_uid: new Uint8Array(16),
            sequence_num: i,
            capabilities: AgentCapabilities.ReportsStatus,
            flags: 0,
          };
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            makeDeterministicCtx(),
          );
          expect(result.newState.last_seen_at).toBeGreaterThanOrEqual(prevLastSeen);
          prevLastSeen = result.newState.last_seen_at;
          state = result.newState;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("connected_at is set on first message and never changes after", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 3, max: 20 }), async (msgCount) => {
        let state = makeInitialState();
        let firstConnectedAt: number | null = null;

        for (let i = 0; i < msgCount; i++) {
          const msg: AgentToServer = {
            instance_uid: new Uint8Array(16),
            sequence_num: i,
            capabilities: AgentCapabilities.ReportsStatus,
            flags: 0,
          };
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            makeDeterministicCtx(),
          );

          if (i === 0) {
            // First message (hello) must set connected_at
            expect(result.newState.connected_at).toBeGreaterThan(0);
            firstConnectedAt = result.newState.connected_at;
          } else {
            // Subsequent messages must not change connected_at
            expect(result.newState.connected_at).toBe(firstConnectedAt);
          }
          state = result.newState;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("sequence gap always requests full state report", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 2, max: 50 }),
        async (currentSeq, gap) => {
          const state = makeInitialState({
            sequence_num: currentSeq,
            connected_at: 1700000000000,
          });
          const msg: AgentToServer = {
            instance_uid: new Uint8Array(16),
            sequence_num: currentSeq + gap + 1, // Gap of `gap`
            capabilities: AgentCapabilities.ReportsStatus,
            flags: 0,
          };
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            makeDeterministicCtx(),
          );
          // ReportFullState flag (0x1) must be set
          expect(result.response!.flags & 0x1).toBeTruthy();
          expect(result.shouldPersist).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("disconnect always emits exactly one AGENT_DISCONNECTED event", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 100 }), async (currentSeq) => {
        const state = makeInitialState({
          sequence_num: currentSeq,
          connected_at: 1700000000000,
        });
        const msg: AgentToServer = {
          instance_uid: new Uint8Array(16),
          sequence_num: currentSeq + 1,
          capabilities: AgentCapabilities.ReportsStatus,
          flags: 0,
          agent_disconnect: {},
        };
        const result = await processFrame(state, msg, undefined, undefined, makeDeterministicCtx());
        expect(result.response).toBeNull();
        expect(result.events).toHaveLength(1);
        expect(result.events[0]!.type).toBe(FleetEventType.AGENT_DISCONNECTED);
        expect(result.shouldPersist).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("config offer only happens when desired != current AND agent accepts remote config", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUint8Array(32),
        fc.option(arbUint8Array(32), { nil: null }),
        arbCapabilities,
        async (desiredHash, currentHash, capabilities) => {
          const state = makeInitialState({
            sequence_num: 1,
            connected_at: 1700000000000,
            desired_config_hash: desiredHash,
            current_config_hash: currentHash,
            capabilities,
          });
          const msg: AgentToServer = {
            instance_uid: new Uint8Array(16),
            sequence_num: 2,
            capabilities,
            flags: 0,
          };
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            makeDeterministicCtx(),
          );

          const hashesMatch =
            currentHash !== null &&
            desiredHash.length === currentHash.length &&
            desiredHash.every((b, i) => b === currentHash[i]);

          const acceptsConfig = (capabilities & AgentCapabilities.AcceptsRemoteConfig) !== 0;

          if (hashesMatch || !acceptsConfig) {
            expect(result.response!.remote_config).toBeUndefined();
          }
          // If hashes differ AND agent accepts config, offer MUST be present
          if (!hashesMatch && acceptsConfig) {
            expect(result.response!.remote_config).toBeDefined();
            expect(result.response!.remote_config!.config_hash).toEqual(desiredHash);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("hello message always emits AGENT_CONNECTED and persists", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCapabilities,
        fc.option(arbHealth, { nil: undefined }),
        async (capabilities, health) => {
          const state = makeInitialState();
          const msg: AgentToServer = {
            instance_uid: new Uint8Array(16),
            sequence_num: 0, // Hello
            capabilities,
            flags: 0,
            health,
          };
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            makeDeterministicCtx(),
          );

          expect(result.shouldPersist).toBe(true);
          const connectedEvents = result.events.filter(
            (e) => e.type === FleetEventType.AGENT_CONNECTED,
          );
          expect(connectedEvents).toHaveLength(1);
          expect(result.newState.connected_at).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("all emitted events have correct tenant_id and config_id", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100 }).chain((seq) => arbMessage(seq)),
        async (msg) => {
          const state = makeInitialState({
            tenant_id: "t-check",
            config_id: "c-check",
            desired_config_hash: new Uint8Array(32).fill(0xff),
            capabilities: AgentCapabilities.AcceptsRemoteConfig,
          });
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            makeDeterministicCtx(),
          );

          for (const event of result.events) {
            expect(event.tenant_id).toBe("t-check");
            expect(event.config_id).toBe("c-check");
            expect(event.timestamp).toBeGreaterThan(0);
            expect(typeof event.instance_uid).toBe("string");
            expect(typeof event.event_id).toBe("string");
            expect(event.event_id.length).toBeGreaterThan(0);
            expect(typeof event.dedupe_key).toBe("string");
            expect(event.dedupe_key.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("pure heartbeat (no changes) always persists (seq + last_seen_at)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 5, max: 50 }), async (currentSeq) => {
        const state = makeInitialState({
          sequence_num: currentSeq,
          connected_at: 1700000000000 - 60000,
          healthy: true,
          status: "running",
          capabilities: AgentCapabilities.ReportsStatus,
        });
        const msg: AgentToServer = {
          instance_uid: new Uint8Array(16),
          sequence_num: currentSeq + 1,
          capabilities: AgentCapabilities.ReportsStatus,
          flags: 0,
          // No health, no config status, no description, no disconnect
        };
        const result = await processFrame(state, msg, undefined, undefined, makeDeterministicCtx());
        // Always persists: sequence_num + last_seen_at saved on every message
        expect(result.shouldPersist).toBe(true);
        expect(result.events).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  it("CONFIG_APPLIED event only emitted for APPLIED status", async () => {
    await fc.assert(
      fc.asyncProperty(arbConfigStatus, arbUint8Array(32), async (status, hash) => {
        const state = makeInitialState({
          sequence_num: 5,
          connected_at: 1700000000000,
        });
        const msg: AgentToServer = {
          instance_uid: new Uint8Array(16),
          sequence_num: 6,
          capabilities: AgentCapabilities.ReportsStatus,
          flags: 0,
          remote_config_status: {
            last_remote_config_hash: hash,
            status,
            error_message: "",
          },
        };
        const result = await processFrame(state, msg, undefined, undefined, makeDeterministicCtx());

        const appliedEvents = result.events.filter((e) => e.type === FleetEventType.CONFIG_APPLIED);
        const rejectedEvents = result.events.filter(
          (e) => e.type === FleetEventType.CONFIG_REJECTED,
        );

        if (status === RemoteConfigStatuses.APPLIED) {
          expect(appliedEvents).toHaveLength(1);
          expect(rejectedEvents).toHaveLength(0);
        } else if (status === RemoteConfigStatuses.FAILED) {
          expect(appliedEvents).toHaveLength(0);
          expect(rejectedEvents).toHaveLength(1);
        } else {
          // UNSET or APPLYING — no config events
          expect(appliedEvents).toHaveLength(0);
          expect(rejectedEvents).toHaveLength(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("response always contains correct server capabilities", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100 }).chain((seq) => arbMessage(seq)),
        async (msg) => {
          // Skip disconnect messages (response is null)
          if (msg.agent_disconnect) return;

          const state = makeInitialState();
          const result = await processFrame(
            state,
            msg,
            undefined,
            undefined,
            makeDeterministicCtx(),
          );

          if (result.response) {
            // Server should always declare AcceptsStatus | OffersRemoteConfig | AcceptsEffectiveConfig
            expect(result.response.capabilities & 0x1).toBeTruthy(); // AcceptsStatus
            expect(result.response.capabilities & 0x2).toBeTruthy(); // OffersRemoteConfig
            expect(result.response.capabilities & 0x4).toBeTruthy(); // AcceptsEffectiveConfig
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Stress: long message sequences ─────────────────────────────────

describe("state-machine stress tests", () => {
  it("1000-message sequence maintains all invariants", async () => {
    let state = makeInitialState({
      desired_config_hash: new Uint8Array(32).fill(0xaa),
    });
    const allEvents: string[] = [];

    for (let i = 0; i < 1000; i++) {
      const msg: AgentToServer = {
        instance_uid: new Uint8Array(16),
        sequence_num: i,
        capabilities:
          AgentCapabilities.ReportsStatus |
          AgentCapabilities.AcceptsRemoteConfig |
          AgentCapabilities.ReportsHealth,
        flags: 0,
        health:
          i % 10 === 0
            ? {
                healthy: i % 20 === 0,
                start_time_unix_nano: 0n,
                last_error: i % 20 === 0 ? "" : "intermittent",
                status: i % 20 === 0 ? "running" : "degraded",
                status_time_unix_nano: 0n,
                component_health_map: {},
              }
            : undefined,
        remote_config_status:
          i === 50
            ? {
                last_remote_config_hash: new Uint8Array(32).fill(0xaa),
                status: RemoteConfigStatuses.APPLIED,
                error_message: "",
              }
            : undefined,
      };

      const result = await processFrame(state, msg, undefined, undefined, makeDeterministicCtx());

      // Invariant: last_seen_at never decreases
      expect(result.newState.last_seen_at).toBeGreaterThanOrEqual(state.last_seen_at);

      // Invariant: sequence_num tracks
      expect(result.newState.sequence_num).toBe(i);

      for (const e of result.events) {
        allEvents.push(e.type);
      }
      state = result.newState;
    }

    // Should have exactly 1 connected event (hello at seq=0)
    expect(allEvents.filter((e) => e === FleetEventType.AGENT_CONNECTED)).toHaveLength(1);

    // Should have exactly 1 config applied event (at seq=50)
    expect(allEvents.filter((e) => e === FleetEventType.CONFIG_APPLIED)).toHaveLength(1);

    // After config applied, config should not be offered anymore
    const finalMsg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 1000,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
    };
    const finalResult = await processFrame(
      state,
      finalMsg,
      undefined,
      undefined,
      makeDeterministicCtx(),
    );
    expect(finalResult.response!.remote_config).toBeUndefined();
  });

  it("rapid health toggling is idempotent for same state", async () => {
    let state = makeInitialState({
      sequence_num: 0,
      connected_at: 1700000000000,
      healthy: true,
      status: "running",
      capabilities: AgentCapabilities.ReportsHealth,
    });
    let healthChangeCount = 0;

    for (let i = 1; i <= 100; i++) {
      const msg: AgentToServer = {
        instance_uid: new Uint8Array(16),
        sequence_num: i,
        capabilities: AgentCapabilities.ReportsHealth,
        flags: 0,
        health: {
          healthy: true,
          start_time_unix_nano: 0n,
          last_error: "",
          status: "running",
          status_time_unix_nano: 0n,
          component_health_map: {},
        },
      };
      const result = await processFrame(state, msg, undefined, undefined, makeDeterministicCtx());
      healthChangeCount += result.events.filter(
        (e) => e.type === FleetEventType.AGENT_HEALTH_CHANGED,
      ).length;
      state = result.newState;
    }

    // Health never changed from the initial state, so 0 events expected
    expect(healthChangeCount).toBe(0);
  });
});
