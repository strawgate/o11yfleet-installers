import fs from "node:fs";
import ts from "typescript";

const routeFiles = [
  "apps/worker/src/routes/auth.ts",
  "apps/worker/src/routes/v1/index.ts",
  "apps/worker/src/routes/admin/index.ts",
] as const;

const docsFiles = [
  "apps/site/public/docs/api/authentication.html",
  "apps/site/public/docs/api/endpoints.html",
] as const;

const legacyScanFiles = [
  ...docsFiles,
  "README.md",
  "apps/site/public/docs/getting-started.html",
  "apps/site/public/docs/how-to/install.html",
  "docs/portal-design-prompt.md",
  "docs/research/plan.md",
  "scripts/seed-local.ts",
  "scripts/push-config.ts",
  "scripts/show-fleet.ts",
] as const;

function normalizePath(path: string): string {
  return path.replace(/:([a-z_]+)/g, ":id");
}

function routeFromRegexLiteral(text: string): string | null {
  if (!text.startsWith("/^") || !text.endsWith("$/")) return null;
  let route = text.slice(2, -2);
  route = route.replace(/\\\//g, "/").replace(/\(\[\^\/\]\+\)/g, ":id");
  if (!route.startsWith("/api/v1/") && !route.startsWith("/api/admin/")) return null;
  return normalizePath(route);
}

function extractRoutes(file: string): Set<string> {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const routes = new Set<string>();

  for (const match of source.matchAll(/path === "([^"]+)"/g)) {
    const route = match[1];
    if (
      route?.startsWith("/auth/") ||
      route?.startsWith("/api/v1/") ||
      route?.startsWith("/api/admin/")
    ) {
      routes.add(normalizePath(route));
    }
  }

  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const route = routeFromRegexLiteral(node.getText(sourceFile));
      if (route) routes.add(route);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return routes;
}

const expectedRoutes = new Set<string>(["/healthz", "/v1/opamp"]);
for (const file of routeFiles) {
  for (const route of extractRoutes(file)) {
    expectedRoutes.add(route);
  }
}

const docsText = docsFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const normalizedDocs = normalizePath(docsText);
const failures: string[] = [];

for (const route of [...expectedRoutes].sort()) {
  if (!normalizedDocs.includes(route)) {
    failures.push(`API docs do not mention implemented route: ${route}`);
  }
}

const docsWithoutHtmlLinks = docsText.replace(/\s(?:href|src)="[^"]*"/g, "");
const legacyPublicApiPattern = /\/api\/(?!v1(?:\/|\b)|admin(?:\/|\b))[a-z][a-z0-9/-]*/gi;
const legacyMatches = [...docsWithoutHtmlLinks.matchAll(legacyPublicApiPattern)].map(
  (match) => match[0],
);
if (legacyMatches.length > 0) {
  failures.push(
    `API docs mention deprecated non-v1/non-admin /api routes: ${[...new Set(legacyMatches)].join(", ")}`,
  );
}

const legacyRouteFamilyPattern = /\/api\/(?:tenants|configurations)(?:\/[a-z0-9:_/-]*)?/gi;
const legacyScanText = legacyScanFiles
  .map((file) => fs.readFileSync(file, "utf8").replace(/\s(?:href|src)="[^"]*"/g, ""))
  .join("\n");
const legacyRouteFamilyMatches = [...legacyScanText.matchAll(legacyRouteFamilyPattern)].map(
  (match) => match[0],
);
if (legacyRouteFamilyMatches.length > 0) {
  failures.push(
    `Docs or local scripts mention legacy API route families: ${[
      ...new Set(legacyRouteFamilyMatches),
    ].join(", ")}`,
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `API docs cover ${expectedRoutes.size} current route paths and no deprecated public /api routes.`,
);
