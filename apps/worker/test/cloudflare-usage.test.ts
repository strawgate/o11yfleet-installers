import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCloudflareUsage } from "../src/cloudflare-usage.js";
import type { Env } from "../src/index.js";

const baseEnv = {
  CLOUDFLARE_USAGE_ACCOUNT_ID: "account-1",
  CLOUDFLARE_USAGE_API_TOKEN: "token-1",
  CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME: "worker-1",
  CLOUDFLARE_USAGE_D1_DATABASE_ID: "database-1",
  CLOUDFLARE_USAGE_R2_BUCKET_NAME: "bucket-1",
  CLOUDFLARE_USAGE_ANALYTICS_DATASET: "queue_events",
} as unknown as Env;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

describe("Cloudflare usage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds Analytics Engine SQL with a validated dataset and quoted time window", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push({ input, init });
      const url = String(input);
      if (url.includes("/analytics_engine/sql")) {
        return jsonResponse({ data: [{ date: "2026-04-29", events: 2 }] });
      }
      return jsonResponse({ data: { viewer: { accounts: [{}] } } });
    });

    await buildCloudflareUsage(baseEnv, new Date("2026-04-29T12:34:56.000Z"));

    const sqlCall = calls.find((call) => String(call.input).includes("/analytics_engine/sql"));
    expect(sqlCall).toBeDefined();
    expect(sqlCall?.init?.body).toContain("FROM queue_events");
    expect(sqlCall?.init?.body).toContain("timestamp >= '2026-04-01T00:00:00Z'");
    expect(sqlCall?.init?.body).toContain("timestamp <= '2026-04-29T12:34:56.000Z'");
  });

  it("rejects unsafe Analytics Engine dataset identifiers before querying SQL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { viewer: { accounts: [{}] } } }));

    const usage = await buildCloudflareUsage(
      {
        ...baseEnv,
        CLOUDFLARE_USAGE_ANALYTICS_DATASET: "queue_events; DROP TABLE queue_events",
      } as unknown as Env,
      new Date("2026-04-29T12:34:56.000Z"),
    );

    const queues = usage.services.find((service) => service.id === "queues");
    expect(queues?.status).toBe("error");
    expect(queues?.error).toContain("valid SQL identifier");
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/analytics_engine/sql")),
    ).toBe(false);
  });
});
