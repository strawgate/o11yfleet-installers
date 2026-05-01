import { describe, it, expect, vi } from "vitest";
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

  it("handles many rapid verifications efficiently (cache regression)", async () => {
    const claim = makeClaim();
    const token = await signClaim(claim, secret);
    await Promise.all(Array.from({ length: 50 }, () => verifyClaim(token, secret)));
  });

  it("concurrent sign + verify with same secret does not race", async () => {
    const claim = makeClaim();
    const token = await signClaim(claim, secret);
    await Promise.all([
      signClaim(claim, secret),
      signClaim(claim, secret),
      verifyClaim(token, secret),
      verifyClaim(token, secret),
    ]);
  });
});

describe("auth/enrollment", () => {
  const secret = "test-enrollment-secret-32-chars!!";

  async function makeToken(overrides: { expires_in_seconds?: number } = {}) {
    return generateEnrollmentToken({
      tenant_id: "tenant-1",
      config_id: "config-1",
      secret,
      ...overrides,
    });
  }

  it("generates token with correct prefix", async () => {
    const { token } = await makeToken();
    expect(token).toMatch(/^fp_enroll_/);
    expect(token.length).toBeGreaterThan(20);
    expect(token).toContain(".");
  });

  it("generates unique tokens", async () => {
    const { token: t1 } = await makeToken();
    const { token: t2 } = await makeToken();
    expect(t1).not.toBe(t2);
  });

  it("verify round-trip extracts claim", async () => {
    const { token } = await makeToken();
    const claim = await verifyEnrollmentToken(token, secret);
    expect(claim.tenant_id).toBe("tenant-1");
    expect(claim.config_id).toBe("config-1");
    expect(claim.v).toBe(1);
    expect(claim.jti).toBeDefined();
  });

  it("rejects wrong secret", async () => {
    const { token } = await makeToken();
    await expect(verifyEnrollmentToken(token, "wrong-secret-32chars!!!!!!!!!!!!")).rejects.toThrow(
      "Invalid enrollment token signature",
    );
  });

  it("rejects expired token", async () => {
    // Generate token "in the past" so it's already expired
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() - 7200_000); // 2 hours ago
    const { token } = await generateEnrollmentToken({
      tenant_id: "tenant-1",
      config_id: "config-1",
      secret,
      expires_in_seconds: 3600, // 1 hour TTL, but issued 2 hours ago → expired
    });
    vi.useRealTimers();
    await expect(verifyEnrollmentToken(token, secret)).rejects.toThrow("Enrollment token expired");
  });

  it("rejects negative expires_in_seconds", async () => {
    await expect(
      generateEnrollmentToken({
        tenant_id: "tenant-1",
        config_id: "config-1",
        secret,
        expires_in_seconds: -3600,
      }),
    ).rejects.toThrow("Invalid expires_in_seconds");
  });

  it("rejects NaN expires_in_seconds", async () => {
    await expect(
      generateEnrollmentToken({
        tenant_id: "tenant-1",
        config_id: "config-1",
        secret,
        expires_in_seconds: NaN,
      }),
    ).rejects.toThrow("Invalid expires_in_seconds");
  });

  it("accepts token with no expiry (exp=0)", async () => {
    const { token } = await makeToken(); // no expires_in_seconds → exp=0
    const claim = await verifyEnrollmentToken(token, secret);
    expect(claim.exp).toBe(0);
  });

  it("hash is deterministic", async () => {
    const { token } = await makeToken();
    const h1 = await hashEnrollmentToken(token);
    const h2 = await hashEnrollmentToken(token);
    expect(h1).toBe(h2);
  });

  it("rejects non-enrollment token", async () => {
    await expect(verifyEnrollmentToken("not_an_enrollment_token", secret)).rejects.toThrow(
      "Not an enrollment token",
    );
  });

  it("rejects token with no dot separator (invalid format)", async () => {
    // fp_enroll_ prefix but no dot → should throw "Invalid enrollment token format"
    await expect(verifyEnrollmentToken("fp_enroll_nodothere", secret)).rejects.toThrow(
      "Invalid enrollment token format",
    );
  });

  it("rejects token with unsupported version", async () => {
    // Craft a valid-signature token but with v=2
    const jti = crypto.randomUUID();
    const payload = { v: 2, tenant_id: "t", config_id: "c", iat: 0, exp: 0, jti };
    const { base64urlEncode } = await import("../src/auth/base64url.js");
    const enc = new TextEncoder();
    const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
    const sigB64 = base64urlEncode(new Uint8Array(sig));
    const token = `fp_enroll_${payloadB64}.${sigB64}`;

    await expect(verifyEnrollmentToken(token, secret)).rejects.toThrow(
      "Unsupported enrollment token version",
    );
  });

  it("rejects token with missing tenant_id or config_id", async () => {
    const { base64urlEncode } = await import("../src/auth/base64url.js");
    const enc = new TextEncoder();
    const payload = { v: 1, tenant_id: "", config_id: "c", iat: 0, exp: 0, jti: "id-1" };
    const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
    const sigB64 = base64urlEncode(new Uint8Array(sig));
    const token = `fp_enroll_${payloadB64}.${sigB64}`;

    await expect(verifyEnrollmentToken(token, secret)).rejects.toThrow("missing required fields");
  });

  it("rejects token with missing jti", async () => {
    const { base64urlEncode } = await import("../src/auth/base64url.js");
    const enc = new TextEncoder();
    // Craft payload without jti field
    const payload = { v: 1, tenant_id: "t", config_id: "c", iat: 0, exp: 0 };
    const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
    const sigB64 = base64urlEncode(new Uint8Array(sig));
    const token = `fp_enroll_${payloadB64}.${sigB64}`;

    await expect(verifyEnrollmentToken(token, secret)).rejects.toThrow("missing token ID (jti)");
  });
});
