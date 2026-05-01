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
import {
  MAX_MESSAGES_PER_MINUTE,
  MAX_AGENTS_PER_CONFIG,
  ALARM_TICK_MS,
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  SERVER_CAPABILITIES,
  ASSIGNMENT_CLAIM_TTL_SECONDS,
  STALE_AGENT_THRESHOLD_MS,
} from "./constants.js";

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
    this.initialized = true;
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

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // Command routes
    if (url.pathname === "/command/set-desired-config" && request.method === "POST")
      return handleSetDesiredConfig(this.commandCtx(), request);
    if (url.pathname === "/command/sweep" && request.method === "POST")
      return handleSweep(
        this.commandCtx(),
        request,
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

    return new Response("Not found", { status: 404 });
  }

  // ─── WebSocket Lifecycle ──────────────────────────────────────────

  private async handleWebSocket(request: Request): Promise<Response> {
    const tenantId = request.headers.get("x-fp-tenant-id") ?? "unknown";
    const configId = request.headers.get("x-fp-config-id") ?? "unknown";
    const instanceUid = request.headers.get("x-fp-instance-uid") ?? crypto.randomUUID();
    const isEnrollment = request.headers.get("x-fp-enrollment") === "true";

    console.warn(
      `[ws.connect] tenant=${tenantId} config=${configId} uid=${instanceUid} enrollment=${isEnrollment}`,
    );

    // Enforce per-tenant plan limit if the worker resolved one.
    const tenantLimit = parseTenantAgentLimit(request.headers.get("x-fp-max-agents-per-config"));
    const limit =
      tenantLimit !== null ? Math.min(tenantLimit, MAX_AGENTS_PER_CONFIG) : MAX_AGENTS_PER_CONFIG;
    const count = this.repo.getAgentCount();
    if (count >= limit && !this.repo.agentExists(instanceUid)) {
      return Response.json(
        { error: "Agent limit reached for this configuration" },
        { status: 429 },
      );
    }
    this.repo.saveDoIdentity(tenantId, configId);

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

    // Handle first message (enrollment or reconnection)
    const result = await handleFirstMessage(this.sessionCtx(), ws, attachment, message);
    if (result.earlyReturn) return;
    attachment = result.attachment;

    // Rate limit — atomic check-and-increment in SQLite
    if (this.repo.checkRateLimit(attachment.instance_uid, MAX_MESSAGES_PER_MINUTE)) {
      try {
        const retryDelayNs = BigInt(30_000_000_000); // 30 seconds
        const errorResponse: ServerToAgent = {
          instance_uid: hexToUint8Array(attachment.instance_uid),
          flags: 0,
          capabilities: SERVER_CAPABILITIES,
          error_response: {
            type: ServerErrorResponseType.Unavailable,
            error_message: "Rate limit exceeded — retry after 30s",
            retry_info: { retry_after_nanoseconds: retryDelayNs },
          },
        };
        ws.send(encodeServerToAgent(errorResponse));
      } catch {
        // Best-effort — socket may already be broken
      }
      ws.close(4029, "Rate limit exceeded");
      return;
    }

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

      // Increment generation on new connection (first processFrame after connect/reconnect)
      if (attachment.is_first_message) {
        state.generation += 1;
        state.connected_at = attachment.connected_at;
        state.status = "connected";
        attachment.is_first_message = false;
        ws.serializeAttachment(attachment);
      }

      const result = await processFrame(
        state,
        agentMsg,
        configBytes,
        undefined,
        defaultProcessContext(),
      );

      // Persist agent's advertised capabilities in attachment for command gating.
      if (agentMsg.capabilities && attachment.capabilities !== agentMsg.capabilities) {
        attachment.capabilities = agentMsg.capabilities;
        ws.serializeAttachment(attachment);
      }

      if (result.shouldPersist) {
        this.repo.saveAgentState(result.newState);
      }

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
      this.repo.markDisconnected(attachment.instance_uid);
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
        this.repo.markDisconnected(attachment.instance_uid);
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

  private emitMetrics(): void {
    if (!this.env.FP_ANALYTICS) return;

    const identity = this.repo.loadDoIdentity();
    if (!identity.tenant_id || !identity.config_id) return;

    const config = this.getDesiredConfig();
    const metrics = this.repo.computeMetrics(config.hash, STALE_AGENT_THRESHOLD_MS);
    metrics.websocket_count = this.ctx.getWebSockets().length;

    this.env.FP_ANALYTICS.writeDataPoint({
      indexes: [identity.tenant_id],
      blobs: [identity.tenant_id, identity.config_id, FLEET_CONFIG_SNAPSHOT_INTERVAL],
      doubles: configMetricsToDoubles(metrics),
    });
  }
}
