/**
 * Tests for checksum verifier utilities.
 */

import { describe, it, expect } from "vitest";
import type { ChecksumVerifier } from "../../src/core/types.js";
import { NodeChecksumVerifier } from "../../src/adapters/checksum.js";
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { join } from "path";

class MockChecksumVerifier implements ChecksumVerifier {
  calls: { filePath: string }[] = [];

  async sha256(filePath: string): Promise<string> {
    this.calls.push({ filePath });
    return "mock-sha256-hash";
  }
}

describe("ChecksumVerifier", () => {
  describe("MockChecksumVerifier", () => {
    it("sha256 is called with correct arguments", async () => {
      const verifier = new MockChecksumVerifier();
      await verifier.sha256("/tmp/test-file");
      expect(verifier.calls).toEqual([{ filePath: "/tmp/test-file" }]);
    });

    it("multiple calls accumulate", async () => {
      const verifier = new MockChecksumVerifier();
      await verifier.sha256("/tmp/a");
      await verifier.sha256("/tmp/b");
      expect(verifier.calls).toHaveLength(2);
      expect(verifier.calls[1]).toEqual({ filePath: "/tmp/b" });
    });

    it("returns mock hash", async () => {
      const verifier = new MockChecksumVerifier();
      const result = await verifier.sha256("/tmp/test");
      expect(result).toBe("mock-sha256-hash");
    });
  });

  describe("NodeChecksumVerifier", () => {
    it("computes correct sha256 for known content", async () => {
      const verifier = new NodeChecksumVerifier();
      const tempDir = mkdtempSync(join(__dirname, "temp-"));
      const tempFile = join(tempDir, "test.txt");
      writeFileSync(tempFile, "hello world");

      const hash = await verifier.sha256(tempFile);
      expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");

      unlinkSync(tempFile);
      rmdirSync(tempDir);
    });

    it("different content produces different hash", async () => {
      const verifier = new NodeChecksumVerifier();
      const tempDir = mkdtempSync(join(__dirname, "temp-"));

      const file1 = join(tempDir, "a.txt");
      const file2 = join(tempDir, "b.txt");
      writeFileSync(file1, "content a");
      writeFileSync(file2, "content b");

      const hash1 = await verifier.sha256(file1);
      const hash2 = await verifier.sha256(file2);
      expect(hash1).not.toBe(hash2);

      unlinkSync(file1);
      unlinkSync(file2);
      rmdirSync(tempDir);
    });
  });
});
