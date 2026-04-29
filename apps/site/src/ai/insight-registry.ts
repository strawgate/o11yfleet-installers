import type {
  AiGuidanceIntent,
  AiGuidanceRequest,
  AiGuidanceSurface,
  AiGuidanceTarget,
  AiGuidanceTargetKind,
  AiPageContext,
} from "@o11yfleet/core/ai";

type InsightContext = Record<string, unknown>;

interface InsightTargetDefinition {
  key: string;
  label: string;
  kind: AiGuidanceTargetKind;
}

interface InsightSurfaceDefinition {
  surface: AiGuidanceSurface;
  targets: Record<string, InsightTargetDefinition>;
}

function defineInsightSurface<const TTargets extends Record<string, InsightTargetDefinition>>(
  surface: AiGuidanceSurface,
  targets: TTargets,
): { surface: AiGuidanceSurface; targets: TTargets } {
  return { surface, targets };
}

export const insightSurfaces = {
  portalOverview: defineInsightSurface("portal.overview", {
    page: {
      key: "overview.page",
      label: "Overview page",
      kind: "page",
    },
    configurations: {
      key: "overview.configurations",
      label: "Configurations metric",
      kind: "metric",
    },
    agents: {
      key: "overview.agents",
      label: "Agents metric",
      kind: "metric",
    },
    recentConfigurations: {
      key: "overview.recent-configurations",
      label: "Recent configurations table",
      kind: "table",
    },
  }),
  portalConfiguration: defineInsightSurface("portal.configuration", {
    page: {
      key: "configuration.page",
      label: "Configuration detail",
      kind: "page",
    },
    agents: {
      key: "configuration.agents",
      label: "Agents metric",
      kind: "metric",
    },
    versions: {
      key: "configuration.versions",
      label: "Versions metric",
      kind: "metric",
    },
    rollout: {
      key: "configuration.rollout",
      label: "Rollout section",
      kind: "section",
    },
    yaml: {
      key: "configuration.yaml",
      label: "YAML editor",
      kind: "editor_selection",
    },
    tokens: {
      key: "configuration.tokens",
      label: "Enrollment tokens metric",
      kind: "metric",
    },
  }),
  portalAgent: defineInsightSurface("portal.agent", {}),
  portalBuilder: defineInsightSurface("portal.builder", {
    page: {
      key: "builder.page",
      label: "Pipeline builder",
      kind: "page",
    },
    editor: {
      key: "builder.editor",
      label: "Visual editor plan",
      kind: "editor_selection",
    },
  }),
  adminOverview: defineInsightSurface("admin.overview", {
    page: {
      key: "admin.overview.page",
      label: "Admin overview",
      kind: "page",
    },
    tenants: {
      key: "admin.overview.tenants",
      label: "Tenants metric",
      kind: "metric",
    },
    configurations: {
      key: "admin.overview.configs",
      label: "Configurations metric",
      kind: "metric",
    },
    agents: {
      key: "admin.overview.agents",
      label: "Agents metric",
      kind: "metric",
    },
    recentTenants: {
      key: "admin.overview.recent-tenants",
      label: "Recent tenants table",
      kind: "table",
    },
  }),
  adminTenant: defineInsightSurface("admin.tenant", {
    page: {
      key: "admin.tenant.page",
      label: "Tenant detail",
      kind: "page",
    },
    configurations: {
      key: "admin.tenant.configurations",
      label: "Configurations section",
      kind: "section",
    },
    users: {
      key: "admin.tenant.users",
      label: "Users section",
      kind: "section",
    },
  }),
} as const;

export function insightTarget(
  surfaceDefinition: InsightSurfaceDefinition,
  target: InsightTargetDefinition,
  context?: InsightContext,
): AiGuidanceTarget {
  return {
    ...target,
    surface: surfaceDefinition.surface,
    ...(context ? { context } : {}),
  };
}

export function tabInsightTarget(
  surfaceDefinition: InsightSurfaceDefinition,
  keyPrefix: string,
  activeTab: string,
): AiGuidanceTarget {
  return {
    key: `${keyPrefix}.${activeTab}`,
    label: `${activeTab} tab`,
    surface: surfaceDefinition.surface,
    kind: "section",
  };
}

export function buildInsightRequest(
  surfaceDefinition: InsightSurfaceDefinition,
  targets: AiGuidanceTarget[],
  context: InsightContext,
  options: {
    intent?: AiGuidanceIntent;
    pageContext?: AiPageContext;
    userPrompt?: string;
  } = {},
): AiGuidanceRequest {
  return {
    surface: surfaceDefinition.surface,
    intent: options.intent ?? "suggest_next_action",
    targets,
    context,
    ...(options.pageContext ? { page_context: options.pageContext } : {}),
    ...(options.userPrompt ? { user_prompt: options.userPrompt } : {}),
  };
}
