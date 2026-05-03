// @o11yfleet/test-utils — Agent State Fixtures
//
// Canonical test fixtures for AgentState objects used across
// worker integration tests and E2E tests.

import type { AgentState } from "@o11yfleet/core/state-machine";
import { AgentCapabilities } from "@o11yfleet/core/codec";

/** Default capabilities for a configurable agent. */
export const DEFAULT_TEST_CAPABILITIES =
  AgentCapabilities.ReportsStatus |
  AgentCapabilities.AcceptsRemoteConfig |
  AgentCapabilities.ReportsEffectiveConfig |
  AgentCapabilities.ReportsHealth |
  AgentCapabilities.ReportsRemoteConfig;

/** Minimal capabilities for a simple agent. */
export const MINIMAL_TEST_CAPABILITIES =
  AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth;

/**
 * Create a default agent state for testing.
 * All fields have sensible defaults — override as needed.
 */
export function createTestAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    instance_uid: new Uint8Array(16).fill(0x42),
    tenant_id: "tenant-test",
    config_id: "config-test",
    sequence_num: 0,
    generation: 1,
    healthy: true,
    status: "running",
    last_error: "",
    current_config_hash: null,
    desired_config_hash: null,
    effective_config_hash: null,
    effective_config_body: null,
    last_seen_at: 0,
    connected_at: 0,
    agent_description: null,
    capabilities: DEFAULT_TEST_CAPABILITIES,
    component_health_map: null,
    available_components: null,
    // Required by AgentState since #493 (config-fail retry limit). A fresh
    // agent has zero consecutive FAILEDs and no last-failed hash.
    config_fail_count: 0,
    config_last_failed_hash: null,
    ...overrides,
  };
}

/** Create a connected agent state. */
export function createConnectedAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return createTestAgentState({
    sequence_num: 1,
    connected_at: Date.now() - 60_000,
    last_seen_at: Date.now() - 30_000,
    ...overrides,
  });
}

/** Create a healthy connected agent. */
export function createHealthyAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return createConnectedAgentState({
    healthy: true,
    status: "running",
    last_error: "",
    ...overrides,
  });
}

/** Create an unhealthy agent. */
export function createUnhealthyAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return createConnectedAgentState({
    healthy: false,
    status: "degraded",
    last_error: "Connection to OTLP endpoint failed: ECONNREFUSED",
    ...overrides,
  });
}

/** Create a disconnected agent state. */
export function createDisconnectedAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return createTestAgentState({
    status: "disconnected",
    healthy: false,
    connected_at: 0,
    last_seen_at: Date.now() - 3_600_000,
    ...overrides,
  });
}

/**
 * Create a sequence of agent states for testing sequence number handling.
 */
export function createAgentStateSequence(
  count: number,
  startSeq: number = 0,
  overrides: Partial<AgentState> = {},
): AgentState[] {
  return Array.from({ length: count }, (_, i) =>
    createConnectedAgentState({
      sequence_num: startSeq + i,
      last_seen_at: Date.now() - (count - i) * 30_000,
      ...overrides,
    }),
  );
}

/**
 * Create a unique instance_uid based on index for testing multi-agent scenarios.
 */
export function createUniqueUid(index: number): Uint8Array {
  const uid = new Uint8Array(16);
  uid[0] = (index >> 8) & 0xff;
  uid[1] = index & 0xff;
  return uid;
}
