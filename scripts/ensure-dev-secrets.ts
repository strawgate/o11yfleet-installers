#!/usr/bin/env -S npx tsx
/**
 * Generates strong random values for dev-only secrets in
 * `apps/worker/.dev.vars`, so each dev environment has unique
 * credentials and the placeholder defaults from `.dev.vars.example`
 * never end up in shared/staging stores.
 *
 * Run automatically by `just dev-up` and as a prerequisite of
 * `just admin-login`. Idempotent — only fills in MISSING or
 * placeholder values; existing real values are preserved.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_VARS_PATH = resolve(__dirname, "../apps/worker/.dev.vars");

interface SecretSpec {
  key: string;
  /** True when the existing value should be replaced. */
  needsReset: (value: string) => boolean;
  generate: () => string;
}

// Patterns we treat as placeholders and overwrite. Real user-supplied
// values pass through untouched.
const PLACEHOLDER =
  /^(dev-local|dev-secret|change-me|.*-change-me-.*|admin-password|demo-password|.*-dev-only.*)/i;
const isPlaceholder = (v: string) => v === "" || PLACEHOLDER.test(v);

const SPECS: SecretSpec[] = [
  {
    key: "O11YFLEET_API_BEARER_SECRET",
    needsReset: isPlaceholder,
    // 32 bytes base64url ≈ 43 chars, fits the >=32-char invariant the
    // worker checks at boot.
    generate: () => randomBytes(32).toString("base64url"),
  },
  {
    key: "O11YFLEET_CLAIM_HMAC_SECRET",
    needsReset: isPlaceholder,
    generate: () => randomBytes(32).toString("base64url"),
  },
  {
    key: "O11YFLEET_SEED_ADMIN_PASSWORD",
    needsReset: isPlaceholder,
    // Long enough to be meaningful, short enough to print in logs.
    generate: () => randomBytes(18).toString("base64url"),
  },
  {
    key: "O11YFLEET_SEED_TENANT_USER_PASSWORD",
    needsReset: isPlaceholder,
    generate: () => randomBytes(18).toString("base64url"),
  },
];

function readVars(path: string): Map<string, { line: number; value: string }> {
  if (!existsSync(path)) return new Map();
  const lines = readFileSync(path, "utf8").split("\n");
  const out = new Map<string, { line: number; value: string }>();
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq === -1) return;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, { line: idx, value });
  });
  return out;
}

function writeUpdated(path: string, updates: Map<string, string>): void {
  if (updates.size === 0) return;
  let contents = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of updates) {
    const replacement = `${key}=${value}`;
    const re = new RegExp(`^${key}\\s*=.*$`, "m");
    if (re.test(contents)) {
      contents = contents.replace(re, replacement);
    } else {
      contents += (contents.endsWith("\n") || contents === "" ? "" : "\n") + replacement + "\n";
    }
  }
  writeFileSync(path, contents);
}

function main(): void {
  if (!existsSync(DEV_VARS_PATH)) {
    console.error(
      `[ensure-dev-secrets] ${DEV_VARS_PATH} does not exist. Run \`cp apps/worker/.dev.vars.example apps/worker/.dev.vars\` first.`,
    );
    process.exit(1);
  }
  const current = readVars(DEV_VARS_PATH);
  const updates = new Map<string, string>();
  const generated: string[] = [];

  for (const spec of SPECS) {
    const existing = current.get(spec.key)?.value ?? "";
    if (spec.needsReset(existing)) {
      const value = spec.generate();
      updates.set(spec.key, value);
      generated.push(spec.key);
    }
  }

  if (updates.size === 0) {
    console.log("[ensure-dev-secrets] all dev secrets already populated; nothing to do.");
    return;
  }

  writeUpdated(DEV_VARS_PATH, updates);
  console.log(
    `[ensure-dev-secrets] generated ${generated.length} secret(s) in ${DEV_VARS_PATH}: ${generated.join(", ")}`,
  );
}

main();
