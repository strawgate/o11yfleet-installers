import { describe, it, expect } from "vitest";
import { signClaim, verifyClaim } from "../src/auth/claims.js";
import type { AssignmentClaim } from "../src/auth/claims.js";
import {
  generateEnrollmentToken,
  hashEnrollmentToken,
  verifyEnrollmentToken,
} from "../src/auth/enrollment.js";

describe("auth/claims", () => {
  const secret = "test-secret-key-minimum-32-chars!!";

  function makeClaim(overrides: Partial<AssignmentClaim> = {}): AssignmentClaim {
    return {
      v: 1,
      tenant_id: "tenant-1",
      config_id: "config-1",
      instance_uid: "abcdef1234567890",
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      ...overrides,
    };
  }

  it("sign and verify round-trip", async () => {
    const claim = makeClaim();
    const token = await signClaim(claim, secret);

    expect(token).toContain(".");
    const parts = token.split(".");
    expect(parts).toHaveLength(2);

    const verified = await verifyClaim(token, secret);
    expect(verified.tenant_id).toBe("tenant-1");
    expect(verified.config_id).toBe("config-1");
    expect(verified.instance_uid).toBe("abcdef1234567890");
    expect(verified.v).toBe(1);
  });

  it("rejects tampered payload", async () => {
    const claim = makeClaim();
    const token = await signClaim(claim, secret);
    const parts = token.split(".");
    // Tamper with payload
    const tampered = "AAAA" + parts[0].slice(4) + "." + parts[1];
    await expect(verifyClaim(tampered, secret)).rejects.toThrow();
  });

  it("rejects wrong secret", async () => {
    const claim = makeClaim();
    const token = await signClaim(claim, secret);
    await expect(verifyClaim(token, "wrong-secret")).rejects.toThrow("Invalid signature");
  });

  it("rejects expired claim", async () => {
    const claim = makeClaim({
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    });
    const token = await signClaim(claim, secret);
    await expect(verifyClaim(token, secret)).rejects.toThrow("Claim expired");
  });

  it("rejects invalid format", async () => {
    await expect(verifyClaim("not-a-valid-token", secret)).rejects.toThrow("Invalid claim format");
  });
});

describe("auth/enrollment", () => {
  it("generates token with correct prefix", () => {
    const token = generateEnrollmentToken();
    expect(token).toMatch(/^fp_enroll_/);
    expect(token.length).toBeGreaterThan(20);
  });

  it("generates unique tokens", () => {
    const t1 = generateEnrollmentToken();
    const t2 = generateEnrollmentToken();
    expect(t1).not.toBe(t2);
  });

  it("hash and verify round-trip", async () => {
    const token = generateEnrollmentToken();
    const hash = await hashEnrollmentToken(token);

    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);

    const valid = await verifyEnrollmentToken(token, hash);
    expect(valid).toBe(true);
  });

  it("rejects wrong token", async () => {
    const token = generateEnrollmentToken();
    const hash = await hashEnrollmentToken(token);

    const wrongToken = generateEnrollmentToken();
    const valid = await verifyEnrollmentToken(wrongToken, hash);
    expect(valid).toBe(false);
  });

  it("hash is deterministic", async () => {
    const token = "fp_enroll_fixed-test-value";
    const h1 = await hashEnrollmentToken(token);
    const h2 = await hashEnrollmentToken(token);
    expect(h1).toBe(h2);
  });
});
