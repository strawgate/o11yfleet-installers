/**
 * Uninstall command - removes the O11yFleet collector and service.
 */

import type { FileSystem, ProcessRunner, Logger, Platform } from "../core/types.js";
import { getDefaultInstallDir } from "../core/index.js";

export interface UninstallContext {
  fs: FileSystem;
  process: ProcessRunner;
  logger: Logger;
  platform: Platform;
}

export interface UninstallOptions {
  installDir?: string;
  dryRun?: boolean;
}

/**
 * Uninstall the O11yFleet collector.
 */
export async function uninstall(
  ctx: UninstallContext,
  options: UninstallOptions = {},
): Promise<boolean> {
  const { fs, process, logger, platform } = ctx;
  const installDir = options.installDir ?? getDefaultInstallDir(platform.os);

  logger.info("Uninstalling O11yFleet collector...");

  // Stop and disable service
  if (platform.os === "linux") {
    await stopSystemdService(process, logger);
    await removeSystemdService(logger);
  } else if (platform.os === "darwin") {
    await stopLaunchdService(process, logger);
    await removeLaunchdService(logger);
  } else if (platform.os === "windows") {
    await stopWindowsService(process, logger);
  }

  // Remove installation directory
  if (!options.dryRun) {
    try {
      await fs.remove(installDir);
      logger.ok(`Removed ${installDir}`);
    } catch (error) {
      logger.warn(`Could not remove ${installDir}: ${error}`);
    }
  } else {
    logger.info(`Dry run: would remove ${installDir}`);
  }

  logger.ok("O11yFleet collector uninstalled.");
  return true;
}

async function stopSystemdService(process: ProcessRunner, logger: Logger): Promise<void> {
  try {
    await process.exec("sudo", ["systemctl", "stop", "o11yfleet-collector"]);
    logger.info("Stopped o11yfleet-collector service");
  } catch {
    // Service might not be running
  }

  try {
    await process.exec("sudo", ["systemctl", "disable", "o11yfleet-collector"]);
    logger.info("Disabled o11yfleet-collector service");
  } catch {
    // Service might not be enabled
  }
}

async function removeSystemdService(logger: Logger): Promise<void> {
  const { execSync } = await import("child_process");

  try {
    execSync("sudo rm -f /etc/systemd/system/o11yfleet-collector.service", {
      stdio: "pipe",
    });
    execSync("sudo systemctl daemon-reload", { stdio: "pipe" });
    logger.info("Removed systemd service file");
  } catch {
    // Service file might not exist
  }
}

async function stopLaunchdService(process: ProcessRunner, logger: Logger): Promise<void> {
  try {
    await process.exec("sudo", ["launchctl", "bootout", "system/com.o11yfleet.collector"]);
    logger.info("Stopped com.o11yfleet.collector service");
  } catch {
    // Service might not be running
  }
}

async function removeLaunchdService(logger: Logger): Promise<void> {
  const { execSync } = await import("child_process");

  try {
    execSync("sudo rm -f /Library/LaunchDaemons/com.o11yfleet.collector.plist", {
      stdio: "pipe",
    });
    logger.info("Removed launchd service file");
  } catch {
    // Service file might not exist
  }
}

async function stopWindowsService(process: ProcessRunner, logger: Logger): Promise<void> {
  try {
    await process.exec("sc", ["stop", "o11yfleet-collector"]);
    logger.info("Stopped o11yfleet-collector service");
  } catch {
    // Service might not exist or not be running
  }

  try {
    await process.exec("sc", ["delete", "o11yfleet-collector"]);
    logger.info("Deleted o11yfleet-collector service");
  } catch {
    // Service might not exist
  }
}
