/**
 * Tests for UUID generation utilities.
 */

import { describe, it, expect } from "vitest";
import { generateUuid, isValidUuid, randomHex } from "../../src/core/uuid.js";

describe("generateUuid", () => {
  it("generates valid UUID v4 format", () => {
    const uuid = generateUuid();
    expect(isValidUuid(uuid)).toBe(true);
  });

  it("generates unique UUIDs", () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUuid());
    }
    expect(uuids.size).toBe(100);
  });

  it("generates UUID with correct format", () => {
    const uuid = generateUuid();
    // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("isValidUuid", () => {
  it("accepts valid UUIDs", () => {
    expect(isValidUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidUuid("ffffffff-ffff-4fff-bfff-ffffffffffff")).toBe(true);
  });

  it("rejects invalid UUIDs", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(false); // v1
    expect(isValidUuid("123e4567-e89b-52d3-a456-426614174000")).toBe(false); // v5
    expect(isValidUuid("123e4567-e89b-42d3-a456")).toBe(false); // too short
    expect(isValidUuid("123e4567e89b42d3a456426614174000")).toBe(false); // no hyphens
  });

  it("is case-insensitive", () => {
    expect(isValidUuid("123E4567-E89B-42D3-A456-426614174000")).toBe(true);
    expect(isValidUuid("123e4567-E89B-42D3-a456-426614174000")).toBe(true);
  });
});

describe("randomHex", () => {
  it("generates correct length", () => {
    expect(randomHex(8)).toHaveLength(8);
    expect(randomHex(16)).toHaveLength(16);
    expect(randomHex(32)).toHaveLength(32);
  });

  it("contains only hex characters", () => {
    const hexRegex = /^[0-9a-f]+$/;
    for (let i = 0; i < 10; i++) {
      const result = randomHex(16);
      expect(result).toMatch(hexRegex);
    }
  });

  it("generates different values", () => {
    const values = new Set<string>();
    for (let i = 0; i < 100; i++) {
      values.add(randomHex(8));
    }
    // Should have high uniqueness
    expect(values.size).toBeGreaterThan(90);
  });
});
