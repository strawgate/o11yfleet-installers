# Formal specs

Lightweight formal models of the architecturally-significant subsystems.
These exist to model-check safety + liveness across all interleavings of
operator and agent actions — a job tests can't do because they only
cover specific sequences.

## Files

| File                             | What it specifies                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pending.tla`](pending.tla)     | Pending-collector lifecycle (token issue/revoke, agent connect, operator assign, claim consume).                                                                    |
| [`pending.cfg`](pending.cfg)     | TLC model config: 2 tenants × 2 configs × 3 tokens × 2 devices.                                                                                                     |
| [`processor.tla`](processor.tla) | OpAMP `processFrame` state machine — sequence-num progression, status transitions, capability tracking, config-hash updates, contiguous vs gap-induced disconnects. |
| [`processor.cfg`](processor.cfg) | TLC model config: MaxSeq=3 × 3 capability values × 3 config hashes.                                                                                                 |

## Running TLC

Install the TLA+ Toolbox or `tlc` command-line tool:

```bash
# Homebrew (macOS)
brew install --cask tla-plus-toolbox
# Or grab `tla2tools.jar` from https://github.com/tlaplus/tlaplus/releases

# All commands assume cwd = docs/spec (cfg/tla files are relative).
cd docs/spec

# Run TLC against the pending-collector spec
java -jar tla2tools.jar -config pending.cfg pending.tla

# Run TLC against the processor state-machine spec
java -jar tla2tools.jar -config processor.cfg processor.tla
```

Status: this is the **first-pass spec — design artifact, not yet
TLC-verified**. The "What the spec proves" section below describes the
_intended_ invariants — they are the safety/liveness contract the spec
formalizes, not facts that have been checked against the model
checker. TLA+ specs typically need a few iterations of TLC feedback
(parser issues, infinite-state explosions, fairness adjustments)
before they run cleanly. Running it under TLC is a follow-up.

Two known TLC-iteration items I'd expect to surface:

- `<<>>` for the initial empty function may need to be written as
  `[d \in {} |-> {}]` for some TLC versions.
- `Assign` updates the function map in two branches — TLC may prefer
  EXCEPT-form unification.

Neither affects the _intent_ of the spec; they're stylistic fixes for
the model checker.

## Intended invariants (spec contract; pending TLC verification)

### `pending.tla` — pending-collector lifecycle

**Safety:**

- `TypeOK` — state stays well-typed across all transitions.
- `ClaimsRespectScope` — a claim's `config_id` never disagrees with
  the connecting token's scope. Catches races where an operator
  assigns to a different config concurrently with the agent
  reconnecting.
- `AssignmentsReferenceDevices` — `pending_assignments` rows only
  exist for known pending devices.
- `NoDuplicateClaim` — at most one claim per device. Catches the bug
  where `pending_assignments` is consumed multiple times.

**Liveness:**

- `EveryAssignmentEventuallyClaimed` — under fair scheduling of the
  consume action, every assignment eventually becomes a claim. This
  is what the live-push + reconnect-promotion code together
  guarantee.

### `processor.tla` — `processFrame` state machine

**Safety:**

- `TypeOK` — state stays well-typed across all transitions.
- `DisconnectsAreContiguous` — the model only emits a disconnect
  after a sequence-contiguous frame; gap-induced disconnects flow
  through `GapDisconnect` so the processor can't be tricked into
  emitting the wrong status by a forged gap.
- `CurrentHashStable` — `agentCurrentHash` only advances on a
  successful contiguous frame, never spontaneously.
- `NoSpontaneousReconnect` — once disconnected, the agent must send
  a `Hello` (with sequence_num=0 reset) before status returns to
  connected.

## What it doesn't cover

- The actual TypeScript implementation. The spec is the _intent_; the
  pure decision functions (`decision.ts`, `do-name.ts`,
  `policy-schemas.ts`) implement it. fast-check property tests
  (`apps/worker/test/properties.test.ts`) check the implementation
  matches its own contract.
- Network-level concerns (header injection, TLS, etc.).
- Performance / capacity.

## Updating the spec

When the lifecycle changes — new states, new transitions, new
invariants — update `pending.tla` first, run TLC to confirm the new
property still holds (or to find the violation), then implement the
change in TypeScript.

## Companion: property-based + mutation testing

The TLA+ spec covers _interleavings_ — what's correct across all
orderings of agent and operator events. Two complementary techniques
cover the _implementation_ of the pure decision functions:

- **Property tests** (`apps/worker/test/properties.test.ts`) use
  fast-check to verify the implementation matches its contract over
  randomized inputs. These run in plain Node (no CF runtime), so
  they're fast enough to keep on the default test path.
- **Mutation testing** (Stryker, configured per package) flips
  operators in source and reruns the test suite. Surviving mutants =
  test gaps. Run with `just mutate` (slow — multi-minute).

  Current baselines (as of 2026-05-01; regenerate with
  `just mutate` from each package, then read the score from
  `reports/mutation/index.html`):

  | Module                                              | Score  |
  | --------------------------------------------------- | ------ |
  | `apps/worker/src/durable-objects/do-name.ts`        | 100%   |
  | `apps/worker/src/durable-objects/policy-schemas.ts` | 96.67% |
  | `packages/core/src/hex.ts`                          | 94.74% |
  | `packages/core/src/auth/base64url.ts`               | 94.74% |
  | `packages/core/src/auth/claims.ts`                  | 94.44% |
  | `packages/core/src/auth/timing-safe-compare.ts`     | 92.86% |
  | `packages/core/src/auth/enrollment.ts`              | 88.07% |
  | `packages/core/src/state-machine/processor.ts`      | 69.84% |
  | `packages/core/src/codec/protobuf.ts`               | 58.11% |

  The auth + small modules sit above the 90% threshold; state-machine
  and codec are partial. Improving those is bounded work — add property
  tests for the uncovered branches, rerun, repeat — but is its own
  multi-day effort separate from this PR. The _value_ delivered by
  the current properties isn't the percentage, it's the bugs they
  found (the `connection_settings` decoder gap in `protobuf.ts`, the
  `isProtobufFrame` 0x7b false-negative, the disconnect-vs-gap
  ordering in `processor.ts`).

Together: TLA+ proves the _design_, fast-check exercises the
_implementation_ against its own contract, mutation testing verifies
the _tests_ actually catch bugs.
