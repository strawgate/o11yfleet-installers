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
    src,
    /const hasDriftStats = typeof statsData\?\.drifted_agents === "number"/,
    "AgentsPage should not render drift counts unless the snapshot includes them",
  );
  assert.match(
    src,
    /const hasDegradedStats = typeof statsData\?\.status_counts\?\.\["degraded"\] === "number"/,
    "AgentsPage should not render degraded counts unless the snapshot includes them",
  );
  assert.match(
    src,
    /\{hasSnapshotStats \? agentMetrics\.totalAgents\.toLocaleString\(\) : "—"\}/,
    "AgentsPage should show missing snapshot metrics as unavailable, not as zero collectors",
  );
});

test("Portal overview renders collector health with non-misleading state", () => {
  const src = readSource("pages/portal/OverviewPage.tsx");

  assert.match(
    src,
    /const healthyTagClass =/,
    "OverviewPage should derive health tag styling from collector health counts",
  );
  assert.doesNotMatch(
    src,
    /<span className="tag tag-ok"[^>]*>\s*\{metrics\.healthyAgents\} healthy/,
    "OverviewPage must not always style collector health as success",
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
