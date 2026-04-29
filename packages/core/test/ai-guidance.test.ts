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
    {
      key: "overview.agents-table",
      label: "Agents table",
      surface: "portal.overview" as const,
      kind: "table" as const,
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

  it("promotes clustered offline collectors sharing a config hash", () => {
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
          ],
          tables: [
            {
              key: "agents",
              label: "Agents",
              columns: ["id", "desired_config_hash", "status"],
              rows: [
                { id: "a1", desired_config_hash: "cfg-1234567890abcdef", status: "offline" },
                {
                  id: "a2",
                  desired_config_hash: "cfg-1234567890abcdef",
                  status: "disconnected",
                },
                { id: "a3", desired_config_hash: "cfg-1234567890abcdef", status: "offline" },
                { id: "a4", desired_config_hash: "cfg-other", status: "connected" },
              ],
              total_rows: 4,
            },
          ],
        },
      },
      { scopeLabel: "tenant:test" },
    );

    const cluster = candidates.find(
      (candidate) => candidate.signal === "offline_cluster_by_config",
    );
    expect(cluster).toMatchObject({
      evidence_level: "correlated",
      item: {
        target_key: "overview.agents-table",
        severity: "critical",
      },
    });
    expect(cluster?.item.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Offline in cluster", value: "3/3" }),
      ]),
    );
    expect(candidates.some((candidate) => candidate.signal === "connectivity_gap")).toBe(false);
  });

  it("prefers the larger offline cluster when ratios tie", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "portal.overview",
        targets,
        context: {},
        page_context: {
          route: "/portal/overview",
          tables: [
            {
              key: "agents",
              label: "Agents",
              columns: ["id", "desired_config_hash", "status"],
              rows: [
                { id: "a1", desired_config_hash: "cfg-small", status: "offline" },
                { id: "a2", desired_config_hash: "cfg-small", status: "offline" },
                { id: "a3", desired_config_hash: "cfg-small", status: "offline" },
                { id: "b1", desired_config_hash: "cfg-large", status: "offline" },
                { id: "b2", desired_config_hash: "cfg-large", status: "offline" },
                { id: "b3", desired_config_hash: "cfg-large", status: "offline" },
                { id: "b4", desired_config_hash: "cfg-large", status: "offline" },
              ],
              total_rows: 7,
            },
          ],
        },
      },
      { scopeLabel: "tenant:test" },
    );

    const cluster = candidates.find(
      (candidate) => candidate.signal === "offline_cluster_by_config",
    );
    expect(cluster?.item.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Cluster config hash", value: "cfg-large" }),
        expect.objectContaining({ label: "Offline in cluster", value: "4/4" }),
      ]),
    );
  });

  it("does not cluster generic configuration labels as hashes", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "portal.overview",
        targets,
        context: {},
        page_context: {
          route: "/portal/overview",
          tables: [
            {
              key: "agents",
              label: "Agents",
              columns: ["id", "configuration", "status"],
              rows: [
                { id: "a1", configuration: "production", status: "offline" },
                { id: "a2", configuration: "production", status: "offline" },
                { id: "a3", configuration: "production", status: "offline" },
              ],
              total_rows: 3,
            },
          ],
        },
      },
      { scopeLabel: "tenant:test" },
    );

    expect(candidates).toEqual([]);
  });

  it("does not promote scattered offline rows as a cluster", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "portal.overview",
        targets,
        context: {
          total_agents: 8,
          connected_agents: 7,
          healthy_agents: 7,
        },
        page_context: {
          route: "/portal/overview",
          tables: [
            {
              key: "agents",
              label: "Agents",
              columns: ["id", "desired_config_hash", "status"],
              rows: [
                { id: "a1", desired_config_hash: "cfg-a", status: "offline" },
                { id: "a2", desired_config_hash: "cfg-b", status: "connected" },
                { id: "a3", desired_config_hash: "cfg-c", status: "offline" },
                { id: "a4", desired_config_hash: "cfg-d", status: "connected" },
              ],
              total_rows: 4,
            },
          ],
        },
      },
      { scopeLabel: "tenant:test" },
    );

    expect(candidates).toEqual([]);
  });

  it("promotes admin onboarding gaps only for meaningful plan cohorts", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "admin.overview",
        targets: [
          { key: "admin.overview.page", label: "Admin", surface: "admin.overview", kind: "page" },
          {
            key: "admin.overview.tenants",
            label: "Tenants",
            surface: "admin.overview",
            kind: "section",
          },
        ],
        context: {
          total_tenants: 12,
          total_configurations: 8,
          onboarding_gap_ratio: 0.5,
          plan_zero_state_rates: [
            { plan: "pro", tenant_count: 6, zero_config_rate: 0.67, zero_user_rate: 0.17 },
            { plan: "free", tenant_count: 6, zero_config_rate: 0.33, zero_user_rate: 0 },
          ],
        },
      },
      { scopeLabel: "admin" },
    );

    expect(candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ signal: "admin_onboarding_gap_by_plan" })]),
    );
  });

  it("suppresses admin onboarding gaps for tiny plan cohorts", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "admin.overview",
        targets: [
          { key: "admin.overview.page", label: "Admin", surface: "admin.overview", kind: "page" },
        ],
        context: {
          total_tenants: 4,
          total_configurations: 1,
          onboarding_gap_ratio: 0.75,
          plan_zero_state_rates: [
            { plan: "enterprise", tenant_count: 2, zero_config_rate: 1, zero_user_rate: 0 },
          ],
        },
      },
      { scopeLabel: "admin" },
    );

    expect(
      candidates.some((candidate) => candidate.signal === "admin_onboarding_gap_by_plan"),
    ).toBe(false);
  });

  it("promotes admin capacity pressure only when normalized by tenant limits", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "admin.overview",
        targets: [
          { key: "admin.overview.page", label: "Admin", surface: "admin.overview", kind: "page" },
        ],
        context: {
          total_tenants: 10,
          total_configurations: 50,
          tenant_limit_utilization: [
            { plan: "pro", config_limit_utilization_ratio: 0.9 },
            { plan: "pro", config_limit_utilization_ratio: 0.88 },
            { plan: "pro", config_limit_utilization_ratio: 0.92 },
            { plan: "pro", config_limit_utilization_ratio: 0.4 },
            { plan: "pro", config_limit_utilization_ratio: 0.6 },
          ],
        },
      },
      { scopeLabel: "admin" },
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "admin_capacity_pressure_by_limit" }),
      ]),
    );
  });

  it("suppresses admin capacity pressure when the measured cohort is small", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "admin.overview",
        targets: [
          { key: "admin.overview.page", label: "Admin", surface: "admin.overview", kind: "page" },
        ],
        context: {
          total_tenants: 3,
          total_configurations: 12,
          tenant_limit_utilization: [
            { plan: "pro", config_limit_utilization_ratio: 0.95 },
            { plan: "pro", config_limit_utilization_ratio: 0.95 },
          ],
        },
      },
      { scopeLabel: "admin" },
    );

    expect(
      candidates.some((candidate) => candidate.signal === "admin_capacity_pressure_by_limit"),
    ).toBe(false);
  });

  it("promotes cross-tenant concentration only with enough configurations", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "admin.overview",
        targets: [
          { key: "admin.overview.page", label: "Admin", surface: "admin.overview", kind: "page" },
          {
            key: "admin.overview.configs",
            label: "Configurations",
            surface: "admin.overview",
            kind: "section",
          },
        ],
        context: {
          total_tenants: 12,
          total_configurations: 40,
          tenant_config_concentration_top3_ratio: 0.7,
        },
      },
      { scopeLabel: "admin" },
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "admin_cross_tenant_concentration" }),
      ]),
    );
  });

  it("suppresses cross-tenant concentration on small fleets", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "admin.overview",
        targets: [
          { key: "admin.overview.page", label: "Admin", surface: "admin.overview", kind: "page" },
        ],
        context: {
          total_tenants: 3,
          total_configurations: 6,
          tenant_config_concentration_top3_ratio: 1,
        },
      },
      { scopeLabel: "admin" },
    );

    expect(
      candidates.some((candidate) => candidate.signal === "admin_cross_tenant_concentration"),
    ).toBe(false);
  });

  it("promotes tenant detail capacity pressure from explicit limits", () => {
    const candidates = analyzeGuidanceCandidates(
      {
        surface: "admin.tenant",
        targets: [
          { key: "admin.tenant.page", label: "Tenant", surface: "admin.tenant", kind: "page" },
        ],
        context: {
          config_count: 9,
          max_configs: 10,
          config_limit_utilization: 0.9,
        },
      },
      { scopeLabel: "admin" },
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "admin_tenant_capacity_pressure" }),
      ]),
    );
  });
});
