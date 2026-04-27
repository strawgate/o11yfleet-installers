// Instrumented entry point for production deployment
// Wraps the base handler and DO with @microlabs/otel-cf-workers auto-tracing.
// The base index.ts is used directly for tests (workerd pool doesn't support Node APIs).

import { instrument, instrumentDO, ResolveConfigFn } from "@microlabs/otel-cf-workers";
import handler from "./index.js";
import { ConfigDurableObject } from "./durable-objects/config-do.js";
import type { Env } from "./index.js";

const resolveConfig: ResolveConfigFn = (env: Env, _trigger) => {
  const exporterUrl = (env as unknown as Record<string, string>).OTEL_EXPORTER_URL;

  return {
    exporter: exporterUrl
      ? { url: exporterUrl, headers: {} }
      : undefined,
    service: {
      name: "o11yfleet-worker",
      version: "0.0.1",
      namespace: "o11yfleet",
    },
    handlers: {
      fetch: { acceptTraceContext: true },
    },
  };
};

// Auto-instrumented handler: fetch, queue, D1, R2, DO bindings
export default instrument(handler, resolveConfig);

// Auto-instrumented DO: traces fetch() calls to the DO
const InstrumentedConfigDO = instrumentDO(ConfigDurableObject, resolveConfig);
export { InstrumentedConfigDO as ConfigDurableObject };
