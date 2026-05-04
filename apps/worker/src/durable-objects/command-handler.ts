import {
  encodeServerToAgent,
  prepareBroadcastMessage,
  CommandType,
  AgentCapabilities,
} from "@o11yfleet/core/codec";
import type { ServerToAgent } from "@o11yfleet/core/codec";
import { hexToUint8Array, InvalidHexError } from "@o11yfleet/core/hex";
import { setDesiredConfigRequestSchema } from "@o11yfleet/core/api";
import type { AgentStateRepository } from "./agent-state-repo-interface.js";
import { parseAttachment } from "./ws-attachment.js";
import { STALE_AGENT_THRESHOLD_MS, SERVER_CAPABILITIES } from "./constants.js";
import type {
  SetDesiredConfigParams,
  SetDesiredConfigResult,
  SweepResult,
  DisconnectResult,
  RestartAllResult,
  DisconnectAgentResult,
  RestartAgentResult,
} from "./rpc-types.js";
import { RpcError } from "./rpc-types.js";

export interface CommandContext {
  repo: AgentStateRepository;
  /** DO identity, derived from `ctx.id.name` at the call site —
   *  authoritative, no header trust. */
  identity: { tenant_id: string; config_id: string };
  getWebSockets: () => WebSocket[];
  ensureAlarm: () => Promise<void>;
  /** Invalidate the DO-level desired config cache after a write. */
  invalidateDesiredConfigCache: () => void;
  analytics?: AnalyticsEngineDataset;
}

function buildConfigMap(
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

export async function handleSetDesiredConfig(
  ctx: CommandContext,
  request: Request,
): Promise<Response> {
  const parsed = setDesiredConfigRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed.data;

  // Decode the hex hash before any persistence work — the existing Zod schema
  // validates length/non-empty but not hex chars, so a non-hex string would
  // previously silently broadcast all-zero bytes (since hexToUint8Array used
  // to coerce invalid pairs to 0). Now hex.ts throws on bad input; surface as
  // 400 so the caller can fix their request.
  let desiredHashBytes: Uint8Array;
  try {
    desiredHashBytes = hexToUint8Array(body.config_hash);
  } catch (err) {
    if (err instanceof InvalidHexError) {
      return Response.json({ error: "config_hash must be a hex string" }, { status: 400 });
    }
    throw err;
  }

  ctx.repo.saveDesiredConfig(body.config_hash, body.config_content ?? null);
  ctx.invalidateDesiredConfigCache();

  const sockets = ctx.getWebSockets();
  let pushed = 0;
  let failed = 0;
  let skippedNoCap = 0;

  const configMap = buildConfigMap(body.config_content ?? null);

  const broadcastTemplate: Omit<ServerToAgent, "instance_uid"> = {
    flags: 0,
    capabilities: SERVER_CAPABILITIES,
    remote_config: {
      config: { config_map: configMap },
      config_hash: desiredHashBytes,
    },
  };

  const protoBroadcast = prepareBroadcastMessage(broadcastTemplate);

  let batchCount = 0;
  for (const ws of sockets) {
    const attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) continue;

    if (
      attachment.capabilities !== undefined &&
      !(attachment.capabilities & AgentCapabilities.AcceptsRemoteConfig)
    ) {
      skippedNoCap++;
      continue;
    }

    try {
      const uid = hexToUint8Array(attachment.instance_uid);
      ws.send(protoBroadcast(uid));
      pushed++;
    } catch {
      failed++;
    }
    batchCount++;
    if (batchCount % 1000 === 0) {
      // Yield to event loop periodically to allow GC and buffer flushing
      await new Promise<void>((r) => {
        setTimeout(r, 0);
      });
    }
  }

  await ctx.ensureAlarm();
  return Response.json({
    pushed,
    failed,
    skipped_no_cap: skippedNoCap,
    config_hash: body.config_hash,
  });
}

export function handleDisconnectAll(ctx: CommandContext): Response {
  const sockets = ctx.getWebSockets();
  let closed = 0;
  let failed = 0;
  for (const ws of sockets) {
    try {
      ws.close(4001, "Server-initiated disconnect");
      closed++;
    } catch {
      failed++;
    }
  }
  return Response.json({ disconnected: closed, failed });
}

function findSocketByInstanceUid(ctx: CommandContext, instanceUid: string): WebSocket | null {
  // Hex UIDs round-trip through the API in lower-case (per OpAMP convention),
  // but the route accepts case-insensitively because users sometimes paste
  // upper-case from log lines. Normalize both sides so an upper-case lookup
  // doesn't false-negative against the lower-case attachment value.
  const target = instanceUid.toLowerCase();
  for (const ws of ctx.getWebSockets()) {
    const attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) continue;
    if (attachment.instance_uid.toLowerCase() === target) return ws;
  }
  return null;
}

export function handleDisconnectAgent(ctx: CommandContext, instanceUid: string): Response {
  const ws = findSocketByInstanceUid(ctx, instanceUid);
  if (!ws) {
    return Response.json({ disconnected: false, reason: "agent_not_connected" }, { status: 404 });
  }
  try {
    ws.close(4001, "Server-initiated disconnect");
  } catch {
    /* already closed */
  }
  return Response.json({ disconnected: true });
}

export function handleRestartAgent(ctx: CommandContext, instanceUid: string): Response {
  const ws = findSocketByInstanceUid(ctx, instanceUid);
  if (!ws) {
    return Response.json({ restarted: false, reason: "agent_not_connected" }, { status: 404 });
  }
  const attachment = parseAttachment(ws.deserializeAttachment());
  if (!attachment) {
    return Response.json({ restarted: false, reason: "attachment_missing" }, { status: 500 });
  }
  if (
    attachment.capabilities !== undefined &&
    !(attachment.capabilities & AgentCapabilities.AcceptsRestartCommand)
  ) {
    return Response.json(
      { restarted: false, reason: "capability_not_advertised" },
      { status: 409 },
    );
  }
  try {
    const msg: ServerToAgent = {
      instance_uid: hexToUint8Array(attachment.instance_uid),
      flags: 0,
      capabilities: SERVER_CAPABILITIES,
      command: { type: CommandType.Restart },
    };
    ws.send(encodeServerToAgent(msg));
  } catch {
    return Response.json({ restarted: false, reason: "send_failed" }, { status: 502 });
  }
  return Response.json({ restarted: true });
}

export function handleRestartCommand(ctx: CommandContext): Response {
  const sockets = ctx.getWebSockets();
  let sent = 0;
  let failed = 0;
  let skippedNoCap = 0;
  for (const ws of sockets) {
    try {
      const attachment = parseAttachment(ws.deserializeAttachment());
      if (!attachment) continue;
      if (
        attachment.capabilities !== undefined &&
        !(attachment.capabilities & AgentCapabilities.AcceptsRestartCommand)
      ) {
        skippedNoCap++;
        continue;
      }
      const msg: ServerToAgent = {
        instance_uid: hexToUint8Array(attachment.instance_uid),
        flags: 0,
        capabilities: SERVER_CAPABILITIES,
        command: { type: CommandType.Restart },
      };
      ws.send(encodeServerToAgent(msg));
      sent++;
    } catch {
      failed++;
    }
  }
  return Response.json({
    restarted: sent,
    failed,
    skipped_no_cap: skippedNoCap,
  });
}

export async function handleSweep(
  ctx: CommandContext,
  isConnected: (uid: string) => boolean,
  emitMetrics: () => void,
): Promise<Response> {
  const start = Date.now();

  // Auto-unenroll runs BEFORE stale sweep so only agents that were already
  // disconnected (from a prior sweep) are eligible for deletion. Running it
  // after sweep would delete agents freshly flipped to disconnected in the
  // same pass — a data-loss race.
  const policy = ctx.repo.loadDoPolicy();
  const unenrolled =
    policy.auto_unenroll_after_days !== null
      ? ctx.repo.autoUnenrollStaleAgents(policy.auto_unenroll_after_days)
      : 0;

  const staleUids = ctx.repo.sweepStaleAgents(STALE_AGENT_THRESHOLD_MS, isConnected);
  const activeSocketCount = ctx.getWebSockets().length;

  const durationMs = Date.now() - start;
  ctx.repo.recordSweep({
    staleCount: staleUids.length,
    activeSocketCount,
    durationMs,
  });

  const { tenant_id: tenantId, config_id: configId } = ctx.identity;

  try {
    ctx.analytics?.writeDataPoint({
      blobs: ["stale_sweep", tenantId, configId],
      doubles: [Date.now(), staleUids.length, activeSocketCount, durationMs, unenrolled],
      indexes: [tenantId],
    });
  } catch {
    // Analytics write failure should never block stale reconciliation.
  }
  try {
    emitMetrics();
  } catch {
    // Metrics writes are best-effort and should not block stale reconciliation.
  }

  return Response.json({
    swept: staleUids.length,
    unenrolled,
    active_websockets: activeSocketCount,
    duration_ms: durationMs,
  });
}

// ─── Data-returning cores (called by RPC methods) ────────────────

export async function setDesiredConfigData(
  ctx: CommandContext,
  body: SetDesiredConfigParams,
): Promise<SetDesiredConfigResult> {
  const parsed = setDesiredConfigRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new RpcError("Invalid request body", 400);
  }

  ctx.repo.saveDesiredConfig(parsed.data.config_hash, parsed.data.config_content ?? null);
  ctx.invalidateDesiredConfigCache();

  const sockets = ctx.getWebSockets();
  const desiredHashBytes = hexToUint8Array(parsed.data.config_hash);
  let pushed = 0;
  let failed = 0;
  let skippedNoCap = 0;

  const configMap = buildConfigMap(parsed.data.config_content ?? null);

  const broadcastTemplate: Omit<ServerToAgent, "instance_uid"> = {
    flags: 0,
    capabilities: SERVER_CAPABILITIES,
    remote_config: {
      config: { config_map: configMap },
      config_hash: desiredHashBytes,
    },
  };

  const protoBroadcast = prepareBroadcastMessage(broadcastTemplate);

  let batchCount = 0;
  for (const ws of sockets) {
    const attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) continue;

    if (
      attachment.capabilities !== undefined &&
      !(attachment.capabilities & AgentCapabilities.AcceptsRemoteConfig)
    ) {
      skippedNoCap++;
      continue;
    }

    try {
      const uid = hexToUint8Array(attachment.instance_uid);
      ws.send(protoBroadcast(uid));
      pushed++;
    } catch {
      failed++;
    }
    batchCount++;
    if (batchCount % 1000 === 0) {
      await new Promise<void>((r) => {
        setTimeout(r, 0);
      });
    }
  }

  await ctx.ensureAlarm();
  return { pushed, failed, skipped_no_cap: skippedNoCap, config_hash: parsed.data.config_hash };
}

export function disconnectAllData(ctx: CommandContext): DisconnectResult {
  const sockets = ctx.getWebSockets();
  let closed = 0;
  let failed = 0;
  for (const ws of sockets) {
    try {
      ws.close(4001, "Server-initiated disconnect");
      closed++;
    } catch {
      failed++;
    }
  }
  return { disconnected: closed, failed };
}

export function disconnectAgentData(ctx: CommandContext, instanceUid: string): DisconnectAgentResult {
  const ws = findSocketByInstanceUid(ctx, instanceUid);
  if (!ws) {
    throw new RpcError("agent_not_connected", 404, { disconnected: false, reason: "agent_not_connected" });
  }
  try {
    ws.close(4001, "Server-initiated disconnect");
  } catch {
    /* already closed */
  }
  return { disconnected: true };
}

export function restartAgentData(ctx: CommandContext, instanceUid: string): RestartAgentResult {
  const ws = findSocketByInstanceUid(ctx, instanceUid);
  if (!ws) {
    throw new RpcError("agent_not_connected", 404, { restarted: false, reason: "agent_not_connected" });
  }
  const attachment = parseAttachment(ws.deserializeAttachment());
  if (!attachment) {
    throw new RpcError("attachment_missing", 500, { restarted: false, reason: "attachment_missing" });
  }
  if (
    attachment.capabilities !== undefined &&
    !(attachment.capabilities & AgentCapabilities.AcceptsRestartCommand)
  ) {
    throw new RpcError("capability_not_advertised", 409, { restarted: false, reason: "capability_not_advertised" });
  }
  try {
    const msg: ServerToAgent = {
      instance_uid: hexToUint8Array(attachment.instance_uid),
      flags: 0,
      capabilities: SERVER_CAPABILITIES,
      command: { type: CommandType.Restart },
    };
    ws.send(encodeServerToAgent(msg));
  } catch {
    throw new RpcError("send_failed", 502, { restarted: false, reason: "send_failed" });
  }
  return { restarted: true };
}

export function restartAllData(ctx: CommandContext): RestartAllResult {
  const sockets = ctx.getWebSockets();
  let sent = 0;
  let failed = 0;
  let skippedNoCap = 0;
  for (const ws of sockets) {
    try {
      const attachment = parseAttachment(ws.deserializeAttachment());
      if (!attachment) continue;
      if (
        attachment.capabilities !== undefined &&
        !(attachment.capabilities & AgentCapabilities.AcceptsRestartCommand)
      ) {
        skippedNoCap++;
        continue;
      }
      const msg: ServerToAgent = {
        instance_uid: hexToUint8Array(attachment.instance_uid),
        flags: 0,
        capabilities: SERVER_CAPABILITIES,
        command: { type: CommandType.Restart },
      };
      ws.send(encodeServerToAgent(msg));
      sent++;
    } catch {
      failed++;
    }
  }
  return { restarted: sent, failed, skipped_no_cap: skippedNoCap };
}

export async function sweepData(
  ctx: CommandContext,
  isConnected: (uid: string) => boolean,
  emitMetrics: () => void,
): Promise<SweepResult> {
  const start = Date.now();

  const policy = ctx.repo.loadDoPolicy();
  const unenrolled =
    policy.auto_unenroll_after_days !== null
      ? ctx.repo.autoUnenrollStaleAgents(policy.auto_unenroll_after_days)
      : 0;

  const staleUids = ctx.repo.sweepStaleAgents(STALE_AGENT_THRESHOLD_MS, isConnected);
  const activeSocketCount = ctx.getWebSockets().length;

  const durationMs = Date.now() - start;
  ctx.repo.recordSweep({
    staleCount: staleUids.length,
    activeSocketCount,
    durationMs,
  });

  const { tenant_id: tenantId, config_id: configId } = ctx.identity;

  try {
    ctx.analytics?.writeDataPoint({
      blobs: ["stale_sweep", tenantId, configId],
      doubles: [Date.now(), staleUids.length, activeSocketCount, durationMs, unenrolled],
      indexes: [tenantId],
    });
  } catch {
    // Analytics write failure should never block stale reconciliation.
  }
  try {
    emitMetrics();
  } catch {
    // Metrics writes are best-effort and should not block stale reconciliation.
  }

  return { swept: staleUids.length, unenrolled, active_websockets: activeSocketCount, duration_ms: durationMs };
}
