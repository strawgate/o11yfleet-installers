/**
 * Embedded asset management for offline installation.
 * These assets are bundled with the installer binary at build time.
 * 
 * Each platform-specific bundle contains only that platform's OTel binary.
 * Use `just build <platform>` to build a specific platform's bundle.
 */

import type { Platform, OS, Arch } from "./types.js";

/**
 * Platform-specific embedded asset.
 * Only one of these will be available at runtime.
 */
import EMBEDDED_ASSET from "../assets/embedded.js";

/**
 * Get the asset key for a platform.
 */
function getAssetKey(os: OS, arch: Arch): string {
  return `${os}-${arch}`;
}

/**
 * Check if the embedded asset matches the given platform.
 * Handles both .deb packages and .tar.gz archives.
 */
function assetMatchesPlatform(filename: string, os: OS, arch: Arch): boolean {
  const osMatch = filename.includes(`_${os}_`);
  const archMatch = filename.includes(`_${arch}.`);
  return osMatch && archMatch;
}

/**
 * Try to load an embedded asset for the given platform and version.
 * Returns null if no embedded asset is available.
 */
export async function getEmbeddedAsset(
  platform: Platform,
  version: string,
): Promise<{ data: Buffer; filename: string } | null> {
  if (!EMBEDDED_ASSET) {
    return null;
  }

  const { filename, base64 } = EMBEDDED_ASSET;

  // Check if the embedded asset matches this platform
  if (!assetMatchesPlatform(filename, platform.os, platform.arch)) {
    return null;
  }

  // Extract version from filename
  const match = filename.match(/otelcol-contrib[._](\d+\.\d+\.\d+)/);
  const assetVersion = match ? match[1] : "0.152.0";

  if (assetVersion !== version) {
    console.log(
      `Embedded asset is v${assetVersion}, but requested v${version}. Will download from network.`,
    );
    return null;
  }

  // Decode base64 to buffer
  const data = Buffer.from(base64, "base64");
  return { data, filename };
}

/**
 * Check if an embedded asset exists for the given platform.
 */
export async function hasEmbeddedAsset(
  platform: Platform,
  version: string,
): Promise<boolean> {
  const asset = await getEmbeddedAsset(platform, version);
  return asset !== null;
}
