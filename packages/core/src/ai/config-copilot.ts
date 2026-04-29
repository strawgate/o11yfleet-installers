import { parse as parseYaml } from "yaml";
import {
  parseCollectorYamlToGraph,
  summarizePipelineGraph,
  validatePipelineGraph,
  type PipelineValidationIssue,
} from "../pipeline/index.js";
import type { AiGuidanceIntent, AiPageContext } from "./guidance.js";

export interface ConfigCopilotIssue {
  code: string;
  message: string;
}

export interface ConfigCopilotAnalysis {
  yaml_present: boolean;
  yaml_truncated: boolean;
  import_confidence: "complete" | "partial" | "raw-only" | "missing";
  summary: string | null;
  pipeline_count: number;
  signals: string[];
  safe_for_draft: boolean;
  blockers: ConfigCopilotIssue[];
  warnings: ConfigCopilotIssue[];
}

// This intentionally includes valid Collector sections that are not rendered by
// the pipeline graph importer, such as connectors and extensions.
const allowedCollectorTopLevelSections = new Set([
  "receivers",
  "processors",
  "exporters",
  "connectors",
  "extensions",
  "service",
]);

const inlineSecretPattern =
  /^\s*(?:[-\w]+\.)*(?:api[_-]?key|authorization|bearer[_-]?token|password|secret|token)\s*:\s*(.+?)\s*(?:#.*)?$/gim;
const secretReferencePattern =
  /^(?:\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*(?::[^}]*)?\}|\$[A-Za-z_][A-Za-z0-9_]*)$/;
const bearerSecretReferencePattern =
  /^Bearer\s+(?:\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*(?::[^}]*)?\}|\$[A-Za-z_][A-Za-z0-9_]*)$/i;

export function analyzeConfigCopilotYaml(
  yaml: AiPageContext["yaml"] | undefined,
  _intent: AiGuidanceIntent,
): ConfigCopilotAnalysis {
  if (!yaml) {
    const blockers = [
      { code: "yaml_missing", message: "No current YAML is available for a draft change." },
    ];
    return {
      yaml_present: false,
      yaml_truncated: false,
      import_confidence: "missing",
      summary: null,
      pipeline_count: 0,
      signals: [],
      safe_for_draft: blockers.length === 0,
      blockers,
      warnings: [],
    };
  }

  const blockers: ConfigCopilotIssue[] = [];
  const warnings: ConfigCopilotIssue[] = [];
  if (yaml.truncated) {
    blockers.push({
      code: "yaml_truncated",
      message: "YAML is truncated, so draft changes are blocked until the full file is loaded.",
    });
  }

  const importResult = parseCollectorYamlToGraph(yaml.content);
  for (const warning of importResult.warnings) {
    const issue = { code: warning.code, message: warning.message };
    if (
      warning.code === "collector_yaml_parse_error" ||
      warning.code === "collector_yaml_not_mapping"
    ) {
      blockers.push(issue);
    } else warnings.push(issue);
  }

  for (const section of unknownTopLevelSections(yaml.content)) {
    blockers.push({
      code: "unknown_top_level_section",
      message: `Top-level section "${section}" is not part of the supported Collector config shape.`,
    });
  }

  const secretIssue = inlineSecretIssue(yaml.content);
  if (secretIssue) blockers.push(secretIssue);

  const validation = validatePipelineGraph(importResult.graph);
  for (const error of validation.errors) {
    const issue = validationIssue(error);
    if (error.code === "signal_without_exporter" || error.code === "pipeline_topology_error") {
      blockers.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  const signals = validation.pipelines.map((pipeline) => pipeline.signal);
  return {
    yaml_present: true,
    yaml_truncated: yaml.truncated,
    import_confidence: importResult.confidence,
    summary:
      importResult.confidence === "raw-only"
        ? "Collector YAML could not be represented as a visual pipeline graph."
        : summarizePipelineGraph(importResult.graph),
    pipeline_count: validation.pipelines.length,
    signals,
    safe_for_draft: blockers.length === 0,
    blockers,
    warnings,
  };
}

function validationIssue(issue: PipelineValidationIssue): ConfigCopilotIssue {
  return { code: issue.code, message: issue.message };
}

function inlineSecretIssue(yaml: string): ConfigCopilotIssue | null {
  for (const match of yaml.matchAll(inlineSecretPattern)) {
    const value = normalizeSecretValue(match[1] ?? "");
    if (!value || isSecretReference(value)) continue;
    return {
      code: "inline_secret_detected",
      message: "YAML appears to contain an inline secret or token value.",
    };
  }
  return null;
}

function normalizeSecretValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isSecretReference(value: string): boolean {
  return secretReferencePattern.test(value) || bearerSecretReferencePattern.test(value);
}

function unknownTopLevelSections(yaml: string): string[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  return Object.keys(parsed).filter((section) => !allowedCollectorTopLevelSections.has(section));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
