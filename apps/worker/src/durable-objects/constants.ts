import { ServerCapabilities } from "@o11yfleet/core/codec";

// Per-message processing is O(1) (tag-based UID lookup, no full materialization).
// Remaining O(N) paths: broadcast (admin-triggered, with yielding) and
// getWebSockets().length (~200 bytes/handle, ~6MB at 30K). Safe headroom.
export const MAX_AGENTS_PER_CONFIG = 30_000;

// Stale agent detection: agents not seen for this long are marked disconnected.
// With zero-wake model, this only applies to agents whose SQLite last_seen_at
// is old AND no longer have an active WebSocket. The primary disconnect signal
// is webSocketClose() (instant). This is the fallback for silent deaths only.
export const STALE_AGENT_THRESHOLD_MS = 3_600_000 * 3; // 3 hours (3× heartbeat interval)

// Alarm tick interval for config metrics. The alarm is scheduled only after
// state-changing activity, then emits one aggregate snapshot and stops.
export const ALARM_TICK_MS = 60_000;

// Assignment claim TTL: agents must reconnect within this window.
export const ASSIGNMENT_CLAIM_TTL_SECONDS = 86_400; // 24 hours

// Default heartbeat interval sent via ConnectionSettingsOffers.
// Balances DO wake frequency vs liveness detection.
export const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 3_600; // 1 hour

/** Aggregated server capabilities sent in all ServerToAgent responses. */
export const SERVER_CAPABILITIES =
  ServerCapabilities.AcceptsStatus |
  ServerCapabilities.OffersRemoteConfig |
  ServerCapabilities.AcceptsEffectiveConfig |
  ServerCapabilities.OffersConnectionSettings;

/** Sentinel `config_id` for the per-tenant DO that handles pending-token
 *  enrollments before a configuration is assigned. DO name format is
 *  `${tenant_id}:${PENDING_DO_CONFIG_ID}`. */
export const PENDING_DO_CONFIG_ID = "__pending__";
