import { DurableObject } from "cloudflare:workers";

export interface ConfigDOEnv {
  FP_DB: D1Database;
  FP_CONFIGS: R2Bucket;
  FP_EVENTS: Queue;
  FP_ANALYTICS: AnalyticsEngineDataset;
}

// Config Durable Object — Phase 2B
// Central stateful actor for OpAMP agent management
export class ConfigDurableObject extends DurableObject<ConfigDOEnv> {
  constructor(ctx: DurableObjectState, env: ConfigDOEnv) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade for OpAMP connections
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // HTTP commands
    if (url.pathname === "/command/set-desired-config" && request.method === "POST") {
      return new Response("Not implemented", { status: 501 });
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      return Response.json({ agents: 0 });
    }

    if (url.pathname === "/agents" && request.method === "GET") {
      return Response.json({ agents: [] });
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleWebSocket(_request: Request): Promise<Response> {
    // Phase 2B — WebSocket hibernation implementation
    return new Response("Not implemented", { status: 501 });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // Phase 2B
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string): Promise<void> {
    // Phase 2B
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // Phase 2B
  }
}
