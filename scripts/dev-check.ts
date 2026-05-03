import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

type CheckPlan = {
  formatFiles: string[];
  runAllFast: boolean;
  runTypeAwareLint: boolean;
  runDocsApiCheck: boolean;
  runScriptsLint: boolean;
  runWorkerTypegenCheck: boolean;
  runWorkerRuntime: boolean;
  runCronDriftCheck: boolean;
  runTerraformLocal: boolean;
};

type DevCheckOptions = {
  all: boolean;
  json: boolean;
  since: string | null;
  staged: boolean;
};

type CheckStep = {
  id: string;
  command: string;
  args: string[];
  reason: string;
};

export function parseOptions(argv = process.argv.slice(2)): DevCheckOptions {
  const args = new Set(argv);
  const sinceIndex = argv.indexOf("--since");
  const since = sinceIndex === -1 ? null : (argv[sinceIndex + 1] ?? null);
  if (sinceIndex !== -1 && (!since || since.startsWith("-"))) {
    throw new Error("--since requires a git revision, for example: --since origin/main");
  }
  const diffModeCount = [args.has("--all"), args.has("--staged"), since !== null].filter(
    Boolean,
  ).length;
  if (diffModeCount > 1) {
    throw new Error("--all, --staged and --since are mutually exclusive; pass only one");
  }

  return {
    all: args.has("--all"),
    json: args.has("--json"),
    since,
    staged: args.has("--staged"),
  };
}

const rootFilesTriggeringFullCheck = new Set([
  ".github/workflows/ci.yml",
  ".husky/pre-commit",
  ".gitignore",
  ".prettierignore",
  ".oxlintrc.json",
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

function defaultDiffBase(): string {
  const base = tryGit(["merge-base", "HEAD", "origin/main"]);
  if (base) return base;
  throw new Error(
    "Could not determine merge-base with origin/main. Run `git fetch origin`, pass `--since <rev>`, or use `--all`.",
  );
}

function listChangedFiles(options: DevCheckOptions): string[] {
  if (options.all) {
    return [];
  }

  if (options.staged) {
    return git(["diff", "--cached", "--name-only", changedFileDiffFilter])
      .split("\n")
      .filter(Boolean);
  }

  const base = options.since ?? defaultDiffBase();
  const branchFiles = git(["diff", "--name-only", changedFileDiffFilter, `${base}...HEAD`])
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

export function buildPlan(files: string[], options: DevCheckOptions = parseOptions([])): CheckPlan {
  if (options.all) {
    return {
      formatFiles: [],
      runAllFast: true,
      runTypeAwareLint: true,
      runDocsApiCheck: true,
      runScriptsLint: true,
      runWorkerTypegenCheck: true,
      runWorkerRuntime: true,
      runCronDriftCheck: true,
      runTerraformLocal: true,
    };
  }

  const formatFiles = files
    .filter((file) => formatExtensions.has(extname(file)))
    .filter((file) => existsSync(file));

  const runAllFast = files.some(isCodeOrConfigChange);

  // Run type-aware lint when TypeScript files change (catches async/void return issues)
  const runTypeAwareLint = files.some((file) => file.endsWith(".ts") || file.endsWith(".tsx"));

  const runDocsApiCheck = files.some(
    (file) =>
      file.startsWith("apps/worker/src/routes/") ||
      file.startsWith("apps/site/public/docs/api/") ||
      file === "scripts/check-api-docs.ts",
  );

  const runScriptsLint = files.some(
    (file) =>
      file.startsWith("scripts/") ||
      file === ".oxlintrc.json" ||
      file === "package.json" ||
      file === "pnpm-lock.yaml",
  );
  const runWorkerTypegenCheck = files.some(affectsWorkerTypegen);
  const runWorkerRuntime = files.some(affectsWorkerRuntime);
  const runCronDriftCheck = files.some(
    (file) =>
      file === "apps/worker/wrangler.jsonc" ||
      file === "infra/terraform/variables.tf" ||
      file === "scripts/check-cron-drift.ts",
  );
  const runTerraformLocal = files.some(
    (file) => file.startsWith("infra/terraform/") || file === "scripts/check-terraform-local.ts",
  );

  return {
    formatFiles,
    runAllFast,
    runTypeAwareLint,
    runDocsApiCheck,
    runScriptsLint,
    runWorkerTypegenCheck,
    runWorkerRuntime,
    runCronDriftCheck,
    runTerraformLocal,
  };
}

export function buildSteps(plan: CheckPlan): CheckStep[] {
  const steps: CheckStep[] = [];

  for (const [index, chunk] of chunkFiles(plan.formatFiles).entries()) {
    steps.push({
      id: `format-${index + 1}`,
      command: "pnpm",
      args: ["prettier", "--ignore-unknown", "--check", ...chunk],
      reason: `format check for ${chunk.length} changed file${chunk.length === 1 ? "" : "s"}`,
    });
  }

  if (plan.runWorkerTypegenCheck) {
    steps.push({
      id: "worker-typegen",
      command: "pnpm",
      args: ["--filter", "@o11yfleet/worker", "typegen:check"],
      reason: "worker binding/typegen inputs changed",
    });
  }

  if (plan.runScriptsLint) {
    steps.push({
      id: "scripts-lint",
      command: "pnpm",
      args: ["lint:scripts"],
      reason: "repo maintenance scripts or lint config changed",
    });
  }

  if (plan.runAllFast) {
    steps.push({
      id: "fast-suite",
      command: "pnpm",
      args: ["turbo", "lint", "typecheck", "test"],
      reason: "code or shared config changed",
    });
  }

  if (plan.runTypeAwareLint) {
    steps.push({
      id: "type-aware-lint",
      command: "pnpm",
      args: ["lint:type-aware"],
      reason: "TypeScript files changed; running type-aware lint",
    });
  }

  if (plan.runDocsApiCheck) {
    steps.push({
      id: "api-docs",
      command: "pnpm",
      args: ["tsx", "scripts/check-api-docs.ts"],
      reason: "worker routes or API docs changed",
    });
  }

  if (plan.runCronDriftCheck) {
    steps.push({
      id: "cron-drift",
      command: "pnpm",
      args: ["tsx", "scripts/check-cron-drift.ts"],
      reason: "wrangler.jsonc or terraform variables.tf changed",
    });
  }

  if (plan.runTerraformLocal) {
    steps.push({
      id: "terraform-local",
      command: "pnpm",
      args: ["tsx", "scripts/check-terraform-local.ts"],
      reason: "infra/terraform/ changed",
    });
  }

  if (plan.runWorkerRuntime) {
    steps.push({
      id: "worker-runtime",
      command: "pnpm",
      args: ["--filter", "@o11yfleet/worker", "test:runtime"],
      reason: "worker runtime-adjacent files changed",
    });
  }

  return steps;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

function runStep(step: CheckStep): number {
  const started = Date.now();
  console.log(`\n[dev-check] ${step.id}: ${step.reason}`);
  console.log(`$ ${[step.command, ...step.args].join(" ")}`);
  const result = spawnSync(step.command, step.args, { stdio: "inherit" });
  const elapsed = Date.now() - started;
  if (result.error) {
    console.error(`Failed to start process: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`Process terminated by signal: ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log(`[dev-check] ${step.id} passed in ${formatDuration(elapsed)}`);
  return elapsed;
}

export function chunkFiles(files: string[], size = prettierChunkSize): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
}

function printPlan(plan: CheckPlan, files: string[], options: DevCheckOptions): void {
  if (options.all) {
    console.log("Running full local check.");
    return;
  }

  if (files.length === 0) {
    console.log(options.staged ? "No staged files to check." : "No changed files to check.");
    return;
  }

  console.log(`Changed files: ${files.length}`);
  if (options.since) {
    console.log(`Diff base: ${options.since}`);
  }
  console.log("Planned checks:");
  const checks = [
    [
      "format",
      plan.formatFiles.length > 0,
      `${plan.formatFiles.length} changed formattable file(s)`,
    ],
    ["worker-typegen", plan.runWorkerTypegenCheck, "worker typegen input changed"],
    ["scripts-lint", plan.runScriptsLint, "repo maintenance script changed"],
    ["fast-suite", plan.runAllFast, "code/config changed"],
    ["type-aware-lint", plan.runTypeAwareLint, "TypeScript files changed"],
    ["api-docs", plan.runDocsApiCheck, "API docs/route changed"],
    ["worker-runtime", plan.runWorkerRuntime, "worker runtime-adjacent changed"],
  ] as const;
  for (const [name, enabled, reason] of checks) {
    console.log(`  ${enabled ? "run " : "skip"} ${name.padEnd(14)} ${reason}`);
  }

  if (plan.runAllFast) {
    console.log("Code/config change detected: running full fast lint/typecheck/test.");
  }
  if (plan.runWorkerRuntime) {
    console.log("Worker/runtime-adjacent change detected: running workerd runtime tests.");
  }
  if (plan.runDocsApiCheck) {
    console.log("API docs-adjacent change detected: checking generated API docs.");
  }
  if (plan.runScriptsLint) {
    console.log("Script/tooling change detected: linting repo maintenance scripts.");
  }
  if (plan.runWorkerTypegenCheck) {
    console.log("Worker typegen-adjacent change detected: checking generated Worker types.");
  }
}

function main(): void {
  const options = parseOptions();
  const files = listChangedFiles(options);
  const plan = buildPlan(files, options);
  const steps = buildSteps(plan);

  if (options.json) {
    console.log(JSON.stringify({ files, options, plan, steps }, null, 2));
    return;
  }

  printPlan(plan, files, options);

  if (!options.all && files.length === 0) {
    process.exit(0);
  }

  let totalMs = 0;
  for (const step of steps) {
    totalMs += runStep(step);
  }

  console.log(`\nDev check passed in ${formatDuration(totalMs)}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
