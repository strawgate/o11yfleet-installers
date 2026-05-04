/**
 * OTLP ingest endpoints.
 *
 * Phase 1: Debug endpoint that accepts OTLP POSTs and logs them.
 * Phase 2 (full JWT verification + DO forwarding) was removed in the
 * dead-code sweep — it had no callers wired into the worker entrypoint.
 */

import type { Env } from "../index.js";

/**
 * Phase 1: Debug OTLP metrics endpoint.
 * Logs request metadata and returns 202.
 */
export async function handleOtlpMetricsDebug(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url);
  const bodySize = request.headers.get("content-length") ?? "unknown";

  console.warn(`[otlp-debug] POST ${url.pathname} len=${bodySize}`);

  // TODO(phase-2): Verify JWT token, extract tenant_id/collector_id,
  // forward to Config DO instead of just logging.

  return new Response(null, { status: 202 });
}
