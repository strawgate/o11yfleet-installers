// @o11yfleet/test-utils — Test Fixtures
//
// Centralized fixtures for consistent test data across packages.

export {
  createTestAgentState,
  createConnectedAgentState,
  createHealthyAgentState,
  createUnhealthyAgentState,
  createDisconnectedAgentState,
  createAgentStateSequence,
  createUniqueUid,
  DEFAULT_TEST_CAPABILITIES,
  MINIMAL_TEST_CAPABILITIES,
} from "./agent-state.js";

export {
  resetFixtureCounters,
  nextTenantName,
  nextConfigName,
  nextTokenId,
  createTenantRequest,
  createConfigRequest,
  createEnrollmentTokenResponse,
  createConfigStatsResponse,
  createAgentSummary,
  createHealthCheckResponse,
  type TenantFixtures,
  type ConfigFixtures,
  type EnrollmentTokenResponse,
  type ConfigStatsResponse,
  type AgentSummaryResponse,
  type HealthCheckResponse,
} from "./api-payloads.js";
