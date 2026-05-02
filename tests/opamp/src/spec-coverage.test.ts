// Spec-section coverage guard.
//
// Scans `opamp.test.ts` for `describe()` titles annotated with `§X.Y` and
// asserts every section in `EXPECTED_SECTIONS` is covered by at least one
// describe block. The known list is the curated set of OpAMP spec sections
// we *intend* to test — adding a new entry forces a deliberate "do we
// have a test for this" decision in PR review, and removing coverage for
// an existing section fails fast instead of silently regressing.
//
// This is the spec-section analog of the proto field-coverage assertion in
// packages/core/test/oracle.test.ts. Together they form a structural guard
// against the two ways our OpAMP coverage can drift: missing fixtures for
// a wire field, and missing tests for a spec section.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_FILE = resolve(__dirname, "./opamp.test.ts");

/**
 * OpAMP spec sections we intend to cover. Keep aligned with the OpAMP spec
 * table of contents:
 *   https://github.com/open-telemetry/opamp-spec/blob/main/specification.md
 *
 * Format: bare numbering (e.g. "4.5.1"). Do not include the § sigil — we
 * compare against extracted section numbers without the symbol.
 *
 * To add a section: list it here AND add a `describe("... (§X.Y)", ...)`
 * block in opamp.test.ts. To deliberately defer coverage, move the entry
 * to `INTENTIONALLY_UNCOVERED` with a written reason.
 */
const EXPECTED_SECTIONS = [
  "4.1", // WebSocket Transport
  "4.2", // Connection Establishment
  "4.3", // Heartbeat
  "4.3.1", // Heartbeat Interval Persistence
  "4.4", // ServerToAgent Message
  "4.4.1", // Server Capabilities
  "4.5", // Error Handling
  "4.5.1", // Error Recovery
  "4.6", // Connection Settings Status
  "5.1", // AgentIdentification
  "5.2", // Health Reporting
  "5.2.1", // Component Health Map
  "5.2.2", // Available Components
  "5.3", // Remote Configuration
  "5.3.1", // Config Hash Consistency
  "5.3.2", // Config Applying Status
  "5.3.3", // Multi-File Config Map
  "5.4", // Connection Settings
  "5.4.1", // ConnectionSettingsOffers Hash
  "5.5", // Reconnection
  "5.6", // Capacity and Rate Limiting
  "5.6.1", // Pre-Upgrade Rejection
  "5.7", // Server-Initiated Disconnect
  "5.8", // Connection Settings Request
  "5.9", // Restart Command
  "5.10", // Custom Messages
  "6.1", // Enrollment
  "6.1.1", // Token Revocation
  "6.1.2", // Token Revocation - Rust Worker (deployment-specific)
  "7", // Sequence Numbers
];

/**
 * Sections we know about but deliberately don't cover yet. Each entry
 * carries a one-line justification so the gap is documented, not silent.
 */
const INTENTIONALLY_UNCOVERED: Record<string, string> = {
  "8": "Generic OpAMP capability negotiation — covered implicitly by §4.4.1 and §5.2.2 fixtures, no dedicated test yet.",
};

function extractCoveredSections(): Set<string> {
  const source = readFileSync(TEST_FILE, "utf-8");
  // Match `describe(<quote>...§X.Y...<quote>, ...)` for any of `"`, `'`, or
  // backtick quote styles. Anchoring on a *single* quote class up front and
  // requiring the closing quote to match (back-reference) keeps the section
  // string self-contained and avoids spilling into the next argument.
  const re = /describe\(\s*(["'`])((?:(?!\1)[\s\S])*?)§(\d+(?:\.\d+){0,3})(?:(?!\1)[\s\S])*?\1/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[3] !== undefined) found.add(m[3]);
  }
  return found;
}

describe("OpAMP spec coverage", () => {
  const covered = extractCoveredSections();

  it("every EXPECTED_SECTIONS entry has a corresponding describe block", () => {
    const missing = EXPECTED_SECTIONS.filter((s) => !covered.has(s));
    expect(
      missing,
      `OpAMP spec sections in EXPECTED_SECTIONS missing a describe block: ${missing.join(", ")}. ` +
        `Add a \`describe("... (§${missing[0] ?? "X.Y"})", ...)\` block in opamp.test.ts, ` +
        `or move the entry to INTENTIONALLY_UNCOVERED with a written reason.`,
    ).toEqual([]);
  });

  it("no covered section is also marked as INTENTIONALLY_UNCOVERED", () => {
    // Catches a stale ignore-list entry — once a section is actually
    // covered, the documented gap should be removed.
    const stale = Object.keys(INTENTIONALLY_UNCOVERED).filter((s) => covered.has(s));
    expect(
      stale,
      `Sections in INTENTIONALLY_UNCOVERED are now covered; remove them from the ignore list: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("every covered section is either expected or intentionally uncovered", () => {
    // Catches typos / sections that exist in tests but aren't tracked. A
    // describe titled `§4.5.99` with no entry in either list would slip
    // by silently otherwise.
    const expected = new Set(EXPECTED_SECTIONS);
    const documented = new Set(Object.keys(INTENTIONALLY_UNCOVERED));
    const orphan = [...covered].filter((s) => !expected.has(s) && !documented.has(s));
    expect(
      orphan,
      `Test files annotate spec sections not in EXPECTED_SECTIONS: ${orphan.join(", ")}. ` +
        `Add the section to EXPECTED_SECTIONS or fix the annotation.`,
    ).toEqual([]);
  });
});
