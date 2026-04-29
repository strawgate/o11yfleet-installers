import { describe, expect, it } from "vitest";
import {
  aiGuidanceRequestSchema,
  aiGuidanceResponseSchema,
  analyzeGuidanceCandidates,
} from "../src/ai/index.js";

describe("ai guidance contracts", () => {
  it("accepts a valid page guidance request", () => {
    const parsed = aiGuidanceRequestSchema.parse({
      surface: "portal.overview",
      intent: "triage_state",
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
      page_context: {
        route: "/portal/overview",
        title: "Fleet overview",
        metrics: [
          { key: "total_agents", label: "Total collectors", value: 10 },
          { key: "connected_agents", label: "Connected collectors", value: 8 },
        ],
        tables: [
          {
            key: "recent_configurations",
            label: "Recent configurations",
            columns: ["name", "status"],
            rows: [{ name: "prod", status: "active" }],
            total_rows: 1,
          },
        ],
      },
    });

    expect(parsed.surface).toBe("portal.overview");
    expect(parsed.intent).toBe("triage_state");
    expect(parsed.page_context?.metrics[0]?.key).toBe("total_agents");
    expect(parsed.targets[0]?.key).toBe("overview.health");
  });

  it("defaults intent and page context collection fields", () => {
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
      page_context: {
        route: "/portal/overview",
      },
    });

    expect(parsed.intent).toBe("suggest_next_action");
    expect(parsed.page_context?.metrics).toEqual([]);
    expect(parsed.page_context?.tables).toEqual([]);
    expect(parsed.page_context?.light_fetches).toEqual([]);
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

describe("ai insight candidates", () => {
  const targets = [
    {
      key: "overview.page",
      label: "Overview page",
      surface: "portal.overview" as const,
      kind: "page" as const,
    },
    {
      key: "overview.agents",
      label: "Agents metric",
      surface: "portal.overview" as const,
      kind: "metric" as const,
    },
  ];

  it("does not promote moderate raw count gaps without better evidence", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "portal.overview",
        targets,
        context: {
          total_agents: 10,
          connected_agents: 8,
          healthy_agents: 8,
        },
      },
      { scopeLabel: "tenant:test" },
    );

    expect(candidates).toEqual([]);
  });

  it("promotes explicit policy threshold crossings with evidence", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "portal.overview",
        targets,
        context: {},
        page_context: {
          route: "/portal/overview",
          metrics: [
            { key: "total_agents", label: "Total collectors", value: 10 },
            { key: "connected_agents", label: "Connected collectors", value: 4 },
            { key: "healthy_agents", label: "Healthy collectors", value: 3 },
          ],
        },
      },
      { scopeLabel: "tenant:test" },
    );

    expect(candidates[0]).toMatchObject({
      signal: "connectivity_gap",
      evidence_level: "policy_threshold",
      item: {
        target_key: "overview.agents",
        severity: "warning",
      },
    });
    expect(candidates[0]?.rationale).toContain("not a historical anomaly");
    expect(candidates[0]?.item.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Offline share", value: "60%" })]),
    );
  });

  it("keeps admin setup gaps separate from fleet health anomalies", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "admin.overview",
        targets: [
          {
            key: "admin.overview.page",
            label: "Admin overview",
            surface: "admin.overview",
            kind: "page",
          },
        ],
        context: {
          total_tenants: 2,
          total_configurations: 0,
        },
      },
      { scopeLabel: "admin" },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.signal).toBe("tenant_setup_gap");
    expect(candidates[0]?.item.detail).toContain("onboarding/setup gap");
  });
});
