import { adminDoQueryRequestSchema } from "@o11yfleet/core/api";
import type { DebugTablesResult, DebugQueryParams, DebugQueryResult } from "./rpc-types.js";
import { RpcError } from "./rpc-types.js";

const MAX_DEBUG_QUERY_ROWS = 500;
const MAX_DEBUG_SQL_LENGTH = 4_000;
// Total serialized response bytes for the admin debug query. Caps memory
// pressure on the DO when an individual row materializes a large value
// (e.g. effective_config_body, blob columns) — `LIMIT 500` only counts
// rows, not bytes.
const MAX_DEBUG_RESPONSE_BYTES = 1_048_576; // 1 MiB

// Auth: This handler runs inside a Durable Object, reachable only via
// authenticated worker routes (see routes/v1/index.ts admin middleware).
// The X-Admin-Secret header is an additional defense-in-depth check.
// TODO: Replace with proper admin JWT verification.
function isDebugAuthorized(request: Request): boolean {
  return request.headers.get("x-fp-admin-debug") === "true";
}

function normalizeDebugParam(value: unknown): string | number | null {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  throw new Error("Query params must be strings, numbers, booleans, or null");
}

export function containsSemicolonOutsideStrings(sql: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (quote) {
      if (char === quote) {
        if (next === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ";") {
      return true;
    }
  }
  return false;
}

function readonlyDebugQuery(sql: string): string {
  if (sql.length > MAX_DEBUG_SQL_LENGTH) {
    throw new Error(`SQL must be ${MAX_DEBUG_SQL_LENGTH} characters or fewer`);
  }
  if (!/^select\b/i.test(sql) || containsSemicolonOutsideStrings(sql)) {
    throw new Error("Only single SELECT queries are allowed");
  }
  // The outer LIMIT only caps returned rows. Without these keyword
  // bans, an admin could materialize the full agents table before the
  // limit applies (JOIN/UNION/WITH) or reorder it in memory (ORDER BY
  // / GROUP BY / HAVING). Reject those keywords so the debug viewer
  // stays a debug viewer and not a wholesale scan tool. Operators
  // who need aggregation should run it offline against an Analytics
  // Engine export.
  if (/\b(join|union|with|group\s+by|order\s+by|having|recursive)\b/i.test(sql)) {
    throw new Error(
      "Debug queries cannot use JOIN, UNION, WITH, GROUP BY, ORDER BY, HAVING, or RECURSIVE",
    );
  }
  // Reject SQLite functions that can materialize huge values per row
  // regardless of LIMIT (e.g. `SELECT zeroblob(1<<27)` or
  // `SELECT printf('%.*c', 50000000, 'a')`).
  if (/\b(zeroblob|randomblob|printf|char|replicate)\s*\(/i.test(sql)) {
    throw new Error(
      "Debug queries cannot use blob/string-amplification functions (zeroblob, randomblob, printf, char, replicate)",
    );
  }
  return `SELECT * FROM (${sql}) LIMIT ?`;
}

export function handleDebugTables(sql: SqlStorage, request: Request): Response {
  if (!isDebugAuthorized(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = sql
    .exec(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name ASC`,
    )
    .toArray() as Array<{ name: string }>;

  return Response.json({ tables: rows.map((row) => row.name) });
}

export async function handleDebugQuery(sql: SqlStorage, request: Request): Promise<Response> {
  if (!isDebugAuthorized(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = adminDoQueryRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { sql: querySql, params = [] } = parsed.data;

  try {
    const cursor = sql.exec(
      readonlyDebugQuery(querySql),
      ...params.map((param) => normalizeDebugParam(param)),
      MAX_DEBUG_QUERY_ROWS,
    );
    // Stream rows out of the cursor and stop accumulating once we
    // would exceed the response byte budget. The estimate is the
    // length of `JSON.stringify(row)`; it's cheap and good enough.
    const rows: Array<Record<string, unknown>> = [];
    let bytes = 2; // `[]`
    let truncated = false;
    for (const row of cursor) {
      const rowJson = JSON.stringify(row);
      const rowBytes = new TextEncoder().encode(rowJson).byteLength + 1; // + comma
      if (bytes + rowBytes > MAX_DEBUG_RESPONSE_BYTES) {
        truncated = true;
        break;
      }
      bytes += rowBytes;
      rows.push(row as Record<string, unknown>);
    }
    return Response.json({
      rows,
      row_count: rows.length,
      truncated,
      response_bytes_estimate: bytes,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 400 },
    );
  }
}

// ─── Data-returning cores (called by RPC methods) ────────────────

export function debugTablesData(sql: SqlStorage): DebugTablesResult {
  const rows = sql
    .exec(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name ASC`,
    )
    .toArray() as Array<{ name: string }>;
  return { tables: rows.map((row) => row.name) };
}

export function debugQueryData(sql: SqlStorage, params: DebugQueryParams): DebugQueryResult {
  const { sql: querySql, params: queryParams = [] } = params;
  try {
    const cursor = sql.exec(
      readonlyDebugQuery(querySql),
      ...queryParams.map((param) => normalizeDebugParam(param)),
      MAX_DEBUG_QUERY_ROWS,
    );
    const rows: Array<Record<string, unknown>> = [];
    let bytes = 2;
    let truncated = false;
    for (const row of cursor) {
      const rowJson = JSON.stringify(row);
      const rowBytes = new TextEncoder().encode(rowJson).byteLength + 1;
      if (bytes + rowBytes > MAX_DEBUG_RESPONSE_BYTES) {
        truncated = true;
        break;
      }
      bytes += rowBytes;
      rows.push(row as Record<string, unknown>);
    }
    return { rows, row_count: rows.length, truncated, response_bytes_estimate: bytes };
  } catch (error) {
    throw new RpcError(error instanceof Error ? error.message : "Query failed", 400);
  }
}
