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
    // Craft a valid-signature JWT with v=2
    const { SignJWT } = await import("jose");
    const enc = new TextEncoder();
    const key = enc.encode(secret);
    const jwt = await new SignJWT({ v: 2, tenant_id: "t", config_id: "c" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(key);
    const token = `fp_enroll_${jwt}`;

    await expect(verifyEnrollmentToken(token, secret)).rejects.toThrow(
      "invalid or missing required claims",
    );
  });

  it("rejects token with missing tenant_id or config_id", async () => {
    const { SignJWT } = await import("jose");
    const enc = new TextEncoder();
    const key = enc.encode(secret);
    const jwt = await new SignJWT({ v: 1, tenant_id: "", config_id: "c" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setJti("id-1")
      .sign(key);
    const token = `fp_enroll_${jwt}`;

    await expect(verifyEnrollmentToken(token, secret)).rejects.toThrow(
      "invalid or missing required claims",
    );
  });

  it("rejects token with missing jti", async () => {
    const { SignJWT } = await import("jose");
    const enc = new TextEncoder();
    const key = enc.encode(secret);
    // Craft JWT without jti
    const jwt = await new SignJWT({ v: 1, tenant_id: "t", config_id: "c" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .sign(key);
    const token = `fp_enroll_${jwt}`;

    await expect(verifyEnrollmentToken(token, secret)).rejects.toThrow(
      "invalid or missing required claims",
    );
  });
});

// ─── API Keys ────────────────────────────────────────────────

describe("auth/api-keys", () => {
  const secret = "test-secret-key-minimum-32-chars!!";

  it("generate and verify round-trip", async () => {
    const { generateApiKey, verifyApiKey } = await import("../src/auth/api-keys.js");

    const { token, jti, expires_at } = await generateApiKey({
      tenant_id: "tenant-1",
      secret,
      label: "CI deploy key",
    });

    expect(token).toMatch(/^fp_key_/);
    expect(jti).toBeTruthy();
    expect(expires_at).toBeNull(); // no expiry

    const claim = await verifyApiKey(token, secret);
    expect(claim.tenant_id).toBe("tenant-1");
    expect(claim.v).toBe(1);
    expect(claim.jti).toBe(jti);
    expect(claim.label).toBe("CI deploy key");
    expect(claim.exp).toBe(0);
  });

  it("rejects tampered token", async () => {
    const { generateApiKey, verifyApiKey } = await import("../src/auth/api-keys.js");

    const { token } = await generateApiKey({ tenant_id: "t1", secret });
    // Flip a character in the payload
    const tampered = token.slice(0, 10) + "X" + token.slice(11);

    await expect(verifyApiKey(tampered, secret)).rejects.toThrow();
  });

  it("rejects wrong secret", async () => {
    const { generateApiKey, verifyApiKey } = await import("../src/auth/api-keys.js");

    const { token } = await generateApiKey({ tenant_id: "t1", secret });
    await expect(verifyApiKey(token, "wrong-secret-key-minimum-32-chars!!")).rejects.toThrow(
      "Invalid API key signature",
    );
  });

  it("rejects expired token", async () => {
    const { generateApiKey, verifyApiKey } = await import("../src/auth/api-keys.js");

    // Generate with 1 second expiry, then fake time forward
    const { token } = await generateApiKey({
      tenant_id: "t1",
      secret,
      expires_in_seconds: 1,
    });

    // Advance time past expiry
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    try {
      await expect(verifyApiKey(token, secret)).rejects.toThrow("API key expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("generates unique jti per call", async () => {
    const { generateApiKey } = await import("../src/auth/api-keys.js");

    const r1 = await generateApiKey({ tenant_id: "t1", secret });
    const r2 = await generateApiKey({ tenant_id: "t1", secret });
    expect(r1.jti).not.toBe(r2.jti);
    expect(r1.token).not.toBe(r2.token);
  });

  it("rejects non-api-key token", async () => {
    const { verifyApiKey } = await import("../src/auth/api-keys.js");
    await expect(verifyApiKey("not_an_api_key", secret)).rejects.toThrow("Not an API key");
  });

  it("rejects token with no dot separator", async () => {
    const { verifyApiKey } = await import("../src/auth/api-keys.js");
    await expect(verifyApiKey("fp_key_nodothere", secret)).rejects.toThrow(
      "Invalid API key format",
    );
  });

  it("isApiKey detects fp_key_ prefix", async () => {
    const { isApiKey, generateApiKey } = await import("../src/auth/api-keys.js");
    const { token } = await generateApiKey({ tenant_id: "t1", secret });
    expect(isApiKey(token)).toBe(true);
    expect(isApiKey("Bearer some-other-token")).toBe(false);
    expect(isApiKey("fp_enroll_something")).toBe(false);
  });

  it("respects expires_in_seconds", async () => {
    const { generateApiKey, verifyApiKey } = await import("../src/auth/api-keys.js");

    const { token, expires_at } = await generateApiKey({
      tenant_id: "t1",
      secret,
      expires_in_seconds: 86400,
    });

    expect(expires_at).toBeTruthy();
    const claim = await verifyApiKey(token, secret);
    expect(claim.exp).toBeGreaterThan(0);
    expect(claim.exp - claim.iat).toBe(86400);
  });

  it("rejects negative expires_in_seconds", async () => {
    const { generateApiKey } = await import("../src/auth/api-keys.js");
    await expect(
      generateApiKey({ tenant_id: "t1", secret, expires_in_seconds: -3600 }),
    ).rejects.toThrow("Invalid expires_in_seconds");
  });
});
