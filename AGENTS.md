# o11yFleet Agent Instructions

## Project Overview

OpAMP (Open Agent Management Protocol) fleet management built on Cloudflare Workers, Durable Objects, D1, R2, and Queues.

## Documentation Routing

| File                            | Purpose                                    |
| ------------------------------- | ------------------------------------------ |
| `README.md`                     | User-facing overview, quick start          |
| `DEVELOPING.md`                 | Developer workflow, package map, test flow |
| `CODE_STYLE.md`                 | Subjective reviewer/style preferences      |
| `docs/README.md`                | Documentation index                        |
| `docs/architecture/overview.md` | Technical architecture details             |
| `justfile`                      | All developer commands                     |

## Key Commands

```bash
just dev         # Start worker locally
just dev-up      # Start worker + apps/site, migrate, seed
just check       # Changed-file-aware local check
just ci-fast     # Fast local CI gate
just setup       # Migrate, seed, and show fleet status
just ui          # Start apps/site UI
just test        # Run all tests
just test-core   # Core package only (fast)
just test-worker # Worker unit tests
just test-runtime # Worker runtime tests (workerd runtime)
just lint        # Lint all packages
just typecheck   # Type check all packages
just bench       # Run benchmarks
```

## Package Structure

| Package                | Role                                              |
| ---------------------- | ------------------------------------------------- |
| `packages/core/`       | OpAMP codec, state machine, auth (pure TS, no CF) |
| `packages/db/`         | D1 migrations and schema                          |
| `packages/test-utils/` | Shared test utilities                             |
| `apps/worker/`         | Cloudflare Worker (API + OpAMP + DO)              |
| `apps/site/`           | React/Vite marketing site, user portal, admin UI  |

## Project-Specific Rules

- Worker runtime tests use `@cloudflare/vitest-pool-workers`
- Core package tests run in plain Vitest (no CF runtime needed)
- All packages use TypeScript with strict mode
- Config DO uses SQLite internally (not D1) for agent state
- Enroll tokens use HMAC-SHA256 signed claims (no JWT library needed)

## CI Pipeline

See `.github/workflows/ci.yml`:

- lint-format, typecheck, test-core, test-worker run in parallel
- bundle-size checks worker bundle (3MB compressed budget)
- terraform validates IaC
- deploy-staging runs smoke tests on push to main

## Testing Guide

### Test Organization

Tests are organized by layer and purpose:

```text
packages/core/test/         # Pure TypeScript unit tests
  state-machine.test.ts     # Unit tests for processFrame
  state-machine.purity.test.ts     # Property tests: purity, determinism, invariants
  state-machine.sequences.test.ts   # Property tests: message sequences, stress tests
  hex.test.ts               # Unit tests
  hex.properties.test.ts    # Property-based edge case coverage
  codec.properties.test.ts  # Protobuf round-trip properties

apps/worker/test/           # Worker integration tests (with CF bindings)
  api.test.ts               # REST API endpoint tests
  config-do.test.ts         # Durable Object tests
  protocol.test.ts          # WebSocket/OpAMP protocol tests
  ai-guidance.test.ts       # AI guidance route tests

packages/test-utils/        # Shared test infrastructure
  src/fixtures/             # Reusable test data builders
  src/fake-agent.ts         # FakeOpampAgent for E2E tests
  src/opamp-messages.ts     # Message builders
```

### Test Utilities (`@o11yfleet/test-utils`)

Use shared fixtures instead of duplicating test data:

```typescript
import {
  createTestAgentState,
  createConnectedAgentState,
  createHealthyAgentState,
  createUnhealthyAgentState,
  createUniqueUid,
  nextTenantName,
  nextConfigName,
  createEnrollmentTokenResponse,
} from "@o11yfleet/test-utils";

// Agent state fixtures
const agent = createConnectedAgentState({ tenant_id: "my-tenant" });

// API payload fixtures
const token = createEnrollmentTokenResponse();

// Unique IDs for multi-agent tests
const uid1 = createUniqueUid(1);
const uid2 = createUniqueUid(2);
```

### Test Naming Conventions

- **Unit tests**: Describe the unit and behavior: `describe("hexToUint8Array")`
- **Property tests**: Start with `property:` prefix: `describe("property: hex round-trip")`
- **Integration tests**: Describe the interaction: `describe("WebSocket enrollment flow")`
- **E2E tests**: Describe the user scenario: `test("complete lifecycle: enrollment → claim")`

### Skipped Tests Policy

| Reason for Skip | Action |
|----------------|--------|
| Flaky/timeouts | Fix or mark with TODO explaining the issue |
| Missing feature | Create GitHub issue, link in test comment |
| Requires external service | Use conditional skip with clear env var requirement |
| Performance regression | Keep in `perf-audit.test.ts` with `describe.skip` |

### Property-Based Testing

Use fast-check for:
- Edge cases that are hard to enumerate manually
- Invariants that must hold across all inputs
- Round-trip encoding/decoding

```typescript
import * as fc from "fast-check";

// Good: testing invariants across all possible inputs
it("uint8 → hex → uint8 is identity", () => {
  fc.assert(fc.property(fc.uint8Array(), (bytes) => {
    const hex = uint8ToHex(bytes);
    const round = hexToUint8Array(hex);
    return buffersEqual(round, bytes);
  }));
});
```

### Common Patterns

**Creating agent states for tests:**

```typescript
import { createTestAgentState, createHealthyAgentState } from "@o11yfleet/test-utils";

// For basic tests
const state = createTestAgentState();

// For connected scenarios
const connected = createConnectedAgentState({
  sequence_num: 5,
  last_seen_at: Date.now() - 30_000,
});
```

**Using FakeOpampAgent for E2E:**

```typescript
import { FakeOpampAgent } from "@o11yfleet/test-utils";

const agent = new FakeOpampAgent({
  endpoint: "ws://localhost:8787/v1/opamp",
  enrollmentToken: "fp_enroll_...",
});
await agent.connect();
await agent.sendHello();
// ... run assertions
agent.close();
```
