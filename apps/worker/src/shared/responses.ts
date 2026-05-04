import type { z } from "zod";

/** Subset of `Env` that this module reads. Defined locally so `responses.ts`
 *  doesn't need to depend on the full worker `Env` type. */
interface RuntimeValidationEnv {
  /** Set to `"true"` (in `wrangler.jsonc` `vars` or via `wrangler dev --var`)
   *  to make `typedJsonResponse` parse outgoing payloads against their schema
   *  and log mismatches. Off by default — production runs the compile-time
   *  check only. */
  O11YFLEET_RUNTIME_VALIDATION?: string;
}

/**
 * Create a JSON response validated against a Zod schema.
 *
 * The schema parameter enforces compile-time type safety: TypeScript verifies
 * that `data` satisfies `z.output<T>` (the validated/transformed shape).
 *
 * When `env.O11YFLEET_RUNTIME_VALIDATION === "true"`, the schema is also
 * applied at runtime via `safeParse`. Mismatches are logged via
 * `console.warn` (not thrown — a worker that's already serving the response
 * shouldn't 500 over a contract drift; the goal is observability for
 * dev/staging). When the flag is unset, this is a zero-overhead pass-through.
 *
 * The `env` argument is optional so legacy call sites that don't have
 * `env` in scope (e.g., DO query handlers that take `SqlStorage` only)
 * keep working without modification.
 */
export function typedJsonResponse<T extends z.ZodType>(
  schema: T,
  data: z.output<T>,
  envOrInit?: RuntimeValidationEnv | ResponseInit,
  init?: ResponseInit,
): Response {
  // The third argument is overloaded: either the worker `env` (so we can
  // read the runtime-validation flag) or a plain `ResponseInit`. Distinguish
  // by checking whether it looks like ResponseInit (has status/headers/etc).
  // We can't use `"O11YFLEET_RUNTIME_VALIDATION" in envOrInit` because
  // optional env properties don't exist on Cloudflare's Proxy-wrapped env.
  let env: RuntimeValidationEnv | undefined;
  let resolvedInit: ResponseInit | undefined;
  if (
    envOrInit &&
    typeof envOrInit === "object" &&
    !("status" in envOrInit) &&
    !("headers" in envOrInit) &&
    !("statusText" in envOrInit)
  ) {
    // Looks like env, not ResponseInit
    env = envOrInit as RuntimeValidationEnv;
    resolvedInit = init;
  } else {
    resolvedInit = envOrInit as ResponseInit | undefined;
  }

  if (env?.O11YFLEET_RUNTIME_VALIDATION === "true") {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.warn(
        "[typed-response] outgoing payload failed schema validation:",
        result.error.flatten(),
      );
    }
  }

  return Response.json(data, resolvedInit);
}
