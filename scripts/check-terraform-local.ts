#!/usr/bin/env -S npx tsx
/**
 * Local-equivalent of the terraform fast-job checks in CI:
 *
 *   1. terraform fmt -check -recursive infra/terraform/
 *   2. tflint --init && tflint --recursive --format compact (in infra/terraform)
 *   3. terraform-docs --config .terraform-docs.yml infra/terraform/
 *      (with a git-diff check after to fail on uncommitted README drift)
 *
 * Each tool is optional: if it's not installed locally we emit a friendly
 * "install via …" hint and skip that check. CI installs all three so any
 * actual drift is still caught at PR time — this script is a faster local
 * loop that catches obvious mistakes before the push.
 *
 * Wired in by scripts/dev-check.ts when any of the following changes:
 *   - infra/terraform/**
 *   - infra/terraform/.tflint.hcl
 *   - infra/terraform/.terraform-docs.yml
 *   - this script
 */
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tfDir = resolve(repoRoot, "infra/terraform");

let failed = false;

function which(cmd: string): boolean {
  // Use the `which` binary directly so we don't need shell:true (which
  // emits a node DEP0190 deprecation warning).
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function step(name: string, run: () => void): void {
  process.stdout.write(`\n[terraform-local] ${name}\n`);
  try {
    run();
    process.stdout.write(`[terraform-local] ${name} ✓\n`);
  } catch (err) {
    failed = true;
    process.stdout.write(`[terraform-local] ${name} ✗ ${(err as Error).message}\n`);
  }
}

step("terraform fmt -check -recursive", () => {
  if (!which("terraform")) {
    process.stdout.write(
      "  (skip) terraform CLI not on PATH. Install via `brew install terraform`.\n",
    );
    return;
  }
  const result = spawnSync("terraform", ["fmt", "-check", "-recursive", tfDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `terraform fmt found unformatted files. Run \`terraform fmt -recursive ${tfDir}\` to fix.`,
    );
  }
});

step("tflint", () => {
  if (!which("tflint")) {
    process.stdout.write("  (skip) tflint not on PATH. Install via `brew install tflint`.\n");
    return;
  }
  const init = spawnSync("tflint", ["--init"], { cwd: tfDir, stdio: "inherit" });
  if (init.status !== 0) throw new Error("tflint --init failed.");
  const run = spawnSync("tflint", ["--recursive", "--format", "compact"], {
    cwd: tfDir,
    stdio: "inherit",
  });
  if (run.status !== 0) throw new Error("tflint reported issues (see above).");
});

step("terraform-docs (fail-on-diff)", () => {
  if (!which("terraform-docs")) {
    process.stdout.write(
      "  (skip) terraform-docs not on PATH. Install via `brew install terraform-docs`.\n",
    );
    return;
  }
  // First snapshot the README so we can detect a diff after generation.
  const readmeBefore = execFileSync("git", ["diff", "--no-color", "infra/terraform/README.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const gen = spawnSync(
    "terraform-docs",
    ["--config", "infra/terraform/.terraform-docs.yml", "infra/terraform/"],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (gen.status !== 0) throw new Error("terraform-docs failed to generate.");
  const readmeAfter = execFileSync("git", ["diff", "--no-color", "infra/terraform/README.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (readmeAfter !== readmeBefore) {
    throw new Error(
      `terraform-docs produced new content for infra/terraform/README.md. The generated section is now updated locally — \`git add\` it and re-commit.`,
    );
  }
});

if (failed) process.exit(1);
process.stdout.write("\n[terraform-local] all checks passed\n");
