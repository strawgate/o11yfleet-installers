import { deriveSignalPipelines } from "./validation.js";
import type {
  PipelineConfigObject,
  PipelineConfigScalar,
  PipelineConfigValue,
  PipelineGraph,
} from "./types.js";

type PathToken = string | number;

function cloneConfigValue(value: PipelineConfigValue): PipelineConfigValue {
  if (Array.isArray(value)) return value.map(cloneConfigValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneConfigValue(nested)]),
    );
  }
  return value;
}

function parseConfigPath(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  for (const part of path.split(".")) {
    const matchAll = part.matchAll(/([^[\]]+)|\[(\d+)\]/g);
    for (const match of matchAll) {
      if (match[1]) tokens.push(match[1]);
      if (match[2]) tokens.push(Number(match[2]));
    }
  }
  return tokens;
}

function pathKey(tokens: PathToken[]): string {
  return tokens
    .map((token, index) =>
      typeof token === "number" ? `[${token}]` : index === 0 ? token : `.${token}`,
    )
    .join("");
}

function findConfigPathConflict(
  existingLeaves: Map<string, string>,
  path: PathToken[],
  sourceKey: string,
): string | null {
  for (let i = 1; i < path.length; i++) {
    const ancestor = pathKey(path.slice(0, i));
    const existing = existingLeaves.get(ancestor);
    if (existing) return existing;
  }

  const ownPath = pathKey(path);
  for (const [existingPath, existingSource] of existingLeaves.entries()) {
    if (existingPath === ownPath && existingSource !== sourceKey) return existingSource;
    if (existingPath.startsWith(`${ownPath}.`) || existingPath.startsWith(`${ownPath}[`)) {
      return existingSource;
    }
  }

  return null;
}

function setPath(target: PipelineConfigObject, path: string, value: PipelineConfigValue): void {
  const tokens = parseConfigPath(path);
  let cursor: PipelineConfigObject | PipelineConfigValue[] = target;

  tokens.forEach((token, index) => {
    const last = index === tokens.length - 1;
    const next = tokens[index + 1];

    if (last) {
      if (typeof token === "number" && Array.isArray(cursor)) {
        cursor[token] = cloneConfigValue(value);
      } else if (typeof token === "string" && !Array.isArray(cursor)) {
        cursor[token] = cloneConfigValue(value);
      }
      return;
    }

    if (typeof token === "number") {
      if (!Array.isArray(cursor)) return;
      const existing = cursor[token];
      if (!existing || typeof existing !== "object") {
        cursor[token] = typeof next === "number" ? [] : {};
      }
      cursor = cursor[token] as PipelineConfigObject | PipelineConfigValue[];
      return;
    }

    if (Array.isArray(cursor)) return;
    const existing = cursor[token];
    if (!existing || typeof existing !== "object") {
      cursor[token] = typeof next === "number" ? [] : {};
    }
    cursor = cursor[token] as PipelineConfigObject | PipelineConfigValue[];
  });
}

export function expandPipelineConfig(config: PipelineConfigObject): PipelineConfigObject {
  const expanded: PipelineConfigObject = {};
  const leaves = new Map<string, string>();
  for (const [key, value] of Object.entries(config)) {
    const tokens = parseConfigPath(key);
    const conflict = findConfigPathConflict(leaves, tokens, key);
    if (conflict) {
      throw new Error(`Conflicting pipeline config keys: "${conflict}" and "${key}".`);
    }

    if (key.includes(".") || key.includes("[")) {
      setPath(expanded, key, value);
    } else {
      expanded[key] = cloneConfigValue(value);
    }
    leaves.set(pathKey(tokens), key);
  }
  return expanded;
}

function isScalar(value: PipelineConfigValue): value is PipelineConfigScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function renderScalar(value: PipelineConfigValue): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  throw new Error("Expected scalar YAML value");
}

function renderConfigObject(object: PipelineConfigObject, indent = 0): string[] {
  const lines: string[] = [];
  const pad = " ".repeat(indent);

  for (const [key, value] of Object.entries(object)) {
    if (isScalar(value)) {
      lines.push(`${pad}${key}: ${renderScalar(value)}`);
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else if (value.every(isScalar)) {
        lines.push(`${pad}${key}: [${value.map(renderScalar).join(", ")}]`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of value) {
          if (isScalar(item)) {
            lines.push(`${pad}  - ${renderScalar(item)}`);
          } else {
            lines.push(...renderArrayObject(item as PipelineConfigObject, indent + 2));
          }
        }
      }
      continue;
    }

    lines.push(`${pad}${key}:`);
    lines.push(...renderConfigObject(value, indent + 2));
  }

  return lines;
}

function renderArrayObject(object: PipelineConfigObject, indent: number): string[] {
  const entries = Object.entries(object);
  if (entries.length === 0) return [`${" ".repeat(indent)}- {}`];

  const [firstKey, firstValue] = entries[0]!;
  const pad = " ".repeat(indent);
  const lines: string[] = [];

  if (isScalar(firstValue)) {
    lines.push(`${pad}- ${firstKey}: ${renderScalar(firstValue)}`);
  } else {
    lines.push(`${pad}- ${firstKey}:`);
    lines.push(...renderNestedValue(firstValue, indent + 4));
  }

  for (const [key, value] of entries.slice(1)) {
    if (isScalar(value)) {
      lines.push(`${pad}  ${key}: ${renderScalar(value)}`);
    } else {
      lines.push(`${pad}  ${key}:`);
      lines.push(...renderNestedValue(value, indent + 4));
    }
  }

  return lines;
}

function renderNestedValue(
  value: Exclude<PipelineConfigValue, PipelineConfigScalar>,
  indent: number,
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const pad = " ".repeat(indent);
      if (isScalar(item)) return [`${pad}- ${renderScalar(item)}`];
      return renderArrayObject(item as PipelineConfigObject, indent);
    });
  }
  return renderConfigObject(value, indent);
}

function sectionName(role: "receiver" | "processor" | "exporter"): string {
  return `${role}s`;
}

export function renderCollectorYaml(graph: PipelineGraph): string {
  const lines: string[] = [`# Generated by O11yFleet pipeline model`, `# ${graph.label}`];

  for (const role of ["receiver", "processor", "exporter"] as const) {
    lines.push(`${sectionName(role)}:`);
    const components = graph.components.filter((component) => component.role === role);
    if (components.length === 0) {
      lines.push("  {}");
      continue;
    }
    for (const component of components) {
      lines.push(`  ${component.name}:`);
      const config = expandPipelineConfig(component.config);
      const configLines = renderConfigObject(config, 4);
      lines.push(...(configLines.length ? configLines : ["    {}"]));
    }
    lines.push("");
  }

  lines.push("service:");
  const pipelines = deriveSignalPipelines(graph);
  if (pipelines.length === 0) {
    lines.push("  pipelines: {}");
    return `${lines.join("\n").trimEnd()}\n`;
  }

  lines.push("  pipelines:");
  for (const pipeline of pipelines) {
    lines.push(`    ${pipeline.signal}:`);
    lines.push(`      receivers: [${pipeline.receivers.join(", ")}]`);
    if (pipeline.processors.length > 0) {
      lines.push(`      processors: [${pipeline.processors.join(", ")}]`);
    }
    lines.push(`      exporters: [${pipeline.exporters.join(", ")}]`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
