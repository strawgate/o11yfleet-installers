import { useQuery } from "@tanstack/react-query";
import type { AiGuidanceRequest, AiGuidanceResponse } from "@o11yfleet/core/ai";
import { ApiError, apiPost } from "../client";

type GuidanceRoute = "admin" | "portal";

interface GuidanceHookOptions {
  enabled?: boolean;
}

function guidancePath(route: GuidanceRoute): string {
  return route === "admin" ? "/api/admin/ai/guidance" : "/api/v1/ai/guidance";
}

export function useAiGuidance(
  route: GuidanceRoute,
  request: AiGuidanceRequest | null,
  options: GuidanceHookOptions = {},
) {
  return useQuery({
    queryKey: ["ai-guidance", route, request],
    queryFn: () => apiPost<AiGuidanceResponse>(guidancePath(route), request),
    enabled: (options.enabled ?? true) && request !== null,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) return false;
      return failureCount < 1;
    },
  });
}

export function usePortalGuidance(
  request: AiGuidanceRequest | null,
  options?: GuidanceHookOptions,
) {
  return useAiGuidance("portal", request, options);
}

export function useAdminGuidance(request: AiGuidanceRequest | null, options?: GuidanceHookOptions) {
  return useAiGuidance("admin", request, options);
}
