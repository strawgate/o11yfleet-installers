/**
 * OTLP ingest endpoints.
 *
 * Phase 1: Debug endpoint that accepts OTLP POSTs and logs them.
 * Phase 2: Full JWT verification and forwarding to Config DO.
 */

import type { Env } from "../index.js";
import { verifyTelemetryToken } from "../auth/telemetry-tokens.js";

/**
 * Phase 1: Debug OTLP metrics endpoint.
 * Logs request metadata and returns 202.
 * Replace with full auth + DO forwarding in Phase 2.
 */
export async function handleOtlpMetricsDebug(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url);
  const bodySize = request.headers.get("content-length") ?? "unknown";

  console.warn(`[otlp-debug] POST ${url.pathname} len=${bodySize}`);

  // TODO(phase-2): Verify JWT token, extract tenant_id/collector_id,
  // forward to Config DO instead of just logging.

  return new Response(null, { status: 202 });
}

/**
 * Phase 2: Production OTLP metrics endpoint with JWT auth.
 */
export async function handleOtlpMetrics(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return new Response("unauthorized", { status: 401 });
  }

  const claims = await verifyTelemetryToken(token, env.O11YFLEET_CLAIM_HMAC_SECRET);
  if (!claims) {
    return new Response("unauthorized", { status: 401 });
  }

  // tenant_id comes from the VERIFIED claim, never the body.
  const { tenant_id, config_id, collector_id } = claims;
  const body = await request.arrayBuffer();

  // TODO(phase-3): Forward to tenant's Config DO for normalization + storage.

  console.warn(
    `[otlp-ingest] tenant=${tenant_id} config=${config_id} collector=${collector_id} len=${body.byteLength}`,
  );

  return new Response(null, { status: 202 });
}
