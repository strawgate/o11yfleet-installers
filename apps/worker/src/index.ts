// FleetPlane Worker — main entry point

export { ConfigDurableObject } from "./durable-objects/config-do.js";
import { handleApiRequest } from "./routes/api/index.js";
import { handleQueueBatch } from "./event-consumer.js";
import type { AnyFleetEvent } from "@o11yfleet/core/events";

export interface Env {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_EVENTS: Queue;
  CONFIG_DO: DurableObjectNamespace;
  FP_ANALYTICS: AnalyticsEngineDataset;
  CLAIM_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    // API routes
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, url);
    }

    // OpAMP WebSocket endpoint — Phase 3A (ingress router)
    if (url.pathname === "/v1/opamp") {
      return handleOpampRequest(request, env);
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(batch: MessageBatch<AnyFleetEvent>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env as unknown as { FP_DB: D1Database; FP_ANALYTICS: AnalyticsEngineDataset });
  },
};

async function handleOpampRequest(_request: Request, _env: Env): Promise<Response> {
  // Stub — Phase 3A will implement full ingress routing
  return new Response("Not implemented", { status: 501 });
}
