import { describe, it, expect } from "vitest";
import { diffLines } from "diff";

/**
 * Test helpers are inlined here to avoid importing from the main module,
 * which has complex dependencies. The actual implementation is in routes/v1/index.ts.
 */

/**
 * Computes a summary of text differences between two YAML strings.
 * Uses the `diff` package's Myers diff algorithm for accurate line-level changes.
 * Returns line counts, byte delta, and added/removed line counts.
 */
function summarizeTextDiff(previous: string, latest: string) {
  const changes = diffLines(previous, latest);
  let addedLines = 0;
  let removedLines = 0;

  for (const part of changes) {
    const lines = part.value.split(/\r?\n/).filter((l, i, arr) => i < arr.length - 1 || l !== "");
    const count = lines.length || (part.value.length > 0 ? 1 : 0);
    if (part.added) {
      addedLines += count;
    } else if (part.removed) {
      removedLines += count;
    }
  }

  return {
    previous_line_count: previous.split(/\r?\n/).length,
    latest_line_count: latest.split(/\r?\n/).length,
    line_count_delta: latest.split(/\r?\n/).length - previous.split(/\r?\n/).length,
    size_bytes_delta: utf8ByteLength(latest) - utf8ByteLength(previous),
    added_lines: addedLines,
    removed_lines: removedLines,
  };
}

function utf8ByteLength(str: string): number {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      len += 1;
    } else if (code < 0x800) {
      len += 2;
    } else if (code < 0xd800 || code > 0xdfff) {
      len += 3;
    } else {
      // Surrogate pair: consume both code units
      i++;
      len += 4;
    }
  }
  return len;
}

describe("utf8ByteLength", () => {
  it("counts ASCII characters as 1 byte each", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("hello")).toBe(5);
    expect(utf8ByteLength("Hello, World!")).toBe(13);
  });

  it("counts 2-byte UTF-8 characters correctly (Latin-1 Supplement)", () => {
    // é is U+00E9, encoded as 0xC3 0xA9 in UTF-8
    expect(utf8ByteLength("café")).toBe(5); // c=1, a=1, f=1, é=2
    expect(utf8ByteLength("naïve")).toBe(6); // n=1, a=1, ï=2, v=1, e=1
  });

  it("counts 3-byte UTF-8 characters correctly (CJK and other)", () => {
    // Each CJK character is 3 bytes in UTF-8
    expect(utf8ByteLength("日本")).toBe(6);
    expect(utf8ByteLength("日本語")).toBe(9);
  });

  it("counts 4-byte UTF-8 characters correctly (emoji, rare CJK)", () => {
    // Emoji are 4 bytes in UTF-8
    expect(utf8ByteLength("😀")).toBe(4);
    expect(utf8ByteLength("🌍")).toBe(4);
  });

  it("handles mixed content correctly", () => {
    // "Hello" = 5 bytes, " 世界" = 7 bytes (space + 2 CJK chars × 3 bytes)
    expect(utf8ByteLength("Hello 世界")).toBe(12);
  });

  it("matches TextEncoder output for various strings", () => {
    const testStrings = [
      "",
      "a",
      "hello",
      "Hello, World!",
      "café",
      "naïve",
      "日本語",
      "😀",
      "🌍",
      "Hello 世界 🌍",
      "config:\n  name: test\n  version: 1",
    ];

    for (const str of testStrings) {
      const expected = new TextEncoder().encode(str).byteLength;
      expect(utf8ByteLength(str)).toBe(expected);
    }
  });
});

describe("summarizeTextDiff", () => {
  it("returns zero diffs for identical strings", () => {
    const yaml = "config:\n  version: 1\n";
    const result = summarizeTextDiff(yaml, yaml);
    expect(result.added_lines).toBe(0);
    expect(result.removed_lines).toBe(0);
    expect(result.line_count_delta).toBe(0);
    expect(result.size_bytes_delta).toBe(0);
  });

  it("counts added lines correctly", () => {
    const previous = "config:\n  version: 1\n";
    const latest = "config:\n  version: 1\n  name: test\n";
    const result = summarizeTextDiff(previous, latest);
    expect(result.added_lines).toBe(1);
    expect(result.removed_lines).toBe(0);
    expect(result.line_count_delta).toBe(1);
  });

  it("counts removed lines correctly", () => {
    const previous = "config:\n  version: 1\n  name: test\n";
    const latest = "config:\n  version: 1\n";
    const result = summarizeTextDiff(previous, latest);
    expect(result.added_lines).toBe(0);
    expect(result.removed_lines).toBe(1);
    expect(result.line_count_delta).toBe(-1);
  });

  it("handles multi-line changes", () => {
    const previous = "receivers:\n  otlp:\n";
    const latest = "receivers:\n  otlp:\n    protocols:\n      grpc:\n";
    const result = summarizeTextDiff(previous, latest);
    expect(result.added_lines).toBe(2);
    expect(result.previous_line_count).toBe(3);
    expect(result.latest_line_count).toBe(5);
  });

  it("calculates byte delta correctly", () => {
    const previous = "a";
    const latest = "ab";
    const result = summarizeTextDiff(previous, latest);
    expect(result.size_bytes_delta).toBe(1); // +1 byte for 'b'
  });

  it("handles empty strings", () => {
    const result = summarizeTextDiff("", "");
    expect(result.added_lines).toBe(0);
    expect(result.removed_lines).toBe(0);
    expect(result.line_count_delta).toBe(0);
  });

  it("handles adding content to empty string", () => {
    const result = summarizeTextDiff("", "config:\n  version: 1\n");
    expect(result.added_lines).toBe(2);
    expect(result.removed_lines).toBe(0);
  });

  it("handles removing all content", () => {
    const result = summarizeTextDiff("config:\n  version: 1\n", "");
    expect(result.added_lines).toBe(0);
    expect(result.removed_lines).toBe(2);
  });
});
