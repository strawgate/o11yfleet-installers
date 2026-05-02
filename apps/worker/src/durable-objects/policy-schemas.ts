// Zod schemas for the DO's lifecycle endpoints (`/init`, `/sync-policy`).
//
// Bodies are intentionally permissive about *missing* fields (so callers
// can update one knob at a time) and strict about *invalid* values
// (negative caps, non-integers, strings posing as numbers all fail).
//
// Unknown keys are silently dropped by Zod's default behavior. This is
// what we want: a caller that mistakenly includes `tenant_id` in the
// body shouldn't get a 400, but those keys must not influence DO state.
// (This is the property that lets us delete the worker→DO identity-
// header trust boundary in later phases.)

import { z } from "zod";

/**
 * `max_agents_per_config` semantics:
 *   undefined → field absent in body, don't touch the cached value
 *   null      → caller wants to clear the cached value
 *   N (int>0) → cap to N
 */
const maxAgentsPerConfigSchema = z.number().int().positive().nullable().optional();

export const initBodySchema = z
  .object({
    max_agents_per_config: maxAgentsPerConfigSchema,
  })
  .strip();

export const syncPolicyBodySchema = z
  .object({
    max_agents_per_config: maxAgentsPerConfigSchema,
  })
  .strip();

export type InitBody = z.output<typeof initBodySchema>;
export type SyncPolicyBody = z.output<typeof syncPolicyBodySchema>;

/** A `Result<T, E>` for body parsing — pure, no exceptions. */
export type ParseBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { field: string; reason: string } };

/**
 * Parse + validate a JSON body against a Zod schema. Pure function:
 * takes the raw text, returns a tagged Result. The DO route handler
 * translates a non-ok result into a 400 response. Tested independently
 * of any DO setup.
 */
export function parseAndValidateBody<S extends z.ZodTypeAny>(
  text: string,
  schema: S,
): ParseBodyResult<z.output<S>> {
  // Empty body is treated as `{}` so a caller can POST without a body
  // (e.g., `/init` with no policy fields).
  let parsed: unknown;
  if (text.length === 0) {
    parsed = {};
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: { field: "body", reason: "invalid_json" } };
    }
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    // Zod always populates `issues` on failure; the type-system guarantee
    // (z.SafeParseError.error.issues is non-empty) carries the correctness
    // here — no defensive `if (!issue)` branch needed.
    const issue = result.error.issues[0]!;
    const field = issue.path.length > 0 ? issue.path.join(".") : "body";
    return { ok: false, error: { field, reason: issue.code } };
  }
  return { ok: true, value: result.data };
}
