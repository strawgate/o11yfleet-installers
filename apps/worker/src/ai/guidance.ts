import {
  aiChatRequestSchema,
  aiGuidanceRequestSchema,
  type AiChatRequest,
  type AiGuidanceRequest,
} from "@o11yfleet/core/ai";
import type { Env } from "../index.js";
import { AiProviderError, generateAiGuidance, streamAiChat } from "./provider.js";

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
  env: Env,
  tenantId: string,
): Promise<Response> {
  const input = await readGuidanceRequest(request);
  if (!input.surface.startsWith("portal.")) {
    throw new AiApiError("Portal AI route requires a portal surface", 400);
  }

  const response = await generateGuidanceResponse(input, env, `tenant:${tenantId}`);
  return Response.json(response);
}

export async function handleTenantChatRequest(
  request: Request,
  env: Env,
  tenantId: string,
): Promise<Response> {
  const input = await readChatRequest(request);
  if (!input.context.surface.startsWith("portal.")) {
    throw new AiApiError("Portal AI route requires a portal surface", 400);
  }

  return generateChatResponse(input, env, `tenant:${tenantId}`);
}

export async function handleAdminGuidanceRequest(request: Request, env: Env): Promise<Response> {
  const input = await readGuidanceRequest(request);
  if (!input.surface.startsWith("admin.")) {
    throw new AiApiError("Admin AI route requires an admin surface", 400);
  }

  const response = await generateGuidanceResponse(input, env, "admin");
  return Response.json(response);
}

export async function handleAdminChatRequest(request: Request, env: Env): Promise<Response> {
  const input = await readChatRequest(request);
  if (!input.context.surface.startsWith("admin.")) {
    throw new AiApiError("Admin AI route requires an admin surface", 400);
  }

  return generateChatResponse(input, env, "admin");
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

async function readChatRequest(request: Request): Promise<AiChatRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AiApiError("Invalid JSON in request body", 400);
  }

  const parsed = aiChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AiApiError("Invalid AI chat request", 400);
  }
  return parsed.data;
}

async function generateGuidanceResponse(input: AiGuidanceRequest, env: Env, scopeLabel: string) {
  try {
    return await generateAiGuidance(input, { env, scopeLabel });
  } catch (err) {
    if (err instanceof AiProviderError) {
      throw new AiApiError(err.message, 502);
    }
    throw err;
  }
}

async function generateChatResponse(input: AiChatRequest, env: Env, scopeLabel: string) {
  try {
    return await streamAiChat(input, { env, scopeLabel });
  } catch (err) {
    if (err instanceof AiProviderError) {
      throw new AiApiError(err.message, 502);
    }
    throw err;
  }
}
