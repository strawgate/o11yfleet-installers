// Pure-function validator: collector YAML → ValidationResult.
//
// Designed to be cheap and deterministic — same input always produces the
// same output, no network I/O. The Workflow harness calls it once per
// `{repo, sha}` and turns the result into a Check Run conclusion +
// per-line annotations.
//
// What this PR validates:
//   - YAML parses
//   - Top-level is a mapping with known section keys (unknown keys → warning,
//     not failure, since custom builders can extend the schema)
//   - Each component section (receivers / processors / exporters / extensions
//     / connectors) is a mapping of component-id → config
//   - `service` is a mapping
//   - `service.pipelines.<name>.{receivers,processors,exporters}` references
//     resolve to a declared component (connectors count as both receivers
//     and exporters per OpenTelemetry spec)
//   - `service.extensions` references resolve to a declared extension
//
// Deliberately *not* validated here (each its own follow-up PR):
//   - Per-component config schemas (would need a maintained schema source
//     scattered across otelcol-contrib; high effort, separate scope)
//   - `exporters[*].endpoint` URL parsing
//   - Fleet-version awareness (component is in `available_components`)
//   - Diff vs current rolled-out config (skip with neutral if unchanged)
//
// Annotation positions: every annotation lands on line 1 today. Pulling
// real positions out of the YAML AST (via `parseDocument`) is mechanical
// but adds enough code to deserve a separate PR. The Check Run UI shows
// each annotation as a distinct row, so distinct messages on the same
// line stay readable.

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

const TOP_LEVEL_SECTIONS = new Set([
  "receivers",
  "processors",
  "exporters",
  "extensions",
  "connectors",
  "service",
]);

type ComponentSection = "receivers" | "processors" | "exporters" | "extensions" | "connectors";
const COMPONENT_SECTIONS: readonly ComponentSection[] = [
  "receivers",
  "processors",
  "exporters",
  "extensions",
  "connectors",
];

interface Declarations {
  receivers: Set<string>;
  processors: Set<string>;
  exporters: Set<string>;
  extensions: Set<string>;
  connectors: Set<string>;
}

/**
 * Run all validators against a single config file. Order is fixed so the
 * highest-signal failure (parse) short-circuits cheaper checks. Each
 * validator pushes annotations onto a shared list; the conclusion is
 * derived from the worst level present.
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
    annotations.push({
      path: input.path,
      start_line: 1,
      end_line: 1,
      level: "failure",
      message: `Top-level YAML must be a mapping (got ${typeName(parsed)}).`,
    });
    return {
      conclusion: "failure",
      summary: "❌ Top-level must be a mapping",
      annotations,
    };
  }

  // ─── Structure ──────────────────────────────────────────────────────
  validateStructure(parsed, input.path, annotations);

  // ─── Pipeline reference resolution ──────────────────────────────────
  const decls = gatherDeclarations(parsed);
  validatePipelineRefs(parsed, decls, input.path, annotations);

  // ─── Conclude ───────────────────────────────────────────────────────
  return concludeFromAnnotations(annotations);
}

function validateStructure(
  config: Record<string, unknown>,
  path: string,
  annotations: ValidationAnnotation[],
): void {
  // Unknown top-level keys are a warning, not a failure: custom collector
  // builds can introduce new sections, and we don't want to block PRs over
  // a key we don't recognize. The user gets a heads-up to double-check
  // for typos (`recievers` is the classic one).
  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_SECTIONS.has(key)) {
      annotations.push({
        path,
        start_line: 1,
        end_line: 1,
        level: "warning",
        message: `Unknown top-level key '${key}'. Expected one of: ${[...TOP_LEVEL_SECTIONS].sort().join(", ")}.`,
      });
    }
  }

  for (const section of COMPONENT_SECTIONS) {
    const value = config[section];
    if (value !== undefined && value !== null && !isPlainObject(value)) {
      annotations.push({
        path,
        start_line: 1,
        end_line: 1,
        level: "failure",
        message: `'${section}' must be a mapping of component-id to config (got ${typeName(value)}).`,
      });
    }
  }

  const service = config["service"];
  if (service !== undefined && service !== null && !isPlainObject(service)) {
    annotations.push({
      path,
      start_line: 1,
      end_line: 1,
      level: "failure",
      message: `'service' must be a mapping (got ${typeName(service)}).`,
    });
  }
}

function gatherDeclarations(config: Record<string, unknown>): Declarations {
  const get = (key: ComponentSection): Set<string> => {
    const section = config[key];
    if (!isPlainObject(section)) return new Set();
    return new Set(Object.keys(section));
  };
  return {
    receivers: get("receivers"),
    processors: get("processors"),
    exporters: get("exporters"),
    extensions: get("extensions"),
    connectors: get("connectors"),
  };
}

function validatePipelineRefs(
  config: Record<string, unknown>,
  decls: Declarations,
  path: string,
  annotations: ValidationAnnotation[],
): void {
  const service = config["service"];
  if (!isPlainObject(service)) return;

  // service.extensions: list of strings referencing declared extensions.
  const serviceExtensions = service["extensions"];
  if (serviceExtensions !== undefined) {
    if (!Array.isArray(serviceExtensions)) {
      annotations.push({
        path,
        start_line: 1,
        end_line: 1,
        level: "failure",
        message: `service.extensions must be a list (got ${typeName(serviceExtensions)}).`,
      });
    } else {
      for (const ref of serviceExtensions) {
        if (typeof ref !== "string") {
          annotations.push({
            path,
            start_line: 1,
            end_line: 1,
            level: "failure",
            message: `service.extensions contains non-string entry: ${JSON.stringify(ref)}.`,
          });
          continue;
        }
        if (!decls.extensions.has(ref)) {
          annotations.push({
            path,
            start_line: 1,
            end_line: 1,
            level: "failure",
            message: `service.extensions references '${ref}', not declared in extensions.`,
          });
        }
      }
    }
  }

  const pipelines = service["pipelines"];
  if (pipelines === undefined) return;
  if (!isPlainObject(pipelines)) {
    annotations.push({
      path,
      start_line: 1,
      end_line: 1,
      level: "failure",
      message: `service.pipelines must be a mapping (got ${typeName(pipelines)}).`,
    });
    return;
  }

  // Connectors act as both receivers (in the downstream pipeline) and
  // exporters (in the upstream pipeline) per the OpenTelemetry spec.
  const validReceivers = new Set([...decls.receivers, ...decls.connectors]);
  const validExporters = new Set([...decls.exporters, ...decls.connectors]);

  for (const [pipelineName, pipelineDef] of Object.entries(pipelines)) {
    if (!isPlainObject(pipelineDef)) {
      annotations.push({
        path,
        start_line: 1,
        end_line: 1,
        level: "failure",
        message: `pipelines.${pipelineName} must be a mapping (got ${typeName(pipelineDef)}).`,
      });
      continue;
    }

    checkPipelineRole(
      pipelineName,
      "receivers",
      pipelineDef,
      validReceivers,
      "receivers or connectors",
      path,
      annotations,
    );
    checkPipelineRole(
      pipelineName,
      "processors",
      pipelineDef,
      decls.processors,
      "processors",
      path,
      annotations,
    );
    checkPipelineRole(
      pipelineName,
      "exporters",
      pipelineDef,
      validExporters,
      "exporters or connectors",
      path,
      annotations,
    );
  }
}

function checkPipelineRole(
  pipelineName: string,
  role: "receivers" | "processors" | "exporters",
  pipeline: Record<string, unknown>,
  validSet: Set<string>,
  label: string,
  path: string,
  annotations: ValidationAnnotation[],
): void {
  const refs = pipeline[role];
  if (refs === undefined) return;
  if (!Array.isArray(refs)) {
    annotations.push({
      path,
      start_line: 1,
      end_line: 1,
      level: "failure",
      message: `pipelines.${pipelineName}.${role} must be a list (got ${typeName(refs)}).`,
    });
    return;
  }
  for (const ref of refs) {
    if (typeof ref !== "string") {
      annotations.push({
        path,
        start_line: 1,
        end_line: 1,
        level: "failure",
        message: `pipelines.${pipelineName}.${role} contains non-string entry: ${JSON.stringify(ref)}.`,
      });
      continue;
    }
    if (!validSet.has(ref)) {
      annotations.push({
        path,
        start_line: 1,
        end_line: 1,
        level: "failure",
        message: `pipelines.${pipelineName}.${role} references '${ref}', not declared in ${label}.`,
      });
    }
  }
}

function concludeFromAnnotations(annotations: ValidationAnnotation[]): ValidationResult {
  const failures = annotations.filter((a) => a.level === "failure").length;
  const warnings = annotations.filter((a) => a.level === "warning").length;

  if (failures > 0) {
    return {
      conclusion: "failure",
      summary: `❌ ${failures} error${failures === 1 ? "" : "s"}${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`,
      text:
        "Structural validation found one or more errors. Per-component config schema, " +
        "endpoint URL parsing, and fleet-aware checks ship in follow-up PRs.",
      annotations,
    };
  }
  if (warnings > 0) {
    return {
      conclusion: "neutral",
      summary: `⚠️ ${warnings} warning${warnings === 1 ? "" : "s"}`,
      text: "Structure is valid but unknown top-level keys were found. Double-check for typos.",
      annotations,
    };
  }
  return {
    conclusion: "success",
    summary: "✅ Structure valid, pipeline references resolve",
    text:
      "YAML parses, top-level structure is valid, and every pipeline reference resolves to a " +
      "declared component. Per-component config schema and fleet-aware checks land in follow-up PRs.",
    annotations,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function typeName(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (value instanceof Date) return "date";
  return typeof value;
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

import type { FleetComponentGroup } from "../durable-objects/agent-state-repo-interface.js";

const COMPONENT_KINDS = [
  "receivers",
  "processors",
  "exporters",
  "extensions",
  "connectors",
] as const;
type ComponentKind = (typeof COMPONENT_KINDS)[number];

export interface ComponentDeclaration {
  kind: ComponentKind;
  name: string;
}

export function extractComponentDeclarations(yamlConfig: string): ComponentDeclaration[] {
  const decls: ComponentDeclaration[] = [];
  try {
    const parsed = parseYaml(yamlConfig) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return [];
    for (const kind of COMPONENT_KINDS) {
      const section = parsed[kind] as unknown;
      // Handle map format: receivers: { otlp: {}, prometheus: {} }
      // Reject arrays (typeof array === 'object') and scalars.
      if (section && typeof section === "object" && !Array.isArray(section)) {
        for (const name of Object.keys(section as Record<string, unknown>)) {
          decls.push({ kind, name });
        }
      }
    }
  } catch {
    return [];
  }
  return decls;
}

export interface FleetCompatibilityResult {
  compatible: boolean;
  missingComponents: ComponentDeclaration[];
  compatibleAgents: number;
  incompatibleAgents: number;
  /** Agents that have not reported available_components — unknown capability. */
  unknownAgents: number;
  totalAgents: number;
  perGroup: {
    availableComponents: string;
    agentCount: number;
    missingComponents: ComponentDeclaration[];
  }[];
}

export function validateFleetCompatibility(
  decls: ComponentDeclaration[],
  fleetGroups: FleetComponentGroup[],
): FleetCompatibilityResult {
  const missingMap = new Map<string, ComponentDeclaration>();
  let compatibleAgents = 0;
  let incompatibleAgents = 0;
  let unknownAgents = 0;

  for (const group of fleetGroups) {
    // Agents that have not reported available_components cannot be validated.
    // Treat them as "unknown" — they do not cause incompatibility.
    if (group.availableComponents === "null" || group.availableComponents === null) {
      unknownAgents += group.agentCount;
      continue;
    }

    let fingerprint: ComponentInventory | null = null;
    try {
      fingerprint = extractComponentInventoryFromRaw(JSON.parse(group.availableComponents));
    } catch {
      unknownAgents += group.agentCount;
      continue;
    }

    if (!fingerprint) {
      unknownAgents += group.agentCount;
      continue;
    }

    const missing = decls.filter((d) => {
      const list = fingerprint![d.kind];
      return !list.includes(d.name);
    });

    if (missing.length === 0) {
      compatibleAgents += group.agentCount;
    } else {
      incompatibleAgents += group.agentCount;
      // Deduplicate by individual component key so we don't return the same
      // component twice even if multiple groups are missing it.
      for (const m of missing) {
        missingMap.set(`${m.kind}/${m.name}`, m);
      }
    }
  }

  return {
    compatible: incompatibleAgents === 0,
    missingComponents: Array.from(missingMap.values()),
    compatibleAgents,
    incompatibleAgents,
    unknownAgents,
    totalAgents: compatibleAgents + incompatibleAgents + unknownAgents,
    perGroup: fleetGroups.map((g) => {
      if (g.availableComponents === "null" || g.availableComponents === null) {
        return {
          availableComponents: g.availableComponents,
          agentCount: g.agentCount,
          missingComponents: [],
        };
      }
      let fp: ComponentInventory | null = null;
      try {
        fp = extractComponentInventoryFromRaw(JSON.parse(g.availableComponents));
      } catch {
        fp = null;
      }
      const missing = fp ? decls.filter((d) => !fp![d.kind]?.includes(d.name)) : [];
      return {
        availableComponents: g.availableComponents,
        agentCount: g.agentCount,
        missingComponents: missing,
      };
    }),
  };
}

interface ComponentInventory {
  receivers: string[];
  processors: string[];
  exporters: string[];
  extensions: string[];
  connectors: string[];
}

function extractComponentInventoryFromRaw(
  raw: Record<string, unknown> | null,
): ComponentInventory | null {
  if (!raw) return null;
  const components = raw["components"] as Record<string, unknown> | undefined;
  if (!components || typeof components !== "object") return null;
  const extractNames = (section: unknown): string[] => {
    if (!section || typeof section !== "object") return [];
    const subMap = (section as Record<string, unknown>)["sub_component_map"] as
      | Record<string, unknown>
      | undefined;
    if (!subMap || typeof subMap !== "object") return [];
    return Object.keys(subMap);
  };
  return {
    receivers: extractNames(components["receivers"]),
    processors: extractNames(components["processors"]),
    exporters: extractNames(components["exporters"]),
    extensions: extractNames(components["extensions"]),
    connectors: extractNames(components["connectors"]),
  };
}
