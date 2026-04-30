import fs from "node:fs";
import ts from "typescript";

const routeFiles = [
  "apps/worker/src/routes/auth.ts",
  "apps/worker/src/routes/v1/index.ts",
] as const;
const adminRouteFiles = ["apps/worker/src/routes/admin/index.ts"] as const;

const docsFiles = [
  "apps/site/public/docs/api/authentication.html",
  "apps/site/public/docs/api/endpoints.html",
] as const;
const adminPortalFiles = ["apps/site/src/pages/admin/ApiReferencePage.tsx"] as const;

const legacyScanFiles = [
  ...docsFiles,
  "README.md",
  "apps/site/public/docs/getting-started.html",
  "apps/site/public/docs/how-to/install.html",
  "docs/research/portal-design-notes.md",
  ".github/workflows/ci.yml",
  "apps/worker/src/index.ts",
  "apps/worker/test/api.test.ts",
  "apps/worker/test/beta-features.test.ts",
  "apps/worker/test/e2e.test.ts",
  "apps/worker/test/helpers.ts",
  "tests/e2e/src/helpers.ts",
  "tests/load/src/load-test.ts",
  "tests/load/src/smoke-test.ts",
  "tests/ui/src/dashboard.test.ts",
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
  if (!route.startsWith("/api/")) return null;
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
      route?.startsWith("/api/admin/") ||
      route?.startsWith("/api/tenants") ||
      route?.startsWith("/api/configurations")
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
const expectedAdminRoutes = new Set<string>();
for (const file of adminRouteFiles) {
  for (const route of extractRoutes(file)) {
    expectedAdminRoutes.add(route);
  }
}

const docsText = docsFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const normalizedDocs = normalizePath(docsText);
const adminPortalText = adminPortalFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const normalizedAdminPortal = normalizePath(adminPortalText);
const failures: string[] = [];

for (const route of [...expectedRoutes].sort()) {
  if (!normalizedDocs.includes(route)) {
    failures.push(`Public API docs do not mention implemented route: ${route}`);
  }
}

for (const route of [...expectedAdminRoutes].sort()) {
  if (!normalizedAdminPortal.includes(route)) {
    failures.push(`Admin portal API reference does not mention implemented route: ${route}`);
  }
}

const docsWithoutHtmlLinks = docsText.replace(/\s(?:href|src)="[^"]*"/g, "");
const publicAdminApiPattern = /\/api\/admin(?:\/[a-z0-9:_/-]*)?/gi;
const publicAdminMatches = [...docsWithoutHtmlLinks.matchAll(publicAdminApiPattern)].map(
  (match) => match[0],
);
if (publicAdminMatches.length > 0) {
  failures.push(
    `Public docs mention admin API routes that should live only in the admin portal: ${[
      ...new Set(publicAdminMatches.map(normalizePath)),
    ].join(", ")}`,
  );
}

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
const legacyRouteFamilyExactPattern = /^\/api\/(?:tenants|configurations)(?:\/[a-z0-9:_/-]*)?$/i;
const legacyScanText = legacyScanFiles
  .map((file) => fs.readFileSync(file, "utf8").replace(/\s(?:href|src)="[^"]*"/g, ""))
  .join("\n");
const legacyRouteFamilyMatches = [...legacyScanText.matchAll(legacyRouteFamilyPattern)].map(
  (match) => match[0],
);
const legacyRouteFamilyRegexMatches = legacyScanFiles
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
  .flatMap((file) => [...extractRoutes(file)])
  .filter((route) => legacyRouteFamilyExactPattern.test(route));
legacyRouteFamilyMatches.push(...legacyRouteFamilyRegexMatches);
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
  `Public API docs cover ${expectedRoutes.size} routes; admin portal covers ${expectedAdminRoutes.size} admin routes.`,
);
