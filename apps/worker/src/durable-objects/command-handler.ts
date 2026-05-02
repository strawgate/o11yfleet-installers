import {
  encodeServerToAgent,
  prepareBroadcastMessage,
  CommandType,
  AgentCapabilities,
} from "@o11yfleet/core/codec";
import type { ServerToAgent } from "@o11yfleet/core/codec";
import { hexToUint8Array } from "@o11yfleet/core/hex";
import { setDesiredConfigRequestSchema } from "@o11yfleet/core/api";
import type { AgentStateRepository } from "./agent-state-repo-interface.js";
import { parseAttachment } from "./ws-attachment.js";
import { STALE_AGENT_THRESHOLD_MS, SERVER_CAPABILITIES } from "./constants.js";

export interface CommandContext {
  repo: AgentStateRepository;
  /** DO identity, derived from `ctx.id.name` at the call site —
   *  authoritative, no header trust. */
  identity: { tenant_id: string; config_id: string };
  getWebSockets: () => WebSocket[];
  ensureAlarm: () => Promise<void>;
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

  ctx.repo.saveDesiredConfig(body.config_hash, body.config_content ?? null);

  const sockets = ctx.getWebSockets();
  const desiredHashBytes = hexToUint8Array(body.config_hash);
  let pushed = 0;

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

  for (const ws of sockets) {
    const attachment = parseAttachment(ws.deserializeAttachment());
    if (!attachment) continue;

    if (
      attachment.capabilities !== undefined &&
      !(attachment.capabilities & AgentCapabilities.AcceptsRemoteConfig)
    ) {
      continue;
    }

    try {
      const uid = hexToUint8Array(attachment.instance_uid);
      ws.send(protoBroadcast(uid));
      pushed++;
    } catch {
      /* Socket may have closed */
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
      /* skip broken sockets */
    }
  }
  return Response.json({
    restarted: sent,
    skipped_no_cap: skippedNoCap,
  });
}

export async function handleSweep(
  ctx: CommandContext,
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

  const { tenant_id: tenantId, config_id: configId } = ctx.identity;

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
