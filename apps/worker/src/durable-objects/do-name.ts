// Pure parsing for the Config DO's `${tenant_id}:${config_id}` naming scheme.
//
// The runtime guarantees a DO can only be reached via `idFromName(name)`,
// so `ctx.id.name` is the authoritative identity for each instance. This
// module turns that string into a typed identity (or a structured error)
// without touching any DO state — letting the parsing be tested as a
// plain pure function.

export interface ConfigDoIdentity {
  tenant_id: string;
  config_id: string;
}

export type ParseConfigDoNameResult =
  | { ok: true; identity: ConfigDoIdentity }
  | { ok: false; error: ParseConfigDoNameError };

export type ParseConfigDoNameError =
  | "missing_name"
  | "missing_separator"
  | "empty_tenant_id"
  | "empty_config_id"
  | "name_too_long";

/**
 * Cap on the length of a Config DO name. The worker constructs names from
 * tenant + config UUIDs (~36 chars each), so 200 is generous. Bounding it
 * prevents an arbitrarily long string from being echoed into error logs.
 */
const MAX_NAME_LENGTH = 200;

/**
 * Parse a Config DO name into `{ tenant_id, config_id }`. The split is on
 * the *first* colon, so a config_id may itself contain colons (e.g. the
 * special `__pending__` DO is `${tenant_id}:__pending__`, and any future
 * structured config_id is preserved verbatim).
 */
export function parseConfigDoName(name: string | undefined): ParseConfigDoNameResult {
  if (name === undefined || name.length === 0) {
    return { ok: false, error: "missing_name" };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "name_too_long" };
  }
  const colonIdx = name.indexOf(":");
  if (colonIdx === -1) {
    return { ok: false, error: "missing_separator" };
  }
  if (colonIdx === 0) {
    return { ok: false, error: "empty_tenant_id" };
  }
  if (colonIdx === name.length - 1) {
    return { ok: false, error: "empty_config_id" };
  }
  return {
    ok: true,
    identity: {
      tenant_id: name.slice(0, colonIdx),
      config_id: name.slice(colonIdx + 1),
    },
  };
}

/**
 * Bound an arbitrary input string to a safe length for inclusion in error
 * messages and logs. Adversarial Config DO names should never escape
 * unbounded into log lines.
 */
export function safeForLog(s: string | undefined, maxLen = 64): string {
  if (s === undefined) return "<missing>";
  if (s.length === 0) return "<empty>";
  if (s.length > maxLen) return `${s.slice(0, maxLen)}…(${s.length} chars)`;
  return s;
}
