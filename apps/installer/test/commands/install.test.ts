/**
 * Tests for install command — smoke-level coverage.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    createWriteStream: () => ({
      on: () => {},
      close: () => {},
      destroy: () => {},
      write: () => true,
      end: () => {},
    }),
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual("node:os");
  return {
    ...actual,
    homedir: () => "/home/test",
    platform: () => "linux",
    arch: () => "x64",
    tmpdir: () => "/tmp",
  };
});

import type { FileSystem, ProcessRunner, HttpClient, Platform, OS } from "../../src/core/types.js";
import { install } from "../../src/commands/install.js";

class MockFS implements FileSystem {
  files = new Map<string, string>();
  dirs = new Set<string>();
  readFile = vi.fn(async (p: string) => {
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`File not found: ${p}`);
    return c;
  });
  writeFile = vi.fn(async (p: string, c: string) => this.files.set(p, c));
  chmod = vi.fn(async () => {});
  mkdir = vi.fn(async (p: string) => {
    this.dirs.add(p);
  });
  exists = vi.fn(async (p: string) => this.files.has(p) || this.dirs.has(p));
  remove = vi.fn(async () => {});
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
  exec = vi.fn(async () => "");
  spawn = vi.fn(async () => "");
  which = vi.fn(async (_: string) => "/usr/bin/fake");
}

class MockHttp implements HttpClient {
  fetch = vi.fn(async () =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Map([["content-length", "1024"]]),
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({ done: false, value: Buffer.from("f") })
            .mockResolvedValue({ done: true }),
        }),
      },
    }),
  );
}

const platform: Platform = { os: "linux", arch: "x64" };
function makeCtx(overrides: Record<string, unknown> = {}) {
  const fs = new MockFS();
  return {
    fs,
    process: new MockProcess(),
    http: new MockHttp(),
    logger: new MockLogger(),
    platform,
    homeDir: "/home/test",
    archive: {
      extract: vi.fn(async (_os: OS, _archive: string, destDir: string) => {
        fs.files.set(`${destDir}/otelcol-contrib`, "binary");
      }),
    },
    checksum: { verify: vi.fn(async () => true) },
    tempDir: { create: vi.fn(async () => "/tmp/ci-test-dir") },
    ...overrides,
  };
}

describe("install command", () => {
  it("rejects invalid tokens", async () => {
    const result = await install(makeCtx(), { token: "bad_token" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid token");
  });

  it("accepts valid fp_enroll_ token", async () => {
    const result = await install(makeCtx(), { token: "fp_enroll_test_123", user: true });
    expect(result.success).toBe(true);
  });

  it("creates install directory on fresh install", async () => {
    const c = makeCtx();
    await install(c, { token: "fp_enroll_test_123", user: true });
    expect(c.fs.mkdir).toHaveBeenCalled();
  });

  it("detects existing install for upgrade", async () => {
    const c = makeCtx();
    c.fs.dirs.add("/home/test/.local/share/o11yfleet/bin");
    c.fs.files.set("/home/test/.local/share/o11yfleet/bin/otelcol-contrib", "existing");
    const result = await install(c, { token: "fp_enroll_test_123", user: true });
    expect(result.isUpgrade).toBe(true);
  });
});
