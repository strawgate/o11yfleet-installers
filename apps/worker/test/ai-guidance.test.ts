import { describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { authHeaders } from "./helpers.js";
import { handleV1Request } from "../src/routes/v1/index.js";
import type { AiGuidanceResponse } from "@o11yfleet/core/ai";

const overviewRequest = {
  surface: "portal.overview",
  targets: [
    {
      key: "overview.page",
      label: "Overview page",
      surface: "portal.overview",
      kind: "page",
    },
    {
      key: "overview.fleet-health",
      label: "Fleet health cards",
      surface: "portal.overview",
      kind: "metric",
    },
  ],
  context: {
    total_agents: 10,
    connected_agents: 7,
    healthy_agents: 6,
    configs_count: 2,
  },
};

describe("AI guidance routes", () => {
  it("generates tenant-scoped portal guidance with validated response shape", async () => {
    const request = new Request("http://localhost/api/v1/ai/guidance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overviewRequest),
    });
    const response = await handleV1Request(request, env, new URL(request.url), "tenant-ai-test");

    expect(response.status).toBe(200);
    const body = await response.json<AiGuidanceResponse>();
    expect(body.model).toBe("o11yfleet-guidance-fixture");
    expect(body.summary).toContain("portal.overview");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.target_key).toBe("overview.fleet-health");
  });

  it("rejects admin surfaces on the tenant route", async () => {
    const request = new Request("http://localhost/api/v1/ai/guidance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...overviewRequest,
        surface: "admin.overview",
        targets: [
          {
            key: "admin.page",
            label: "Admin page",
            surface: "admin.overview",
            kind: "page",
          },
        ],
      }),
    });
    const response = await handleV1Request(request, env, new URL(request.url), "tenant-ai-test");

    expect(response.status).toBe(400);
  });

  it("generates admin guidance only on admin route", async () => {
    const response = await exports.default.fetch("http://localhost/api/admin/ai/guidance", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        surface: "admin.overview",
        targets: [
          {
            key: "admin.page",
            label: "Admin overview",
            surface: "admin.overview",
            kind: "page",
          },
        ],
        context: {
          total_tenants: 3,
          total_configurations: 0,
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<AiGuidanceResponse>();
    expect(body.items.some((item) => item.headline.includes("Tenants"))).toBe(true);
  });
});
