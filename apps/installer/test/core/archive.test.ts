/**
 * Tests for archive extraction utilities.
 */

import { describe, it, expect } from "vitest";
import type { ArchiveExtractor, OS } from "../../src/core/types.js";

class MockArchiveExtractor implements ArchiveExtractor {
  calls: { os: OS; archivePath: string; destDir: string }[] = [];

  async extract(os: OS, archivePath: string, destDir: string): Promise<void> {
    this.calls.push({ os, archivePath, destDir });
  }
}

describe("ArchiveExtractor", () => {
  it("extract is called with correct arguments for linux", async () => {
    const extractor = new MockArchiveExtractor();
    await extractor.extract("linux", "/tmp/test.tar.gz", "/tmp/dest");
    expect(extractor.calls).toEqual([
      { os: "linux", archivePath: "/tmp/test.tar.gz", destDir: "/tmp/dest" },
    ]);
  });

  it("extract is called with correct arguments for windows", async () => {
    const extractor = new MockArchiveExtractor();
    await extractor.extract("windows", "C:\\temp\\test.zip", "C:\\dest");
    expect(extractor.calls).toEqual([
      { os: "windows", archivePath: "C:\\temp\\test.zip", destDir: "C:\\dest" },
    ]);
  });

  it("extract is called with correct arguments for darwin", async () => {
    const extractor = new MockArchiveExtractor();
    await extractor.extract("darwin", "/tmp/test.tar.gz", "/tmp/dest");
    expect(extractor.calls).toEqual([
      { os: "darwin", archivePath: "/tmp/test.tar.gz", destDir: "/tmp/dest" },
    ]);
  });

  it("multiple calls accumulate", async () => {
    const extractor = new MockArchiveExtractor();
    await extractor.extract("linux", "/tmp/a.tar.gz", "/tmp/a");
    await extractor.extract("linux", "/tmp/b.tar.gz", "/tmp/b");
    expect(extractor.calls).toHaveLength(2);
    expect(extractor.calls[1]).toEqual({
      os: "linux",
      archivePath: "/tmp/b.tar.gz",
      destDir: "/tmp/b",
    });
  });
});
