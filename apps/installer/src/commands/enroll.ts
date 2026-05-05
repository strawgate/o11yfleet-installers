/**
 * Enroll command - configures an existing OTel collector to connect to O11yFleet.
 */

import type { FileSystem, Logger } from "../core/types.js";
import {
  validateToken,
  getTokenWarning,
  generateOtelConfig,
  createDefaultConfig,
} from "../core/config.js";
import { generateUuid, isValidInstanceUid, legacyUidToUuid } from "../core/uuid.js";

export interface EnrollContext {
  fs: FileSystem;
  logger: Logger;
}

export interface EnrollOptions {
  collectorPath: string;
  token: string;
  endpoint?: string;
}

/**
 * Enroll an existing collector with O11yFleet.
 */
export async function enroll(ctx: EnrollContext, options: EnrollOptions): Promise<boolean> {
  const { fs, logger } = ctx;
  const { collectorPath, token, endpoint } = options;

  // Validate token
  if (!validateToken(token)) {
    logger.error("Invalid enrollment token. Must start with 'fp_enroll_'");
    return false;
  }

  const tokenWarning = getTokenWarning(token);
  if (tokenWarning) {
    logger.warn(tokenWarning);
  }

  // Find config file (for now, assume it's in the same directory)
  const { dirname } = await import("path");
  const baseDir = dirname(collectorPath);

  // Common config file names
  const configNames = [
    "otelcol.yaml",
    "otelcol.yml",
    "config.yaml",
    "config.yml",
    "collector.yaml",
    "collector.yml",
  ];

  let configPath: string | null = null;
  for (const name of configNames) {
    const candidate = `${baseDir}/${name}`;
    if (await fs.exists(candidate)) {
      configPath = candidate;
      break;
    }
  }

  // Also check parent config directory
  if (!configPath) {
    const parentConfig = `${baseDir}/../config/otelcol.yaml`;
    if (await fs.exists(parentConfig)) {
      configPath = parentConfig;
    }
  }

  if (!configPath) {
    logger.error(`Could not find config file near ${collectorPath}`);
    logger.info("Ensure your collector has a config file in the same directory or parent");
    return false;
  }

  // Get or generate instance UID
  const { dirname: getDirname } = await import("path");
  const installDir = getDirname(configPath.split("/config/")[0] || configPath);
  const uidFile = `${installDir}/instance-uid`;
  let instanceUid: string;

  if (await fs.exists(uidFile)) {
    instanceUid = (await fs.readFile(uidFile)).trim();
    if (!isValidInstanceUid(instanceUid)) {
      instanceUid = legacyUidToUuid(instanceUid);
      await fs.writeFile(uidFile, instanceUid);
    }
  } else {
    instanceUid = generateUuid();
    await fs.writeFile(uidFile, instanceUid);
  }

  // Generate config
  const config = createDefaultConfig(
    token,
    endpoint ?? "wss://api.o11yfleet.com/v1/opamp",
    instanceUid,
  );
  const configContent = generateOtelConfig(config);

  // Write config
  await fs.writeFile(configPath, configContent);
  await fs.chmod(configPath, 0o640);

  logger.ok(`Config written to ${configPath}`);
  logger.info("Restart the collector to apply changes");

  return true;
}
