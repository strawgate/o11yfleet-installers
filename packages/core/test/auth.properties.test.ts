// Property-based tests for the auth module. Crypto correctness +
// security boundary correctness for HMAC-signed claim and enrollment
// tokens. These supplement the example-based tests in auth.test.ts.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { signClaim, verifyClaim, type AssignmentClaim } from "../src/auth/claims.js";
import {
  generateEnrollmentToken,
  verifyEnrollmentToken,
  hashEnrollmentToken,
  verifyEnrollmentTokenHash,
} from "../src/auth/enrollment.js";
import { base64urlEncode, base64urlDecode } from "../src/auth/base64url.js";
import { timingSafeEqual } from "../src/auth/timing-safe-compare.js";

const SECRET = "property-test-secret-32-chars-long!";

// ─── base64url ────────────────────────────────────────────────────────

describe("property: base64url round-trip", () => {
  const byteArb = fc.uint8Array({ minLength: 0, maxLength: 256 });

  it("encode → decode is identity", () => {
    fc.assert(
      fc.property(byteArb, (bytes) => {
        const round = base64urlDecode(base64urlEncode(bytes));
        if (round.length !== bytes.length) return false;
        for (let i = 0; i < bytes.length; i += 1) if (round[i] !== bytes[i]) return false;
        return true;
      }),
    );
  });

  it("encoded output has no `+`, `/`, or `=` characters", () => {
    fc.assert(
      fc.property(byteArb, (bytes) => {
        const enc = base64urlEncode(bytes);
        return !/[+/=]/.test(enc);
      }),
    );
  });
});

// ─── timing-safe compare ──────────────────────────────────────────────

describe("property: timingSafeEqual", () => {
  it("a === a (reflexive)", () => {
    fc.assert(fc.property(fc.string(), (s) => timingSafeEqual(s, s)));
  });

  it("returns true iff a === b under JS string equality", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => timingSafeEqual(a, b) === (a === b)));
  });

  it("returns false for strings of different length", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        (a, b) => {
          if (a.length === b.length) return true; // skip equal-length pairs
          return !timingSafeEqual(a, b);
        },
      ),
    );
  });

  it("symmetric: timingSafeEqual(a, b) === timingSafeEqual(b, a)", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        (a, b) => timingSafeEqual(a, b) === timingSafeEqual(b, a),
      ),
    );
  });
});

// ─── claims ────────────────────────────────────────────────────────────

const claimArb: fc.Arbitrary<AssignmentClaim> = fc.record({
  v: fc.constant(1 as const),
  tenant_id: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.length > 0),
  config_id: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.length > 0),
  instance_uid: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.length > 0),
  generation: fc.integer({ min: 0, max: 1_000_000 }),
  iat: fc.integer({ min: 0, max: 2_000_000_000 }),
  exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: 2_000_000_000 }),
});

describe("property: signClaim/verifyClaim", () => {
  it("verify(sign(claim)) returns the original claim fields", async () => {
    await fc.assert(
      fc.asyncProperty(claimArb, async (claim) => {
        const token = await signClaim(claim, SECRET);
        const verified = await verifyClaim(token, SECRET);
        return (
          verified.tenant_id === claim.tenant_id &&
          verified.config_id === claim.config_id &&
          verified.instance_uid === claim.instance_uid &&
          verified.generation === claim.generation &&
          verified.v === 1
        );
      }),
      { numRuns: 25 }, // crypto is slow; keep run count modest
    );
  });

  it("any tampered byte in the payload makes verification fail", async () => {
    await fc.assert(
      fc.asyncProperty(claimArb, fc.integer({ min: 0, max: 100 }), async (claim, idx) => {
        const token = await signClaim(claim, SECRET);
        // Flip a single character in the payload portion (before the dot).
        const dot = token.indexOf(".");
        if (dot < 1) return true; // skip pathological tokens
        const flipAt = idx % dot;
        const original = token[flipAt]!;
        const flipped = original === "A" ? "B" : "A";
        const tampered = token.slice(0, flipAt) + flipped + token.slice(flipAt + 1);
        if (tampered === token) return true; // no-op; skip
        try {
          await verifyClaim(tampered, SECRET);
          return false; // shouldn't have verified
        } catch {
          return true;
        }
      }),
      { numRuns: 20 },
    );
  });

  it("claim signed with secret A does not verify with secret B", async () => {
    await fc.assert(
      fc.asyncProperty(
        claimArb,
        fc.string({ minLength: 32, maxLength: 64 }).filter((s) => s !== SECRET),
        async (claim, otherSecret) => {
          const token = await signClaim(claim, SECRET);
          await expect(verifyClaim(token, otherSecret)).rejects.toThrow();
          return true;
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ─── claim validation paths ────────────────────────────────────────────
//
// signClaim requires a typed AssignmentClaim, so we can't generate
// invalid claims through it directly. Instead we manually construct
// signed tokens with adversarial payloads to verify the rejection
// paths in verifyClaim.

async function signRawPayload(payload: object, secret: string): Promise<string> {
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
  return `${payloadB64}.${base64urlEncode(new Uint8Array(sig))}`;
}

describe("verifyClaim validation paths", () => {
  const validClaim = (): AssignmentClaim => ({
    v: 1,
    tenant_id: "t",
    config_id: "c",
    instance_uid: "u",
    generation: 1,
    iat: 0,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  it("rejects unsupported version (v !== 1)", async () => {
    const payload = { ...validClaim(), v: 2 };
    const token = await signRawPayload(payload, SECRET);
    await expect(verifyClaim(token, SECRET)).rejects.toThrow(/Unsupported claim version/);
  });

  it("rejects missing tenant_id", async () => {
    const payload = { ...validClaim(), tenant_id: "" };
    const token = await signRawPayload(payload, SECRET);
    await expect(verifyClaim(token, SECRET)).rejects.toThrow(/missing required fields/);
  });

  it("rejects missing config_id", async () => {
    const payload = { ...validClaim(), config_id: "" };
    const token = await signRawPayload(payload, SECRET);
    await expect(verifyClaim(token, SECRET)).rejects.toThrow(/missing required fields/);
  });

  it("rejects missing instance_uid", async () => {
    const payload = { ...validClaim(), instance_uid: "" };
    const token = await signRawPayload(payload, SECRET);
    await expect(verifyClaim(token, SECRET)).rejects.toThrow(/missing required fields/);
  });

  it("rejects non-numeric exp", async () => {
    const payload = { ...validClaim(), exp: "soon" };
    const token = await signRawPayload(payload, SECRET);
    await expect(verifyClaim(token, SECRET)).rejects.toThrow(/Claim expired/);
  });

  it("rejects expired claims", async () => {
    const payload = { ...validClaim(), exp: 1 };
    const token = await signRawPayload(payload, SECRET);
    await expect(verifyClaim(token, SECRET)).rejects.toThrow(/Claim expired/);
  });

  it("rejects malformed token (no dot)", async () => {
    await expect(verifyClaim("no-dot-here", SECRET)).rejects.toThrow(/Invalid claim format/);
  });

  it("rejects token with extra dots", async () => {
    await expect(verifyClaim("a.b.c", SECRET)).rejects.toThrow(/Invalid claim format/);
  });
});

// ─── enrollment tokens ─────────────────────────────────────────────────

describe("property: enrollment tokens", () => {
  const tenantArb = fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.length > 0);
  const configArb = fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.length > 0);

  it("verify(generate(tenant,config)) returns those values", async () => {
    await fc.assert(
      fc.asyncProperty(tenantArb, configArb, async (tenant_id, config_id) => {
        const { token } = await generateEnrollmentToken({ tenant_id, config_id, secret: SECRET });
        const claim = await verifyEnrollmentToken(token, SECRET);
        return claim.tenant_id === tenant_id && claim.config_id === config_id;
      }),
      { numRuns: 25 },
    );
  });

  it("hash is deterministic for the same token", async () => {
    await fc.assert(
      fc.asyncProperty(tenantArb, configArb, async (tenant_id, config_id) => {
        const { token } = await generateEnrollmentToken({ tenant_id, config_id, secret: SECRET });
        const h1 = await hashEnrollmentToken(token);
        const h2 = await hashEnrollmentToken(token);
        return h1 === h2;
      }),
      { numRuns: 15 },
    );
  });

  it("verifyEnrollmentTokenHash matches iff hash matches the token", async () => {
    await fc.assert(
      fc.asyncProperty(tenantArb, configArb, async (tenant_id, config_id) => {
        const { token } = await generateEnrollmentToken({ tenant_id, config_id, secret: SECRET });
        const hash = await hashEnrollmentToken(token);
        const ok = await verifyEnrollmentTokenHash(token, hash);
        const wrong = await verifyEnrollmentTokenHash(token, hash.slice(0, -2) + "AA");
        return ok === true && wrong === false;
      }),
      { numRuns: 15 },
    );
  });

  it("tampering the signature portion makes verification fail", async () => {
    await fc.assert(
      fc.asyncProperty(tenantArb, configArb, async (tenant_id, config_id) => {
        const { token } = await generateEnrollmentToken({ tenant_id, config_id, secret: SECRET });
        // Replace the signature portion with `XXXX...`
        const dot = token.lastIndexOf(".");
        const tampered = token.slice(0, dot + 1) + "X".repeat(token.length - dot - 1);
        try {
          await verifyEnrollmentToken(tampered, SECRET);
          return false;
        } catch {
          return true;
        }
      }),
      { numRuns: 15 },
    );
  });

  it("hashes for distinct tokens collide with negligible probability", async () => {
    await fc.assert(
      fc.asyncProperty(tenantArb, async (tenant_id) => {
        // Two enrollment tokens for the same tenant differ in jti, so hashes differ.
        const a = await generateEnrollmentToken({ tenant_id, config_id: "c", secret: SECRET });
        const b = await generateEnrollmentToken({ tenant_id, config_id: "c", secret: SECRET });
        const ha = await hashEnrollmentToken(a.token);
        const hb = await hashEnrollmentToken(b.token);
        return ha !== hb;
      }),
      { numRuns: 10 },
    );
  });
});

describe("enrollment input validation", () => {
  it("rejects an empty secret", async () => {
    await expect(
      generateEnrollmentToken({ tenant_id: "t", config_id: "c", secret: "" }),
    ).rejects.toThrow(/secret must not be empty/);
  });

  it("rejects a malformed JWT (not a valid token)", async () => {
    const token = "fp_enroll_not.a.valid-jwt";
    await expect(verifyEnrollmentToken(token, SECRET)).rejects.toThrow();
  });
});
