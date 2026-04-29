import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPlan, changedFileDiffFilter, chunkFiles } from "./dev-check.ts";

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
