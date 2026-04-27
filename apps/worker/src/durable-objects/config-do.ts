import { DurableObject } from "cloudflare:workers";
import { decodeAgentToServer, encodeServerToAgent } from "@o11yfleet/core/codec";
import { processFrame } from "@o11yfleet/core/state-machine";
import type { AnyFleetEvent } from "@o11yfleet/core/events";
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { hexToUint8Array } from "@o11yfleet/core/hex";
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
} from "./agent-state-repo.js";

export interface ConfigDOEnv {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_EVENTS: Queue;
  FP_ANALYTICS: AnalyticsEngineDataset;
  CLAIM_SECRET: string;
}

interface WSAttachment {
  tenant_id: string;
  config_id: string;
  instance_uid: string;
  connected_at: number;
  is_enrollment?: boolean;
}

const MAX_MESSAGES_PER_MINUTE = 60;
const MAX_AGENTS_PER_CONFIG = 50_000;

// Config Durable Object — per tenant:config stateful actor for OpAMP agent management
// Uses WebSocket Hibernation API — no timers, no alarms, no intervals
//
// Design: ZERO meaningful instance state. All mutable data lives in DO-local
// SQLite (sync, ~µs per query). This makes the DO fully hibernation-proof —
// no async rehydration needed on wake-up.
export class ConfigDurableObject extends DurableObject<ConfigDOEnv> {
  private initialized = false;

  constructor(ctx: DurableObjectState, env: ConfigDOEnv) {
    super(ctx, env);
  }

  private ensureInit(): void {
    if (this.initialized) return;
    initSchema(this.ctx.storage.sql);
    this.initialized = true;
  }

  // ─── HTTP Dispatch ────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
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

    const attachment: WSAttachment = {
      tenant_id: tenantId,
      config_id: configId,
      instance_uid: instanceUid,
      connected_at: Date.now(),
      is_enrollment: isEnrollment,
    };
    server.serializeAttachment(attachment);

    if (isEnrollment) {
      const claim: AssignmentClaim = {
        v: 1,
        tenant_id: tenantId,
        config_id: configId,
        instance_uid: instanceUid,
        generation: 1,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400 * 30,
      };

      try {
        const signedClaim = await signClaim(claim, this.env.CLAIM_SECRET);

        server.send(JSON.stringify({
          type: "enrollment_complete",
          assignment_claim: signedClaim,
          instance_uid: instanceUid,
        }));

        server.send(encodeServerToAgent({
          instance_uid: hexToUint8Array(instanceUid),
          flags: 0,
          capabilities: 0x00000003,
          agent_identification: {
            new_instance_uid: hexToUint8Array(instanceUid),
          },
        }));

        await this.emitEvents([{
          type: "agent_enrolled" as const,
          tenant_id: tenantId,
          config_id: configId,
          instance_uid: instanceUid,
          timestamp: Date.now(),
          generation: 1,
        }]);
      } catch {
        server.close(4500, "Enrollment failed");
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.ensureInit();

    if (typeof message === "string") {
      ws.close(4000, "Binary frames only");
      return;
    }

    const attachment = ws.deserializeAttachment() as WSAttachment;
    if (!attachment) {
      ws.close(1008, "Missing attachment");
      return;
    }

    // Rate limit — atomic check-and-increment in SQLite
    if (checkRateLimit(this.ctx.storage.sql, attachment.instance_uid, MAX_MESSAGES_PER_MINUTE)) {
      ws.close(4029, "Rate limit exceeded");
      return;
    }

    // Load config from SQLite (sync, ~µs)
    const config = loadDesiredConfig(this.ctx.storage.sql);
    const configBytes = config.content ? new TextEncoder().encode(config.content) : null;

    const span = startWsMessageSpan(attachment.instance_uid, attachment.tenant_id, attachment.config_id);
    try {
      const agentMsg = decodeAgentToServer(message);
      span.setAttribute("opamp.sequence_num", agentMsg.sequence_num);

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

      if (result.events.length > 0) {
        span.setAttribute("opamp.events_emitted", result.events.length);
        await this.emitEvents(result.events);
      }

      if (result.response) {
        ws.send(encodeServerToAgent(result.response));
        if (result.response.remote_config) {
          span.setAttribute("opamp.config_offered", true);
        }
      }
    } catch (err) {
      recordSpanError(span, err);
      throw err;
    } finally {
      span.end();
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string): Promise<void> {
    this.ensureInit();
    const attachment = ws.deserializeAttachment() as WSAttachment | null;
    if (!attachment) return;

    const span = startWsLifecycleSpan("close", attachment.instance_uid);
    try {
      markDisconnected(this.ctx.storage.sql, attachment.instance_uid);
      await this.emitEvents([{
        type: "agent_disconnected" as const,
        tenant_id: attachment.tenant_id,
        config_id: attachment.config_id,
        instance_uid: attachment.instance_uid,
        timestamp: Date.now(),
        reason: "websocket_close",
      }]);
    } finally {
      span.end();
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.ensureInit();
    const attachment = ws.deserializeAttachment() as WSAttachment | null;

    const span = startWsLifecycleSpan("error", attachment?.instance_uid ?? "unknown");
    span.setStatus({ code: SpanStatusCode.ERROR });
    try {
      if (attachment) {
        markDisconnected(this.ctx.storage.sql, attachment.instance_uid);
        await this.emitEvents([{
          type: "agent_disconnected" as const,
          tenant_id: attachment.tenant_id,
          config_id: attachment.config_id,
          instance_uid: attachment.instance_uid,
          timestamp: Date.now(),
          reason: "websocket_error",
        }]);
      }
      ws.close(1011, "Internal error");
    } finally {
      span.end();
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
      const attachment = ws.deserializeAttachment() as WSAttachment | null;
      if (!attachment) continue;

      try {
        ws.send(encodeServerToAgent({
          instance_uid: hexToUint8Array(attachment.instance_uid),
          flags: 0,
          capabilities: 0x00000003,
          remote_config: {
            config: { config_map: configMap },
            config_hash: desiredHashBytes,
          },
        }));
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
  private buildConfigMap(content: string | null): Record<string, { body: Uint8Array; content_type: string }> {
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
    const config = loadDesiredConfig(this.ctx.storage.sql);
    return Response.json({
      total_agents: stats.total,
      connected_agents: stats.connected,
      healthy_agents: stats.healthy,
      desired_config_hash: config.hash,
      active_websockets: this.ctx.getWebSockets().length,
    });
  }

  private handleGetAgents(): Response {
    const agents = listAgents(this.ctx.storage.sql);
    return Response.json({ agents });
  }

  // ─── Event Emission ───────────────────────────────────────────────

  private async emitEvents(events: AnyFleetEvent[]): Promise<void> {
    try {
      for (const event of events) {
        await this.env.FP_EVENTS.send(event);
      }
    } catch {
      // Queue failure should not break WS handling
    }
  }
}
