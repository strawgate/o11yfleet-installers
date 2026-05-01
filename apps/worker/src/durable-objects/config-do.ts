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
import { signClaim } from "@o11yfleet/core/auth";
import type { AssignmentClaim } from "@o11yfleet/core/auth";
import { hexToUint8Array, uint8ToHex } from "@o11yfleet/core/hex";
import { adminDoQueryRequestSchema, setDesiredConfigRequestSchema } from "@o11yfleet/core/api";
import {
  computeConfigMetrics,
  configMetricsToDoubles,
  FLEET_CONFIG_SNAPSHOT_INTERVAL,
} from "@o11yfleet/core/metrics";
import {
  startWsMessageSpan,
  startWsLifecycleSpan,
  recordSpanError,
  SpanStatusCode,
} from "../tracing.js";
import { logTransitionEvents } from "../observability-events.js";
import {
  initSchema,
  loadAgentState,
  saveAgentState,
  getAgentCount,
  agentExists,
  markDisconnected,
  getStats,
  getCohortBreakdown,
  listAgentsPage,
  loadDesiredConfig,
  saveDesiredConfig,
  checkRateLimit,
  sweepStaleAgents,
  recordSweep,
  getSweepStats,
  loadDoIdentity,
  saveDoIdentity,
  loadAgentsForMetrics,
} from "./agent-state-repo.js";

export interface ConfigDOEnv {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_ANALYTICS?: AnalyticsEngineDataset;
  O11YFLEET_CLAIM_HMAC_SECRET: string;
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
// Total serialized response bytes for the admin debug query. Caps memory
// pressure on the DO when an individual row materializes a large value
// (e.g. effective_config_body, blob columns) — `LIMIT 500` only counts
// rows, not bytes.
const MAX_DEBUG_RESPONSE_BYTES = 1_048_576; // 1 MiB
const MAX_MESSAGES_PER_MINUTE = 60;
const MAX_AGENTS_PER_CONFIG = 50_000;

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

// Stale agent detection: agents not seen for this long are marked disconnected.
// With zero-wake model, this only applies to agents whose SQLite last_seen_at
// is old AND no longer have an active WebSocket. The primary disconnect signal
// is webSocketClose() (instant). This is the fallback for silent deaths only.
const STALE_AGENT_THRESHOLD_MS = 3_600_000 * 3; // 3 hours (3× heartbeat interval)

// Alarm tick interval for config metrics. The alarm is scheduled only after
// state-changing activity, then emits one aggregate snapshot and stops.
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

  /**
   * Get desired config from SQLite (~µs). The returned shape includes the
   * pre-encoded `bytes`, so callers don't need to run `TextEncoder.encode`
   * per WS message — that work happens exactly once on `set-desired-config`.
   *
   * For older rows written before the encoded-bytes column existed, fall
   * back to encoding on read; the next `set-desired-config` upgrades the
   * row.
   */
  private getDesiredConfig(): {
    hash: string | null;
    content: string | null;
    bytes: Uint8Array | null;
  } {
    const config = loadDesiredConfig(this.ctx.storage.sql);
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
      return this.handleGetAgents(request);
    }
    const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
    if (agentMatch && request.method === "GET") {
      return this.handleGetAgent(agentMatch[1]!);
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
    // The outer LIMIT only caps returned rows. Without these keyword
    // bans, an admin could materialize the full agents table before the
    // limit applies (JOIN/UNION/WITH) or reorder it in memory (ORDER BY
    // / GROUP BY / HAVING). Reject those keywords so the debug viewer
    // stays a debug viewer and not a wholesale scan tool. Operators
    // who need aggregation should run it offline against an Analytics
    // Engine export.
    if (/\b(join|union|with|group\s+by|order\s+by|having|recursive)\b/i.test(sql)) {
      throw new Error(
        "Debug queries cannot use JOIN, UNION, WITH, GROUP BY, ORDER BY, HAVING, or RECURSIVE",
      );
    }
    // Reject SQLite functions that can materialize huge values per row
    // regardless of LIMIT (e.g. `SELECT zeroblob(1<<27)` or
    // `SELECT printf('%.*c', 50000000, 'a')`).
    if (/\b(zeroblob|randomblob|printf|char|replicate)\s*\(/i.test(sql)) {
      throw new Error(
        "Debug queries cannot use blob/string-amplification functions (zeroblob, randomblob, printf, char, replicate)",
      );
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

    const parsed = adminDoQueryRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sql, params = [] } = parsed.data;

    try {
      const cursor = this.ctx.storage.sql.exec(
        this.readonlyDebugQuery(sql),
        ...params.map((param) => this.normalizeDebugParam(param)),
        MAX_DEBUG_QUERY_ROWS,
      );
      // Stream rows out of the cursor and stop accumulating once we
      // would exceed the response byte budget. The estimate is the
      // length of `JSON.stringify(row)`; it's cheap and good enough.
      const rows: Array<Record<string, unknown>> = [];
      let bytes = 2; // `[]`
      let truncated = false;
      for (const row of cursor) {
        const rowBytes = JSON.stringify(row).length + 1; // + comma
        if (bytes + rowBytes > MAX_DEBUG_RESPONSE_BYTES) {
          truncated = true;
          break;
        }
        bytes += rowBytes;
        rows.push(row as Record<string, unknown>);
      }
      return Response.json({
        rows,
        row_count: rows.length,
        truncated,
        response_bytes_estimate: bytes,
      });
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

    // Enforce per-tenant plan limit if the worker resolved one.
    // Falls back to the global MAX_AGENTS_PER_CONFIG when the header is
    // missing/invalid — the worker never sets a value larger than the
    // global cap, so taking the min keeps both bounds.
    const tenantLimit = parseTenantAgentLimit(request.headers.get("x-fp-max-agents-per-config"));
    const limit =
      tenantLimit !== null ? Math.min(tenantLimit, MAX_AGENTS_PER_CONFIG) : MAX_AGENTS_PER_CONFIG;
    const count = getAgentCount(this.ctx.storage.sql);
    if (count >= limit && !agentExists(this.ctx.storage.sql, instanceUid)) {
      return Response.json(
        { error: "Agent limit reached for this configuration" },
        { status: 429 },
      );
    }
    saveDoIdentity(this.ctx.storage.sql, tenantId, configId);

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
          const assignmentToken = await signClaim(claim, this.env.O11YFLEET_CLAIM_HMAC_SECRET);

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

    // Load config from SQLite (~µs). Single read; the encoded bytes ride
    // along on the same row, so the WS hot path doesn't run
    // `TextEncoder.encode()` per heartbeat.
    const config = this.getDesiredConfig();
    const configBytes = config.bytes;

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

      if (result.events.length > 0) {
        span.setAttribute("opamp.events_emitted", result.events.length);
        logTransitionEvents(result.events);
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
        // The runtime may deliver `close` followed by `error` for the same
        // socket. Inspect state before scheduling metrics so duplicate close
        // signals do not create extra work.
        const config = this.getDesiredConfig();
        const state = loadAgentState(
          this.ctx.storage.sql,
          attachment.instance_uid,
          attachment.tenant_id,
          attachment.config_id,
          config.hash,
        );
        markDisconnected(this.ctx.storage.sql, attachment.instance_uid);
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
  //
  // Fires after state-changing activity and emits one aggregate snapshot.
  // Stale sweeps are triggered externally via cron → /command/sweep.

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

    const identity = loadDoIdentity(this.ctx.storage.sql);
    if (!identity.tenant_id || !identity.config_id) return;

    const agents = loadAgentsForMetrics(this.ctx.storage.sql);
    const config = this.getDesiredConfig();
    const metrics = computeConfigMetrics(agents, config.hash);
    metrics.websocket_count = this.ctx.getWebSockets().length;

    this.env.FP_ANALYTICS.writeDataPoint({
      indexes: [identity.tenant_id],
      blobs: [identity.tenant_id, identity.config_id, FLEET_CONFIG_SNAPSHOT_INTERVAL],
      doubles: configMetricsToDoubles(metrics),
    });
  }

  // ─── Internal Commands ────────────────────────────────────────────

  private async handleSetDesiredConfig(request: Request): Promise<Response> {
    saveDoIdentity(
      this.ctx.storage.sql,
      request.headers.get("x-fp-tenant-id") ?? "",
      request.headers.get("x-fp-config-id") ?? "",
    );

    const parsed = setDesiredConfigRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const body = parsed.data;

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

    await this.ensureAlarm();
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
    const cohort = getCohortBreakdown(this.ctx.storage.sql, config.hash);
    return Response.json({
      total_agents: stats.total,
      connected_agents: wsCount, // authoritative: live WebSocket count, not SQL
      healthy_agents: stats.healthy,
      drifted_agents: cohort.drifted,
      status_counts: cohort.status_counts,
      current_hash_counts: cohort.current_hash_counts,
      desired_config_hash: config.hash,
      active_websockets: wsCount,
      stale_sweep: sweepStats,
    });
  }

  private handleGetAgents(request: Request): Response {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
    const sortParam = url.searchParams.get("sort") ?? "last_seen_desc";
    const allowedSort = new Set(["last_seen_desc", "last_seen_asc", "instance_uid_asc"]);
    const sort = allowedSort.has(sortParam)
      ? (sortParam as "last_seen_desc" | "last_seen_asc" | "instance_uid_asc")
      : "last_seen_desc";
    const status = url.searchParams.get("status") ?? undefined;
    const q = url.searchParams.get("q") ?? undefined;
    const healthParam = url.searchParams.get("health") ?? undefined;
    const health =
      healthParam === "healthy" || healthParam === "unhealthy" || healthParam === "unknown"
        ? healthParam
        : undefined;
    let cursor: { last_seen_at: number; instance_uid: string } | null = null;
    const cursorRaw = url.searchParams.get("cursor");
    if (cursorRaw) {
      try {
        const parsed = JSON.parse(atob(cursorRaw)) as {
          last_seen_at?: unknown;
          instance_uid?: unknown;
        };
        if (typeof parsed.last_seen_at !== "number" || typeof parsed.instance_uid !== "string") {
          return Response.json({ error: "Invalid cursor" }, { status: 400 });
        }
        cursor = { last_seen_at: parsed.last_seen_at, instance_uid: parsed.instance_uid };
      } catch {
        return Response.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    const page = listAgentsPage(this.ctx.storage.sql, { limit, cursor, q, status, health, sort });
    const nextCursor = page.nextCursor ? btoa(JSON.stringify(page.nextCursor)) : null;
    return Response.json({
      agents: page.agents,
      pagination: { limit, next_cursor: nextCursor, has_more: page.hasMore, sort },
      filters: { q, status, health },
    });
  }

  private handleGetAgent(agentUid: string): Response {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT a.instance_uid,a.tenant_id,a.config_id,a.sequence_num,a.generation,a.healthy,a.status,a.last_error,a.current_config_hash,a.effective_config_hash,cs.body AS effective_config_body,a.last_seen_at,a.connected_at,a.agent_description,a.capabilities,a.rate_window_start,a.rate_window_count
         FROM agents a
         LEFT JOIN config_snapshots cs ON cs.hash = a.effective_config_hash
         WHERE a.instance_uid = ?
         LIMIT 1`,
        agentUid,
      )
      .toArray();
    const agent = rows[0];
    if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
    return Response.json(agent);
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
    const durationMs = Date.now() - start;
    recordSweep(this.ctx.storage.sql, {
      staleCount: staleUids.length,
      activeSocketCount: activeInstanceUids.size,
      durationMs,
    });

    const tenantId = request.headers.get("x-fp-tenant-id") ?? staleUids[0]?.tenant_id ?? "unknown";
    const configId = request.headers.get("x-fp-config-id") ?? staleUids[0]?.config_id ?? "unknown";
    saveDoIdentity(this.ctx.storage.sql, tenantId, configId);

    try {
      this.env.FP_ANALYTICS?.writeDataPoint({
        blobs: ["stale_sweep", tenantId, configId],
        doubles: [Date.now(), staleUids.length, activeInstanceUids.size, durationMs],
        indexes: [tenantId],
      });
    } catch {
      // Analytics write failure should never block stale reconciliation.
    }
    try {
      this.emitMetrics();
    } catch {
      // Metrics writes are best-effort and should not block stale reconciliation.
    }

    return Response.json({
      swept: staleUids.length,
      active_websockets: activeInstanceUids.size,
      duration_ms: durationMs,
    });
  }
}
