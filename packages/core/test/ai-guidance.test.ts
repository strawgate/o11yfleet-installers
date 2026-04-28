import { describe, expect, it } from "vitest";
import { aiGuidanceRequestSchema, aiGuidanceResponseSchema } from "../src/ai/guidance.js";

describe("ai guidance contracts", () => {
  it("accepts a valid page guidance request", () => {
    const parsed = aiGuidanceRequestSchema.parse({
      surface: "portal.overview",
      targets: [
        {
          key: "overview.health",
          label: "Fleet health summary",
          surface: "portal.overview",
          kind: "metric",
        },
      ],
      context: {
        total_agents: 10,
        connected_agents: 8,
        healthy_agents: 7,
      },
    });

    expect(parsed.surface).toBe("portal.overview");
    expect(parsed.targets[0]?.key).toBe("overview.health");
  });

  it("rejects unknown surfaces", () => {
    expect(() =>
      aiGuidanceRequestSchema.parse({
        surface: "portal.unknown",
        targets: [
          {
            key: "overview.health",
            label: "Fleet health summary",
            surface: "portal.overview",
            kind: "metric",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects empty target sets", () => {
    expect(() =>
      aiGuidanceRequestSchema.parse({
        surface: "portal.overview",
        targets: [],
      }),
    ).toThrow();
  });

  it("rejects targets from a different surface", () => {
    expect(() =>
      aiGuidanceRequestSchema.parse({
        surface: "portal.overview",
        targets: [
          {
            key: "admin.health",
            label: "Admin health",
            surface: "admin.overview",
            kind: "metric",
          },
        ],
      }),
    ).toThrow(/target surface/);
  });

  it("rejects duplicate target keys", () => {
    expect(() =>
      aiGuidanceRequestSchema.parse({
        surface: "portal.overview",
        targets: [
          {
            key: "overview.health",
            label: "Fleet health summary",
            surface: "portal.overview",
            kind: "metric",
          },
          {
            key: "overview.health",
            label: "Fleet health table",
            surface: "portal.overview",
            kind: "table",
          },
        ],
      }),
    ).toThrow(/target keys/);
  });

  it("requires href for navigation actions", () => {
    expect(() =>
      aiGuidanceResponseSchema.parse({
        summary: "Found one guidance item.",
        generated_at: "2026-04-28T00:00:00.000Z",
        items: [
          {
            target_key: "overview.health",
            headline: "2 collectors offline",
            detail: "Two enrolled collectors are not currently connected.",
            severity: "warning",
            confidence: 0.8,
            action: {
              kind: "open_page",
              label: "Review agents",
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("validates the model response envelope", () => {
    const parsed = aiGuidanceResponseSchema.parse({
      summary: "Found one guidance item.",
      generated_at: "2026-04-28T00:00:00.000Z",
      model: "fixture",
      items: [
        {
          target_key: "overview.health",
          headline: "2 collectors offline",
          detail: "Two enrolled collectors are not currently connected.",
          severity: "warning",
          confidence: 0.8,
          evidence: [{ label: "Total collectors", value: "10", source: "tenant:demo" }],
          action: {
            kind: "open_page",
            label: "Review agents",
            href: "/portal/agents",
          },
        },
      ],
    });

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.severity).toBe("warning");
  });
});
