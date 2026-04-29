/**
 * Build script - compiles TypeScript to native binary via Bun
 *
 * Usage:
 *   bun run build              # Build for current platform
 */

import { spawnSync } from "child_process";
import { mkdirSync, chmodSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { exit } from "bun:process";

const BIN_DIR = join(process.cwd(), "bin");

function build(): void {
  const isWindows = process.platform === "win32";
  const outName = `o11yfleet-install${isWindows ? ".exe" : ""}`;
  const outFile = join(BIN_DIR, outName);

  console.log(`Building o11yfleet-install for ${process.platform}-${process.arch}...`);

  mkdirSync(BIN_DIR, { recursive: true });

  // Remove existing
  if (existsSync(outFile)) {
    rmSync(outFile);
  }

  // Build with bun build --compile
  const result = spawnSync("bun", [
    "build",
    "--compile",
    "--production",
    "--outfile=" + outFile,
    join(SRC_DIR, "src/cli.ts"),
  ], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error("Build failed");
    exit(1);
  }

  // Make executable on Unix
  if (!isWindows) {
    chmodSync(outFile, 0o755);
  }

  console.log(`  ✓ Built: ${outFile}`);
}

build();
