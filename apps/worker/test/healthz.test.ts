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
    const response = await exports.default.fetch("http://localhost/api/admin/tenants");
    // API handler is active and admin routes reject unauthenticated requests.
    expect(response.status).toBe(403);
  });

  it("GET /v1/opamp without upgrade returns 426", async () => {
    const response = await exports.default.fetch("http://localhost/v1/opamp");
    expect(response.status).toBe(426);
  });
});
