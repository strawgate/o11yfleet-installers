/**
 * O11yFleet Installer CLI
 *
 * A cross-platform installer for the OTel collector with OpAMP extension.
 * Supports Linux (systemd), macOS (launchd), and Windows.
 */

import { parseArgs } from "util";
import { platform, arch, homedir as getHomedir } from "os";
import { detectPlatform } from "./core/index.js";
import { createLogger, nodeFs, nodeProcess, nodeHttp } from "./adapters/index.js";
import { install, scan, printScanResults, enroll, uninstall } from "./commands/index.js";

const VERSION = "1.0.0";

function printUsage(): void {
  console.log(`
O11yFleet Collector Installer v${VERSION}

Usage:
  o11yinstaller <command> [options]

Commands:
  install     Download and install the OTel collector with OpAMP
  scan        Find existing OTel collectors on the system
  enroll      Configure an existing collector to connect to O11yFleet
  uninstall   Remove the O11yFleet collector and service

Install Options:
  --token <TOKEN>        Enrollment token (required, starts with fp_enroll_)
  --version <VERSION>    OTel collector version (default: 0.114.0)
  --endpoint <URL>       OpAMP server endpoint
  --dir <PATH>           Installation directory
  --dry-run              Download and verify only, don't install
  --skip-service         Don't install systemd/launchd service

Scan Options:
  (no options required)

Enroll Options:
  --collector <PATH>     Path to existing collector binary
  --token <TOKEN>        Enrollment token
  --endpoint <URL>       OpAMP server endpoint

Uninstall Options:
  --dir <PATH>           Installation directory (default: /opt/o11yfleet)
  --dry-run              Show what would be removed

Global Options:
  --help, -h             Show this help
  --version, -v          Show version
  --quiet, -q            Suppress output
  --json                 Output as JSON

Examples:
  # Install with enrollment token
  o11yinstaller install --token fp_enroll_abc123...

  # Scan for existing collectors
  o11yinstaller scan

  # Enroll existing collector
  o11yinstaller enroll --collector /usr/bin/otelcol-contrib --token fp_enroll_...

  # Uninstall
  o11yinstaller uninstall

For more documentation, visit https://o11yfleet.com/docs
`);
}

/**
 * Simple argument parser that extracts command and command-specific args.
 * Handles global flags that can appear before or after the command.
 */
function parseArgsSimple(args: string[]): {
  command: string | null;
  commandArgs: string[];
  globalFlags: { help?: boolean; version?: boolean; quiet?: boolean; json?: boolean };
} {
  const globalFlags: { help?: boolean; version?: boolean; quiet?: boolean; json?: boolean } = {};
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      globalFlags.help = true;
    } else if (arg === "--version" || arg === "-v") {
      globalFlags.version = true;
    } else if (arg === "--quiet" || arg === "-q") {
      globalFlags.quiet = true;
    } else if (arg === "--json") {
      globalFlags.json = true;
    } else {
      remaining.push(arg);
    }
  }

  // First remaining arg is the command
  const command = remaining[0] || null;
  const commandArgs = remaining.slice(1);

  return { command, commandArgs, globalFlags };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Simple parse to extract command
  const { command, commandArgs, globalFlags } = parseArgsSimple(args);

  const logger = createLogger({
    quiet: globalFlags.quiet,
    json: globalFlags.json,
  });

  // Check global flags
  if (globalFlags.help) {
    printUsage();
    process.exit(0);
  }

  if (globalFlags.version) {
    console.log(`o11yinstaller v${VERSION}`);
    process.exit(0);
  }

  if (!command) {
    logger.error("No command specified. Use --help for usage.");
    process.exit(1);
  }

  const detectedPlatform = detectPlatform(platform(), arch());
  const homeDir = getHomedir();
  const ctx = {
    fs: nodeFs,
    process: nodeProcess,
    http: nodeHttp,
    logger,
    platform: detectedPlatform,
    homeDir,
  };

  try {
    switch (command) {
      case "install": {
        const parsed = parseArgs({
          args: commandArgs,
          options: {
            token: { type: "string" },
            version: { type: "string" },
            endpoint: { type: "string" },
            dir: { type: "string" },
            "dry-run": { type: "boolean" },
            "skip-service": { type: "boolean" },
          },
          allowPositionals: false,
        });

        if (!parsed.values.token) {
          logger.error("--token is required");
          printUsage();
          process.exit(1);
        }

        const result = await install(ctx, {
          token: parsed.values.token as string,
          version: parsed.values.version as string | undefined,
          endpoint: parsed.values.endpoint as string | undefined,
          installDir: parsed.values.dir as string | undefined,
          dryRun: parsed.values["dry-run"] as boolean | undefined,
          skipService: parsed.values["skip-service"] as boolean | undefined,
        });

        if (!result.success) {
          process.exit(1);
        }

        logger.header("O11yFleet Collector");
        logger.ok(`Installation ${result.isUpgrade ? "upgraded" : "complete"}!`);
        break;
      }

      case "scan": {
        const results = await scan(ctx);
        printScanResults(results, logger);
        break;
      }

      case "enroll": {
        const parsed = parseArgs({
          args: commandArgs,
          options: {
            collector: { type: "string" },
            token: { type: "string" },
            endpoint: { type: "string" },
          },
          allowPositionals: false,
        });

        if (!parsed.values.collector) {
          logger.error("--collector is required");
          process.exit(1);
        }

        if (!parsed.values.token) {
          logger.error("--token is required");
          process.exit(1);
        }

        const enrollCtx = { fs: nodeFs, logger };
        const success = await enroll(enrollCtx, {
          collectorPath: parsed.values.collector as string,
          token: parsed.values.token as string,
          endpoint: parsed.values.endpoint as string | undefined,
        });

        if (!success) {
          process.exit(1);
        }
        break;
      }

      case "uninstall": {
        const parsed = parseArgs({
          args: commandArgs,
          options: {
            dir: { type: "string" },
            "dry-run": { type: "boolean" },
          },
          allowPositionals: false,
        });

        const success = await uninstall(ctx, {
          installDir: parsed.values.dir as string | undefined,
          dryRun: parsed.values["dry-run"] as boolean | undefined,
        });

        if (!success) {
          process.exit(1);
        }
        break;
      }

      default:
        logger.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    logger.error(`Error: ${error}`);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
