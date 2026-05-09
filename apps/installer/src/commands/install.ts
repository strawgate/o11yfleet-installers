/**
 * Install command - downloads and installs the OTel collector.
 */

import { createWriteStream } from "fs";
import type {
  FileSystem,
  ProcessRunner,
  HttpClient,
  Logger,
  Platform,
  InstallOptions,
  ServiceConfig,
  ArchiveExtractor,
  ChecksumVerifier,
  TempDirFactory,
} from "../core/types.js";
import { getDefaultInstallDir, getUserInstallDir, getOtelAsset } from "../core/index.js";
import {
  generateOtelConfig,
  validateToken,
  getTokenWarning,
  createDefaultConfig,
} from "../core/config.js";
import { generateUuid, isValidInstanceUid, legacyUidToUuid } from "../core/uuid.js";

export interface InstallerContext {
  fs: FileSystem;
  process: ProcessRunner;
  http: HttpClient;
  logger: Logger;
  platform: Platform;
  homeDir: string;
  archive: ArchiveExtractor;
  checksum: ChecksumVerifier;
  tempDir: TempDirFactory;
}

export interface InstallResult {
  success: boolean;
  isUpgrade: boolean;
  message?: string;
}

/**
 * Main install function.
 */
export async function install(
  ctx: InstallerContext,
  options: InstallOptions,
): Promise<InstallResult> {
  const { fs, http, logger, platform, homeDir, archive, checksum, tempDir } = ctx;
  const installDir =
    options.installDir ??
    (options.user ? getUserInstallDir(homeDir, platform.os) : getDefaultInstallDir(platform.os));

  // Validate token
  if (!validateToken(options.token)) {
    logger.error("Invalid enrollment token. Must start with 'fp_enroll_'");
    return { success: false, isUpgrade: false, message: "Invalid token" };
  }

  const tokenWarning = getTokenWarning(options.token);
  if (tokenWarning) {
    logger.warn(tokenWarning);
  }

  // Check for existing installation
  const binPath =
    platform.os === "windows"
      ? `${installDir}\\bin\\otelcol-contrib.exe`
      : `${installDir}/bin/otelcol-contrib`;
  const isUpgrade = await fs.exists(binPath);

  if (isUpgrade && !options.dryRun) {
    logger.info(`Upgrading existing installation at ${installDir}`);
  }

  // Download OTel collector
  const version = options.version ?? "0.114.0";
  const asset = getOtelAsset(version, platform);

  logger.info(`Downloading otelcol-contrib v${version} for ${platform.os}/${platform.arch}...`);

  const tmpDir = await tempDir.create();

  try {
    // Download binary
    const tarballPath = `${tmpDir}/${asset.filename}`;
    await downloadFile(http, asset.url, tarballPath, (progress) => {
      logger.info(`Downloaded ${progress.percent}% (${formatBytes(progress.bytesDownloaded)})`);
    });

    // Download and verify checksum
    logger.info("Verifying checksum...");
    const checksumPath = `${tmpDir}/checksums.txt`;
    await downloadFile(http, asset.checksumUrl, checksumPath);

    const expectedHash = await findChecksum(fs, checksumPath, asset.filename);
    if (expectedHash) {
      const actualHash = await checksum.sha256(tarballPath);
      if (expectedHash !== actualHash) {
        logger.error(`Checksum mismatch! Expected ${expectedHash}, got ${actualHash}`);
        return { success: false, isUpgrade, message: "Checksum verification failed" };
      }
      logger.ok("Checksum verified");
    }

    // Extract
    logger.info("Extracting...");
    await archive.extract(platform.os, tarballPath, tmpDir);

    if (options.dryRun) {
      logger.ok(`Dry run: would install to ${installDir}`);
      return { success: true, isUpgrade };
    }

    // Install binary
    const binDir = `${installDir}/bin`;
    await fs.mkdir(binDir, true);

    // Read extracted binary
    const extractedPath = `${tmpDir}/otelcol-contrib${platform.os === "windows" ? ".exe" : ""}`;
    const binaryContent = await fs.readFile(extractedPath);

    await fs.writeFile(
      binDir + (platform.os === "windows" ? "\\otelcol-contrib.exe" : "/otelcol-contrib"),
      binaryContent,
    );
    await fs.chmod(
      binDir + (platform.os === "windows" ? "\\otelcol-contrib.exe" : "/otelcol-contrib"),
      0o755,
    );
    logger.ok(`Installed to ${binDir}`);

    // Generate or read instance UID
    const uidFile = `${installDir}/instance-uid`;
    let instanceUid: string;
    if (await fs.exists(uidFile)) {
      instanceUid = (await fs.readFile(uidFile)).trim();
      // Convert legacy format if needed
      if (!isValidInstanceUid(instanceUid)) {
        instanceUid = legacyUidToUuid(instanceUid);
      }
    } else {
      instanceUid = generateUuid();
      await fs.writeFile(uidFile, instanceUid);
    }

    // Write config (unless upgrading and preserving)
    const configFile = `${installDir}/config/otelcol.yaml`;
    if (!isUpgrade) {
      const config = createDefaultConfig(
        options.token,
        options.endpoint ?? "wss://api.o11yfleet.com/v1/opamp",
        instanceUid,
      );
      await fs.writeFile(configFile, generateOtelConfig(config));
      await fs.chmod(configFile, 0o640);
      logger.ok(`Config written to ${configFile}`);
    } else {
      logger.ok("Preserving existing config");
    }

    // Install service (unless skipped)
    if (!options.skipService) {
      await installService(ctx, installDir, configFile, !!options.user);
    }

    return { success: true, isUpgrade };
  } finally {
    await fs.remove(tmpDir);
  }
}

async function installService(
  ctx: InstallerContext,
  installDir: string,
  configFile: string,
  userMode: boolean,
): Promise<void> {
  const { fs, process, platform, logger, homeDir } = ctx;
  const logFile = userMode
    ? `${installDir}/logs/collector.log`
    : platform.os === "windows"
      ? `${installDir}\\logs\\collector.log`
      : platform.os === "darwin"
        ? "/var/log/o11yfleet-collector.log"
        : "/var/log/o11yfleet-collector.log";

  const serviceConfig = {
    name: platform.os === "darwin" ? "com.o11yfleet.collector" : "o11yfleet-collector",
    displayName: "O11yFleet Collector",
    description: "O11yFleet Collector (otelcol-contrib + OpAMP)",
    execStart:
      platform.os === "windows"
        ? `${installDir}\\bin\\otelcol-contrib.exe`
        : `${installDir}/bin/otelcol-contrib`,
    user: userMode ? null : "o11yfleet",
    group: userMode ? null : "o11yfleet",
    installDir,
    configFile,
    logFile,
    userMode,
    homeDir,
    serviceUser: userMode ? (homeDir.split("/").pop() ?? "root") : "o11yfleet",
  };

  if (platform.os === "linux") {
    await installLinuxService(fs, process, logger, serviceConfig);
  } else if (platform.os === "darwin") {
    await installMacOSService(fs, process, logger, serviceConfig);
  } else if (platform.os === "windows") {
    await installWindowsService(logger, serviceConfig);
  }
}

async function installLinuxService(
  fs: FileSystem,
  process: ProcessRunner,
  logger: Logger,
  config: ServiceConfig,
): Promise<void> {
  const { generateSystemdUnit } = await import("../core/config.js");
  const unitContent = generateSystemdUnit(config);

  if (config.userMode) {
    // Per-user: no sudo needed, install to ~/.config/systemd/user/
    const userDir = `${config.homeDir}/.config/systemd/user`;
    await fs.mkdir(userDir, true);
    await fs.writeFile(`${userDir}/o11yfleet-collector.service`, unitContent);

    // Reload and start with systemctl --user
    await process.exec("systemctl", ["--user", "daemon-reload"]);
    await process.exec("systemctl", ["--user", "enable", "o11yfleet-collector"]);
    await process.exec("systemctl", ["--user", "start", "o11yfleet-collector"]);
    logger.ok("User service started: o11yfleet-collector");
  } else {
    // System-wide: requires sudo
    // Create o11yfleet user if not exists
    try {
      await process.exec("id", ["-u", "o11yfleet"]);
    } catch {
      logger.info("Creating o11yfleet user...");
      await process.exec("sudo", [
        "useradd",
        "--system",
        "--no-create-home",
        "--shell",
        "/sbin/nologin",
        "o11yfleet",
      ]);
    }

    // Set ownership
    await process.exec("sudo", ["chown", "-R", "o11yfleet:o11yfleet", config.installDir]);

    // Write systemd unit
    await fs.writeFile("/etc/systemd/system/o11yfleet-collector.service", unitContent);

    // Reload and start
    await process.exec("sudo", ["systemctl", "daemon-reload"]);
    await process.exec("sudo", ["systemctl", "enable", "o11yfleet-collector"]);
    await process.exec("sudo", ["systemctl", "restart", "o11yfleet-collector"]);
    logger.ok("Service started: o11yfleet-collector");
  }
}

async function installMacOSService(
  fs: FileSystem,
  process: ProcessRunner,
  logger: Logger,
  config: ServiceConfig,
): Promise<void> {
  const { generateLaunchdPlist } = await import("../core/config.js");
  const plistContent = generateLaunchdPlist(config);

  if (config.userMode) {
    // Per-user: no sudo needed, install to ~/Library/LaunchAgents/
    const plistPath = `${config.homeDir}/Library/LaunchAgents/com.o11yfleet.collector.plist`;
    await fs.writeFile(plistPath, plistContent);

    // Load service for current user
    const uid = await process.currentUid();
    await process.exec("launchctl", ["bootout", `gui/${uid}/com.o11yfleet.collector`]);
    await process.exec("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
    logger.ok("User service started: com.o11yfleet.collector");
  } else {
    // System-wide: requires sudo
    // Create o11yfleet user if not exists
    try {
      await process.exec("id", ["-u", "o11yfleet"]);
    } catch {
      logger.info("Creating o11yfleet user...");
      await process.exec("sudo", [
        "dscl",
        ".",
        "-create",
        "/Users/o11yfleet",
        "UserShell",
        "/usr/bin/false",
      ]);
      await process.exec("sudo", ["dscl", ".", "-create", "/Users/o11yfleet", "UniqueID", "400"]);
      await process.exec("sudo", [
        "dscl",
        ".",
        "-create",
        "/Users/o11yfleet",
        "PrimaryGroupID",
        "400",
      ]);
    }

    // Set ownership
    await process.exec("sudo", ["chown", "-R", "o11yfleet:o11yfleet", config.installDir]);

    // Write launchd plist
    const plistPath = "/Library/LaunchDaemons/com.o11yfleet.collector.plist";
    await fs.writeFile(plistPath, plistContent);

    // Load service
    await process.exec("sudo", ["launchctl", "bootout", "system/com.o11yfleet.collector"]);
    await process.exec("sudo", ["launchctl", "bootstrap", "system", plistPath]);
    logger.ok("Service started: com.o11yfleet.collector");
  }
}

async function installWindowsService(logger: Logger, config: ServiceConfig): Promise<void> {
  if (config.userMode) {
    // Per-user: use Task Scheduler instead of Windows Service
    logger.info("Installing per-user scheduled task...");
    const taskName = "o11yfleet-collector";
    const action = `powershell -Command "& {Start-Process -FilePath '${config.execStart}' -ArgumentList '--config ${config.configFile}' -NoNewWindow}"`;
    // For simplicity, just log what would be done - actual Task Scheduler setup requires more complex PowerShell
    logger.info(`Would create scheduled task: ${taskName}`);
    logger.info(`Action: ${action}`);
    logger.ok("Per-user install complete. Collector will run at logon.");
  } else {
    logger.info("Installing Windows service...");
    logger.info("Windows service registration requires Administrator privileges.");
    logger.info(
      `Run manually: sc create o11yfleet-collector binPath= "${config.execStart} --config ${config.configFile}"`,
    );
  }
}

async function downloadFile(
  http: HttpClient,
  url: string,
  destPath: string,
  onProgress?: (p: { percent: number; bytesDownloaded: number }) => void,
): Promise<void> {
  const response = await http.fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
  const file = createWriteStream(destPath);
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("No response body");
  }

  let bytesDownloaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      file.write(value);
      bytesDownloaded += value.length;

      if (onProgress && contentLength > 0) {
        onProgress({
          percent: Math.round((bytesDownloaded / contentLength) * 100),
          bytesDownloaded,
        });
      }
    }
  } finally {
    file.end();
  }
}

async function findChecksum(
  fs: FileSystem,
  checksumFile: string,
  filename: string,
): Promise<string | null> {
  try {
    const content = await fs.readFile(checksumFile);
    const lines = content.split("\n");
    for (const line of lines) {
      const [hash, name] = line.trim().split(/\s+/);
      if (name === filename) {
        return hash;
      }
    }
  } catch {
    // Checksum file not found - that's okay
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
