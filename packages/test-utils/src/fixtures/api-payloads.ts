// @o11yfleet/test-utils — API Payload Fixtures
//
// Canonical test fixtures for API requests and responses used across
// worker integration tests and E2E tests.

/** Standard tenant payload for API tests. */
export interface TenantFixtures {
  minimal: { name: string; plan: "starter" | "hobby" | "pro" | "growth" | "enterprise" };
  pro: { name: string; plan: "pro" };
  starter: { name: string; plan: "starter" };
  growth: { name: string; plan: "growth" };
  enterprise: { name: string; plan: "enterprise" };
}

/** Standard configuration payload for API tests. */
export interface ConfigFixtures {
  minimal: { name: string };
  withDescription: { name: string; description?: string };
}

/** Standard enrollment token response. */
export interface EnrollmentTokenResponse {
  id: string;
  token: string;
  created_at: string;
  expires_at: string | null;
  created_by?: string;
}

/**
 * Standard config stats response. Mirrors the shape that
 * `apps/worker/src/routes/v1/index.ts` builds at the `/stats` endpoint —
 * any change there should change this fixture in lockstep so tests
 * assert against the real contract, not a stale one.
 */
export interface ConfigStatsResponse {
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
  drifted_agents: number;
  desired_config_hash: string | null;
  /** Map from status name (e.g. "connected", "disconnected") to count. */
  status_counts: Record<string, number>;
  /** Hash → agent count breakdown for drift visualization. */
  current_hash_counts: Array<{ value: string; count: number }>;
}

/** Standard agent summary response. */
export interface AgentSummaryResponse {
  instance_uid: string;
  display_name: string;
  status: "connected" | "disconnected" | "degraded";
  healthy: boolean;
  last_seen_at: string;
  connected_at: string;
  version?: string;
  capabilities?: number;
}

/** Standard health check response. */
export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks?: {
    worker?: { status: string; latency_ms?: number };
    d1?: { status: string; latency_ms?: number };
    r2?: { status: string; latency_ms?: number };
    durable_objects?: { status: string };
    queue?: { status: string };
  };
}

// ─── Fixture Factories ────────────────────────────────────────────────────────

let tenantCounter = 0;
let configCounter = 0;
let tokenCounter = 0;
let agentUidCounter = 0;

/**
 * Reset all fixture counters. Call this in beforeEach to ensure
 * deterministic test data.
 */
export function resetFixtureCounters(): void {
  tenantCounter = 0;
  configCounter = 0;
  tokenCounter = 0;
  agentUidCounter = 0;
}

// Determinism note: every fixture id below is derived from a monotonic
// counter only — never `Date.now()` and never `Math.random()`. Two test
// runs from the same starting state must produce byte-identical
// fixtures so snapshot and exact-value assertions remain stable.
// `resetFixtureCounters()` (called from beforeEach) restores the
// starting state.

/**
 * Generate a unique tenant name for tests. Counter-only — same input
 * sequence reproduces across runs.
 */
export function nextTenantName(prefix = "test-tenant"): string {
  return `${prefix}-${++tenantCounter}`;
}

/**
 * Generate a unique config name for tests. Counter-only.
 */
export function nextConfigName(prefix = "test-config"): string {
  return `${prefix}-${++configCounter}`;
}

/**
 * Generate a unique token ID for tests. Counter-only.
 */
export function nextTokenId(): string {
  return `token-${++tokenCounter}`;
}

/**
 * Create a minimal tenant request payload.
 */
export function createTenantRequest(name?: string): { name: string; plan: "growth" } {
  return {
    name: name ?? nextTenantName(),
    plan: "growth",
  };
}

/**
 * Create a minimal config request payload.
 */
export function createConfigRequest(name?: string): { name: string } {
  return {
    name: name ?? nextConfigName(),
  };
}

/** Fixed-epoch timestamp used by every fixture. Aligns with arbitrary
 * 2026-01-01T00:00:00Z; chosen to be in the past so "X minutes ago"
 * arithmetic doesn't accidentally produce negative ages. */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 0, 1);

/** Counter-derived 32-char hex id — deterministic, no Math.random. */
function nextAgentUidHex(): string {
  agentUidCounter += 1;
  return agentUidCounter.toString(16).padStart(32, "0");
}

/**
 * Create a mock enrollment token response.
 */
export function createEnrollmentTokenResponse(
  overrides: Partial<EnrollmentTokenResponse> = {},
): EnrollmentTokenResponse {
  return {
    id: nextTokenId(),
    token: `fp_enroll_${"a".repeat(48)}`,
    created_at: new Date(FIXTURE_EPOCH_MS).toISOString(),
    expires_at: null,
    ...overrides,
  };
}

/**
 * Create a mock config stats response. Shape mirrors what
 * `apps/worker/src/routes/v1/index.ts` returns from `/stats`.
 */
export function createConfigStatsResponse(
  overrides: Partial<ConfigStatsResponse> = {},
): ConfigStatsResponse {
  return {
    total_agents: 0,
    connected_agents: 0,
    healthy_agents: 0,
    drifted_agents: 0,
    desired_config_hash: null,
    status_counts: {},
    current_hash_counts: [],
    ...overrides,
  };
}

/**
 * Create a mock agent summary.
 */
export function createAgentSummary(
  overrides: Partial<AgentSummaryResponse> = {},
): AgentSummaryResponse {
  return {
    instance_uid: nextAgentUidHex(),
    display_name: "test-agent",
    status: "connected",
    healthy: true,
    last_seen_at: new Date(FIXTURE_EPOCH_MS).toISOString(),
    connected_at: new Date(FIXTURE_EPOCH_MS - 3_600_000).toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock health check response.
 */
export function createHealthCheckResponse(
  overrides: Partial<HealthCheckResponse> = {},
): HealthCheckResponse {
  return {
    status: "healthy",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}
