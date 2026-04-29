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

const MAX_MESSAGES_PER_MINUTE = 60;
const MAX_AGENTS_PER_CONFIG = 50_000;

// Stale agent detection: agents not seen for this long are marked disconnected.
// With zero-wake model, this only applies to agents whose SQLite last_seen_at
// is old AND no longer have an active WebSocket. The primary liveness signal is
// the auto-response ping/pong timestamp checked directly on sockets.
const STALE_AGENT_THRESHOLD_MS = 3_600_000 * 3; // 3 hours (3× heartbeat interval)
// How often the alarm fires (60s) — lightweight: zombie check + event drain.
const STALE_SWEEP_INTERVAL_MS = 60_000;
// Zombie threshold: disabled — we rely on webSocketClose() for clean disconnects
// and the stale agent sweep (STALE_AGENT_THRESHOLD_MS) for silent deaths.
// getWebSocketAutoResponseTimestamp() is unreliable at scale (returns null for
// hibernated sockets), so we don't use it for liveness detection.
// const ZOMBIE_THRESHOLD_MS = 120_000;

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

  /** Schedule the stale-agent sweep alarm if not already set. */
  private async ensureAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + STALE_SWEEP_INTERVAL_MS);
    }
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

    if (url.pathname === "/stats" && request.method === "GET") {
      return this.handleGetStats();
    }

    if (url.pathname === "/agents" && request.method === "GET") {
      return this.handleGetAgents();
    }

    return new Response("Not found", { status: 404 });
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

    // Start stale sweep alarm when agents connect
    await this.ensureAlarm();

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

  // ─── Alarm: Stale Sweep + Event Drain ───────────────────────────────
  //
  // Zero-wake model: ping/pong auto-response keeps connections alive without
  // waking the DO. The alarm handles stale agent cleanup and event draining.

  override async alarm(): Promise<void> {
    this.ensureInit();

    const now = Date.now();
    const sockets = this.ctx.getWebSockets();

    // 1. Zombie detection — DISABLED.
    //    getWebSocketAutoResponseTimestamp() returns null for hibernated sockets
    //    at scale, causing false-positive kills. Instead we rely on:
    //    - webSocketClose() for clean disconnects (instant)
    //    - Stale agent sweep below for silent deaths (STALE_AGENT_THRESHOLD_MS)
    //    - Ping/pong auto-response keeps Cloudflare edge alive (zero DO cost)

    // 2. Sweep agents in SQLite that have no active WebSocket AND haven't been
    //    seen for a long time (fallback for any edge case where webSocketClose
    //    didn't fire). This is rare — the zombie check above catches most cases.
    const staleUids = sweepStaleAgents(this.ctx.storage.sql, STALE_AGENT_THRESHOLD_MS);
    if (staleUids.length > 0) {
      console.warn(`[alarm] swept ${staleUids.length} stale agents from SQLite`);
      bufferEvents(
        this.ctx.storage.sql,
        staleUids.map((agent) => ({
          type: FleetEventType.AGENT_DISCONNECTED as const,
          tenant_id: agent.tenant_id,
          config_id: agent.config_id,
          instance_uid: agent.instance_uid,
          timestamp: now,
          reason: "stale_timeout",
        })),
      );
    }

    // 3. Drain buffered events → queue in one batch per alarm tick.
    //    Peek first, delete only after successful delivery to avoid data loss.
    const { events: pending, ids: pendingIds } = peekBufferedEvents(this.ctx.storage.sql, 100);
    if (pending.length > 0) {
      try {
        await this.env.FP_EVENTS.sendBatch(pending.map((event) => ({ body: event })));
        deleteBufferedEvents(this.ctx.storage.sql, pendingIds);
      } catch (err) {
        console.error(`[alarm] sendBatch failed (${pending.length} events), will retry:`, err);
      }
    }

    // 4. Reschedule
    const aliveSocketCount = this.ctx.getWebSockets().length;
    const pendingCount = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) as count FROM pending_events`)
      .one()["count"] as number;

    console.warn(
      `[alarm] ws=${sockets.length} alive=${aliveSocketCount} stale=${staleUids.length} pending_events=${pendingCount} drained=${pending.length}`,
    );

    if (aliveSocketCount > 0 || pendingCount > 0) {
      const nextInterval = pendingCount > 0 ? 5_000 : STALE_SWEEP_INTERVAL_MS;
      await this.ctx.storage.setAlarm(Date.now() + nextInterval);
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
    const wsCount = this.ctx.getWebSockets().length;
    return Response.json({
      total_agents: stats.total,
      connected_agents: wsCount, // authoritative: live WebSocket count, not SQL
      healthy_agents: stats.healthy,
      desired_config_hash: config.hash,
      active_websockets: wsCount,
    });
  }

  private handleGetAgents(): Response {
    const agents = listAgents(this.ctx.storage.sql);
    return Response.json({ agents });
  }
}
