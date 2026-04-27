import { DurableObject } from "cloudflare:workers";
import { decodeAgentToServer, encodeServerToAgent } from "@o11yfleet/core/codec";
import { processFrame } from "@o11yfleet/core/state-machine";
import type { AgentState } from "@o11yfleet/core/state-machine";
import type { AnyFleetEvent } from "@o11yfleet/core/events";

export interface ConfigDOEnv {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_EVENTS: Queue;
  FP_ANALYTICS: AnalyticsEngineDataset;
}

interface WSAttachment {
  tenant_id: string;
  config_id: string;
  instance_uid: string;
  connected_at: number;
}

// Config Durable Object — Phase 2B
// Central stateful actor for OpAMP agent management
// Uses WebSocket Hibernation API — no timers, no alarms, no intervals
export class ConfigDurableObject extends DurableObject<ConfigDOEnv> {
  private desiredConfigHash: string | null = null;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: ConfigDOEnv) {
    super(ctx, env);
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        instance_uid TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        config_id TEXT NOT NULL,
        sequence_num INTEGER NOT NULL DEFAULT 0,
        generation INTEGER NOT NULL DEFAULT 1,
        healthy INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_error TEXT NOT NULL DEFAULT '',
        current_config_hash TEXT,
        last_seen_at INTEGER NOT NULL DEFAULT 0,
        connected_at INTEGER NOT NULL DEFAULT 0,
        agent_description TEXT
      )
    `);

    // Load desired config hash from storage
    const stored = await this.ctx.storage.get<string>("desired_config_hash");
    if (stored) {
      this.desiredConfigHash = stored;
    }
    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInit();
    const url = new URL(request.url);

    // WebSocket upgrade for OpAMP connections
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // HTTP commands
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

  private async handleWebSocket(request: Request): Promise<Response> {
    // Extract context from internal headers (set by ingress router)
    const tenantId = request.headers.get("x-fp-tenant-id") ?? "unknown";
    const configId = request.headers.get("x-fp-config-id") ?? "unknown";
    const instanceUid = request.headers.get("x-fp-instance-uid") ?? crypto.randomUUID();

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Accept with hibernation API
    this.ctx.acceptWebSocket(server);

    // Serialize attachment for hibernation restore
    const attachment: WSAttachment = {
      tenant_id: tenantId,
      config_id: configId,
      instance_uid: instanceUid,
      connected_at: Date.now(),
    };
    server.serializeAttachment(attachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureInit();

    const attachment = ws.deserializeAttachment() as WSAttachment;
    if (!attachment) {
      ws.close(1008, "Missing attachment");
      return;
    }

    // Decode the frame
    let buf: ArrayBuffer;
    if (typeof message === "string") {
      buf = new TextEncoder().encode(message).buffer as ArrayBuffer;
    } else {
      buf = message;
    }

    const agentMsg = decodeAgentToServer(buf);

    // Load agent state from DO SQLite
    const state = this.loadAgentState(attachment);

    // Process through state machine
    const result = processFrame(state, agentMsg);

    // Persist if needed
    if (result.shouldPersist) {
      this.saveAgentState(result.newState);
    }

    // Emit events to queue
    if (result.events.length > 0) {
      await this.emitEvents(result.events);
    }

    // Send response
    if (result.response) {
      const responseBuf = encodeServerToAgent(result.response);
      ws.send(responseBuf);
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string): Promise<void> {
    await this.ensureInit();
    const attachment = ws.deserializeAttachment() as WSAttachment | null;
    if (!attachment) return;

    // Mark agent as disconnected in DO SQLite
    this.ctx.storage.sql.exec(
      `UPDATE agents SET status = 'disconnected', last_seen_at = ? WHERE instance_uid = ?`,
      Date.now(),
      attachment.instance_uid,
    );

    // Emit disconnect event
    await this.emitEvents([
      {
        type: "agent_disconnected" as const,
        tenant_id: attachment.tenant_id,
        config_id: attachment.config_id,
        instance_uid: attachment.instance_uid,
        timestamp: Date.now(),
        reason: "websocket_close",
      },
    ]);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    // Treat as disconnect
    ws.close(1011, "Internal error");
  }

  private async handleSetDesiredConfig(request: Request): Promise<Response> {
    const body = await request.json<{ config_hash: string }>();
    if (!body.config_hash) {
      return Response.json({ error: "config_hash required" }, { status: 400 });
    }

    this.desiredConfigHash = body.config_hash;
    await this.ctx.storage.put("desired_config_hash", body.config_hash);

    // Push to all connected agents
    const sockets = this.ctx.getWebSockets();
    const desiredHashBytes = hexToUint8Array(body.config_hash);
    let pushed = 0;

    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as WSAttachment | null;
      if (!attachment) continue;

      const response = encodeServerToAgent({
        instance_uid: new Uint8Array(16), // Will be ignored for broadcast
        flags: 0,
        capabilities: 0x00000003, // AcceptsStatus | OffersRemoteConfig
        remote_config: {
          config: { config_map: {} },
          config_hash: desiredHashBytes,
        },
      });

      try {
        ws.send(response);
        pushed++;
      } catch {
        // Socket may have closed
      }
    }

    return Response.json({ pushed, config_hash: body.config_hash });
  }

  private handleGetStats(): Response {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) as connected,
          SUM(CASE WHEN healthy = 1 THEN 1 ELSE 0 END) as healthy
        FROM agents`,
      )
      .one();

    return Response.json({
      total_agents: row.total ?? 0,
      connected_agents: row.connected ?? 0,
      healthy_agents: row.healthy ?? 0,
      desired_config_hash: this.desiredConfigHash,
      active_websockets: this.ctx.getWebSockets().length,
    });
  }

  private handleGetAgents(): Response {
    const rows = this.ctx.storage.sql
      .exec(`SELECT * FROM agents ORDER BY last_seen_at DESC LIMIT 1000`)
      .toArray();

    return Response.json({ agents: rows });
  }

  private loadAgentState(attachment: WSAttachment): AgentState {
    const row = this.ctx.storage.sql
      .exec(`SELECT * FROM agents WHERE instance_uid = ?`, attachment.instance_uid)
      .toArray()[0];

    if (row) {
      return {
        instance_uid: hexToUint8Array(row.instance_uid as string),
        tenant_id: row.tenant_id as string,
        config_id: row.config_id as string,
        sequence_num: row.sequence_num as number,
        generation: row.generation as number,
        healthy: (row.healthy as number) === 1,
        status: row.status as string,
        last_error: row.last_error as string,
        current_config_hash: row.current_config_hash
          ? hexToUint8Array(row.current_config_hash as string)
          : null,
        desired_config_hash: this.desiredConfigHash
          ? hexToUint8Array(this.desiredConfigHash)
          : null,
        last_seen_at: row.last_seen_at as number,
        connected_at: row.connected_at as number,
        agent_description: row.agent_description as string | null,
      };
    }

    // New agent
    return {
      instance_uid: hexToUint8Array(attachment.instance_uid),
      tenant_id: attachment.tenant_id,
      config_id: attachment.config_id,
      sequence_num: 0,
      generation: 1,
      healthy: true,
      status: "unknown",
      last_error: "",
      current_config_hash: null,
      desired_config_hash: this.desiredConfigHash
        ? hexToUint8Array(this.desiredConfigHash)
        : null,
      last_seen_at: 0,
      connected_at: 0,
      agent_description: null,
    };
  }

  private saveAgentState(state: AgentState): void {
    const uid = uint8ToHex(state.instance_uid);
    const configHash = state.current_config_hash ? uint8ToHex(state.current_config_hash) : null;

    this.ctx.storage.sql.exec(
      `INSERT INTO agents (instance_uid, tenant_id, config_id, sequence_num, generation, healthy, status, last_error, current_config_hash, last_seen_at, connected_at, agent_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instance_uid) DO UPDATE SET
         sequence_num = excluded.sequence_num,
         generation = excluded.generation,
         healthy = excluded.healthy,
         status = excluded.status,
         last_error = excluded.last_error,
         current_config_hash = excluded.current_config_hash,
         last_seen_at = excluded.last_seen_at,
         connected_at = CASE WHEN excluded.connected_at > 0 THEN excluded.connected_at ELSE agents.connected_at END,
         agent_description = COALESCE(excluded.agent_description, agents.agent_description)`,
      uid,
      state.tenant_id,
      state.config_id,
      state.sequence_num,
      state.generation,
      state.healthy ? 1 : 0,
      state.status,
      state.last_error,
      configHash,
      state.last_seen_at,
      state.connected_at,
      state.agent_description,
    );
  }

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

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function uint8ToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
