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
import type { AgentStateRepository, DesiredConfig } from "./agent-state-repo-interface.js";
import { SqliteAgentStateRepo } from "./sqlite-agent-state-repo.js";
import { parseAttachment } from "./ws-attachment.js";
import type { WSAttachment } from "./ws-attachment.js";
import { handleDebugTables, handleDebugQuery } from "./admin-debug-handler.js";
import {
  handleSetDesiredConfig,
  handleDisconnectAll,
  handleRestartCommand,
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
} from "./constants.js";

const PENDING_DO_CONFIG_ID = "__pending__";

export interface ConfigDOEnv {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_ANALYTICS?: AnalyticsEngineDataset;
  O11YFLEET_CLAIM_HMAC_SECRET: string;
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

// Config Durable Object — per tenant:config stateful actor for OpAMP agent management
// Uses WebSocket Hibernation API with DO alarm for event draining to Queues.
//
// Design: Minimal instance state — all reads go through DO-local SQLite
// (sync, ~µs per query). This makes the DO fully hibernation-safe.
export class ConfigDurableObject extends DurableObject<ConfigDOEnv> {
  private repo: AgentStateRepository;
  private initialized = false;

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
   * Parsing is delegated to `parseConfigDoName` (pure, tested in
   * isolation). This method just orchestrates: read `ctx.id.name`, run
   * the parser, throw a sanitized error on the structured failure modes
   * (DO addressed via `idFromString`/`newUniqueId`, malformed name, etc.).
   */
  private getMyIdentity(): ConfigDoIdentity {
    const result = parseConfigDoName(this.ctx.id.name);
    if (!result.ok) {
      // Truncate the name before echoing it so an adversarial caller
      // can't inflate log lines arbitrarily.
      throw new Error(
        `[ConfigDO] invalid identity (${result.error}): ${safeForLog(this.ctx.id.name)}`,
      );
    }
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
    const config = this.repo.loadDesiredConfig();
    if (config.bytes === null && config.content !== null) {
      return { ...config, bytes: new TextEncoder().encode(config.content) };
    }
    return config;
  }

  /** Schedule one deferred aggregate metrics snapshot after state changes. */
  private async ensureAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_TICK_MS);
    }
  }

  private getActiveInstanceUids(): Set<string> {
    const active = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = parseAttachment(ws.deserializeAttachment());
      if (attachment) {
        active.add(attachment.instance_uid);
      }
    }
    return active;
  }

  private commandCtx(): CommandContext {
    return {
      repo: this.repo,
      identity: this.getMyIdentity(),
      getWebSockets: () => this.ctx.getWebSockets(),
      ensureAlarm: () => this.ensureAlarm(),
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
        () => this.getActiveInstanceUids(),
        () => this.emitMetrics(),
      );
    if (url.pathname === "/command/disconnect" && request.method === "POST")
      return handleDisconnectAll(this.commandCtx());
    if (url.pathname === "/command/restart" && request.method === "POST")
      return handleRestartCommand(this.commandCtx());

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
        () => this.getActiveInstanceUids(),
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
      const cachedPolicy = this.repo.loadDoPolicy();
      const headerLimit = parseTenantAgentLimit(request.headers.get("x-fp-max-agents-per-config"));
      const tenantLimit = cachedPolicy.max_agents_per_config ?? headerLimit;
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

    this.ctx.acceptWebSocket(server);

    const attachment: WSAttachment = {
      tenant_id: tenantId,
      config_id: configId,
      instance_uid: instanceUid,
      connected_at: Date.now(),
      is_enrollment: isEnrollment,
      is_first_message: true,
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
    if (attachment.is_first_message || attachment.is_enrollment) {
      const result = await handleFirstMessage(this.sessionCtx(), ws, attachment, message);
      if (result.earlyReturn) return;
      attachment = result.attachment;
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

      // Duplicate UID detection (OpAMP spec §3.2.1.2)
      if (agentMsg.sequence_num === 0) {
        const otherSockets = this.ctx.getWebSockets().filter((s) => s !== ws);
        const isDuplicate = otherSockets.some((s) => {
          const att = parseAttachment(s.deserializeAttachment());
          return att?.instance_uid === attachment!.instance_uid;
        });
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

      // Track session-scoped state in WS attachment (zero SQL cost).
      // seq_num + last_seen_at live here so no-op heartbeats avoid a SQLite write.
      // capabilities are already tracked for command gating.
      if (result.newState.sequence_num !== attachment.sequence_num) {
        attachment.sequence_num = result.newState.sequence_num;
      }
      if (attachment.capabilities !== agentMsg.capabilities) {
        attachment.capabilities = agentMsg.capabilities;
      }
      // Always update last_seen_at so liveness is tracked even on Tier 0.
      // Flushed to SQLite on webSocketClose → markDisconnected.
      attachment.last_seen_at = Date.now();
      ws.serializeAttachment(attachment);

      if (forceFullPersist || (result.shouldPersist && result.dirtyFields.has("connected_at"))) {
        // Tier 2: first message, hello, reconnect, or disconnect — row may not exist,
        // and config-do may have mutated fields (generation, connected_at, status) outside
        // processFrame. Full UPSERT writes all 16 columns.
        this.repo.saveAgentState(result.newState);
      } else if (result.shouldPersist && result.dirtyFields.size > 0) {
        // Tier 1: existing agent, field change only — targeted UPDATE writes only dirty
        // columns, skipping JSON.stringify for untouched component_health_map/available_components.
        this.repo.updateAgentPartial(attachment.instance_uid, result.newState, result.dirtyFields);
      }
      // When dirtyFields is empty but shouldPersist is true (e.g. config_rejected),
      // only events need processing — no SQL write needed.

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

        ws.send(encodeServerToAgent(result.response));
        if (result.response.remote_config) {
          span.setAttribute("opamp.config_offered", true);
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

  override async webSocketClose(ws: WebSocket, _code: number, _reason: string): Promise<void> {
    this.ensureInit();
    const attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) return;

    const span = startWsLifecycleSpan("close", attachment.instance_uid);
    try {
      const config = this.getDesiredConfig();
      const state = this.repo.loadAgentState(
        attachment.instance_uid,
        attachment.tenant_id,
        attachment.config_id,
        config.hash,
      );
      // Flush attachment-tracked last_seen_at + sequence_num to SQLite so
      // metrics and stale sweeps stay accurate even for Tier 0 connections.
      this.repo.markDisconnected(
        attachment.instance_uid,
        attachment.last_seen_at,
        attachment.sequence_num,
      );
      if (state.status === "disconnected") {
        return;
      }
      await this.ensureAlarm();
    } finally {
      span.end();
    }
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.ensureInit();
    const attachment = parseAttachment(ws.deserializeAttachment());

    const span = startWsLifecycleSpan("error", attachment?.instance_uid ?? "unknown");
    span.setStatus({ code: SpanStatusCode.ERROR });
    try {
      if (attachment) {
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

  // ─── Alarm: Metrics Snapshot ───────────────────────────────────────

  override async alarm(): Promise<void> {
    this.ensureInit();
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
    }

    return Response.json({
      tenant_id: identity.tenant_id,
      config_id: identity.config_id,
      policy: this.repo.loadDoPolicy(),
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
    }
    return Response.json({ policy: this.repo.loadDoPolicy() });
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
