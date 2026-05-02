// Property-based tests for the pure modules. Each test asserts a
// universally-quantified property — fast-check generates many random
// inputs (with shrinking) until it finds a counterexample or gives up.
//
// These run in plain Node (~ms) because the targets are pure functions
// with no DO/workerd dependencies. See `vitest.node.config.ts`.

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { parseConfigDoName, safeForLog } from "../src/durable-objects/do-name.js";
import { isValidMaxAgents } from "../src/durable-objects/agent-state-repo.js";
import {
  initBodySchema,
  parseAndValidateBody,
  syncPolicyBodySchema,
} from "../src/durable-objects/policy-schemas.js";

// ─── parseConfigDoName ─────────────────────────────────────────────────

const noColonString = fc.string({ minLength: 1, maxLength: 80 }).filter((s) => !s.includes(":"));

describe("property: parseConfigDoName", () => {
  it("succeeds for any non-empty `tenant:config` where tenant has no colon", () => {
    fc.assert(
      fc.property(noColonString, fc.string({ minLength: 1, maxLength: 80 }), (tenant, config) => {
        const result = parseConfigDoName(`${tenant}:${config}`);
        if (!result.ok) return false;
        return result.identity.tenant_id === tenant && result.identity.config_id === config;
      }),
    );
  });

  it("round-trips: parse then rejoin produces the original name", () => {
    fc.assert(
      fc.property(noColonString, fc.string({ minLength: 1, maxLength: 80 }), (tenant, config) => {
        const name = `${tenant}:${config}`;
        const result = parseConfigDoName(name);
        if (!result.ok) return false;
        return `${result.identity.tenant_id}:${result.identity.config_id}` === name;
      }),
    );
  });

  it("rejects any non-empty string with no colon", () => {
    fc.assert(
      fc.property(noColonString, (s) => {
        const result = parseConfigDoName(s);
        return !result.ok && result.error === "missing_separator";
      }),
    );
  });

  it("rejects names longer than the cap", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 201, maxLength: 1000 }), (s) => {
        const result = parseConfigDoName(s);
        return !result.ok && result.error === "name_too_long";
      }),
    );
  });

  it("rejects names with empty tenant_id (leading colon)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (rest) => {
        const result = parseConfigDoName(`:${rest}`);
        return !result.ok && result.error === "empty_tenant_id";
      }),
    );
  });

  it("rejects names with empty config_id (trailing colon)", () => {
    fc.assert(
      fc.property(noColonString, (tenant) => {
        const result = parseConfigDoName(`${tenant}:`);
        return !result.ok && result.error === "empty_config_id";
      }),
    );
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(undefined)), (input) => {
        // Must not throw for any input, only return a Result.
        parseConfigDoName(input);
        return true;
      }),
    );
  });
});

// ─── isValidMaxAgents ─────────────────────────────────────────────────

describe("property: isValidMaxAgents", () => {
  it("accepts exactly the positive integers and rejects everything else", () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const expected =
          typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0;
        return isValidMaxAgents(v) === expected;
      }),
    );
  });

  it("accepts every positive integer", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (n) => isValidMaxAgents(n)),
    );
  });

  it("rejects every non-positive integer", () => {
    fc.assert(fc.property(fc.integer({ min: -1_000_000, max: 0 }), (n) => !isValidMaxAgents(n)));
  });
});

// ─── parseAndValidateBody ──────────────────────────────────────────────

describe("property: parseAndValidateBody", () => {
  it("accepts every positive integer for max_agents_per_config", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (n) => {
        const result = parseAndValidateBody(
          JSON.stringify({ max_agents_per_config: n }),
          initBodySchema,
        );
        return result.ok && result.value.max_agents_per_config === n;
      }),
    );
  });

  it("rejects non-positive integers", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 0 }), (n) => {
        const result = parseAndValidateBody(
          JSON.stringify({ max_agents_per_config: n }),
          initBodySchema,
        );
        return !result.ok;
      }),
    );
  });

  it("rejects non-integer numbers", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((d) => !Number.isInteger(d)),
        (n) => {
          const result = parseAndValidateBody(
            JSON.stringify({ max_agents_per_config: n }),
            initBodySchema,
          );
          return !result.ok;
        },
      ),
    );
  });

  it("strips arbitrary unknown keys (body-trust property)", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string().filter((k) => k !== "max_agents_per_config" && k.length > 0 && k.length < 50),
          fc.anything(),
          { maxKeys: 5 },
        ),
        (extras) => {
          const body = { ...extras, max_agents_per_config: 100 };
          const result = parseAndValidateBody(JSON.stringify(body), initBodySchema);
          if (!result.ok) return false;
          // Only the recognized key survives; extras are stripped.
          const keys = Object.keys(result.value);
          return keys.length === 1 && keys[0] === "max_agents_per_config";
        },
      ),
    );
  });

  it("missing key is undefined; explicit null is null (distinguishable)", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const missing = parseAndValidateBody("{}", initBodySchema);
        const explicit = parseAndValidateBody(
          JSON.stringify({ max_agents_per_config: null }),
          initBodySchema,
        );
        return (
          missing.ok &&
          missing.value.max_agents_per_config === undefined &&
          explicit.ok &&
          explicit.value.max_agents_per_config === null
        );
      }),
    );
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom(initBodySchema, syncPolicyBodySchema),
        (s, schema) => {
          parseAndValidateBody(s, schema);
          return true;
        },
      ),
    );
  });
});

// ─── safeForLog ────────────────────────────────────────────────────────

describe("property: safeForLog", () => {
  it("returns input unchanged when length ≤ maxLen", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.integer({ min: 8, max: 500 }),
        (s, maxLen) => {
          if (s.length > maxLen) return true; // skip — covered by truncation property
          return safeForLog(s, maxLen) === s;
        },
      ),
    );
  });

  it("truncates to exactly maxLen + the annotation suffix when too long", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1000 }),
        fc.integer({ min: 1, max: 200 }),
        (s, maxLen) => {
          if (s.length <= maxLen) return true; // skip — covered above
          const out = safeForLog(s, maxLen);
          // First maxLen chars are the original.
          if (out.slice(0, maxLen) !== s.slice(0, maxLen)) return false;
          // Then `…(N chars)` annotation.
          return out === `${s.slice(0, maxLen)}…(${s.length} chars)`;
        },
      ),
    );
  });

  it("represents undefined and empty string distinctly (and never as the input)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (maxLen) => {
        const a = safeForLog(undefined, maxLen);
        const b = safeForLog("", maxLen);
        return a === "<missing>" && b === "<empty>" && a !== b;
      }),
    );
  });
});
