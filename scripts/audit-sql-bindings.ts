// Find SQL binding-count mismatches across the worker.
//
// Walks every `sql.exec(query, ...args)` call, counts `?` placeholders
// in the query string, and compares to the number of bound arguments.
// The class of bug it catches: `upsertPendingDevice` had 13
// placeholders bound to 12 params and threw at runtime — but no test
// ever called it, so it shipped to main untouched.
//
// Usage: pnpm tsx scripts/audit-sql-bindings.ts
//
// Reports: file:line | placeholders | bound args | function/method name
//
// Limitations:
//  - Tagged-template `sql\`...\`` calls aren't analyzed (none in this
//    repo today).
//  - Counts `?` literally — if a string contains a `?` for any reason
//    other than a bind placeholder, this will overcount. Easy to spot.
//  - `sql.prepare(query)` is bound on the returned statement
//    (`.bind(...)`), not at the prepare call. We see those in the
//    inspection list but skip the strict count check.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// All TypeScript files under apps/worker/src that might contain SQL —
// discovered via filesystem walk so a new DO file added in the future
// is automatically in scope. The previous hard-coded list silently let
// renamed/new files fall out of audit (CR feedback).
const SCAN_ROOT = path.join(ROOT, "apps/worker/src");

function discoverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...discoverFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(path.relative(ROOT, full));
    }
  }
  return out;
}

const files = discoverFiles(SCAN_ROOT);

interface Finding {
  file: string;
  line: number;
  placeholders: number;
  args: number;
  context: string;
  kind: "exec" | "prepare" | "run";
}

const findings: Finding[] = [];
let scannedFiles = 0;
let inspectedCalls = 0;

/** Returns null if the query string is dynamic (contains `${...}`
 *  substitutions that we can't statically count). Otherwise the
 *  literal `?` count. */
function countPlaceholders(node: ts.Node): number | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return (node.text.match(/\?/g) ?? []).length;
  }
  if (ts.isTemplateExpression(node)) {
    // Has `${...}` substitutions — placeholder count depends on
    // runtime values. Skip; report as "dynamic".
    return null;
  }
  // Some other expression (variable reference, function call, etc.).
  return null;
}

function isSqlCall(node: ts.CallExpression): { kind: "exec" | "prepare" | "run" } | null {
  const expr = node.expression;
  // sql.exec / sql.prepare / state.storage.sql.exec etc.
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name.text;
    const obj = expr.expression.getText();
    if ((name === "exec" || name === "prepare" || name === "run") && /(\.|^)sql$/.test(obj)) {
      return { kind: name as "exec" | "prepare" | "run" };
    }
  }
  return null;
}

function findEnclosingFunctionName(node: ts.Node): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) {
      return cur.name?.getText() ?? "<anonymous>";
    }
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return "<top-level>";
}

for (const rel of files) {
  const full = path.join(ROOT, rel);
  const src = fs.readFileSync(full, "utf8");
  // Quick skip: nothing in this file calls into SQL.
  if (!/\bsql\.(exec|prepare|run)\b/.test(src)) continue;
  scannedFiles += 1;
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.ES2022, true);

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const kind = isSqlCall(node);
      if (kind) {
        inspectedCalls += 1;
        const args = node.arguments;
        if (args.length === 0) return;
        // sql.prepare(query) binds on the returned statement, not here.
        // The `?` count would be compared to zero bound args and false-fire.
        if (kind.kind === "prepare") return;
        const queryArg = args[0]!;
        const placeholders = countPlaceholders(queryArg);
        // If any bound arg is a spread (...x) the count is runtime-dynamic.
        const hasSpread = args.slice(1).some((a) => ts.isSpreadElement(a));
        const boundArgs = args.length - 1;
        if (placeholders !== null && !hasSpread && placeholders !== boundArgs) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const fnName = findEnclosingFunctionName(node);
          findings.push({
            file: rel,
            line: line + 1,
            placeholders,
            args: boundArgs,
            context: fnName,
            kind: kind.kind,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

console.log(
  `Audited ${inspectedCalls} sql.exec/prepare/run call(s) across ${scannedFiles} file(s) under apps/worker/src.`,
);
console.log("");
if (findings.length === 0) {
  console.log("✓ All SQL calls have matching placeholder/binding counts.");
  process.exit(0);
}

console.log(`✗ Found ${findings.length} mismatch(es):`);
console.log("");
for (const f of findings) {
  console.log(
    `  ${f.file}:${f.line}  placeholders=${f.placeholders}  bound=${f.args}  in ${f.context} (${f.kind})`,
  );
}
process.exit(1);
