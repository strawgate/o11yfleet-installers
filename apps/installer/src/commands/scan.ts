/**
 * Scan command - detects existing OTel collectors on the system.
 */

import { basename, join } from "path";
import type { FileSystem, ProcessRunner, Logger, Platform, ScanResult } from "../core/types.js";
import { getSystemPaths } from "../core/index.js";

export interface ScannerContext {
  fs: FileSystem;
  process: ProcessRunner;
  logger: Logger;
  platform: Platform;
  homeDir: string;
}

/**
 * Scan for existing OTel collectors.
 */
export async function scan(ctx: ScannerContext): Promise<ScanResult[]> {
  const { fs, process, logger, platform, homeDir } = ctx;
  const results: ScanResult[] = [];
  const searchPaths = getSystemPaths(homeDir, platform.os);

  logger.info(`Scanning for otelcol-contrib in ${searchPaths.length} paths...`);

  // Common binary names
  const binaryNames =
    platform.os === "windows"
      ? ["otelcol-contrib.exe", "otelcol.exe"]
      : ["otelcol-contrib", "otelcol"];

  // Check each path
  for (const searchPath of searchPaths) {
    if (!(await fs.exists(searchPath))) {
      continue;
    }

    try {
      const entries = await fs.listDir(searchPath);

      for (const entry of entries) {
        const fullPath = join(searchPath, entry);

        // Check if it's a file (not directory)
        try {
          const stat = await fs.exists(fullPath);
          if (!stat) continue;
        } catch {
          continue;
        }

        // Check if name matches
        for (const binName of binaryNames) {
          if (entry === binName) {
            // Get version if possible
            let version: string | null = null;
            try {
              // Try to get version
              const output = process.execSync(platform.os === "windows" ? fullPath : fullPath, [
                "--version",
              ]);
              version = parseVersionFromOutput(output);
            } catch {
              // Version check failed - that's okay
            }

            // Check if running
            const running = await isProcessRunning(process, entry);

            results.push({
              path: fullPath,
              version,
              running,
            });
          }
        }
      }
    } catch {
      // Path not readable - skip
    }
  }

  // Also check common installation directories
  const commonInstallDirs =
    platform.os === "windows"
      ? ["C:\\Program Files\\O11yFleet", "C:\\Program Files\\opentelemetry-collector"]
      : ["/opt/o11yfleet", "/opt/opentelemetry-collector"];

  for (const dir of commonInstallDirs) {
    if (!(await fs.exists(dir))) continue;

    const binPath =
      platform.os === "windows"
        ? join(dir, "bin", "otelcol-contrib.exe")
        : join(dir, "bin", "otelcol-contrib");

    if (await fs.exists(binPath)) {
      const alreadyScanned = results.some((r) => r.path === binPath);
      if (!alreadyScanned) {
        let version: string | null = null;
        try {
          const output = process.execSync(binPath, ["--version"]);
          version = parseVersionFromOutput(output);
        } catch {}

        const running = await isProcessRunning(process, basename(binPath));

        results.push({
          path: binPath,
          version,
          running,
        });
      }
    }
  }

  return results;
}

function parseVersionFromOutput(output: string): string | null {
  // Try to extract version from output like "otelcol-contrib version 0.114.0"
  const match = output.match(/otelcol-contrib.*?(\d+\.\d+\.\d+)/);
  return match?.[1] || null;
}

async function isProcessRunning(process: ProcessRunner, name: string): Promise<boolean> {
  try {
    if (process.currentUid() === 0) {
      // Root - can check running processes
      const output = process.execSync(
        process.currentUid() === 0 ? "ps" : "pgrep",
        process.currentUid() === 0 ? ["-C", name] : ["-f", name],
      );
      return output.includes(name);
    }
  } catch {
    // Process check failed - assume not running
  }
  return false;
}

/**
 * Print scan results.
 */
export function printScanResults(results: ScanResult[], logger: Logger): void {
  if (results.length === 0) {
    logger.info("No existing OTel collectors found.");
    return;
  }

  logger.ok(`Found ${results.length} OTel collector(s):`);
  console.log("");

  for (const result of results) {
    const status = result.running ? "running" : "installed";
    const version = result.version ? `v${result.version}` : "unknown version";
    console.log(`  ${result.path}`);
    console.log(`    Status: ${status} | ${version}`);
  }

  console.log("");
  logger.info("Use --enroll to configure an existing collector.");
}
