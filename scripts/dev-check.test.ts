import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPlan,
  buildSteps,
  changedFileDiffFilter,
  chunkFiles,
  formatDuration,
  parseOptions,
} from "./dev-check.ts";

test("plans the full fast suite for root config changes", () => {
  const plan = buildPlan(["package.json"]);

  assert.equal(plan.runAllFast, true);
  assert.equal(plan.runDocsApiCheck, false);
  assert.equal(plan.runScriptsLint, true);
  assert.equal(plan.runWorkerRuntime, false);
  assert.equal(plan.runWorkerTypegenCheck, false);
});

test("plans worker typegen and runtime checks for worker configuration changes", () => {
  const plan = buildPlan(["apps/worker/wrangler.jsonc"]);

  assert.equal(plan.runAllFast, true);
  assert.equal(plan.runWorkerTypegenCheck, true);
  assert.equal(plan.runWorkerRuntime, true);
});

test("plans worker typegen checks for worker package metadata changes", () => {
  const plan = buildPlan(["apps/worker/package.json"]);

  assert.equal(plan.runAllFast, true);
  assert.equal(plan.runWorkerTypegenCheck, true);
  assert.equal(plan.runWorkerRuntime, true);
});

test("plans worker typegen checks for generated worker configuration changes", () => {
  const plan = buildPlan(["apps/worker/src/worker-configuration.d.ts"]);

  assert.equal(plan.runAllFast, true);
  assert.equal(plan.runWorkerTypegenCheck, true);
  assert.equal(plan.runWorkerRuntime, true);
});

test("includes deletions when listing changed files for planning", () => {
  assert.match(changedFileDiffFilter, /D/);
});

test("plans docs API checks for worker route changes", () => {
  const plan = buildPlan(["apps/worker/src/routes/configs.ts"]);

  assert.equal(plan.runAllFast, true);
  assert.equal(plan.runDocsApiCheck, true);
  assert.equal(plan.runWorkerRuntime, true);
});

test("plans script linting for script changes", () => {
  const plan = buildPlan(["scripts/dev-check.ts"]);

  assert.equal(plan.runAllFast, true);
  assert.equal(plan.runScriptsLint, true);
});

test("does not run code checks for non-code docs changes", () => {
  const plan = buildPlan(["README.md"]);

  assert.equal(plan.formatFiles.includes("README.md"), true);
  assert.equal(plan.runAllFast, false);
  assert.equal(plan.runDocsApiCheck, false);
  assert.equal(plan.runScriptsLint, false);
  assert.equal(plan.runWorkerRuntime, false);
  assert.equal(plan.runWorkerTypegenCheck, false);
});

test("keeps extensionless dotfiles out of prettier file lists", () => {
  const plan = buildPlan([".prettierignore"]);

  assert.deepEqual(plan.formatFiles, []);
  assert.equal(plan.runAllFast, true);
});

test("chunks large format file lists for prettier", () => {
  const files = Array.from({ length: 1_201 }, (_, index) => `file-${index}.ts`);
  const chunks = chunkFiles(files, 500);

  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [500, 500, 201],
  );
  assert.equal(chunks.flat().length, files.length);
  assert.equal(chunks.flat()[1_200], "file-1200.ts");
});

test("builds ordered check steps with human reasons", () => {
  const plan = buildPlan(["scripts/dev-check.ts", "apps/worker/src/routes/auth.ts"]);
  const steps = buildSteps(plan);

  assert.deepEqual(
    steps.map((step) => step.id),
    ["format-1", "scripts-lint", "fast-suite", "type-aware-lint", "api-docs", "worker-runtime"],
  );
  assert.match(steps[0]?.reason ?? "", /2 changed files/);
});

test("formats check durations for logs", () => {
  assert.equal(formatDuration(999), "999ms");
  assert.equal(formatDuration(1_250), "1.3s");
});

test("requires a concrete --since revision", () => {
  assert.throws(() => parseOptions(["--since"]), /--since requires/);
  assert.throws(() => parseOptions(["--since", "--json"]), /--since requires/);
  assert.equal(parseOptions(["--since", "origin/main"]).since, "origin/main");
});

test("rejects conflicting changed-file modes", () => {
  assert.throws(() => parseOptions(["--all", "--staged"]), /mutually exclusive/);
  assert.throws(() => parseOptions(["--all", "--since", "origin/main"]), /mutually exclusive/);
  assert.throws(() => parseOptions(["--staged", "--since", "origin/main"]), /mutually exclusive/);
});
