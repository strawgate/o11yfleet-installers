import {
  aiGuidanceRequestSchema,
  aiGuidanceResponseSchema,
  type AiGuidanceItem,
  type AiGuidanceRequest,
  type AiGuidanceResponse,
  type AiGuidanceTarget,
} from "@o11yfleet/core/ai";

export class AiApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AiApiError";
    Object.setPrototypeOf(this, AiApiError.prototype);
  }
}

export async function handleTenantGuidanceRequest(
  request: Request,
  tenantId: string,
): Promise<Response> {
  const input = await readGuidanceRequest(request);
  if (!input.surface.startsWith("portal.")) {
    throw new AiApiError("Portal AI route requires a portal surface", 400);
  }

  const response = buildDeterministicGuidance(input, {
    model: "o11yfleet-guidance-fixture",
    scopeLabel: `tenant:${tenantId}`,
  });
  return Response.json(response);
}

export async function handleAdminGuidanceRequest(request: Request): Promise<Response> {
  const input = await readGuidanceRequest(request);
  if (!input.surface.startsWith("admin.")) {
    throw new AiApiError("Admin AI route requires an admin surface", 400);
  }

  const response = buildDeterministicGuidance(input, {
    model: "o11yfleet-guidance-fixture",
    scopeLabel: "admin",
  });
  return Response.json(response);
}

async function readGuidanceRequest(request: Request): Promise<AiGuidanceRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AiApiError("Invalid JSON in request body", 400);
  }

  const parsed = aiGuidanceRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AiApiError("Invalid AI guidance request", 400);
  }
  return parsed.data;
}

function buildDeterministicGuidance(
  input: AiGuidanceRequest,
  opts: { model: string; scopeLabel: string },
): AiGuidanceResponse {
  const items: AiGuidanceItem[] = [];
  const pageTarget = targetFor(input, "page") ?? input.targets[0]!;
  const metricTarget = targetFor(input, "metric") ?? pageTarget;
  const sectionTarget = targetFor(input, "section") ?? pageTarget;

  const totalAgents = numberFromContext(input.context, "total_agents");
  const connectedAgents = numberFromContext(input.context, "connected_agents");
  const healthyAgents = numberFromContext(input.context, "healthy_agents");
  const configCount =
    numberFromContext(input.context, "configs_count") ??
    numberFromContext(input.context, "total_configurations");
  const activeTokens = numberFromContext(input.context, "total_active_tokens");
  const tenantCount = numberFromContext(input.context, "total_tenants");

  if (totalAgents !== null && connectedAgents !== null && connectedAgents < totalAgents) {
    const offline = totalAgents - connectedAgents;
    items.push({
      target_key: metricTarget.key,
      headline: `${offline} collector${offline === 1 ? "" : "s"} offline`,
      detail:
        "Some enrolled collectors are not currently connected. Check whether the gap is concentrated in one configuration before changing rollout policy.",
      severity: offline / Math.max(totalAgents, 1) > 0.25 ? "critical" : "warning",
      confidence: 0.8,
      evidence: [
        { label: "Total collectors", value: String(totalAgents), source: opts.scopeLabel },
        { label: "Connected collectors", value: String(connectedAgents), source: opts.scopeLabel },
      ],
      action: { kind: "open_page", label: "Review agents", href: "/portal/agents" },
    });
  }

  if (
    healthyAgents !== null &&
    connectedAgents !== null &&
    connectedAgents > 0 &&
    healthyAgents < connectedAgents
  ) {
    const unhealthy = connectedAgents - healthyAgents;
    items.push({
      target_key: sectionTarget.key,
      headline: `${unhealthy} connected collector${unhealthy === 1 ? "" : "s"} unhealthy`,
      detail:
        "Connected but unhealthy collectors usually indicate config status, resource pressure, or exporter failures rather than network loss.",
      severity: unhealthy / connectedAgents > 0.2 ? "critical" : "warning",
      confidence: 0.74,
      evidence: [
        { label: "Connected collectors", value: String(connectedAgents), source: opts.scopeLabel },
        { label: "Healthy collectors", value: String(healthyAgents), source: opts.scopeLabel },
      ],
      action: { kind: "open_page", label: "Inspect unhealthy agents", href: "/portal/agents" },
    });
  }

  if (configCount === 0) {
    items.push({
      target_key: pageTarget.key,
      headline: "No managed configurations yet",
      detail:
        "There is not enough fleet data for optimization guidance until at least one configuration and collector are connected.",
      severity: "notice",
      confidence: 0.95,
      evidence: [{ label: "Configurations", value: "0", source: opts.scopeLabel }],
      action: {
        kind: "open_page",
        label: "Create configuration",
        href: "/portal/configurations",
      },
    });
  }

  if (opts.scopeLabel === "admin" && tenantCount !== null && tenantCount > 0 && configCount === 0) {
    items.push({
      target_key: pageTarget.key,
      headline: "Tenants exist without configurations",
      detail:
        "The admin view shows tenants but no configurations. This is likely an onboarding or seed-data gap rather than a fleet health issue.",
      severity: "notice",
      confidence: 0.76,
      evidence: [
        { label: "Tenants", value: String(tenantCount), source: opts.scopeLabel },
        { label: "Configurations", value: "0", source: opts.scopeLabel },
      ],
      action: { kind: "open_page", label: "Open tenants", href: "/admin/tenants" },
    });
  }

  if (activeTokens !== null && activeTokens > 0 && configCount === 0) {
    items.push({
      target_key: sectionTarget.key,
      headline: "Active enrollment tokens without configurations",
      detail:
        "Enrollment tokens should normally be attached to managed configurations. Verify that the overview context is complete before sharing new tokens.",
      severity: "warning",
      confidence: 0.7,
      evidence: [
        { label: "Active tokens", value: String(activeTokens), source: opts.scopeLabel },
        { label: "Configurations", value: "0", source: opts.scopeLabel },
      ],
    });
  }

  const summary =
    items.length > 0
      ? `Found ${items.length} guidance item${items.length === 1 ? "" : "s"} from the provided ${input.surface} context.`
      : `No non-obvious guidance found in the provided ${input.surface} context.`;

  return aiGuidanceResponseSchema.parse({
    summary,
    items: items.slice(0, 12),
    generated_at: new Date().toISOString(),
    model: opts.model,
  });
}

function targetFor(
  input: AiGuidanceRequest,
  kind: AiGuidanceTarget["kind"],
): AiGuidanceTarget | null {
  return input.targets.find((target) => target.kind === kind) ?? null;
}

function numberFromContext(context: Record<string, unknown>, key: string): number | null {
  const value = context[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
