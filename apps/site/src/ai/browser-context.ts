import type {
  AiGuidanceIntent,
  AiGuidanceRequest,
  AiGuidanceSurface,
  AiGuidanceTarget,
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
}

export interface BrowserContextSnapshot {
  route: string;
  title: string;
  surface: AiGuidanceSurface | null;
  visibleText: string;
  facts: BrowserContextFact[];
  context: Record<string, unknown>;
  targets: AiGuidanceTarget[];
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
    capturedAt: now.toISOString(),
  };
}

export function buildBrowserGuidanceRequest(
  snapshot: BrowserContextSnapshot,
  userPrompt: string,
  intent: AiGuidanceIntent = "suggest_next_action",
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
