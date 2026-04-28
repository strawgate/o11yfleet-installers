// OpenTelemetry tracing for FleetPlane Worker
//
// Production instrumentation is applied in the separate instrumented entry point
// (src/instrumented.ts) which wraps the handler and DO with @microlabs/otel-cf-workers.
//
// This module provides manual span helpers using @opentelemetry/api.
// When no SDK is registered (e.g. in tests or when OTel is disabled),
// @opentelemetry/api returns no-op spans that are zero-cost.

import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";

const WS_TRACER = "o11yfleet.websocket";

/**
 * Create a span for WebSocket message processing.
 */
export function startWsMessageSpan(instanceUid: string, tenantId: string, configId: string): Span {
  const tracer = trace.getTracer(WS_TRACER);
  return tracer.startSpan("ws.message", {
    attributes: {
      "opamp.instance_uid": instanceUid,
      "opamp.tenant_id": tenantId,
      "opamp.config_id": configId,
    },
  });
}

/**
 * Create a span for WebSocket close/error lifecycle events.
 */
export function startWsLifecycleSpan(event: "close" | "error", instanceUid: string): Span {
  const tracer = trace.getTracer(WS_TRACER);
  return tracer.startSpan(`ws.${event}`, {
    attributes: {
      "opamp.instance_uid": instanceUid,
    },
  });
}

/**
 * Record an error on a span and set its status to ERROR.
 */
export function recordSpanError(span: Span, error: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR });
  if (error instanceof Error) {
    span.recordException(error);
  }
}

export { SpanStatusCode };
