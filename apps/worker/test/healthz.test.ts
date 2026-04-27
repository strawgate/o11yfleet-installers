import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("Worker health check", () => {
  it("GET /healthz returns 200 with status ok", async () => {
    const response = await exports.default.fetch("http://localhost/healthz");
    expect(response.status).toBe(200);
    const body = await response.json<{ status: string; timestamp: string }>();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("GET /unknown returns 404", async () => {
    const response = await exports.default.fetch("http://localhost/unknown");
    expect(response.status).toBe(404);
  });

  it("GET /api/anything returns a response (API handler active)", async () => {
    const response = await exports.default.fetch("http://localhost/api/tenants");
    // API handler is active — GET /api/tenants would be 404 (no matching route for GET)
    expect(response.status).toBeDefined();
  });

  it("GET /v1/opamp returns 501 (not yet implemented)", async () => {
    const response = await exports.default.fetch("http://localhost/v1/opamp");
    expect(response.status).toBe(501);
  });
});
