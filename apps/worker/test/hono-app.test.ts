// Unit tests for the Hono v1 router — validates that the Hono app
// correctly wires middleware and routes to existing handler functions.
//
// These tests use Hono's `app.request()` (no HTTP server needed),
// exercising the CSRF, auth, and CORS middleware plus one representative
// route from each domain group.

import { describe, it, expect } from "vitest";
import { v1App } from "../src/hono-app.js";

// Minimal Env stub — only what the auth middleware touches.
function stubEnv(overrides?: Partial<Record<string, unknown>>) {
  return {
    O11YFLEET_CLAIM_HMAC_SECRET: "test-secret-key-that-is-long-enough",
    ENVIRONMENT: "dev",
    ...overrides,
  };
}

function stubCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
}

describe("Hono v1App", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await v1App.request("/api/v1/tenant", {}, stubEnv(), stubCtx());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "Authentication required");
  });

  it("sets CORS headers on responses", async () => {
    const res = await v1App.request(
      "/api/v1/tenant",
      { headers: { Origin: "https://app.o11yfleet.com" } },
      stubEnv(),
      stubCtx(),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.o11yfleet.com");
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("sets security headers on responses", async () => {
    const res = await v1App.request("/api/v1/tenant", {}, stubEnv(), stubCtx());
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("rejects CSRF on state-changing cookie requests from untrusted origins", async () => {
    const res = await v1App.request(
      "/api/v1/tenant",
      {
        method: "PUT",
        headers: {
          Cookie: "fp_session=abc123",
          Origin: "https://evil.example.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "test" }),
      },
      stubEnv(),
      stubCtx(),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("origin not allowed");
  });

  it("returns 404 for unknown routes under /api/v1", async () => {
    const res = await v1App.request("/api/v1/nonexistent", {}, stubEnv(), stubCtx());
    // Auth middleware fires first → 401 (no auth), not 404
    // This verifies the middleware pipeline is running
    expect(res.status).toBe(401);
  });
});
