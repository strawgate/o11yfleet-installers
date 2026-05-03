// Instrumented entry point for production deployment
// Wraps the base handler and DO with @microlabs/otel-cf-workers auto-tracing.
// The base index.ts is used directly for tests (workerd pool doesn't support Node APIs).

import { instrument, instrumentDO } from "@microlabs/otel-cf-workers";
import handler from "./index.js";
import { ConfigDurableObject } from "./durable-objects/config-do.js";

// oxlint-disable-next-line typescript/no-explicit-any
const resolveConfig = (env: any, _trigger: any) => {
  const exporterUrl = env?.OTEL_EXPORTER_URL as string | undefined;
  const exporterToken = env?.OTEL_EXPORTER_TOKEN as string | undefined;

  const headers: Record<string, string> = {};
  if (exporterToken) {
    headers["Authorization"] = `Bearer ${exporterToken}`;
  }

  return {
    exporter: { url: exporterUrl ?? "https://localhost:4318", headers },
    service: {
      name: "o11yfleet-worker",
      version: "0.0.1",
      namespace: "o11yfleet",
    },
    handlers: {
      fetch: { acceptTraceContext: true as const },
    },
  };
};

// Auto-instrumented handler: fetch, D1, R2, DO bindings.
// Preserve non-fetch module handlers explicitly; production uses this entrypoint,
// so cron handlers must be present here too.
const instrumentedHandler = instrument(handler, resolveConfig);
export default {
  ...instrumentedHandler,
  scheduled: handler.scheduled,
};

// Auto-instrumented DO: traces fetch() calls to the DO
const InstrumentedConfigDO = instrumentDO(ConfigDurableObject, resolveConfig);
export { InstrumentedConfigDO as ConfigDurableObject };

// Workflows are not currently auto-instrumented by @microlabs/otel-cf-workers
// — re-export the class as-is so wrangler's binding lookup finds it.
export { ConfigValidationWorkflow } from "./workflows/config-validation.js";
