import { DurableObject } from "cloudflare:workers";
import {
  decodeAgentToServer,
  encodeServerToAgent,
  detectCodecFormat,
  ServerCapabilities,
  ServerErrorResponseType,
} from "@o11yfleet/core/codec";
import type { CodecFormat, ServerToAgent } from "@o11yfleet/core/codec";
import { processFrame } from "@o11yfleet/core/state-machine";
import { FleetEventType } from "@o11yfleet/core/events";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { hexToUint8Array, uint8ToHex } from "@o11yfleet/core/hex";
import {
  startWsMessageSpan,
  startWsLifecycleSpan,
  recordSpanError,
  SpanStatusCode,
} from "../tracing.js";
import {
  initSchema,
  loadAgentState,
  saveAgentState,
  getAgentCount,
  agentExists,
  markDisconnected,
  getStats,
  listAgents,
  loadDesiredConfig,
  saveDesiredConfig,
  checkRateLimit,
  sweepStaleAgents,
  bufferEvents,
  peekBufferedEvents,
  deleteBufferedEvents,
  pruneEvents,
  countPendingEvents,
  recordSweep,
  getSweepStats,
} from "./agent-state-repo.js";

export interface ConfigDOEnv {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_EVENTS: Queue;
  FP_ANALYTICS?: AnalyticsEngineDataset;
  CLAIM_SECRET: string;
}

interface WSAttachment {
  tenant_id: string;
  config_id: string;
  instance_uid: string;
  connected_at: number;
  is_enrollment?: boolean;
  codec_format?: CodecFormat;
}

/** Runtime validation for WS attachment deserialized from hibernation storage. */
function parseAttachment(raw: unknown): WSAttachment | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj["tenant_id"] !== "string" ||
    typeof obj["config_id"] !== "string" ||
    typeof obj["instance_uid"] !== "string" ||
    typeof obj["connected_at"] !== "number"
  ) {
    return null;
  }
  return {
    tenant_id: obj["tenant_id"],
    config_id: obj["config_id"],
    instance_uid: obj["instance_uid"],
    connected_at: obj["connected_at"],
    is_enrollment: typeof obj["is_enrollment"] === "boolean" ? obj["is_enrollment"] : undefined,
    codec_format:
      obj["codec_format"] === "protobuf" || obj["codec_format"] === "json"
        ? obj["codec_format"]
        : undefined,
  };
}

function containsSemicolonOutsideStrings(sql: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (quote) {
      if (char === quote) {
        if (next === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ";") {
      return true;
    }
  }
  return false;
}

const MAX_DEBUG_QUERY_ROWS = 500;
const MAX_DEBUG_SQL_LENGTH = 4_000;
const MAX_MESSAGES_PER_MINUTE = 60;
const MAX_AGENTS_PER_CONFIG = 50_000;

// Stale agent detection: agents not seen for this long are marked disconnected.
// With zero-wake model, this only applies to agents whose SQLite last_seen_at
// is old AND no longer have an active WebSocket. The primary disconnect signal
// is webSocketClose() (instant). This is the fallback for silent deaths only.
const STALE_AGENT_THRESHOLD_MS = 3_600_000 * 3; // 3 hours (3× heartbeat interval)
const ALARM_DRAIN_BATCH_SIZE = 500;
const QUEUE_SEND_BATCH_SIZE = 100;

// Alarm tick interval for event drain. The alarm only runs while events
// are pending — no perpetual wake loop. Cost: one lightweight alarm tick
// that drains events and stops when empty.
const ALARM_TICK_MS = 5_000;

// Config Durable Object — per tenant:config stateful actor for OpAMP agent management
// Uses WebSocket Hibernation API with DO alarm for stale agent detection.
//
// Design: Minimal instance state — all reads go through DO-local SQLite
// (sync, ~µs per query). This makes the DO fully hibernation-safe.
export class ConfigDurableObject extends DurableObject<ConfigDOEnv> {
  private initialized = false;

  constructor(ctx: DurableObjectState, env: ConfigDOEnv) {
    super(ctx, env);
    // Zero-cost keepalive: the runtime auto-replies "pong" to text "ping"
    // frames WITHOUT waking the DO. This keeps the Cloudflare edge alive
    // so OpAMP heartbeats can be infrequent (10 min) for health reporting only.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private ensureInit(): void {
    if (this.initialized) return;
    initSchema(this.ctx.storage.sql);
    this.initialized = true;
  }

  /** Get desired config from SQLite (~µs). */
  private getDesiredConfig(): { hash: string | null; content: string | null } {
    return loadDesiredConfig(this.ctx.storage.sql);
  }

  /** Get encoded config bytes from SQLite + TextEncoder. */
  private getConfigBytes(): Uint8Array | null {
    const config = this.getDesiredConfig();
    return config.content ? new TextEncoder().encode(config.content) : null;
  }

  /** Schedule an alarm tick to drain buffered events. Only called when
   *  events are actually buffered — the DO stays fully asleep otherwise. */
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

  // ─── HTTP Dispatch ────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    this.ensureInit();
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/command/set-desired-config" && request.method === "POST") {
      return this.handleSetDesiredConfig(request);
    }

    if (url.pathname === "/command/sweep" && request.method === "POST") {
      return this.handleSweep(request);
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      return this.handleGetStats();
    }

    if (url.pathname === "/agents" && request.method === "GET") {
      return this.handleGetAgents();
    }

    if (url.pathname === "/debug/tables" && request.method === "GET") {
      return this.handleDebugTables(request);
    }

    if (url.pathname === "/debug/query" && request.method === "POST") {
      return this.handleDebugQuery(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private isDebugAuthorized(request: Request): boolean {
    return request.headers.get("x-fp-admin-debug") === "true";
  }

  private normalizeDebugParam(value: unknown): string | number | null {
    if (value === null || typeof value === "string" || typeof value === "number") {
      return value;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    throw new Error("Query params must be strings, numbers, booleans, or null");
  }

  private readonlyDebugQuery(sql: string): string {
    if (sql.length > MAX_DEBUG_SQL_LENGTH) {
      throw new Error(`SQL must be ${MAX_DEBUG_SQL_LENGTH} characters or fewer`);
    }
    if (!/^select\b/i.test(sql) || containsSemicolonOutsideStrings(sql)) {
      throw new Error("Only single SELECT queries are allowed");
    }
    return `SELECT * FROM (${sql}) LIMIT ?`;
  }

  private handleDebugTables(request: Request): Response {
    if (!this.isDebugAuthorized(request)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name ASC`,
      )
      .toArray() as Array<{ name: string }>;

    return Response.json({ tables: rows.map((row) => row.name) });
  }

  private async handleDebugQuery(request: Request): Promise<Response> {
    if (!this.isDebugAuthorized(request)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as {
      sql?: unknown;
      params?: unknown;
    } | null;
    const sql = typeof body?.sql === "string" ? body.sql.trim() : "";

    if (!sql) {
      return Response.json({ error: "sql is required" }, { status: 400 });
    }

    try {
      const params = Array.isArray(body?.params)
        ? body.params.map((param) => this.normalizeDebugParam(param))
        : [];
      const cursor = this.ctx.storage.sql.exec(
        this.readonlyDebugQuery(sql),
        ...params,
        MAX_DEBUG_QUERY_ROWS,
      );
      const rows = cursor.toArray() as Array<Record<string, unknown>>;
      return Response.json({ rows, row_count: rows.length });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Query failed" },
        { status: 400 },
      );
    }
  }

  // ─── WebSocket Lifecycle ──────────────────────────────────────────

  private async handleWebSocket(request: Request): Promise<Response> {
    const tenantId = request.headers.get("x-fp-tenant-id") ?? "unknown";
    const configId = request.headers.get("x-fp-config-id") ?? "unknown";
    const instanceUid = request.headers.get("x-fp-instance-uid") ?? crypto.randomUUID();
    const isEnrollment = request.headers.get("x-fp-enrollment") === "true";

    // Enforce max agents per config
    const count = getAgentCount(this.ctx.storage.sql);
    if (count >= MAX_AGENTS_PER_CONFIG && !agentExists(this.ctx.storage.sql, instanceUid)) {
      return Response.json(
        { error: "Agent limit reached for this configuration" },
        { status: 429 },
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.ctx.acceptWebSocket(server);

    // Per OpAMP spec, client sends first. Defer enrollment to webSocketMessage()
    // so we can auto-detect the codec from the first binary frame.
    const attachment: WSAttachment = {
      tenant_id: tenantId,
      config_id: configId,
      instance_uid: instanceUid,
      connected_at: Date.now(),
      is_enrollment: isEnrollment,
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

    const attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) {
      ws.close(1008, "Missing attachment");
      return;
    }

    // Detect codec format on first message and persist in attachment
    if (!attachment.codec_format) {
      attachment.codec_format = detectCodecFormat(message);

      // Complete enrollment on first message (OpAMP spec: client sends first)
      if (attachment.is_enrollment) {
        try {
          const codec = attachment.codec_format;

          // For protobuf clients, use the agent's own instance_uid from the message
          if (codec === "protobuf") {
            const agentMsg = decodeAgentToServer(message, codec);
            if (agentMsg.instance_uid && agentMsg.instance_uid.byteLength > 0) {
              attachment.instance_uid = uint8ToHex(agentMsg.instance_uid);
            }
          }

          // Generate signed assignment claim for reconnection
          const claim: AssignmentClaim = {
            v: 1,
            tenant_id: attachment.tenant_id,
            config_id: attachment.config_id,
            instance_uid: attachment.instance_uid,
            generation: 1,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400, // 24h
          };
          const assignmentToken = await signClaim(claim, this.env.CLAIM_SECRET);

          // Send enrollment_complete text frame to JSON clients only.
          // Real OpAMP clients (protobuf) don't understand this custom extension
          // and would fail trying to parse it as protobuf.
          if (codec === "json") {
            ws.send(
              JSON.stringify({
                type: "enrollment_complete",
                instance_uid: attachment.instance_uid,
                assignment_claim: assignmentToken,
              }),
            );
          }

          // Buffer enrollment event to SQLite (sync, ~µs). Alarm drains in batches.
          bufferEvents(this.ctx.storage.sql, [
            {
              type: FleetEventType.AGENT_ENROLLED,
              tenant_id: attachment.tenant_id,
              config_id: attachment.config_id,
              instance_uid: attachment.instance_uid,
              timestamp: Date.now(),
              generation: 1,
            },
          ]);
          await this.ensureAlarm();

          attachment.is_enrollment = false;
          ws.serializeAttachment(attachment);
        } catch (_err) {
          ws.close(4500, "Enrollment failed");
          return;
        }
        // Fall through to process this first message normally
      } else {
        ws.serializeAttachment(attachment);
      }
    }
    const codec = attachment.codec_format!;

    // Rate limit — atomic check-and-increment in SQLite
    if (checkRateLimit(this.ctx.storage.sql, attachment.instance_uid, MAX_MESSAGES_PER_MINUTE)) {
      // Send a proper OpAMP error response with RetryInfo before closing
      try {
        const retryDelayNs = BigInt(30_000_000_000); // 30 seconds
        const errorResponse: ServerToAgent = {
          instance_uid: hexToUint8Array(attachment.instance_uid),
          flags: 0,
          capabilities:
            ServerCapabilities.AcceptsStatus |
            ServerCapabilities.OffersRemoteConfig |
            ServerCapabilities.AcceptsEffectiveConfig,
          error_response: {
            type: ServerErrorResponseType.Unavailable,
            error_message: "Rate limit exceeded — retry after 30s",
            retry_info: { retry_after_nanoseconds: retryDelayNs },
          },
        };
        ws.send(encodeServerToAgent(errorResponse, codec));
      } catch {
        // Best-effort — socket may already be broken
      }
      ws.close(4029, "Rate limit exceeded");
      return;
    }

    // Load config from SQLite (~µs)
    const config = this.getDesiredConfig();
    const configBytes = this.getConfigBytes();

    const span = startWsMessageSpan(
      attachment.instance_uid,
      attachment.tenant_id,
      attachment.config_id,
    );
    try {
      const agentMsg = decodeAgentToServer(message, codec);
      span.setAttribute("opamp.sequence_num", agentMsg.sequence_num);
      span.setAttribute("opamp.codec", codec);

      const state = loadAgentState(
        this.ctx.storage.sql,
        attachment.instance_uid,
        attachment.tenant_id,
        attachment.config_id,
        config.hash,
      );

      const result = processFrame(state, agentMsg, configBytes);

      if (result.shouldPersist) {
        saveAgentState(this.ctx.storage.sql, result.newState);
      }

      // Buffer events to SQLite (sync, ~µs). Alarm drains in batches.
      if (result.events.length > 0) {
        span.setAttribute("opamp.events_emitted", result.events.length);
        bufferEvents(this.ctx.storage.sql, result.events);
        await this.ensureAlarm();
      }

      if (result.response) {
        ws.send(encodeServerToAgent(result.response, codec));
        if (result.response.remote_config) {
          span.setAttribute("opamp.config_offered", true);
        }
      }
    } catch (err) {
      recordSpanError(span, err);
      console.error(`[ws.message] error for ${attachment.instance_uid}:`, err);
      // Close this connection gracefully — never propagate errors out of
      // webSocketMessage() because an unhandled throw can crash the entire DO,
      // killing ALL WebSocket connections (not just this one).
      try {
        ws.close(1011, "Internal error");
      } catch {
        // Socket may already be closed
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
      const state = loadAgentState(
        this.ctx.storage.sql,
        attachment.instance_uid,
        attachment.tenant_id,
        attachment.config_id,
        config.hash,
      );
      markDisconnected(this.ctx.storage.sql, attachment.instance_uid);
      if (state.status === "disconnected") {
        return;
      }
      bufferEvents(this.ctx.storage.sql, [
        {
          type: FleetEventType.AGENT_DISCONNECTED,
          tenant_id: attachment.tenant_id,
          config_id: attachment.config_id,
          instance_uid: attachment.instance_uid,
          timestamp: Date.now(),
          reason: "websocket_close",
        },
      ]);
      // Ensure alarm fires soon to drain this disconnect event,
      // even if the DO was about to go idle.
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
        markDisconnected(this.ctx.storage.sql, attachment.instance_uid);
        bufferEvents(this.ctx.storage.sql, [
          {
            type: FleetEventType.AGENT_DISCONNECTED,
            tenant_id: attachment.tenant_id,
            config_id: attachment.config_id,
            instance_uid: attachment.instance_uid,
            timestamp: Date.now(),
            reason: "websocket_error",
          },
        ]);
        // Ensure alarm fires soon to drain this error event
        await this.ensureAlarm();
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

  // ─── Alarm: Event Drain ─────────────────────────────────────────────
  //
  // Fires only when events are pending. Each tick: prune → drain → stop.
  // No perpetual wake loop — the DO stays fully hibernated when idle.
  // Stale sweeps are triggered externally via cron → /command/sweep.

  override async alarm(): Promise<void> {
    this.ensureInit();

    // 1. Prune expired/overflow events (safety valve)
    const pruned = pruneEvents(this.ctx.storage.sql);
    if (pruned > 0) {
      console.warn(`[alarm] pruned ${pruned} expired/overflow events`);
    }

    // 2. Drain buffered events → queue (peek + delete-on-success)
    const { events: pending, ids: pendingIds } = peekBufferedEvents(
      this.ctx.storage.sql,
      ALARM_DRAIN_BATCH_SIZE,
    );
    if (pending.length > 0) {
      for (let i = 0; i < pending.length; i += QUEUE_SEND_BATCH_SIZE) {
        const chunk = pending.slice(i, i + QUEUE_SEND_BATCH_SIZE);
        const chunkIds = pendingIds.slice(i, i + QUEUE_SEND_BATCH_SIZE);
        try {
          await this.env.FP_EVENTS.sendBatch(chunk.map((event) => ({ body: event })));
          deleteBufferedEvents(this.ctx.storage.sql, chunkIds);
        } catch (err) {
          console.error(`[alarm] sendBatch failed (${chunk.length} events), will retry:`, err);
          break;
        }
      }
    }

    // 3. Reschedule only if more events remain
    const remaining = countPendingEvents(this.ctx.storage.sql);
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_TICK_MS);
    }
  }

  // ─── Internal Commands ────────────────────────────────────────────

  private async handleSetDesiredConfig(request: Request): Promise<Response> {
    const body = await request.json<{ config_hash: string; config_content?: string }>();
    if (!body.config_hash) {
      return Response.json({ error: "config_hash required" }, { status: 400 });
    }

    // Persist to SQLite (sync, ~µs)
    saveDesiredConfig(this.ctx.storage.sql, body.config_hash, body.config_content ?? null);

    const sockets = this.ctx.getWebSockets();
    const desiredHashBytes = hexToUint8Array(body.config_hash);
    let pushed = 0;

    // Build config_map with YAML content if available
    const configMap = this.buildConfigMap(body.config_content ?? null);

    for (const ws of sockets) {
      const attachment = parseAttachment(ws.deserializeAttachment());
      if (!attachment) continue;

      try {
        // Skip enrollment sockets that haven't negotiated a codec yet
        const socketCodec =
          attachment.codec_format ?? (attachment.is_enrollment ? undefined : "json");
        if (!socketCodec) continue;
        ws.send(
          encodeServerToAgent(
            {
              instance_uid: hexToUint8Array(attachment.instance_uid),
              flags: 0,
              capabilities:
                ServerCapabilities.AcceptsStatus |
                ServerCapabilities.OffersRemoteConfig |
                ServerCapabilities.AcceptsEffectiveConfig,
              remote_config: {
                config: { config_map: configMap },
                config_hash: desiredHashBytes,
              },
            },
            socketCodec,
          ),
        );
        pushed++;
      } catch {
        // Socket may have closed
      }
    }

    return Response.json({ pushed, config_hash: body.config_hash });
  }

  /**
   * Build the config_map with actual YAML content if available.
   */
  private buildConfigMap(
    content: string | null,
  ): Record<string, { body: Uint8Array; content_type: string }> {
    if (!content) return {};
    return {
      "": {
        body: new TextEncoder().encode(content),
        content_type: "text/yaml",
      },
    };
  }

  private handleGetStats(): Response {
    const stats = getStats(this.ctx.storage.sql);
    const config = this.getDesiredConfig();
    const sweepStats = getSweepStats(this.ctx.storage.sql);
    const wsCount = this.ctx.getWebSockets().length;
    return Response.json({
      total_agents: stats.total,
      connected_agents: wsCount, // authoritative: live WebSocket count, not SQL
      healthy_agents: stats.healthy,
      desired_config_hash: config.hash,
      active_websockets: wsCount,
      stale_sweep: sweepStats,
    });
  }

  private handleGetAgents(): Response {
    const agents = listAgents(this.ctx.storage.sql);
    return Response.json({ agents });
  }

  /** Externally triggered stale agent audit (called via daily cron → worker → DO).
   *  Marks agents disconnected only when last_seen_at is stale and no active
   *  WebSocket with the same instance_uid is attached. This is rare
   *  reconciliation, not the normal liveness path. */
  private async handleSweep(request: Request): Promise<Response> {
    const start = Date.now();
    const activeInstanceUids = this.getActiveInstanceUids();
    const staleUids = sweepStaleAgents(
      this.ctx.storage.sql,
      STALE_AGENT_THRESHOLD_MS,
      activeInstanceUids,
    );
    if (staleUids.length > 0) {
      bufferEvents(
        this.ctx.storage.sql,
        staleUids.map((agent) => ({
          type: FleetEventType.AGENT_DISCONNECTED as const,
          tenant_id: agent.tenant_id,
          config_id: agent.config_id,
          instance_uid: agent.instance_uid,
          timestamp: Date.now(),
          reason: "stale_timeout",
        })),
      );
      await this.ensureAlarm();
    }
    const durationMs = Date.now() - start;
    recordSweep(this.ctx.storage.sql, {
      staleCount: staleUids.length,
      activeSocketCount: activeInstanceUids.size,
      durationMs,
    });

    const tenantId = request.headers.get("x-fp-tenant-id") ?? staleUids[0]?.tenant_id ?? "unknown";
    const configId = request.headers.get("x-fp-config-id") ?? staleUids[0]?.config_id ?? "unknown";
    try {
      this.env.FP_ANALYTICS?.writeDataPoint({
        blobs: ["stale_sweep", tenantId, configId],
        doubles: [Date.now(), staleUids.length, activeInstanceUids.size, durationMs],
        indexes: [tenantId],
      });
    } catch {
      // Analytics write failure should never block stale reconciliation.
    }

    return Response.json({
      swept: staleUids.length,
      active_websockets: activeInstanceUids.size,
      duration_ms: durationMs,
    });
  }
}
