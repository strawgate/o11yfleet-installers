// @o11yfleet/test-utils — Fake OpAMP agent and message builders for testing
export { FakeOpampAgent, REAL_COLLECTOR_PIPELINES } from "./fake-agent.js";
export type {
  FakeAgentOptions,
  EnrollmentResult,
  AgentProfile,
  PipelineConfig,
} from "./fake-agent.js";
export {
  buildHello,
  buildHeartbeat,
  buildHealthReport,
  buildConfigAck,
  buildDescriptionReport,
  buildDisconnect,
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
} from "./opamp-messages.js";
