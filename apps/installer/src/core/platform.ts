/**
 * Pure platform detection utilities.
 * No side effects - all inputs and outputs are deterministic.
 */

import type { OS, Arch, Platform } from "./types.js";

export const DEFAULT_INSTALL_DIRS: Record<OS, string> = {
  linux: "/opt/o11yfleet",
  darwin: "/opt/o11yfleet",
  windows: "C:\\Program Files\\O11yFleet",
};

export const OTEL_USER: Record<OS, string> = {
  linux: "o11yfleet",
  darwin: "o11yfleet",
  windows: "o11yfleet",
};

export const SERVICE_NAME: Record<OS, string> = {
  linux: "o11yfleet-collector",
  darwin: "com.o11yfleet.collector",
  windows: "o11yfleet-collector",
};

/**
 * Detect platform from runtime information.
 */
export function detectPlatform(runtimePlatform: string, runtimeArch: string): Platform {
  const os = detectOS(runtimePlatform);
  const arch = detectArch(runtimeArch);
  return { os, arch };
}

function detectOS(runtimePlatform: string): OS {
  switch (runtimePlatform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      return "linux"; // Default to linux for unknown Unix-like systems
  }
}

function detectArch(runtimeArch: string): Arch {
  // Handle Docker and other environments that report differently
  switch (runtimeArch) {
    case "x64":
    case "x86_64":
    case "amd64":
      return "amd64";
    case "arm64":
    case "aarch64":
      return "arm64";
    default:
      return "amd64"; // Default to amd64
  }
}

/**
 * Get default installation directory for platform.
 */
export function getDefaultInstallDir(os: OS): string {
  return DEFAULT_INSTALL_DIRS[os];
}

/**
 * Get service name for platform.
 */
export function getServiceName(os: OS): string {
  return SERVICE_NAME[os];
}

/**
 * Get service file path for platform.
 */
export function getServiceFilePath(os: OS): string {
  switch (os) {
    case "linux":
      return "/etc/systemd/system/o11yfleet-collector.service";
    case "darwin":
      return "/Library/LaunchDaemons/com.o11yfleet.collector.plist";
    case "windows":
      return "C:\\Program Files\\O11yFleet\\o11yfleet-collector.service";
  }
}

/**
 * Get system binary paths to search for existing collectors.
 */
export function getSystemPaths(homeDir: string, os: OS): string[] {
  const commonPaths = ["/usr/local/bin", "/usr/bin", "/opt", "/opt/homebrew/bin", homeDir];

  const osPaths: Record<OS, string[]> = {
    linux: ["/usr/local/bin", "/usr/bin", "/opt", "/snap/bin"],
    darwin: ["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"],
    windows: [
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      `${homeDir}\\AppData\\Local\\Programs`,
    ],
  };

  return [...new Set([...commonPaths, ...osPaths[os]])];
}

/**
 * Check if systemd is available (Linux only).
 */
export function hasSystemd(os: OS): boolean {
  return os === "linux";
}

/**
 * Check if running as root/admin.
 */
export function isRoot(uid: number, os: OS): boolean {
  if (os === "windows") {
    return uid === 0;
  }
  return uid === 0;
}

/**
 * Get the standard user for the service.
 */
export function getServiceUser(os: OS): string {
  return OTEL_USER[os];
}

/**
 * Validate that an install directory path is reasonable.
 */
export function validateInstallDir(path: string, os: OS): boolean {
  if (!path || path.length === 0) return false;

  // Reject obviously dangerous paths
  const dangerous = ["/", "/home", "/root", "/tmp", "/var"];
  if (dangerous.includes(path)) return false;

  // On Windows, ensure it starts with a drive letter
  if (os === "windows") {
    return /^[A-Za-z]:\\/.test(path);
  }

  // On Unix, must be absolute path
  return path.startsWith("/");
}

/**
 * Parse architecture from uname output.
 */
export function parseArch(unameArch: string): Arch {
  switch (unameArch) {
    case "x86_64":
    case "amd64":
      return "amd64";
    case "aarch64":
    case "arm64":
      return "arm64";
    default:
      return "amd64";
  }
}

/**
 * Parse OS from uname output.
 */
export function parseOS(unameS: string): OS {
  switch (unameS.toLowerCase()) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    case "mingw":
    case "cygwin":
    case "windows":
      return "windows";
    default:
      return "linux";
  }
}
