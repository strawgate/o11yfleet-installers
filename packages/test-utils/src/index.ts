// @o11yfleet/test-utils — Fake OpAMP agent and message builders for testing
export { FakeOpampAgent, REAL_COLLECTOR_PIPELINES } from "./fake-agent.js";
export type {
  FakeAgentOptions,
  EnrollmentResult,
  AgentProfile,
  PipelineConfig,
  AgentBehaviorMode,
  BehaviorConfig,
} from "./fake-agent.js";
export {
  buildHello,
  buildHeartbeat,
  buildHealthReport,
  buildConfigAck,
  buildDescriptionReport,
  buildDisconnect,
  buildShutdown,
  buildExporterFailure,
  buildReceiverFailure,
  buildHealthRecovered,
  DEFAULT_CAPABILITIES,
  CONFIGURABLE_CAPABILITIES,
} from "./opamp-messages.js";
export type {
  HelloOptions,
  HeartbeatOptions,
  HealthReportOptions,
  ConfigAckOptions,
  AgentDescriptionOptions,
  DisconnectOptions,
  ShutdownOptions,
  ExporterFailureOptions,
  ReceiverFailureOptions,
  HealthRecoveredOptions,
} from "./opamp-messages.js";

// ─── Test Scenarios ─────────────────────────────────────────────────────────
export {
  AGENT_SCENARIOS,
  SERVER_SCENARIOS,
  KNOWN_UID,
  REASSIGNED_UID,
  REPORTS_AVAILABLE_COMPONENTS,
  agentScenario,
  serverScenario,
} from "./scenarios.js";
export type { AgentScenario, ServerScenario } from "./scenarios.js";

// ─── Test Fixtures ───────────────────────────────────────────────────────────
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
} from "./fixtures/index.js";
