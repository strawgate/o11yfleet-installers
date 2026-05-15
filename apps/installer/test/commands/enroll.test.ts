/**
 * Tests for enroll command.
 */

import { describe, it, expect, vi } from "vitest";
import type { FileSystem, Logger } from "../../src/core/types.js";
import { enroll } from "../../src/commands/enroll.js";

class MockFileSystem implements FileSystem {
  files: Map<string, string> = new Map();

  readFile = vi.fn(async (path: string) => {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  });

  writeFile = vi.fn(async (path: string, contents: string) => {
    this.files.set(path, contents);
  });

  chmod = vi.fn(async () => {});
  mkdir = vi.fn();
  exists = vi.fn(async (path: string) => this.files.has(path));
  remove = vi.fn();
  listDir = vi.fn();
  uid = vi.fn(async () => 1000);
  gid = vi.fn(async () => 1000);
}

class MockLogger implements Logger {
  messages: { level: string; msg: string }[] = [];

  info = vi.fn((msg: string) => this.messages.push({ level: "info", msg }));
  ok = vi.fn((msg: string) => this.messages.push({ level: "ok", msg }));
  warn = vi.fn((msg: string) => this.messages.push({ level: "warn", msg }));
  error = vi.fn((msg: string) => this.messages.push({ level: "error", msg }));
}

describe("enroll command", () => {
  describe("token validation", () => {
    it("rejects invalid tokens", async () => {
      const fs = new MockFileSystem();
      const logger = new MockLogger();

      const result = await enroll(
        { fs, logger },
        {
          collectorPath: "/usr/bin/otelcol-contrib",
          token: "invalid_token",
        },
      );

      expect(result).toBe(false);
      expect(logger.messages).toContainEqual({
        level: "error",
        msg: "Invalid enrollment token. Must start with 'fp_enroll_'",
      });
    });

    it("accepts valid enrollment tokens", async () => {
      const fs = new MockFileSystem();
      const logger = new MockLogger();

      fs.files.set("/usr/bin/otelcol.yaml", "receivers:\n  otlp:\n    protocols:\n      grpc:");

      const result = await enroll(
        { fs, logger },
        {
          collectorPath: "/usr/bin/otelcol-contrib",
          token: "fp_enroll_abc123",
        },
      );

      expect(result).toBe(true);
    });
  });

  describe("config file discovery", () => {
    it("finds config in same directory as collector", async () => {
      const fs = new MockFileSystem();
      const logger = new MockLogger();

      fs.files.set("/opt/otelcol.yaml", "receivers:\n  otlp:");
      fs.files.set("/opt/otelcol-contrib", "");

      const result = await enroll(
        { fs, logger },
        {
          collectorPath: "/opt/otelcol-contrib",
          token: "fp_enroll_test",
        },
      );

      expect(result).toBe(true);
    });

    it("returns error when no config found", async () => {
      const fs = new MockFileSystem();
      const logger = new MockLogger();

      fs.files.set("/opt/otelcol-contrib", "");

      const result = await enroll(
        { fs, logger },
        {
          collectorPath: "/opt/otelcol-contrib",
          token: "fp_enroll_test",
        },
      );

      expect(result).toBe(false);
      expect(logger.messages).toContainEqual({
        level: "error",
        msg: expect.stringContaining("Could not find config file"),
      });
    });
  });

  describe("config file writing", () => {
    it("writes config with correct endpoint", async () => {
      const fs = new MockFileSystem();
      const logger = new MockLogger();

      fs.files.set("/opt/otelcol.yaml", "receivers:\n  otlp:");
      fs.files.set("/opt/otelcol-contrib", "");

      await enroll(
        { fs, logger },
        {
          collectorPath: "/opt/otelcol-contrib",
          token: "fp_enroll_test",
          endpoint: "wss://custom.example.com/opamp",
        },
      );

      const writeCall = fs.writeFile.mock.calls.find(([path]) => path === "/opt/otelcol.yaml");
      expect(writeCall).toBeDefined();
      const [, content] = writeCall!;
      expect(content).toContain("wss://custom.example.com/opamp");
      expect(content).toContain("opamp");
      expect(content).not.toContain("instance_uid");
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        expect.stringContaining("instance-uid"),
        expect.any(String),
      );
    });

    it("writes config with enrollment token in Authorization header", async () => {
      const fs = new MockFileSystem();
      const logger = new MockLogger();

      fs.files.set("/opt/otelcol.yaml", "receivers:\n  otlp:");
      fs.files.set("/opt/otelcol-contrib", "");

      await enroll(
        { fs, logger },
        {
          collectorPath: "/opt/otelcol-contrib",
          token: "fp_enroll_secret_token",
        },
      );

      const writeCall = fs.writeFile.mock.calls.find(([path]) => path === "/opt/otelcol.yaml");
      const [, content] = writeCall!;
      expect(content).toContain('Authorization: "Bearer fp_enroll_secret_token"');
    });

    it("sets correct file permissions", async () => {
      const fs = new MockFileSystem();
      const logger = new MockLogger();

      fs.files.set("/opt/otelcol.yaml", "receivers:\n  otlp:");
      fs.files.set("/opt/otelcol-contrib", "");

      await enroll(
        { fs, logger },
        {
          collectorPath: "/opt/otelcol-contrib",
          token: "fp_enroll_test",
        },
      );

      expect(fs.chmod).toHaveBeenCalledWith("/opt/otelcol.yaml", 0o640);
    });

    it("uses default endpoint when not specified", async () => {
      const fs = new MockFileSystem();
      const logger = new MockLogger();

      fs.files.set("/opt/otelcol.yaml", "receivers:\n  otlp:");
      fs.files.set("/opt/otelcol-contrib", "");

      await enroll(
        { fs, logger },
        {
          collectorPath: "/opt/otelcol-contrib",
          token: "fp_enroll_test",
        },
      );

      const writeCall = fs.writeFile.mock.calls.find(([path]) => path === "/opt/otelcol.yaml");
      const [, content] = writeCall!;
      expect(content).toContain("wss://api.o11yfleet.com/v1/opamp");
    });
  });
});
