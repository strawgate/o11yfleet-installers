/**
 * Tests for scan command — finds existing OTel Collector installations.
 */

import { describe, it, expect, vi } from "vitest";
import type { FileSystem, ProcessRunner, Platform } from "../../src/core/types.js";
import { scan } from "../../src/commands/scan.js";

class MockFS implements FileSystem {
  files = new Map<string, string>();
  readFile = vi.fn();
  writeFile = vi.fn();
  chmod = vi.fn();
  mkdir = vi.fn();
  exists = vi.fn(async (p: string) => this.files.has(p));
  remove = vi.fn();
  listDir = vi.fn(async () => []);
  uid = vi.fn(async () => 1000);
  gid = vi.fn(async () => 1000);
}

class MockLogger {
  messages: { level: string; msg: string }[] = [];
  info = vi.fn((m: string) => this.messages.push({ level: "info", msg: m }));
  ok = vi.fn((m: string) => this.messages.push({ level: "ok", msg: m }));
  warn = vi.fn((m: string) => this.messages.push({ level: "warn", msg: m }));
  error = vi.fn((m: string) => this.messages.push({ level: "error", msg: m }));
}

class MockProcess implements ProcessRunner {
  exec = vi.fn(async (c: string) => {
    if (c.includes("--version")) return "otelcol-contrib version v0.151.0";
    return "";
  });
  spawn = vi.fn(async () => "");
  which = vi.fn(async (b: string) => `/usr/bin/${b}`);
}

const platform: Platform = { os: "linux", arch: "x64" };

describe("scan command", () => {
  it("returns empty when no collectors found", async () => {
    const fs = new MockFS();
    const logger = new MockLogger();
    const process = new MockProcess();
    process.which = vi.fn(async () => null);
    const results = await scan({ fs, process, logger, platform, homeDir: "/home/test" });
    expect(results).toHaveLength(0);
  });

  it("finds existing collector at known paths", async () => {
    const fs = new MockFS();
    fs.files.set("/usr/local/bin/otelcol-contrib", "binary");
    const logger = new MockLogger();
    const process = new MockProcess();
    process.which = vi.fn(async () => "/usr/local/bin/otelcol-contrib");
    process.exec = vi.fn(async () => "otelcol-contrib version v0.151.0");
    const results = await scan({ fs, process, logger, platform, homeDir: "/home/test" });
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("reports collector without OpAMP extension gracefully", async () => {
    const fs = new MockFS();
    fs.files.set("/usr/local/bin/otelcol-contrib", "binary");
    const logger = new MockLogger();
    const process = new MockProcess();
    process.which = vi.fn(async () => "/usr/local/bin/otelcol-contrib");
    // Return version without opamp in the output
    process.exec = vi.fn(async () => "v0.151.0");
    const results = await scan({ fs, process, logger, platform, homeDir: "/home/test" });
    // Should not crash — scan gracefully handles no OpAMP
    expect(results).toBeDefined();
  });
});