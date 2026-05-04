import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);

  const openBrace = source.indexOf("{", start);
  expect(openBrace, `${name} should have a body`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(openBrace, index + 1);
  }
  throw new Error(`${name} body did not terminate`);
}

describe("UI data-source policy", () => {
  it("keeps portal overview on Analytics Engine snapshots without Config DO fan-out fallback", () => {
    const source = readRepoFile("apps/worker/src/routes/v1/tenant.ts");
    const overview = functionBody(source, "handleGetOverview");

    expect(overview).not.toContain("fanOutPerDoStats");
    expect(overview).toContain("latestSnapshotForTenant");
    expect(overview).toContain("metrics_source");
    expect(overview).not.toContain('stub.fetch(new Request("http://internal/stats"))');
    expect(overview).not.toContain("Promise.all(");
  });

  it("keeps admin fleet counters on Analytics Engine instead of D1 agent rollups", () => {
    const healthSource = readRepoFile("apps/worker/src/routes/admin/health.ts");
    const tenantsSource = readRepoFile("apps/worker/src/routes/admin/tenants.ts");
    const overview = functionBody(healthSource, "handleAdminOverview");
    const health = functionBody(healthSource, "handleHealthCheck");
    const tenants = functionBody(tenantsSource, "handleListTenants");

    expect(healthSource).toContain("currentFleetSummary");
    expect(healthSource).toContain("currentFleetSummaryByTenant");
    expect(overview).not.toContain("agent_summaries");
    expect(health).not.toContain("agent_summaries");
    expect(tenants).not.toContain("agent_summaries");
    expect(overview).not.toContain("CONFIG_DO");
    expect(health).not.toContain("CONFIG_DO.get");
    expect(tenants).not.toContain("CONFIG_DO");
  });
});
