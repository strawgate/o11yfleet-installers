import {
  encodeServerToAgent,
  prepareBroadcastMessage,
  CommandType,
  AgentCapabilities,
} from "@o11yfleet/core/codec";
import type { CodecFormat, ServerToAgent } from "@o11yfleet/core/codec";
import { hexToUint8Array } from "@o11yfleet/core/hex";
import { setDesiredConfigRequestSchema } from "@o11yfleet/core/api";
import type { AgentStateRepository } from "./agent-state-repo-interface.js";
import { parseAttachment, type WSAttachment } from "./ws-attachment.js";
import { STALE_AGENT_THRESHOLD_MS, SERVER_CAPABILITIES } from "./constants.js";

export interface CommandContext {
  repo: AgentStateRepository;
  getWebSockets: () => WebSocket[];
  ensureAlarm: () => Promise<void>;
  analytics?: AnalyticsEngineDataset;
}

/**
 * Build the config_map with actual YAML content if available.
 */
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

/** Resolve the codec for a socket, or undefined if not yet negotiated. */
function resolveSocketCodec(attachment: WSAttachment): CodecFormat | undefined {
  return attachment.codec_format ?? (attachment.is_enrollment ? undefined : "json");
}

export async function handleSetDesiredConfig(
  ctx: CommandContext,
  request: Request,
): Promise<Response> {
  const headerTenantId = request.headers.get("x-fp-tenant-id");
  const headerConfigId = request.headers.get("x-fp-config-id");
  if (headerTenantId && headerConfigId) {
    ctx.repo.saveDoIdentity(headerTenantId, headerConfigId);
  }

  const parsed = setDesiredConfigRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed.data;

  // Persist to SQLite (sync, ~µs)
  ctx.repo.saveDesiredConfig(body.config_hash, body.config_content ?? null);

  const sockets = ctx.getWebSockets();
  const desiredHashBytes = hexToUint8Array(body.config_hash);
  let pushed = 0;

  // Build config_map with YAML content if available
  const configMap = buildConfigMap(body.config_content ?? null);

  // Pre-build the broadcast template (everything except instance_uid)
  const broadcastTemplate: Omit<ServerToAgent, "instance_uid"> = {
    flags: 0,
    capabilities: SERVER_CAPABILITIES,
    remote_config: {
      config: { config_map: configMap },
      config_hash: desiredHashBytes,
    },
  };

  // Pre-encode once per codec format for O(1) per-socket send cost
  const protoBroadcast = prepareBroadcastMessage(broadcastTemplate, "protobuf");
  const jsonBroadcast = prepareBroadcastMessage(broadcastTemplate, "json");

  for (const ws of sockets) {
    const attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) continue;

    // Skip agents that don't accept remote config
    if (
      attachment.capabilities !== undefined &&
      !(attachment.capabilities & AgentCapabilities.AcceptsRemoteConfig)
    ) {
      continue;
    }

    try {
      const socketCodec = resolveSocketCodec(attachment);
      if (!socketCodec) continue;
      const uid = hexToUint8Array(attachment.instance_uid);
      const encoded = socketCodec === "protobuf" ? protoBroadcast(uid) : jsonBroadcast(uid);
      ws.send(encoded);
      pushed++;
    } catch {
      // Socket may have closed
    }
  }

  await ctx.ensureAlarm();
  return Response.json({ pushed, config_hash: body.config_hash });
}

export function handleDisconnectAll(ctx: CommandContext): Response {
  const sockets = ctx.getWebSockets();
  let closed = 0;
  for (const ws of sockets) {
    try {
      ws.close(4001, "Server-initiated disconnect");
      closed++;
    } catch {
      /* already closed */
    }
  }
  return Response.json({ disconnected: closed });
}

export function handleRestartCommand(ctx: CommandContext): Response {
  const sockets = ctx.getWebSockets();
  let sent = 0;
  let skippedNoCodec = 0;
  let skippedNoCap = 0;
  for (const ws of sockets) {
    try {
      const attachment = parseAttachment(ws.deserializeAttachment());
      if (!attachment) continue;
      // Skip agents that didn't advertise AcceptsRestartCommand capability.
      if (
        attachment.capabilities !== undefined &&
        !(attachment.capabilities & AgentCapabilities.AcceptsRestartCommand)
      ) {
        skippedNoCap++;
        continue;
      }
      // Skip sockets that haven't negotiated a codec yet — sending a
      // JSON frame to a protobuf client would corrupt the connection.
      const codec = resolveSocketCodec(attachment);
      if (!codec) {
        skippedNoCodec++;
        continue;
      }
      const msg: ServerToAgent = {
        instance_uid: hexToUint8Array(attachment.instance_uid),
        flags: 0,
        capabilities: SERVER_CAPABILITIES,
        command: { type: CommandType.Restart },
      };
      ws.send(encodeServerToAgent(msg, codec));
      sent++;
    } catch {
      /* skip broken sockets */
    }
  }
  return Response.json({
    restarted: sent,
    skipped_no_codec: skippedNoCodec,
    skipped_no_cap: skippedNoCap,
  });
}

export async function handleSweep(
  ctx: CommandContext,
  request: Request,
  getActiveInstanceUids: () => Set<string>,
  emitMetrics: () => void,
): Promise<Response> {
  const start = Date.now();
  const activeInstanceUids = getActiveInstanceUids();
  const staleUids = ctx.repo.sweepStaleAgents(STALE_AGENT_THRESHOLD_MS, activeInstanceUids);
  const durationMs = Date.now() - start;
  ctx.repo.recordSweep({
    staleCount: staleUids.length,
    activeSocketCount: activeInstanceUids.size,
    durationMs,
  });

  const headerTenantId = request.headers.get("x-fp-tenant-id");
  const headerConfigId = request.headers.get("x-fp-config-id");
  // Prefer authoritative identity from worker route headers; fall back to
  // DO-local state only when headers are absent (best-effort for analytics).
  const tenantId = headerTenantId || staleUids[0]?.tenant_id || "unknown";
  const configId = headerConfigId || staleUids[0]?.config_id || "unknown";
  if (headerTenantId && headerConfigId) {
    ctx.repo.saveDoIdentity(tenantId, configId);
  }

  try {
    ctx.analytics?.writeDataPoint({
      blobs: ["stale_sweep", tenantId, configId],
      doubles: [Date.now(), staleUids.length, activeInstanceUids.size, durationMs],
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
    active_websockets: activeInstanceUids.size,
    duration_ms: durationMs,
  });
}
