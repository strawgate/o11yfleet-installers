// FleetPlane Worker — main entry point

export { ConfigDurableObject } from "./durable-objects/config-do.js";

export interface Env {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_EVENTS: Queue;
  CONFIG_DO: DurableObjectNamespace;
  FP_ANALYTICS: AnalyticsEngineDataset;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    // API routes — Phase 2D
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not implemented", { status: 501 });
    }

    // OpAMP WebSocket endpoint — Phase 3A
    if (url.pathname === "/v1/opamp") {
      return new Response("Not implemented", { status: 501 });
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(_batch: MessageBatch, _env: Env): Promise<void> {
    // Queue consumer — Phase 2C
  },
};
