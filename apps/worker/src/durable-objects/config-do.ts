import { DurableObject } from "cloudflare:workers";
import {
  decodeAgentToServer,
  encodeServerToAgent,
  ServerErrorResponseType,
} from "@o11yfleet/core/codec";
import type { ServerToAgent } from "@o11yfleet/core/codec";
import { processFrame, defaultProcessContext } from "@o11yfleet/core/state-machine";
import { hexToUint8Array, uint8ToHex } from "@o11yfleet/core/hex";
import { signClaim, type AssignmentClaim } from "@o11yfleet/core/auth";
import { configMetricsToDoubles, FLEET_CONFIG_SNAPSHOT_INTERVAL } from "@o11yfleet/core/metrics";
import {
  startWsMessageSpan,
  startWsLifecycleSpan,
  startWsConnectSpan,
  recordSpanError,
  SpanStatusCode,
} from "../tracing.js";
import { logTransitionEvents } from "../observability-events.js";
import type {
  AgentStateRepository,
  DesiredConfig,
  DoPolicy,
} from "./agent-state-repo-interface.js";
import { SqliteAgentStateRepo } from "./sqlite-agent-state-repo.js";
import { parseAttachment } from "./ws-attachment.js";
import type { WSAttachment } from "./ws-attachment.js";
import { handleDebugTables, handleDebugQuery } from "./admin-debug-handler.js";
import {
  handleSetDesiredConfig,
  handleDisconnectAll,
  handleDisconnectAgent,
  handleRestartCommand,
  handleRestartAgent,
  handleSweep,
} from "./command-handler.js";
import type { CommandContext } from "./command-handler.js";
import { handleGetStats, handleGetAgents, handleGetAgent } from "./query-handler.js";
import { handleFirstMessage } from "./opamp-session.js";
import type { SessionContext } from "./opamp-session.js";
import { parseConfigDoName, safeForLog, type ConfigDoIdentity } from "./do-name.js";
import { initBodySchema, parseAndValidateBody, syncPolicyBodySchema } from "./policy-schemas.js";
import {
  MAX_AGENTS_PER_CONFIG,
  ALARM_TICK_MS,
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  SERVER_CAPABILITIES,
  ASSIGNMENT_CLAIM_TTL_SECONDS,
  STALE_AGENT_THRESHOLD_MS,
  PENDING_DO_CONFIG_ID,
} from "./constants.js";

export interface ConfigDOEnv {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_ANALYTICS?: AnalyticsEngineDataset;
  O11YFLEET_CLAIM_HMAC_SECRET: string;
  /** Set to "1" in dev to log every decoded AgentToServer frame as JSON. */
  OPAMP_FRAME_DEBUG?: string;
}

/**
 * Parse the `x-fp-max-agents-per-config` header set by the worker.
 * Returns null if the header is missing or not a positive integer.
 */
function parseTenantAgentLimit(header: string | null): number | null {
  if (!header) return null;
  const parsed = Number(header);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

function extractDisplayName(identifyingAttributes: {
  attributes?: Array<{ key: string; value: { string_value?: string } }>;
}): string | null {
  const attrs = identifyingAttributes.attributes;
  if (!attrs) return null;
  const hostAttr = attrs.find((a) => a.key === "host");
  const nameValue = hostAttr?.value?.string_value;
  if (!nameValue) return null;
  return nameValue.slice(0, 128).replace(/[^a-zA-Z0-9 _.-]/g, "");
}

// ConfigDurableObject — central stateful actor per `tenant:config` pair.
// See docs/architecture/durable-objects.md for the architecture, billing
// model, persistence tier system, hibernation safety, WebSocket close
// flow, and cost model that drive the design decisions below.
export class ConfigDurableObject extends DurableObject<ConfigDOEnv> {
  private repo: AgentStateRepository;
  private initialized = false;

  // ─── In-memory caches (reset on hibernation wake — see header comment) ──
  //
  // These are performance caches, NOT sources of truth. On hibernation wake,
  // the constructor runs again and all fields reset to their defaults:
  //   cachedDesiredConfig → null  (next getDesiredConfig() re-reads from SQLite)
  //   cachedPolicy → null        (next getPolicy() re-reads from SQLite)
  //   alarmScheduled → false     (next ensureAlarm() does the real check)
  //   cachedIdentity → null      (next getMyIdentity() re-parses ctx.id.name)
  //
  // This is correct by design: stale cache = slower first call, never wrong.
  //
  // IMPORTANT: These MUST be instance fields (this.*), not module-scope globals.
  // CF may run multiple DO instances in the same V8 isolate, so module-scope
  // variables would be shared across different tenant:config DOs — corrupting
  // each other's caches. See: developers.cloudflare.com/durable-objects/reference/in-memory-state/

  /** Desired config cache — eliminates 1 SQL read per WebSocket message.
   *  Invalidated explicitly in handleSetDesiredConfig (the only write path).
   *  At 30K agents with 1hr heartbeat that's ~500 reads/min saved. */
  private cachedDesiredConfig: DesiredConfig | null = null;

  /** DO policy cache — eliminates 1 SQL read per WebSocket connect.
   *  Invalidated in handleInit() and handleSyncPolicy() (tenant lifecycle
   *  events, extremely rare). Under burst reconnect of 30K agents this
   *  saves 30K reads of the same singleton do_config row. */
  private cachedPolicy: DoPolicy | null = null;

  /** In-memory alarm guard — skips the async getAlarm() call after the first
   *  ensureAlarm() within a single wake cycle. Whether getAlarm() is billed
   *  as a KV read ($0.20/M) or just a DO subrequest ($0.15/M), avoiding the
   *  async boundary on every state-changing message is worthwhile. Reset to
   *  false in alarm() after the alarm fires. */
  private alarmScheduled = false;

  /** Parsed identity cache — ctx.id.name is immutable for the DO's lifetime,
   *  so we parse it once and reuse. Called 3-5× per wake cycle (ensureInit,
   *  fetch dispatch, handleWebSocket, commandCtx, emitMetrics). */
  private cachedIdentity: ConfigDoIdentity | null = null;

  constructor(ctx: DurableObjectState, env: ConfigDOEnv) {
    super(ctx, env);
    this.repo = new SqliteAgentStateRepo(ctx.storage.sql);
    // Zero-cost keepalive: the runtime auto-replies "pong" to text "ping"
    // frames WITHOUT waking the DO. This keeps the Cloudflare edge alive
    // so OpAMP heartbeats can be infrequent (10 min) for health reporting only.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private ensureInit(): void {
    if (this.initialized) return;
    this.repo.initSchema();
    // Persist identity from ctx.id.name on first wake-up. This keeps
    // the do_config row self-describing for ad-hoc SQL/debug queries;
    // production code reads identity straight from ctx.id.name via
    // getMyIdentity(), so there is no trust boundary here either way.
    const { tenant_id, config_id } = this.getMyIdentity();
    this.repo.saveDoIdentity(tenant_id, config_id);
    this.initialized = true;
  }

  /**
   * Read this DO's identity from `ctx.id.name`. The runtime guarantees a
   * DO can only be reached via `idFromName(name)`, so this is
   * authoritative — no header from the worker is required.
   *
   * Cached after first parse — `ctx.id.name` is immutable for the DO's
   * lifetime, and the parse result never changes. The cache resets on
   * hibernation wake (constructor re-init), but the same `ctx.id.name`
   * produces the same result every time.
   */
  private getMyIdentity(): ConfigDoIdentity {
    if (this.cachedIdentity) return this.cachedIdentity;
    const result = parseConfigDoName(this.ctx.id.name);
    if (!result.ok) {
      throw new Error(
        `[ConfigDO] invalid identity (${result.error}): ${safeForLog(this.ctx.id.name)}`,
      );
    }
    this.cachedIdentity = result.identity;
    return result.identity;
  }

  /**
   * Get desired config from SQLite (~µs). The returned shape includes the
   * pre-encoded `bytes`, so callers don't need to run `TextEncoder.encode`
   * per WS message — that work happens exactly once on `set-desired-config`.
   *
   * For older rows written before the encoded-bytes column existed, fall
   * back to encoding on read; the next `set-desired-config` upgrades the
   * row.
   */
  private getDesiredConfig(): DesiredConfig {
    if (this.cachedDesiredConfig) return this.cachedDesiredConfig;
    const config = this.repo.loadDesiredConfig();
    if (config.bytes === null && config.content !== null) {
      const result = { ...config, bytes: new TextEncoder().encode(config.content) };
      this.cachedDesiredConfig = result;
      return result;
    }
    this.cachedDesiredConfig = config;
    return config;
  }

  /** Get DO policy from SQLite (~µs). Cached after first read — policy
   *  changes only on /init or /sync-policy (tenant lifecycle events).
   *  Invalidated in handleInit() and handleSyncPolicy(). */
  private getPolicy(): DoPolicy {
    if (this.cachedPolicy) return this.cachedPolicy;
    this.cachedPolicy = this.repo.loadDoPolicy();
    return this.cachedPolicy;
  }

  /** Schedule a one-shot alarm for deferred metrics emission.
   *
   *  Called after state-changing events (Tier 1+ messages, disconnects, config
   *  pushes). The alarm fires once, emits an aggregate metrics snapshot via
   *  Analytics Engine, and does NOT reschedule — this prevents runaway alarm
   *  cost in an idle fleet.
   *
   *  The alarmScheduled guard avoids hitting getAlarm() on every call within
   *  a single wake cycle. Within one wake, alarm state can't change underneath
   *  us (single-threaded), so the first call's answer is definitive until
   *  alarm() fires.
   *
   *  Cost: first call = 1 async getAlarm() + maybe 1 setAlarm(). Subsequent
   *  calls in the same wake cycle = free (in-memory short-circuit). */
  private async ensureAlarm(): Promise<void> {
    if (this.alarmScheduled) return;
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_TICK_MS);
    }
    this.alarmScheduled = true;
  }

  /** O(1) tag-based check with fallback for enrollment connections. */
  private isAgentConnected(uid: string): boolean {
    // Fast path: tag-based O(1) lookup (covers reconnect connections)
    if (this.ctx.getWebSockets(uid).length > 0) return true;
    // Enrollment connections have a stale tag (UID assigned post-accept).
    // This is rare (only until the agent's first reconnect) and only
    // called from admin query paths, never the hot message path.
    for (const ws of this.ctx.getWebSockets()) {
      const att = parseAttachment(ws.deserializeAttachment());
      if (att?.instance_uid === uid) return true;
    }
    return false;
  }

  private commandCtx(): CommandContext {
    return {
      repo: this.repo,
      identity: this.getMyIdentity(),
      getWebSockets: () => this.ctx.getWebSockets(),
      ensureAlarm: () => this.ensureAlarm(),
      invalidateDesiredConfigCache: () => {
        this.cachedDesiredConfig = null;
      },
      analytics: this.env.FP_ANALYTICS,
    };
  }

  private sessionCtx(): SessionContext {
    return {
      repo: this.repo,
      hmacSecret: this.env.O11YFLEET_CLAIM_HMAC_SECRET,
      ensureAlarm: () => this.ensureAlarm(),
    };
  }

  // ─── HTTP Dispatch ────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    this.ensureInit();
    const url = new URL(request.url);

    // Derive isPendingDo from ctx.id.name. The DO's identity is always
    // authoritative there; the SQL row is just a debug echo of it.
    const isPendingDo = this.getMyIdentity().config_id === PENDING_DO_CONFIG_ID;

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // Lifecycle routes — invoked by the worker when the underlying
    // resource (tenant or configuration) is created or updated. Both are
    // POSTs so they can carry an optional policy body. Identity is
    // *always* derived from `ctx.id.name`; any tenant_id/config_id in
    // the body is ignored.
    if (url.pathname === "/init" && request.method === "POST") return this.handleInit(request);
    if (url.pathname === "/sync-policy" && request.method === "POST")
      return this.handleSyncPolicy(request);

    // Command routes
    if (url.pathname === "/command/set-desired-config" && request.method === "POST")
      return handleSetDesiredConfig(this.commandCtx(), request);
    if (url.pathname === "/command/sweep" && request.method === "POST")
      return handleSweep(
        this.commandCtx(),
        (uid) => this.isAgentConnected(uid),
        () => this.emitMetrics(),
      );
    if (url.pathname === "/command/disconnect" && request.method === "POST")
      return handleDisconnectAll(this.commandCtx());
    if (url.pathname === "/command/restart" && request.method === "POST")
      return handleRestartCommand(this.commandCtx());
    const disconnectAgentMatch = url.pathname.match(/^\/command\/disconnect-agent\/([^/]+)$/);
    if (disconnectAgentMatch && request.method === "POST")
      return handleDisconnectAgent(this.commandCtx(), disconnectAgentMatch[1]!);
    const restartAgentMatch = url.pathname.match(/^\/command\/restart-agent\/([^/]+)$/);
    if (restartAgentMatch && request.method === "POST")
      return handleRestartAgent(this.commandCtx(), restartAgentMatch[1]!);

    // Query routes
    if (url.pathname === "/stats" && request.method === "GET")
      return handleGetStats(
        this.repo,
        () => this.getDesiredConfig(),
        this.ctx.getWebSockets().length,
      );
    if (url.pathname === "/agents" && request.method === "GET")
      return handleGetAgents(this.repo, request);
    const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
    if (agentMatch && request.method === "GET")
      return handleGetAgent(
        this.repo,
        agentMatch[1]!,
        (uid) => this.isAgentConnected(uid),
        () => this.getDesiredConfig(),
      );

    // Debug routes
    if (url.pathname === "/debug/tables" && request.method === "GET")
      return handleDebugTables(this.ctx.storage.sql, request);
    if (url.pathname === "/debug/query" && request.method === "POST")
      return handleDebugQuery(this.ctx.storage.sql, request);

    // Pending device routes (only for __pending__ DOs)
    if (isPendingDo) {
      if (url.pathname === "/pending-devices" && request.method === "GET")
        return handleListPendingDevices(this.ctx.storage.sql, this.getMyIdentity().tenant_id);
      const pendingAssignMatch = url.pathname.match(/^\/pending-devices\/([^/]+)\/assign$/);
      if (pendingAssignMatch && request.method === "POST")
        return handleAssignPendingDevice(
          this.ctx.storage.sql,
          request,
          pendingAssignMatch[1]!,
          this.getMyIdentity().tenant_id,
        );
    }

    return new Response("Not found", { status: 404 });
  }

  // ─── WebSocket Lifecycle ──────────────────────────────────────────

  private async handleWebSocket(request: Request): Promise<Response> {
    // Identity is derived from `ctx.id.name`, not from request headers.
    // The runtime guarantees this DO can only be reached via
    // `idFromName(name)`, so the answer is authoritative — no header
    // contract has to be remembered or stripped at the worker boundary
    // for security.
    const { tenant_id: tenantId, config_id: configId } = this.getMyIdentity();

    // The instance UID still comes from the worker's claim verification
    // (it's the agent's identity, not the DO's). Same for the
    // is_enrollment flag, which is a routing signal for the agent's
    // first frame, not a security boundary.
    const instanceUid = request.headers.get("x-fp-instance-uid") ?? crypto.randomUUID();
    const isEnrollment = request.headers.get("x-fp-enrollment") === "true";
    const isPendingDo = configId === PENDING_DO_CONFIG_ID;
    const sourceIp =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;

    // Lifecycle logging intentionally omitted at scale; use OTel spans for observability.
    const connectSpan = startWsConnectSpan(instanceUid, tenantId, configId, isEnrollment);

    if (isPendingDo) {
      const { upsertPendingDevice } = await import("./agent-state-repo.js");
      upsertPendingDevice(this.ctx.storage.sql, {
        instance_uid: instanceUid,
        tenant_id: tenantId,
        source_ip: sourceIp,
        geo_country: request.headers.get("x-fp-geo-country") ?? null,
        geo_city: request.headers.get("x-fp-geo-city") ?? null,
        geo_lat: request.headers.get("x-fp-geo-lat")
          ? Number(request.headers.get("x-fp-geo-lat"))
          : null,
        geo_lon: request.headers.get("x-fp-geo-lon")
          ? Number(request.headers.get("x-fp-geo-lon"))
          : null,
        connected_at: Date.now(),
      });
    } else {
      // Cap on agents per config — read from DO-cached policy first
      // (set by /init or /sync-policy from the worker), fall back to
      // the header for callers that haven't yet been migrated to
      // /init, and finally to the global default.
      const policy = this.getPolicy();
      const headerLimit = parseTenantAgentLimit(request.headers.get("x-fp-max-agents-per-config"));
      const tenantLimit = policy.max_agents_per_config ?? headerLimit;
      const limit =
        tenantLimit !== null ? Math.min(tenantLimit, MAX_AGENTS_PER_CONFIG) : MAX_AGENTS_PER_CONFIG;
      const count = this.repo.getAgentCount();
      if (count >= limit && !this.repo.agentExists(instanceUid)) {
        connectSpan.setStatus({ code: SpanStatusCode.ERROR, message: "agent_limit_reached" });
        connectSpan.end();
        return Response.json(
          { error: "Agent limit reached for this configuration" },
          { status: 429 },
        );
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server, [instanceUid]);

    const attachment: WSAttachment = {
      tenant_id: tenantId,
      config_id: configId,
      instance_uid: instanceUid,
      connected_at: Date.now(),
      is_enrollment: isEnrollment,
      is_first_message: true,
      /** Tracks the DO-assigned UID before handleFirstMessage overwrites
       *  instance_uid with the agent's own UID. Used to tell the agent
       *  (via AgentIdentification) to reconnect with our UID. */
      do_assigned_uid: instanceUid,
    };
    server.serializeAttachment(attachment);

    connectSpan.setAttribute("opamp.is_pending", isPendingDo);
    connectSpan.end();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.ensureInit();

    if (typeof message === "string") {
      ws.close(4000, "Binary frames only");
      return;
    }

    let attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) {
      ws.close(1008, "Missing attachment");
      return;
    }

    // Handle first message only (enrollment or reconnection claim signing).
    // Subsequent messages skip the expensive decode+signClaim crypto path.
    let agentIdentification: Uint8Array | undefined;
    const isEnrollment = !!attachment.is_enrollment;
    if (attachment.is_first_message || attachment.is_enrollment) {
      const result = await handleFirstMessage(this.sessionCtx(), ws, attachment, message);
      if (result.earlyReturn) return;
      attachment = result.attachment;
      agentIdentification = result.agentIdentification;
    }

    const isPendingDo = attachment.config_id === PENDING_DO_CONFIG_ID;

    // Rate limiting deliberately omitted inside the DO. By the time this
    // code runs the DO is already awake and JS is executing — the cost is
    // paid. The DO's single-threaded model (~500-1000 msg/sec) IS the
    // natural throttle. Edge-level CF WAF Rate Limiting Rules handle
    // connection-level abuse before the DO is woken. See AGENTS.md.

    const config = this.getDesiredConfig();
    const configBytes = config.bytes;

    const span = startWsMessageSpan(
      attachment.instance_uid,
      attachment.tenant_id,
      attachment.config_id,
    );
    try {
      const agentMsg = decodeAgentToServer(message);
      span.setAttribute("opamp.sequence_num", agentMsg.sequence_num);
      span.setAttribute("opamp.codec", "protobuf");

      // Debug frame logging — enabled by OPAMP_FRAME_DEBUG=1 env var.
      // Prints decoded AgentToServer as JSON so real collector frame shapes
      // can be captured and compared against test-utils message builders.
      if (this.env.OPAMP_FRAME_DEBUG === "1") {
        const debugPayload = JSON.stringify(agentMsg, (_, v) =>
          v instanceof Uint8Array
            ? `<bytes:${v.length}:${Array.from(v.slice(0, 8))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")}${v.length > 8 ? "…" : ""}>`
            : typeof v === "bigint"
              ? v.toString()
              : v,
        );
        console.warn(
          `[FRAME_DEBUG] seq=${agentMsg.sequence_num} uid=${attachment.instance_uid.slice(0, 8)} ${debugPayload}`,
        );
      }

      // Duplicate UID detection (OpAMP spec §3.2.1.2) — O(1) via WebSocket tags.
      // Only consider OPEN sockets — closed sockets (from prior enrollment/reconnect
      // cycles) don't count as active duplicates.
      if (agentMsg.sequence_num === 0) {
        const existing = this.ctx
          .getWebSockets(attachment.instance_uid)
          .filter((s) => s.readyState === WebSocket.OPEN);
        const isDuplicate = existing.length > 1 || (existing.length === 1 && existing[0] !== ws);
        if (isDuplicate) {
          const newUid = new Uint8Array(16);
          crypto.getRandomValues(newUid);
          const newUidHex = uint8ToHex(newUid);
          attachment.instance_uid = newUidHex;

          // Regenerate assignment claim with the new UID so the agent can reconnect.
          const claim: AssignmentClaim = {
            v: 1,
            tenant_id: attachment.tenant_id,
            config_id: attachment.config_id,
            instance_uid: newUidHex,
            generation: 1,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + ASSIGNMENT_CLAIM_TTL_SECONDS,
          };
          const token = await signClaim(claim, this.env.O11YFLEET_CLAIM_HMAC_SECRET);
          attachment.pending_connection_settings = token;
          // Leave `is_first_message=true` so the next frame on this socket
          // still runs the bootstrap block below (gen bump, status flip,
          // forceFullPersist). If we cleared the flag here we'd skip the
          // mandatory full UPSERT for the renamed agent's first persisted
          // frame — Tier-1 partial updates would silently miss because no
          // row exists for the new instance_uid yet. Malformed second
          // frames are handled gracefully because `handleFirstMessage`'s
          // else-branch catch sends `error_response` (per §4.5) instead
          // of closing the socket.

          ws.serializeAttachment(attachment);
          const dupResponse: ServerToAgent = {
            instance_uid: newUid,
            flags: 0,
            capabilities: SERVER_CAPABILITIES,
            agent_identification: { new_instance_uid: newUid },
          };
          ws.send(encodeServerToAgent(dupResponse));
          span.end();
          return;
        }
      }

      const state = this.repo.loadAgentState(
        attachment.instance_uid,
        attachment.tenant_id,
        attachment.config_id,
        config.hash,
      );

      // Use attachment-tracked seq_num for gap detection. SQLite seq_num
      // may be stale when previous no-op heartbeats skipped persistence.
      // On reconnect (new WS), attachment.sequence_num is undefined so
      // we fall back to SQLite — any gap triggers ReportFullState, which
      // brings everything back in sync. See AGENTS.md.
      if (attachment.sequence_num !== undefined) {
        state.sequence_num = attachment.sequence_num;
      }

      // Increment generation on new connection (first processFrame after connect/reconnect).
      // forceFullPersist ensures the full UPSERT (Tier 2) runs, because these
      // mutations happen outside processFrame and won't appear in dirtyFields.
      // An agent reconnecting with seq != 0 (maintaining counter across reconnect)
      // would otherwise lose generation/connected_at/status updates.
      let forceFullPersist = false;
      if (attachment.is_first_message) {
        state.generation += 1;
        state.connected_at = attachment.connected_at;
        state.status = "connected";
        attachment.is_first_message = false;
        forceFullPersist = true;

        // For pending DOs, check for pending assignment on reconnection
        if (isPendingDo) {
          const { getPendingAssignment, deletePendingDevice, deletePendingAssignment } =
            await import("./agent-state-repo.js");
          const assignment = getPendingAssignment(this.ctx.storage.sql, attachment.instance_uid);
          if (assignment) {
            // Issue real claim for the assigned config
            const claim: AssignmentClaim = {
              v: 1,
              tenant_id: attachment.tenant_id,
              config_id: assignment.target_config_id,
              instance_uid: attachment.instance_uid,
              generation: 1,
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + ASSIGNMENT_CLAIM_TTL_SECONDS,
            };
            const token = await signClaim(claim, this.env.O11YFLEET_CLAIM_HMAC_SECRET);
            attachment.pending_connection_settings = token;
            attachment.config_id = assignment.target_config_id;
            // Both rows are fully consumed at this point: device row was
            // already gone (assign deletes it), but be defensive in case
            // an operator re-enrolled into the same uid; assignment row
            // is consumed by issuing the claim above.
            deletePendingDevice(this.ctx.storage.sql, attachment.instance_uid);
            deletePendingAssignment(this.ctx.storage.sql, attachment.instance_uid);
          }
        }

        ws.serializeAttachment(attachment);
      }

      // For pending DOs, update device info with display_name from agent_description
      if (isPendingDo && agentMsg.agent_description?.identifying_attributes) {
        const displayName = extractDisplayName({
          attributes: agentMsg.agent_description.identifying_attributes,
        });
        if (displayName) {
          const { upsertPendingDevice } = await import("./agent-state-repo.js");
          upsertPendingDevice(this.ctx.storage.sql, {
            instance_uid: attachment.instance_uid,
            tenant_id: attachment.tenant_id,
            display_name: displayName,
            agent_description: JSON.stringify(agentMsg.agent_description?.identifying_attributes),
          });
        }
      }

      const result = await processFrame(
        state,
        agentMsg,
        configBytes,
        undefined,
        defaultProcessContext(),
      );

      // ── Attachment State Tracking (Tier 0 optimization) ──
      //
      // seq_num, last_seen_at, and capabilities are tracked in the WS
      // attachment (free — runtime-managed, not billed storage) instead of
      // writing to SQLite on every heartbeat. This is THE key optimization
      // that makes Tier 0 heartbeats cost zero writes.
      //
      // These values are flushed to SQLite on disconnect via
      // webSocketClose → markDisconnected (1 write, amortized over the
      // entire session lifetime).
      if (result.newState.sequence_num !== attachment.sequence_num) {
        attachment.sequence_num = result.newState.sequence_num;
      }
      if (attachment.capabilities !== agentMsg.capabilities) {
        attachment.capabilities = agentMsg.capabilities;
      }
      attachment.last_seen_at = Date.now();
      ws.serializeAttachment(attachment);

      // ── Persistence Tier Classification ──
      //
      // The tier system minimizes SQLite writes (most expensive billed op
      // at $1/M rows). See module header for full tier descriptions.

      if (forceFullPersist || (result.shouldPersist && result.dirtyFields.has("connected_at"))) {
        // Tier 2: first message, hello, reconnect, or disconnect.
        // Row may not exist yet, and config-do mutated fields outside
        // processFrame (generation, connected_at, status) that aren't in
        // dirtyFields. Full UPSERT writes all 16 columns.
        // Cost: 1 SQL write ($1/M).
        this.repo.saveAgentState(result.newState);
      } else if (result.shouldPersist && result.dirtyFields.size > 0) {
        // Tier 1: existing agent, field-level change only (health, effective
        // config hash, etc.). Targeted UPDATE writes only dirty columns,
        // avoiding JSON.stringify for untouched component_health_map and
        // available_components.
        // Cost: 1 SQL write ($1/M) — but smaller row, less CPU.
        this.repo.updateAgentPartial(attachment.instance_uid, result.newState, result.dirtyFields);
      }
      // Tier 0: dirtyFields is empty. No SQL write at all.
      // seq_num + last_seen_at are tracked in the WS attachment (free),
      // flushed to SQLite on disconnect via markDisconnected().
      // Cost: 0 SQL writes. This is why steady-state fleets are near-free.

      // Events (state transitions) trigger a deferred metrics snapshot.
      // ensureAlarm() is idempotent within a wake cycle (alarmScheduled guard).
      if (result.events.length > 0) {
        span.setAttribute("opamp.events_emitted", result.events.length);
        logTransitionEvents(result.events);
        await this.ensureAlarm();
      }

      if (result.response) {
        // Inject ConnectionSettingsOffers with the assignment claim on first response.
        if (attachment.pending_connection_settings) {
          const token = attachment.pending_connection_settings;
          // Hash is computed from the full serialized settings object (opamp
          // headers + heartbeat_interval). This is intentional: the hash lets
          // the agent detect when its connection_settings have changed. All
          // fields that affect agent behavior are included below.
          const settings = {
            opamp: {
              headers: [{ key: "Authorization", value: `Bearer ${token}` }],
              heartbeat_interval_seconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
            },
          };
          const settingsJson = new TextEncoder().encode(JSON.stringify(settings));
          const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", settingsJson));
          result.response.connection_settings = {
            hash: hashBytes,
            ...settings,
          };
          attachment.pending_connection_settings = undefined;
          ws.serializeAttachment(attachment);
        }

        // Inject AgentIdentification on enrollment to tell the agent to use
        // our DO-assigned UID. Per OpAMP spec §3.2.1.2, agents MUST adopt it.
        if (agentIdentification) {
          result.response.agent_identification = { new_instance_uid: agentIdentification };
        }

        ws.send(encodeServerToAgent(result.response));
        if (result.response.remote_config) {
          span.setAttribute("opamp.config_offered", true);
        }

        // Enrollment complete: tell the agent to reconnect with the DO-assigned UID.
        // The new WS will be tagged with our UID, so ctx.getWebSockets(uid) works.
        if (isEnrollment) {
          span.setAttribute("opamp.enrollment_complete", true);
          span.end();
          ws.close(1000, "Reconnect with new instance_uid");
        }
      }
    } catch (err) {
      recordSpanError(span, err);
      console.error(`[ws.message] error for ${attachment.instance_uid}:`, err);

      try {
        const errorResponse: ServerToAgent = {
          instance_uid: hexToUint8Array(attachment.instance_uid),
          flags: 0,
          capabilities: SERVER_CAPABILITIES,
          error_response: {
            type: ServerErrorResponseType.BadRequest,
            error_message: err instanceof Error ? err.message : "Malformed message",
          },
        };
        ws.send(encodeServerToAgent(errorResponse));
      } catch {
        try {
          ws.close(1011, "Internal error");
        } catch {
          /* already closed */
        }
      }
    } finally {
      span.end();
    }
  }

  // ─── WebSocket Close/Error ──────────────────────────────────────────
  //
  // See "WEBSOCKET CLOSE/ERROR FLOW" in module header for full rationale.
  // Short version: load state to check if processFrame already handled
  // the disconnect (status=disconnected), flush attachment fields to
  // SQLite, and only call ensureAlarm() if this is a NEW disconnect.

  override async webSocketClose(ws: WebSocket, _code: number, _reason: string): Promise<void> {
    this.ensureInit();
    const attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) return;

    const span = startWsLifecycleSpan("close", attachment.instance_uid);
    try {
      // Load state BEFORE markDisconnected to check if processFrame already
      // handled a clean agent_disconnect. getDesiredConfig() is cached (free
      // after first call). loadAgentState is 1 SQL read (~$0.001/M).
      const config = this.getDesiredConfig();
      const state = this.repo.loadAgentState(
        attachment.instance_uid,
        attachment.tenant_id,
        attachment.config_id,
        config.hash,
      );

      // Flush attachment-tracked last_seen_at + sequence_num to SQLite.
      // These were tracked in-memory during Tier 0 heartbeats to avoid
      // per-heartbeat SQL writes. This is the deferred flush point.
      // Cost: 1 SQL write ($1/M) — happens on every disconnect.
      this.repo.markDisconnected(
        attachment.instance_uid,
        attachment.last_seen_at,
        attachment.sequence_num,
      );

      if (state.status === "disconnected") {
        // processFrame already handled the disconnect (agent sent
        // agent_disconnect message per OpAMP §3.1.7) and scheduled
        // the alarm. Skip ensureAlarm() to avoid a redundant async call.
        return;
      }
      await this.ensureAlarm();
    } finally {
      span.end();
    }
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    this.ensureInit();
    let attachment: ReturnType<typeof parseAttachment> = null;
    try {
      attachment = parseAttachment(ws.deserializeAttachment());
    } catch {
      // WebSocket may be in a bad state; proceed without attachment
    }

    const span = startWsLifecycleSpan("error", attachment?.instance_uid ?? "unknown");
    recordSpanError(span, error);
    try {
      if (attachment) {
        // Same pattern as webSocketClose: load pre-disconnect state to check
        // if alarm is already scheduled, then flush attachment fields.
        const config = this.getDesiredConfig();
        const state = this.repo.loadAgentState(
          attachment.instance_uid,
          attachment.tenant_id,
          attachment.config_id,
          config.hash,
        );
        this.repo.markDisconnected(
          attachment.instance_uid,
          attachment.last_seen_at,
          attachment.sequence_num,
        );
        if (state.status !== "disconnected") {
          await this.ensureAlarm();
        }
      }
      try {
        ws.close(1011, "Internal error");
      } catch {
        // Socket may already be closed by the runtime after an error
      }
    } finally {
      span.end();
    }
  }

  // ─── Alarm: One-Shot Metrics Snapshot ────────────────────────────────
  //
  // Fires once after state-changing activity, emits an aggregate metrics
  // snapshot to Analytics Engine, then STOPS. Does NOT reschedule itself.
  // This means an idle fleet with no activity pays zero alarm cost.
  // Cost: 1 DO request + ~2 SQL reads (computeMetrics aggregate query).

  override async alarm(): Promise<void> {
    this.ensureInit();
    this.alarmScheduled = false; // Reset guard — next state change will re-check
    try {
      this.emitMetrics();
    } catch {
      // Metrics writes are best-effort and should not make the alarm retry.
    }
  }

  // ─── Lifecycle handlers ──────────────────────────────────────────

  /**
   * Optional initialization hook for caller-supplied policy. Identity is
   * already persisted by `ensureInit()` from `ctx.id.name`, so this
   * route only carries the policy upsert. Idempotent: replays just
   * refresh.
   *
   * Body shape (all fields optional):
   *   { max_agents_per_config?: number | null }
   *
   * The body is *not* trusted to assert identity. Identity always comes
   * from `ctx.id.name`. Any tenant_id/config_id keys in the body are
   * silently dropped; this is the property that lets us delete the
   * worker→DO identity-header trust boundary in later phases.
   */
  private async handleInit(request: Request): Promise<Response> {
    const identity = this.getMyIdentity();

    // Validate body BEFORE writing identity. If the body is malformed,
    // we'd rather refuse the whole /init than commit identity-only and
    // leave the caller thinking the resource was created.
    const result = parseAndValidateBody(await request.text(), initBodySchema);
    if (!result.ok) {
      return Response.json(
        { error: "Invalid body", field: result.error.field, reason: result.error.reason },
        { status: 400 },
      );
    }

    // Identity is already persisted by ensureInit() at the top of every
    // fetch — /init is just an optional policy upsert.
    if (result.value.max_agents_per_config !== undefined) {
      this.repo.saveDoPolicy({ max_agents_per_config: result.value.max_agents_per_config });
      this.cachedPolicy = null; // Invalidate — next getPolicy() re-reads from SQLite
    }

    return Response.json({
      tenant_id: identity.tenant_id,
      config_id: identity.config_id,
      policy: this.getPolicy(),
      initialized: true,
    });
  }

  /**
   * Refresh cached policy values without touching identity. Called when
   * the worker observes a tenant settings change and fans out to all
   * affected DOs.
   */
  private async handleSyncPolicy(request: Request): Promise<Response> {
    const result = parseAndValidateBody(await request.text(), syncPolicyBodySchema);
    if (!result.ok) {
      return Response.json(
        { error: "Invalid body", field: result.error.field, reason: result.error.reason },
        { status: 400 },
      );
    }
    if (result.value.max_agents_per_config !== undefined) {
      this.repo.saveDoPolicy({ max_agents_per_config: result.value.max_agents_per_config });
      this.cachedPolicy = null; // Invalidate — next getPolicy() re-reads from SQLite
    }
    return Response.json({ policy: this.getPolicy() });
  }

  private emitMetrics(): void {
    if (!this.env.FP_ANALYTICS) return;

    const { tenant_id, config_id } = this.getMyIdentity();
    const config = this.getDesiredConfig();
    const metrics = this.repo.computeMetrics(config.hash, STALE_AGENT_THRESHOLD_MS);
    metrics.websocket_count = this.ctx.getWebSockets().length;

    this.env.FP_ANALYTICS.writeDataPoint({
      indexes: [tenant_id],
      blobs: [tenant_id, config_id, FLEET_CONFIG_SNAPSHOT_INTERVAL],
      doubles: configMetricsToDoubles(metrics),
    });
  }

  // ─── Live Collector Telemetry (Phase 1) ─────────────────────────────────────

  /**
   * Send an OpAMP own_metrics offer to a specific collector to enable
   * telemetry streaming. The collector's supervisor will open an OTLP/HTTP
   * connection to the specified endpoint and begin streaming internal metrics.
   */
  async sendOwnMetricsOffer(
    collectorId: string,
    endpoint: string,
    token: string,
    signal: "metrics" | "traces" | "logs" = "metrics",
  ): Promise<void> {
    this.ensureInit();
    // O(1) tag lookup — the collector's WS is tagged with its instance_uid,
    // which matches the DO-assigned UID after enrollment reconnect.
    const sockets = this.ctx.getWebSockets(collectorId);
    if (sockets.length === 0) {
      console.warn(`[own-metrics] collector ${collectorId} not connected, cannot send offer`);
      return;
    }
    const ws = sockets[0]!;

    const settings: ServerToAgent["connection_settings"] = {
      hash: new Uint8Array(32),
      own_metrics:
        signal === "metrics"
          ? {
              destination_endpoint: endpoint,
              headers: [{ key: "Authorization", value: `Bearer ${token}` }],
              heartbeat_interval_seconds: 60,
            }
          : undefined,
      own_traces:
        signal === "traces"
          ? {
              destination_endpoint: endpoint,
              headers: [{ key: "Authorization", value: `Bearer ${token}` }],
              heartbeat_interval_seconds: 60,
            }
          : undefined,
      own_logs:
        signal === "logs"
          ? {
              destination_endpoint: endpoint,
              headers: [{ key: "Authorization", value: `Bearer ${token}` }],
              heartbeat_interval_seconds: 60,
            }
          : undefined,
    };

    const ownMetricsMsg: ServerToAgent = {
      instance_uid: hexToUint8Array(collectorId),
      flags: 0,
      capabilities: SERVER_CAPABILITIES,
      connection_settings: settings,
    };

    try {
      ws.send(encodeServerToAgent(ownMetricsMsg));
      console.warn(`[own-metrics] sent ${signal} offer to collector ${collectorId}`);
    } catch (err) {
      console.error(`[own-metrics] failed to send offer to ${collectorId}:`, err);
    }
  }

  /**
   * Send an empty own_metrics offer to a collector to disable telemetry streaming.
   * The supervisor will close its OTLP connection.
   */
  async revokeOwnMetricsOffers(collectorId: string): Promise<void> {
    this.ensureInit();
    const sockets = this.ctx.getWebSockets(collectorId);
    if (sockets.length === 0) {
      return;
    }
    const ws = sockets[0]!;

    const revokeMsg: ServerToAgent = {
      instance_uid: hexToUint8Array(collectorId),
      flags: 0,
      capabilities: SERVER_CAPABILITIES,
      connection_settings: {
        hash: new Uint8Array(32),
        own_metrics: {},
        own_traces: {},
        own_logs: {},
      },
    };

    try {
      ws.send(encodeServerToAgent(revokeMsg));
      console.warn(`[own-metrics] revoked telemetry offers for collector ${collectorId}`);
    } catch (err) {
      console.error(`[own-metrics] failed to revoke offers for ${collectorId}:`, err);
    }
  }
}

// ─── Pending Device HTTP Handlers ─────────────────────────────────────

async function handleListPendingDevices(sql: SqlStorage, tenantId: string): Promise<Response> {
  const { listPendingDevices } = await import("./agent-state-repo.js");
  // Tenant identity is now derived from `ctx.id.name` and passed in by
  // the caller — no header dependency, no silent-empty fallback.
  if (!tenantId) {
    return Response.json({ error: "Missing tenant" }, { status: 400 });
  }
  const rows = listPendingDevices(sql, tenantId, 1000);
  return Response.json({ devices: rows });
}

async function handleAssignPendingDevice(
  sql: SqlStorage,
  request: Request,
  deviceUid: string,
  tenantId: string,
): Promise<Response> {
  // request.json() throws on malformed JSON, which would surface as a 500
  // here — out of step with the lifecycle endpoints' 400-with-reason
  // contract. Read raw text and parse explicitly so bad input is a 400.
  let body: { config_id?: unknown; assigned_by?: unknown; tenant_id?: unknown };
  try {
    const text = await request.text();
    if (!text) {
      return Response.json({ error: "Empty body", reason: "empty" }, { status: 400 });
    }
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json(
        { error: "Body must be a JSON object", reason: "expected_object" },
        { status: 400 },
      );
    }
    body = parsed as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body", reason: "invalid_json" }, { status: 400 });
  }
  if (typeof body.config_id !== "string" || body.config_id.length === 0) {
    return Response.json({ error: "config_id is required", reason: "required" }, { status: 400 });
  }

  const { upsertPendingAssignment, getPendingDevice, deletePendingDevice } =
    await import("./agent-state-repo.js");

  const device = getPendingDevice(sql, deviceUid);
  if (!device) {
    return Response.json({ error: "Pending device not found" }, { status: 404 });
  }

  // Defense-in-depth: this DO is reached at name `${tenant}:__pending__`,
  // so its `ctx.id.name`-derived tenant is authoritative. If the device
  // row was somehow created under a different tenant — a routing bug
  // upstream — surface that immediately rather than silently completing
  // a cross-tenant assignment. We *also* sanity-check any tenant_id the
  // caller put in the body, but never read it from a header (which would
  // reintroduce the trust boundary this PR is removing).
  if (tenantId !== device.tenant_id) {
    return Response.json(
      { error: "Tenant mismatch", device_tenant: device.tenant_id },
      { status: 403 },
    );
  }
  if (typeof body.tenant_id === "string" && body.tenant_id !== device.tenant_id) {
    return Response.json(
      { error: "Tenant mismatch", device_tenant: device.tenant_id },
      { status: 403 },
    );
  }

  upsertPendingAssignment(sql, {
    instance_uid: deviceUid,
    tenant_id: device.tenant_id,
    target_config_id: body.config_id,
    assigned_by: typeof body.assigned_by === "string" ? body.assigned_by : null,
  });

  deletePendingDevice(sql, deviceUid);

  return Response.json({
    instance_uid: deviceUid,
    target_config_id: body.config_id,
    assigned: true,
  });
}
