import { describe, expect, it, beforeAll } from "vitest";
import { env, exports } from "cloudflare:workers";
import { setupD1 } from "./helpers.js";

/**
 * Tests for OIDC "provision" scope authentication.
 *
 * These tests verify the auth gating logic: OIDC tokens that don't verify
 * against GitHub's JWKS are rejected, and the scope is limited to
 * POST /api/admin/tenants only.
 */

function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`http://localhost${path}`, init), env, {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext);
}

describe("OIDC provision auth", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("rejects a non-JWT bearer token on admin routes", async () => {
    const res = await workerFetch("/api/admin/tenants", {
      method: "POST",
      headers: {
        Authorization: "Bearer not-a-valid-token",
        "Content-Type": "application/json",
        Origin: "https://app.o11yfleet.com",
      },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Admin access required");
  });

  it("rejects a fake JWT (invalid signature) on admin routes", async () => {
    // Craft a JWT-shaped token with valid base64url parts but invalid signature
    const header = btoa(JSON.stringify({ alg: "RS256", kid: "fake-kid", typ: "JWT" }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const payload = btoa(
      JSON.stringify({
        iss: "https://token.actions.githubusercontent.com",
        aud: "o11yfleet",
        sub: "repo:strawgate/o11yfleet-load:ref:refs/heads/main",
        repository: "strawgate/o11yfleet-load",
        exp: Math.floor(Date.now() / 1000) + 300,
        nbf: Math.floor(Date.now() / 1000) - 10,
        iat: Math.floor(Date.now() / 1000) - 10,
      }),
    )
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const signature = "ZmFrZS1zaWduYXR1cmU"; // "fake-signature" in base64url

    const fakeJwt = `${header}.${payload}.${signature}`;

    const res = await workerFetch("/api/admin/tenants", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fakeJwt}`,
        "Content-Type": "application/json",
        Origin: "https://app.o11yfleet.com",
      },
      body: JSON.stringify({ name: "test-oidc" }),
    });
    // Should be rejected — key not found in GitHub JWKS
    expect(res.status).toBe(403);
  });

  it("rejects JWT-shaped tokens that fail OIDC verification on non-POST admin routes", async () => {
    // With a fake JWT that can't be verified against GitHub JWKS,
    // OIDC claims won't be populated → falls through to session auth → 403.
    // The "oidc_scope_insufficient" path is only reachable with a real GitHub token
    // (tested via integration with o11yfleet-load workflow).
    const header = btoa(JSON.stringify({ alg: "RS256", kid: "fake-kid", typ: "JWT" }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const payload = btoa(JSON.stringify({ iss: "fake", aud: "o11yfleet" }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const fakeJwt = `${header}.${payload}.ZmFrZQ`;

    const res = await workerFetch("/api/admin/tenants", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${fakeJwt}`,
        Origin: "https://app.o11yfleet.com",
      },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Admin access required");
  });

  it("failed OIDC verification does not break /api/v1/ routes", async () => {
    // Even a failed OIDC verification shouldn't break v1 routes
    // (they fall through to the standard auth check)
    const res = await workerFetch("/api/v1/configurations", {
      method: "GET",
      headers: {
        Authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.eyJ0ZXN0IjoidHJ1ZSJ9.fake",
        "X-Tenant-Id": "nonexistent-tenant",
        Origin: "https://app.o11yfleet.com",
      },
    });
    // Should get 401 (OIDC verification fails, no bearer match, no session)
    expect(res.status).toBe(401);
  });
});
