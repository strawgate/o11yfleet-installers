import type {
  AiLightFetch,
  AiPageContext,
  AiPageDetail,
  AiPageMetric,
  AiPageTable,
} from "@o11yfleet/core/ai";

type ContextScalar = string | number | boolean | null;
type BrowserPageContextInput = Partial<Omit<AiPageContext, "route">> & { route?: string };

const MAX_YAML_CHARS = 50_000;

export function pageMetric(
  key: string,
  label: string,
  value: ContextScalar,
  options: Omit<AiPageMetric, "key" | "label" | "value"> = {},
): AiPageMetric {
  return { key, label, value, ...options };
}

export function pageDetail(
  key: string,
  label: string,
  value: ContextScalar,
  options: Omit<AiPageDetail, "key" | "label" | "value"> = {},
): AiPageDetail {
  return { key, label, value, ...options };
}

export function pageTable(
  key: string,
  label: string,
  rows: Array<Record<string, unknown>>,
  options: { columns?: string[]; totalRows?: number; maxRows?: number } = {},
): AiPageTable {
  const maxRows = options.maxRows ?? 20;
  const normalizedRows = rows.slice(0, maxRows).map((row) => normalizeRow(row));
  return {
    key,
    label,
    columns: options.columns ?? inferColumns(normalizedRows),
    rows: normalizedRows,
    total_rows: options.totalRows ?? rows.length,
  };
}

export function includedFetch(key: string, label: string, data: unknown): AiLightFetch {
  return { key, label, status: "included", data };
}

export function unavailableFetch(key: string, label: string, error: string): AiLightFetch {
  return { key, label, status: "unavailable", error };
}

export function pageYaml(label: string, content: string): NonNullable<AiPageContext["yaml"]> {
  const truncated = content.length > MAX_YAML_CHARS;
  return {
    label,
    content: truncated ? content.slice(0, MAX_YAML_CHARS) : content,
    truncated,
  };
}

export function buildBrowserPageContext(context: BrowserPageContextInput): AiPageContext {
  return {
    route: context.route ?? currentRoute(),
    ...context,
    visible_text: context.visible_text ?? [],
    metrics: context.metrics ?? [],
    tables: context.tables ?? [],
    details: context.details ?? [],
    light_fetches: context.light_fetches ?? [],
  };
}

function currentRoute(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function normalizeRow(row: Record<string, unknown>): Record<string, ContextScalar> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeScalar(value)]),
  );
}

function normalizeScalar(value: unknown): ContextScalar {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 1000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value)?.slice(0, 1000) ?? null;
}

function inferColumns(rows: Array<Record<string, ContextScalar>>): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      columns.add(column);
      if (columns.size >= 16) return [...columns];
    }
  }
  return [...columns];
}
