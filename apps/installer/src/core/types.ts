/**
 * Core type definitions for the O11yFleet installer.
 * These are pure interfaces that describe the capabilities needed,
 * allowing for easy testing with mock implementations.
 */

export type OS = "linux" | "darwin" | "windows";
export type Arch = "amd64" | "arm64";
export type Platform = { os: OS; arch: Arch };

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
}

export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  uid(): Promise<number>;
  gid(): Promise<number>;
}

export interface ProcessRunner {
  exec(cmd: string, args?: string[]): Promise<void>;
  execSync(cmd: string, args?: string[]): string;
  currentUid(): number;
  currentGid(): number;
}

export interface HttpClient {
  fetch(
    url: string,
    options?: RequestInit,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<Response>;
}

export interface Logger {
  info(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface OTelConfig {
  token: string;
  endpoint: string;
  instanceUid: string;
  version: string;
}

export interface OTelAsset {
  filename: string;
  url: string;
  checksumUrl: string;
}

export interface ParsedOtelFilename {
  filename: string;
  version: string;
  os: OS;
  arch: Arch;
  ext: "tar.gz" | "zip";
}

export interface ServiceConfig {
  name: string;
  displayName: string;
  description: string;
  execStart: string;
  user: string;
  group: string;
  installDir: string;
  configFile: string;
  logFile: string;
}

export interface ScanResult {
  path: string;
  version: string | null;
  running: boolean;
}

export interface InstallOptions {
  token: string;
  version?: string;
  endpoint?: string;
  installDir?: string;
  dryRun?: boolean;
  skipService?: boolean;
}

export interface UserInfo {
  uid: number;
  gid: number;
  name?: string;
}
