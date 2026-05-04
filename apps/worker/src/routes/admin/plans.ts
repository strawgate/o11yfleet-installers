// Plan management endpoints

import { Hono } from "hono";
import type { Env } from "../../index.js";
import type { AdminEnv } from "./shared.js";
import { PLAN_DEFINITIONS, normalizePlan } from "../../shared/plans.js";
import { getDb } from "../../db/client.js";

// ─── Handlers ───────────────────────────────────────────────────────

async function handleListPlans(env: Env): Promise<Response> {
  const planDefs = Object.values(PLAN_DEFINITIONS);

  const counts = await getDb(env.FP_DB)
    .selectFrom("tenants")
    .select(["plan", (eb) => eb.fn.countAll<number>().as("count")])
    .groupBy("plan")
    .execute();

  const countMap: Record<string, number> = {};
  for (const row of counts) {
    const plan = normalizePlan(row.plan) ?? row.plan;
    countMap[plan] = (countMap[plan] ?? 0) + row.count;
  }

  const plans = planDefs.map((p) => ({
    ...p,
    tenant_count: countMap[p.id] ?? 0,
  }));

  return Response.json({ plans });
}

// ─── Sub-router ─────────────────────────────────────────────────────

export const plansRoutes = new Hono<AdminEnv>();

plansRoutes.get("/plans", async (c) => {
  return handleListPlans(c.env);
});
