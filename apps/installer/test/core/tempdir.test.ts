/**
 * Tests for temp directory factory utilities.
 */

import { describe, it, expect, vi } from "vitest";
import type { TempDirFactory, FileSystem } from "../../src/core/types.js";
import { NodeTempDirFactory } from "../../src/adapters/tempdir.js";

class MockFileSystem implements FileSystem {
  dirs: string[] = [];
  mkdir = vi.fn(async (path: string) => {
    this.dirs.push(path);
  });
  readFile = vi.fn();
  writeFile = vi.fn();
  chmod = vi.fn();
  exists = vi.fn();
  remove = vi.fn();
  listDir = vi.fn();
  uid = vi.fn(async () => 1000);
  gid = vi.fn(async () => 1000);
}

class MockTempDirFactory implements TempDirFactory {
  calls: string[] = [];

  async create(): Promise<string> {
    this.calls.push("create");
    return "/tmp/mock-temp-dir";
  }
}

describe("TempDirFactory", () => {
  describe("MockTempDirFactory", () => {
    it("create returns temp directory path", async () => {
      const factory = new MockTempDirFactory();
      const path = await factory.create();
      expect(path).toBe("/tmp/mock-temp-dir");
    });

    it("create tracks calls", async () => {
      const factory = new MockTempDirFactory();
      await factory.create();
      await factory.create();
      expect(factory.calls).toEqual(["create", "create"]);
    });
  });

  describe("NodeTempDirFactory", () => {
    it("create makes fs.mkdir call with expected prefix", async () => {
      const fs = new MockFileSystem();
      const factory = new NodeTempDirFactory(fs);
      const path = await factory.create();

      expect(path).toMatch(/^\/tmp\/o11y-install-/);
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
      expect(fs.mkdir).toHaveBeenCalledWith(path, true);
    });

    it("create returns unique paths on each call", async () => {
      const fs = new MockFileSystem();
      const factory = new NodeTempDirFactory(fs);

      const paths: string[] = [];
      for (let i = 0; i < 5; i++) {
        paths.push(await factory.create());
      }

      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(5);
    });
  });
});
