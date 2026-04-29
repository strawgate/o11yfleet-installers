import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

type CheckPlan = {
  formatFiles: string[];
  runAllFast: boolean;
  runDocsApiCheck: boolean;
  runWorkerTypegenCheck: boolean;
  runWorkerRuntime: boolean;
};

const args = new Set(process.argv.slice(2));
const staged = args.has("--staged");
const all = args.has("--all");

const rootFilesTriggeringFullCheck = new Set([
  ".github/workflows/ci.yml",
  ".husky/pre-commit",
  ".gitignore",
  ".prettierignore",
  "eslint.config.mjs",
  "justfile",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
]);

const formatExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const prettierChunkSize = 500;
const workerGeneratedTypesPath = "apps/worker/src/worker-configuration.d.ts";
export const changedFileDiffFilter = "--diff-filter=ACMRD";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function tryGit(args: string[]): string | null {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function listChangedFiles(): string[] {
  if (all) {
    return [];
  }

  if (staged) {
    return git(["diff", "--cached", "--name-only", changedFileDiffFilter])
      .split("\n")
      .filter(Boolean);
  }

  const base = tryGit(["merge-base", "HEAD", "origin/main"]);
  const branchFiles =
    base === null
      ? []
      : git(["diff", "--name-only", changedFileDiffFilter, `${base}...HEAD`])
          .split("\n")
          .filter(Boolean);
  const worktreeFiles = git(["diff", "--name-only", changedFileDiffFilter, "HEAD"])
    .split("\n")
    .filter(Boolean);
  const stagedFiles = git(["diff", "--cached", "--name-only", changedFileDiffFilter])
    .split("\n")
    .filter(Boolean);
  const untrackedFiles = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);

  return Array.from(
    new Set([...branchFiles, ...worktreeFiles, ...stagedFiles, ...untrackedFiles]),
  ).sort();
}

function isCodeOrConfigChange(file: string): boolean {
  return (
    rootFilesTriggeringFullCheck.has(file) ||
    file.startsWith(".github/workflows/") ||
    file.startsWith("apps/") ||
    file.startsWith("packages/") ||
    file.startsWith("scripts/") ||
    file.startsWith("tests/e2e/") ||
    file.startsWith("tests/load/")
  );
}

function affectsWorkerTypegen(file: string): boolean {
  return (
    file === "apps/worker/package.json" ||
    file === "apps/worker/wrangler.jsonc" ||
    file === workerGeneratedTypesPath
  );
}

function affectsWorkerRuntime(file: string): boolean {
  return (
    file === "apps/worker/package.json" ||
    file === "apps/worker/vitest.config.ts" ||
    file === "apps/worker/wrangler.jsonc" ||
    file.startsWith("apps/worker/src/") ||
    file.startsWith("apps/worker/test/") ||
    file.startsWith("packages/core/src/") ||
    file.startsWith("packages/db/src/") ||
    file.startsWith("packages/test-utils/src/")
  );
}

export function buildPlan(files: string[]): CheckPlan {
  if (all) {
    return {
      formatFiles: [],
      runAllFast: true,
      runDocsApiCheck: true,
      runWorkerTypegenCheck: true,
      runWorkerRuntime: true,
    };
  }

  const formatFiles = files
    .filter((file) => formatExtensions.has(extname(file)))
    .filter((file) => existsSync(file));

  const runAllFast = files.some(isCodeOrConfigChange);

  const runDocsApiCheck = files.some(
    (file) =>
      file.startsWith("apps/worker/src/routes/") ||
      file.startsWith("apps/site/public/docs/api/") ||
      file === "scripts/check-api-docs.ts",
  );

  const runWorkerTypegenCheck = files.some(affectsWorkerTypegen);
  const runWorkerRuntime = files.some(affectsWorkerRuntime);

  return { formatFiles, runAllFast, runDocsApiCheck, runWorkerTypegenCheck, runWorkerRuntime };
}

function run(command: string, commandArgs: string[]): void {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.error) {
    console.error(`Failed to start process: ${result.error.message}`);
  }
  if (result.signal) {
    console.error(`Process terminated by signal: ${result.signal}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function chunkFiles(files: string[], size = prettierChunkSize): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
}

function printPlan(plan: CheckPlan, files: string[]): void {
  if (all) {
    console.log("Running full local check.");
    return;
  }

  if (files.length === 0) {
    console.log(staged ? "No staged files to check." : "No changed files to check.");
    return;
  }

  console.log(`Changed files: ${files.length}`);
  if (plan.runAllFast) {
    console.log("Code/config change detected: running full fast lint/typecheck/test.");
  }
  if (plan.runWorkerRuntime) {
    console.log("Worker/runtime-adjacent change detected: running workerd runtime tests.");
  }
  if (plan.runDocsApiCheck) {
    console.log("API docs-adjacent change detected: checking generated API docs.");
  }
  if (plan.runWorkerTypegenCheck) {
    console.log("Worker typegen-adjacent change detected: checking generated Worker types.");
  }
}

function main(): void {
  const files = listChangedFiles();
  const plan = buildPlan(files);
  printPlan(plan, files);

  if (!all && files.length === 0) {
    process.exit(0);
  }

  for (const chunk of chunkFiles(plan.formatFiles)) {
    run("pnpm", ["prettier", "--ignore-unknown", "--check", ...chunk]);
  }

  if (plan.runWorkerTypegenCheck) {
    run("pnpm", ["--filter", "@o11yfleet/worker", "typegen:check"]);
  }

  if (plan.runAllFast) {
    run("pnpm", ["turbo", "lint", "typecheck", "test"]);
  }

  if (plan.runDocsApiCheck) {
    run("pnpm", ["tsx", "scripts/check-api-docs.ts"]);
  }

  if (plan.runWorkerRuntime) {
    run("pnpm", ["--filter", "@o11yfleet/worker", "test:runtime"]);
  }

  console.log("Dev check passed.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
