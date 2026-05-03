// Pure-function validator: collector YAML → ValidationResult.
//
// Designed to be cheap and deterministic — same input always produces the
// same output, no network I/O. The Workflow harness calls it once per
// `{repo, sha}` and turns the result into a Check Run conclusion +
// per-line annotations.
//
// MVP scope (this PR): YAML parses. Real validators (JSON Schema, exporter
// reachability, fleet-version awareness) ship in follow-up PRs without
// touching the orchestration around this function — keeps the workflow
// plumbing stable while validator quality iterates.

import { parse as parseYaml } from "yaml";

export interface ValidationAnnotation {
  /** Path inside the repo, repeated from the workflow input. */
  path: string;
  start_line: number;
  end_line: number;
  level: "notice" | "warning" | "failure";
  message: string;
  title?: string;
}

export type ValidationConclusion = "success" | "failure" | "neutral";

export interface ValidationResult {
  conclusion: ValidationConclusion;
  /** ~1 line of markdown for the Check Run UI. */
  summary: string;
  /** Optional longer markdown body (collapsible details, etc.). */
  text?: string;
  /** Per-line annotations rendered inline in the diff. */
  annotations: ValidationAnnotation[];
}

export interface ValidationInput {
  /** Path inside the repo (e.g. "o11yfleet/config.yaml"). */
  path: string;
  /** Raw bytes as fetched from the repo. */
  yaml: string;
}

/**
 * Run all validators against a single config file. The order of validators
 * is fixed so the highest-signal failure (parse) short-circuits cheaper
 * checks (schema, fleet-fit). Each validator returns annotations that are
 * concatenated into the final result.
 */
export function validateCollectorConfig(input: ValidationInput): ValidationResult {
  const annotations: ValidationAnnotation[] = [];

  // ─── Parse ──────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = parseYaml(input.yaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const line = extractLineNumber(message) ?? 1;
    annotations.push({
      path: input.path,
      start_line: line,
      end_line: line,
      level: "failure",
      message: `YAML parse error: ${message}`,
      title: "Invalid YAML",
    });
    return {
      conclusion: "failure",
      summary: "❌ YAML parse failed",
      text:
        "The collector configuration could not be parsed as YAML. Fix the parse error " +
        "and re-push to revalidate.",
      annotations,
    };
  }

  // Empty file isn't a parse error in YAML, but is functionally not a config.
  if (parsed === null || parsed === undefined) {
    annotations.push({
      path: input.path,
      start_line: 1,
      end_line: 1,
      level: "failure",
      message: "Configuration file is empty.",
    });
    return {
      conclusion: "failure",
      summary: "❌ Empty configuration",
      annotations,
    };
  }

  if (!isPlainObject(parsed)) {
    const got = Array.isArray(parsed) ? "array" : parsed instanceof Date ? "date" : typeof parsed;
    annotations.push({
      path: input.path,
      start_line: 1,
      end_line: 1,
      level: "failure",
      message: `Top-level YAML must be a mapping (got ${got}).`,
    });
    return {
      conclusion: "failure",
      summary: "❌ Top-level must be a mapping",
      annotations,
    };
  }

  // ─── Real validators land in follow-up PRs ──────────────────────────
  // Planned, in order of cheap → expensive:
  //   - JSON Schema against a vendored otelcol-contrib schema
  //   - Every component referenced by a `service.pipelines` entry is
  //     declared in receivers/processors/exporters
  //   - Every `exporters[*].endpoint` parses as a URL
  //   - Every component is present in the fleet's known
  //     `available_components` (per active collector versions)
  //   - Diff vs current rolled-out config (skip with neutral if unchanged)

  return {
    conclusion: "success",
    summary: "✅ YAML parses",
    text: "YAML parses. Schema and fleet-aware checks land in follow-up PRs.",
    annotations,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/**
 * Best-effort line extraction from yaml-the-package's error messages.
 * The library formats parse errors like "...at line 12, column 4...".
 * If we can't find a number, fall back to line 1 so the annotation
 * still renders.
 */
function extractLineNumber(message: string): number | null {
  const m = message.match(/line (\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
