/**
 * Tests for uninstall command — removes collector and service.
 */

import { describe, it, expect, vi } from "vitest";
import type { FileSystem, ProcessRunner, Platform } from "../../src/core/types.js";
import { uninstall } from "../../src/commands/uninstall.js";

class MockFS implements FileSystem {
  files = new Map<string, string>();
  dirs = new Set<string>(["/opt/o11yfleet", "/opt/o11yfleet/bin", "/opt/o11yfleet/config"]);
  readFile = vi.fn();
  writeFile = vi.fn();
  chmod = vi.fn();
  mkdir = vi.fn();
  exists = vi.fn(async (p: string) => this.files.has(p) || this.dirs.has(p));
  remove = vi.fn(async (p: string) => {
    for (const d of this.dirs) if (d.startsWith(p)) this.dirs.delete(d);
    this.files.delete(p);
  });
  listDir = vi.fn(async () => []);
  uid = vi.fn(async () => 0);
  gid = vi.fn(async () => 0);
}

class MockLogger {
  messages: { level: string; msg: string }[] = [];
  info = vi.fn((m: string) => this.messages.push({ level: "info", msg: m }));
  ok = vi.fn((m: string) => this.messages.push({ level: "ok", msg: m }));
  warn = vi.fn((m: string) => this.messages.push({ level: "warn", msg: m }));
  error = vi.fn((m: string) => this.messages.push({ level: "error", msg: m }));
}

class MockProcess implements ProcessRunner {
  exec = vi.fn(async () => "");
  spawn = vi.fn(async () => "");
  which = vi.fn(async () => "/usr/bin/systemctl");
}

const platform: Platform = { os: "linux", arch: "x64" };

describe("uninstall command", () => {
  it("removes install directory", async () => {
    const fs = new MockFS();
    fs.dirs.add("/opt/o11yfleet");
    const logger = new MockLogger();
    const result = await uninstall({ fs, process: new MockProcess(), logger, platform, homeDir: "/home/test" }, {});
    expect(result).toBe(true);
    expect(fs.remove).toHaveBeenCalledWith("/opt/o11yfleet");
  });

  it("stops service before removing files on linux", async () => {
    const fs = new MockFS();
    const process = new MockProcess();
    const logger = new MockLogger();
    const result = await uninstall({ fs, process, logger, platform, homeDir: "/home/test" }, {});
    expect(result).toBe(true);
    expect(process.exec).toHaveBeenCalledWith("sudo", ["systemctl", "stop", "o11yfleet-collector"]);
  });

  it("handles missing service gracefully (no crash)", async () => {
    const fs = new MockFS();
    const process = new MockProcess();
    process.exec = vi.fn(async () => { throw new Error("Service not found"); });
    const logger = new MockLogger();
    const result = await uninstall({ fs, process, logger, platform, homeDir: "/home/test" }, {});
    expect(result).toBe(true);
  });
});