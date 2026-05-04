import type { z } from "zod";

/** Subset of `Env` that this module reads. Defined locally so `responses.ts`
 *  doesn't need to depend on the full worker `Env` type. */
interface RuntimeValidationEnv {
  /** "production" | "staging" | "dev" — drives the default behavior of
   *  `typedJsonResponse`'s runtime check. */
  ENVIRONMENT?: "staging" | "dev" | "production";
  /** Override for the default. `"true"` forces validation on; `"false"`
   *  forces it off; unset uses the environment default (on in dev/staging,
   *  off in production). Set in `wrangler.jsonc` `vars` or via
   *  `wrangler dev --var O11YFLEET_RUNTIME_VALIDATION:false`. */
  O11YFLEET_RUNTIME_VALIDATION?: string;
}

/**
 * Decide whether `typedJsonResponse` should run the runtime safeParse for
 * a given env. Default: on for non-production, off for production. The
 * `O11YFLEET_RUNTIME_VALIDATION` binding overrides either direction.
 */
function shouldValidate(env: RuntimeValidationEnv): boolean {
  if (env.O11YFLEET_RUNTIME_VALIDATION === "true") return true;
  if (env.O11YFLEET_RUNTIME_VALIDATION === "false") return false;
  return env.ENVIRONMENT !== "production";
}

/**
 * Create a JSON response validated against a Zod schema.
 *
 * The schema parameter enforces compile-time type safety: TypeScript verifies
 * that `data` satisfies `z.output<T>` (the validated/transformed shape).
 *
 * When the worker `env` is provided and `shouldValidate(env)` returns true,
 * the schema is also applied at runtime via `safeParse`. Mismatches are
 * logged via `console.warn` — not thrown — so a worker that's already
 * serving the response doesn't 500 over a contract drift; the goal is
 * observability for dev/staging.
 *
 * The `env` argument is optional so legacy call sites that don't have
 * `env` in scope (e.g., DO query handlers that take `SqlStorage` only)
 * keep working; those paths get the compile-time check only.
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
  // We can't use `"ENVIRONMENT" in envOrInit` because optional env properties
  // don't exist on Cloudflare's Proxy-wrapped env in vitest-pool-workers.
  let env: RuntimeValidationEnv | undefined;
  let resolvedInit: ResponseInit | undefined;
  if (
    envOrInit &&
    typeof envOrInit === "object" &&
    !("status" in envOrInit) &&
    !("headers" in envOrInit) &&
    !("statusText" in envOrInit)
  ) {
    env = envOrInit as RuntimeValidationEnv;
    resolvedInit = init;
  } else {
    resolvedInit = envOrInit as ResponseInit | undefined;
  }

  if (env && shouldValidate(env)) {
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
