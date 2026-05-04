// Shared HTTP helpers — single source of truth for CORS, security headers, and CSRF.
//
// Previously duplicated across index.ts, hono-app.ts, and hono-admin-app.ts.

import type { Env } from "../index.js";
import { isAllowedCorsOrigin, PRODUCTION_ORIGINS } from "./origins.js";

/**
 * Build CORS headers from an already-extracted origin string.
 * Preferred in Hono middleware where the origin is already available from context.
 */
export function getCorsHeadersForOrigin(origin: string, env: Env): Record<string, string> {
  const allowed = isAllowedCorsOrigin(origin, env.ENVIRONMENT);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : PRODUCTION_ORIGINS[0]!,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Tenant-Id",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

/**
 * Build CORS headers from a Request (extracts Origin header automatically).
 * Preferred in the legacy index.ts router.
 */
export function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  return getCorsHeadersForOrigin(origin, env);
}

/** Clone a response and apply CORS headers derived from the request. */
export function addCorsHeaders(resp: Response, request: Request, env: Env): Response {
  const corsResp = new Response(resp.body, resp);
  const corsHeaders = getCorsHeaders(request, env);
  for (const [k, v] of Object.entries(corsHeaders)) {
    corsResp.headers.set(k, v);
  }
  return corsResp;
}

/** Append standard security headers to a response (mutates in-place). */
export function addSecurityHeaders(resp: Response): Response {
  resp.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  resp.headers.set("X-Content-Type-Options", "nosniff");
  resp.headers.set("X-Frame-Options", "DENY");
  resp.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  resp.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return resp;
}

/** HTTP methods that do not mutate state — exempt from CSRF checks. */
export const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF origin validation. Returns true when the request Origin (or Referer
 * fallback) is a known-good origin for the current environment.
 */
export function isTrustedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (origin) {
    return isAllowedCorsOrigin(origin, env.ENVIRONMENT);
  }
  // Fallback: same-origin requests may omit Origin; check Referer
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return isAllowedCorsOrigin(refOrigin, env.ENVIRONMENT);
    } catch {
      return false;
    }
  }
  // No Origin or Referer — reject (browsers always send one on cross-origin)
  return false;
}
