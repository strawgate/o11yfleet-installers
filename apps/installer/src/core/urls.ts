/**
 * Pure URL building and parsing utilities for OTel collector releases.
 * No side effects - all inputs and outputs are deterministic.
 */

import type { OS, Arch, Platform, OTelAsset, ParsedOtelFilename } from "./types.js";

const OTEL_RELEASES_BASE =
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download";

const DEFAULT_OTEL_VERSION = "0.114.0";

/**
 * Get the OTel collector asset for a given platform and version.
 */
export function getOtelAsset(version: string, platform: Platform): OTelAsset {
  const filename = buildOtelFilename(version, platform);
  const url = `${OTEL_RELEASES_BASE}/v${version}/${filename}`;
  const checksumUrl = `${OTEL_RELEASES_BASE}/v${version}/opentelemetry-collector-releases_otelcol-contrib_checksums.txt`;

  return {
    filename,
    url,
    checksumUrl,
  };
}

/**
 * Build the filename for an OTel collector release.
 */
export function buildOtelFilename(version: string, platform: Platform): string {
  const ext = platform.os === "windows" ? "zip" : "tar.gz";
  const osName = platform.os === "darwin" ? "darwin" : platform.os;

  return `otelcol-contrib_${version}_${osName}_${platform.arch}.${ext}`;
}

/**
 * Parse an OTel filename to extract version, OS, arch, and extension.
 * Returns null if the filename doesn't match expected format.
 */
export function parseOtelFilename(filename: string): ParsedOtelFilename | null {
  // Pattern: otelcol-contrib_VERSION_OS_ARCH.EXT
  const pattern = /^otelcol-contrib_(\d+\.\d+\.\d+)_(\w+)_(\w+)\.(tar\.gz|zip)$/;
  const match = filename.match(pattern);

  if (!match) {
    return null;
  }

  const [, version, osStr, archStr, ext] = match;

  const os = parseOS(osStr);
  const arch = parseArch(archStr);

  if (!os || !arch) {
    return null;
  }

  return {
    filename,
    version,
    os,
    arch,
    ext: ext as "tar.gz" | "zip",
  };
}

function parseOS(osStr: string): OS | null {
  switch (osStr.toLowerCase()) {
    case "linux":
      return "linux";
    case "darwin":
    case "macos":
    case "mac":
      return "darwin";
    case "windows":
    case "win":
      return "windows";
    default:
      return null;
  }
}

function parseArch(archStr: string): Arch | null {
  switch (archStr.toLowerCase()) {
    case "amd64":
    case "x86_64":
    case "x64":
      return "amd64";
    case "arm64":
    case "aarch64":
    case "arm":
      return "arm64";
    default:
      return null;
  }
}

/**
 * Build the OpAMP endpoint URL.
 */
export function buildOpampEndpoint(baseUrl?: string): string {
  // Remove trailing slash and ensure proper protocol
  const base = baseUrl?.replace(/\/$/, "") || "wss://api.o11yfleet.com";

  // Ensure wss:// or ws:// prefix
  if (!base.startsWith("ws")) {
    // Default to wss for secure connections
    return base.startsWith("http")
      ? base.replace("http", "ws") + "/v1/opamp"
      : `wss://${base}/v1/opamp`;
  }

  return `${base}/v1/opamp`;
}

/**
 * Get the default OTel collector version.
 */
export function getDefaultOtelVersion(): string {
  return DEFAULT_OTEL_VERSION;
}

/**
 * Validate that a version string looks like a semver version.
 */
export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/**
 * Get the asset for a specific version, with validation.
 */
export function getAssetForVersion(version: string, platform: Platform): OTelAsset | null {
  if (!isValidVersion(version)) {
    return null;
  }
  return getOtelAsset(version, platform);
}

/**
 * Build download URL for Bun runtime (used by bootstrap script).
 */
export function getBunAsset(version: string, platform: Platform): OTelAsset {
  const osName = platform.os === "darwin" ? "darwin" : "linux";
  const ext = "zip";
  const filename = `bun-${osName}-${platform.arch}.${ext}`;

  return {
    filename,
    url: `https://github.com/oven-sh/bun/releases/download/${version}/${filename}`,
    checksumUrl: "", // Bun doesn't have checksums.txt
  };
}

/**
 * Get the latest Bun version from GitHub.
 * This requires a network call, so it's not truly pure,
 * but the caller can cache the result.
 */
export const BUN_LATEST_URL = "https://api.github.com/repos/oven-sh/bun/releases/latest";

/**
 * Parse GitHub API release response to get tag name.
 */
export function parseGitHubReleaseTag(response: { tag_name?: string }): string | null {
  return response.tag_name?.replace(/^v/, "") || null;
}
