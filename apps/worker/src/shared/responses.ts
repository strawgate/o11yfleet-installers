import type { z } from "zod";

/**
 * Create a JSON response validated against a Zod schema.
 *
 * The schema parameter enforces compile-time type safety: TypeScript verifies
 * that `data` satisfies `z.output<T>` (the validated/transformed shape).
 * At runtime, Response.json serializes the data directly — no parse overhead.
 *
 * NOTE: This is a compile-time type check only. Cloudflare Workers have no
 * `process.env`, so NODE_ENV-gated runtime validation is not straightforward.
 * TODO: Add runtime safeParse validation behind a binding-based feature flag
 * (e.g. env.RUNTIME_VALIDATION === "true") to catch contract drift in staging.
 */
export function typedJsonResponse<T extends z.ZodType>(
  _schema: T,
  data: z.output<T>,
  init?: ResponseInit,
): Response {
  return Response.json(data, init);
}
