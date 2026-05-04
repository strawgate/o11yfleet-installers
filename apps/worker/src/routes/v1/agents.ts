// Agent list/detail, disconnect, restart, rollout, and admin command routes

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { V1Env } from "./shared.js";
import { withAudit, getOwnedConfig, getDoName, requireAdminRole } from "./shared.js";
import { jsonError } from "../../shared/errors.js";
import { parseRpcError } from "../../durable-objects/rpc-types.js";
import type { ConfigStatsResult } from "../../durable-objects/rpc-types.js";

// ─── Handlers ───────────────────────────────────────────────────────

export async function handleListAgents(
  env: Env,
  tenantId: string,
  configId: string,
  url: URL,
): Promise<Response> {
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcListAgents({
    limit: Number(url.searchParams.get("limit") ?? 50) || 50,
    cursor: url.searchParams.get("cursor") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    health: url.searchParams.get("health") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
  });
  return Response.json(result);
}

export async function handleGetAgent(
  env: Env,
  tenantId: string,
  configId: string,
  agentUid: string,
): Promise<Response> {
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcGetAgent(agentUid);
  if (!result) return jsonError("Agent not found", 404);
  return Response.json(result);
}

export async function handleGetStats(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcGetStats();
  return Response.json(result);
}

export async function handleDisconnect(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcDisconnectAll();
  return Response.json(result);
}

export async function handleRestart(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  const result = await stub.rpcRestartAll();
  return Response.json(result);
}

export async function handleDisconnectAgentRoute(
  env: Env,
  tenantId: string,
  configId: string,
  instanceUid: string,
): Promise<Response> {
  if (!isValidInstanceUid(instanceUid)) {
    return jsonError("Invalid instance_uid", 400);
  }
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  try {
    const result = await stub.rpcDisconnectAgent(instanceUid);
    return Response.json(result);
  } catch (err) {
    const rpcErr = parseRpcError(err);
    if (rpcErr) {
      // Reconstruct the {disconnected: false, reason} body that the data
      // function attached to the RpcError. CF DO RPC strips custom Error
      // properties, so we infer it from the message (which IS the reason).
      return Response.json(
        { disconnected: false, reason: rpcErr.message },
        { status: rpcErr.statusCode },
      );
    }
    throw err;
  }
}

export async function handleRestartAgentRoute(
  env: Env,
  tenantId: string,
  configId: string,
  instanceUid: string,
): Promise<Response> {
  if (!isValidInstanceUid(instanceUid)) {
    return jsonError("Invalid instance_uid", 400);
  }
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  try {
    const result = await stub.rpcRestartAgent(instanceUid);
    return Response.json(result);
  } catch (err) {
    const rpcErr = parseRpcError(err);
    if (rpcErr) {
      // See note in handleDisconnectAgentRoute about RpcError details.
      return Response.json(
        { restarted: false, reason: rpcErr.message },
        { status: rpcErr.statusCode },
      );
    }
    throw err;
  }
}

export function isValidInstanceUid(uid: string): boolean {
  // OpAMP instance_uid is a 16-byte ULID, hex-encoded → 32 hex chars
  return /^[0-9a-f]{32}$/i.test(uid);
}

export async function handleRolloutCohortSummary(
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);
  try {
    const stats = (await stub.rpcGetStats()) as ConfigStatsResult;
    return Response.json({
      total_agents: stats.total_agents,
      connected_agents: stats.connected_agents,
      healthy_agents: stats.healthy_agents,
      drifted_agents: stats.drifted_agents ?? 0,
      desired_config_hash: stats.desired_config_hash ?? null,
      status_counts: stats.status_counts ?? {},
      current_hash_counts: stats.current_hash_counts ?? [],
    });
  } catch (error) {
    console.error("rollout cohort summary RPC call failed", error);
    return jsonError("Rollout cohort summary unavailable", 502);
  }
}

// ─── Rollout Handler ────────────────────────────────────────────────

export async function handleRollout(
  request: Request,
  env: Env,
  tenantId: string,
  configId: string,
): Promise<Response> {
  const config = await getOwnedConfig(env, tenantId, configId);
  if (!config) return jsonError("Configuration not found", 404);

  if (!config["current_config_hash"]) {
    return jsonError("No config version uploaded yet", 400);
  }

  const doId = env.CONFIG_DO.idFromName(getDoName(tenantId, configId));
  const stub = env.CONFIG_DO.get(doId);

  const r2Key = `configs/sha256/${config["current_config_hash"]}.yaml`;
  const r2Obj = await env.FP_CONFIGS.get(r2Key);
  const configContent = r2Obj ? await r2Obj.text() : null;

  // Fleet component compatibility gate — accepts override=true to force rollout.
  // Strict-boolean check on `override` prevents string truthy values like
  // "false" / "0" from accidentally bypassing the gate. When forceOverride is
  // set the DO returns 200 (instead of 409) regardless of compat.compatible,
  // so this worker only blocks the rollout on a 409 response.
  if (configContent) {
    const reqBody = await request
      .clone()
      .json()
      .catch(() => null);
    const override =
      reqBody !== null &&
      typeof reqBody === "object" &&
      (reqBody as { override?: unknown }).override === true;

    const checkCompatResp = await stub.fetch(
      new Request("http://internal/command/check-compatibility", {
        method: "POST",
        body: JSON.stringify({ yamlConfig: configContent, override }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    // The DO returns 409 with a structured payload on real incompatibility.
    // Forward that body to the caller so they can read missing_components etc.
    // Reserve 502 for true upstream failures (5xx, network errors, malformed JSON).
    if (checkCompatResp.status === 409) {
      const compat = (await checkCompatResp.json().catch(() => null)) as {
        compatible: boolean;
        missingComponents?: { kind: string; name: string }[];
        compatibleAgents?: number;
        incompatibleAgents?: number;
        unknownAgents?: number;
        totalAgents?: number;
      } | null;
      if (!compat) {
        return new Response("Fleet compatibility check returned malformed body", { status: 502 });
      }
      return Response.json(
        {
          error: "INCOMPATIBLE_FLEET",
          message: `${compat.incompatibleAgents} of ${compat.totalAgents} connected agents lack required components. See missing_components for details.`,
          missing_components: compat.missingComponents ?? [],
          compatible_agents: compat.compatibleAgents ?? 0,
          incompatible_agents: compat.incompatibleAgents ?? 0,
        },
        { status: 409 },
      );
    }
    if (!checkCompatResp.ok) {
      return new Response("Fleet compatibility check failed", { status: 502 });
    }
    // 2xx from the DO means either compat passed or override=true; rollout proceeds.
  }

  const result = await stub.rpcSetDesiredConfig({
    config_hash: config["current_config_hash"],
    config_content: configContent,
  });
  return Response.json(result);
}

// ─── Sub-router ─────────────────────────────────────────────────────

export const agentRoutes = new Hono<V1Env>();

agentRoutes.get("/configurations/:id/agents", async (c) => {
  return handleListAgents(c.env, c.get("tenantId"), c.req.param("id"), new URL(c.req.url));
});

agentRoutes.get("/configurations/:id/agents/:agentId", async (c) => {
  return handleGetAgent(c.env, c.get("tenantId"), c.req.param("id"), c.req.param("agentId"));
});

agentRoutes.get("/configurations/:id/stats", async (c) => {
  return handleGetStats(c.env, c.get("tenantId"), c.req.param("id"));
});

agentRoutes.get("/configurations/:id/rollout-cohort-summary", async (c) => {
  return handleRolloutCohortSummary(c.env, c.get("tenantId"), c.req.param("id"));
});

agentRoutes.post("/configurations/:id/rollout", async (c) => {
  const audit = c.get("audit");
  const configId = c.req.param("id");
  return withAudit(
    audit,
    { action: "rollout.start", resource_type: "rollout", resource_id: configId },
    async () => {
      const denial = requireAdminRole(audit);
      if (denial) return denial;
      return handleRollout(c.req.raw, c.env, c.get("tenantId"), configId);
    },
  );
});

agentRoutes.post("/configurations/:id/disconnect", async (c) => {
  const audit = c.get("audit");
  const configId = c.req.param("id");
  return withAudit(
    audit,
    { action: "agents.disconnect", resource_type: "configuration", resource_id: configId },
    async () => {
      const denial = requireAdminRole(audit);
      if (denial) return denial;
      return handleDisconnect(c.env, c.get("tenantId"), configId);
    },
  );
});

agentRoutes.post("/configurations/:id/restart", async (c) => {
  const audit = c.get("audit");
  const configId = c.req.param("id");
  return withAudit(
    audit,
    { action: "agents.restart", resource_type: "configuration", resource_id: configId },
    async () => {
      const denial = requireAdminRole(audit);
      if (denial) return denial;
      return handleRestart(c.env, c.get("tenantId"), configId);
    },
  );
});

agentRoutes.post("/configurations/:id/agents/:agentId/disconnect", async (c) => {
  const audit = c.get("audit");
  const configId = c.req.param("id");
  const instanceUid = c.req.param("agentId");
  return withAudit(
    audit,
    {
      action: "agent.disconnect",
      resource_type: "agent",
      resource_id: instanceUid,
      metadata: { config_id: configId },
    },
    async () => {
      const denial = requireAdminRole(audit);
      if (denial) return denial;
      return handleDisconnectAgentRoute(c.env, c.get("tenantId"), configId, instanceUid);
    },
  );
});

agentRoutes.post("/configurations/:id/agents/:agentId/restart", async (c) => {
  const audit = c.get("audit");
  const configId = c.req.param("id");
  const instanceUid = c.req.param("agentId");
  return withAudit(
    audit,
    {
      action: "agent.restart",
      resource_type: "agent",
      resource_id: instanceUid,
      metadata: { config_id: configId },
    },
    async () => {
      const denial = requireAdminRole(audit);
      if (denial) return denial;
      return handleRestartAgentRoute(c.env, c.get("tenantId"), configId, instanceUid);
    },
  );
});
