import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(rel: string): string {
  return readFileSync(join(root, "src", rel), "utf8");
}

test("Portal agents loads agent rows only for the expanded configuration", () => {
  const src = readSource("pages/portal/AgentsPage.tsx");
  const modelSrc = readSource("pages/portal/agents-page-model.ts");
  const agentQuery = src.match(/useConfigurationAgents\(config\.id,\s*\{[\s\S]*?\}\);/);

  assert.ok(agentQuery, "could not locate the AgentsPage useConfigurationAgents call");
  assert.match(
    agentQuery![0],
    /enabled:\s*expanded/,
    "AgentsPage must gate the per-config agent list query behind the expanded section",
  );
  assert.match(
    src,
    /expanded=\{expandedConfigId === c\.id\}/,
    "AgentsPage should keep the initial render metrics-only and expand at most one config",
  );
  assert.match(
    modelSrc,
    /const hasDriftStats = snapshot\.hasDriftStats/,
    "AgentsPage should not render drift counts unless the snapshot includes them",
  );
  assert.match(
    modelSrc,
    /const hasDegradedStats = snapshot\.hasDegradedStats/,
    "AgentsPage should not render degraded counts unless the snapshot includes them",
  );
  assert.match(
    src,
    /value=\{hasSnapshotStats \? totalAgentsLabel : "—"\}/,
    "AgentsPage should show missing snapshot metrics as unavailable, not as zero collectors",
  );
});

test("Portal overview renders collector health with non-misleading state", () => {
  const src = readSource("pages/portal/OverviewPage.tsx");

  assert.match(
    src,
    /<MetricCard[\s\S]*label="Healthy"[\s\S]*tone=\{/,
    "OverviewPage should derive healthy-card tone from collector health data",
  );
  assert.match(
    src,
    /normalizeFleetOverview/,
    "OverviewPage should consume normalized observed metrics instead of backend-shaped count fields directly",
  );
  assert.match(
    src,
    /<MetricCard/,
    "OverviewPage should render metrics through the shared app metric component",
  );
  assert.doesNotMatch(
    src,
    /const totalAgents =[\s\S]*?: 0;/,
    "OverviewPage must not synthesize missing fleet metrics as zero collectors",
  );
  assert.doesNotMatch(
    src,
    /onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/,
    "OverviewPage must not keep noop row click handlers",
  );
  assert.match(
    src,
    /Snapshot unavailable/,
    "OverviewPage should show missing fleet snapshots as unavailable, not as zero collectors",
  );
});
