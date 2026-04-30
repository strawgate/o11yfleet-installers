import type {
  AiGuidanceIntent,
  AiGuidanceRequest,
  AiGuidanceSurface,
  AiGuidanceTarget,
  AiLightFetch,
  AiPageContext,
} from "@o11yfleet/core/ai";

export interface BrowserContextFact {
  label: string;
  value: string;
  source?: string;
}

export interface BrowserContextSource {
  id: string;
  title?: string;
  surface?: AiGuidanceSurface;
  facts?: BrowserContextFact[];
  context?: Record<string, unknown>;
  targets?: AiGuidanceTarget[];
  pageContext?: Partial<AiPageContext>;
  lightFetches?: BrowserContextLightFetch[];
}

export interface BrowserContextLightFetch {
  key: string;
  label: string;
  load: () => Promise<unknown>;
}

export const MAX_BROWSER_CONTEXT_LIGHT_FETCHES = 2;

export interface BrowserContextSnapshot {
  route: string;
  title: string;
  surface: AiGuidanceSurface | null;
  visibleText: string;
  facts: BrowserContextFact[];
  context: Record<string, unknown>;
  targets: AiGuidanceTarget[];
  pageContext: AiPageContext | null;
  lightFetches: BrowserContextLightFetch[];
  capturedAt: string;
}

const visibleTextLimit = 6000;

export function inferAiSurface(pathname: string): AiGuidanceSurface | null {
  if (pathname === "/portal/overview" || pathname === "/portal") return "portal.overview";
  if (pathname === "/portal/configurations" || pathname.startsWith("/portal/configurations/")) {
    return "portal.configuration";
  }
  if (pathname === "/portal/agents" || pathname.startsWith("/portal/agents/")) {
    return "portal.agent";
  }
  if (pathname === "/portal/builder") return "portal.builder";
  if (pathname === "/admin/overview" || pathname === "/admin") return "admin.overview";
  if (pathname === "/admin/tenants" || pathname.startsWith("/admin/tenants/")) {
    return "admin.tenant";
  }
  if (pathname === "/admin/usage") return "admin.usage";
  return null;
}

export function compactVisibleText(text: string, limit = visibleTextLimit): string {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 1).trimEnd()}…`;
}

export function mergeBrowserContextSources(
  pathname: string,
  visibleText: string,
  sources: BrowserContextSource[],
  now = new Date(),
): BrowserContextSnapshot {
  const inferredSurface = inferAiSurface(pathname);
  const surface = sources.find((source) => source.surface)?.surface ?? inferredSurface;
  const title =
    sources.find((source) => source.title?.trim())?.title?.trim() ??
    routeTitle(pathname) ??
    "Current page";

  const context = {
    ...sources.reduce<Record<string, unknown>>(
      (merged, source) => ({ ...merged, ...source.context }),
      {},
    ),
    route: pathname,
    title,
  };

  return {
    route: pathname,
    title,
    surface,
    visibleText: compactVisibleText(visibleText),
    facts: sources.flatMap((source) => source.facts ?? []),
    context,
    targets: surface
      ? mergeTargets(
          surface,
          title,
          sources.flatMap((source) => source.targets ?? []),
        )
      : [],
    pageContext: mergePageContext(pathname, title, visibleText, sources),
    lightFetches: sources
      .flatMap((source) => source.lightFetches ?? [])
      .slice(0, MAX_BROWSER_CONTEXT_LIGHT_FETCHES),
    capturedAt: now.toISOString(),
  };
}

export function buildBrowserGuidanceRequest(
  snapshot: BrowserContextSnapshot,
  userPrompt: string,
  intent: AiGuidanceIntent = "suggest_next_action",
  options: { lightFetches?: AiLightFetch[] } = {},
): AiGuidanceRequest | null {
  if (!snapshot.surface || snapshot.targets.length === 0) return null;

  return {
    surface: snapshot.surface,
    intent,
    targets: snapshot.targets,
    user_prompt: compactVisibleText(userPrompt, 1000),
    context: {
      ...snapshot.context,
      captured_at: snapshot.capturedAt,
      visible_text: snapshot.visibleText,
      facts: snapshot.facts,
    },
    ...(snapshot.pageContext
      ? {
          page_context: {
            ...snapshot.pageContext,
            light_fetches: options.lightFetches ?? snapshot.pageContext.light_fetches ?? [],
          },
        }
      : {}),
  };
}

function mergeTargets(
  surface: AiGuidanceSurface,
  title: string,
  targets: AiGuidanceTarget[],
): AiGuidanceTarget[] {
  const pageTarget: AiGuidanceTarget = {
    key: "browser.page",
    label: title,
    surface,
    kind: "page",
  };
  const seen = new Set<string>();
  return [pageTarget, ...targets.filter((target) => target.surface === surface)]
    .filter((target) => {
      if (seen.has(target.key)) return false;
      seen.add(target.key);
      return true;
    })
    .slice(0, 32);
}

function routeTitle(pathname: string): string | null {
  const leaf = pathname.split("/").filter(Boolean).at(-1);
  if (!leaf) return null;
  return leaf.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function mergePageContext(
  route: string,
  title: string,
  visibleText: string,
  sources: BrowserContextSource[],
): AiPageContext | null {
  const pageContexts = sources.map((source) => source.pageContext).filter(Boolean);
  const compactedVisibleText = compactVisibleText(visibleText, 500);
  const visibleTextItems = compactedVisibleText ? [compactedVisibleText] : [];

  const merged: AiPageContext = {
    route,
    title,
    visible_text: [
      ...visibleTextItems,
      ...pageContexts.flatMap((context) => context?.visible_text ?? []),
    ].slice(0, 24),
    metrics: pageContexts.flatMap((context) => context?.metrics ?? []).slice(0, 32),
    tables: pageContexts.flatMap((context) => context?.tables ?? []).slice(0, 8),
    details: pageContexts.flatMap((context) => context?.details ?? []).slice(0, 48),
    light_fetches: pageContexts
      .flatMap((context) => context?.light_fetches ?? [])
      .slice(0, MAX_BROWSER_CONTEXT_LIGHT_FETCHES),
  };

  const activeTab = pageContexts.find((context) => context?.active_tab)?.active_tab;
  if (activeTab) merged.active_tab = activeTab;

  const filters = pageContexts.find((context) => context?.filters)?.filters;
  if (filters) merged.filters = filters;

  const selection = pageContexts.find((context) => context?.selection)?.selection;
  if (selection) merged.selection = selection;

  const yaml = pageContexts.find((context) => context?.yaml)?.yaml;
  if (yaml) merged.yaml = yaml;

  if (
    merged.visible_text.length === 0 &&
    merged.metrics.length === 0 &&
    merged.tables.length === 0 &&
    merged.details.length === 0 &&
    !merged.active_tab &&
    !merged.filters &&
    !merged.selection &&
    !merged.yaml
  ) {
    return null;
  }

  return merged;
}
