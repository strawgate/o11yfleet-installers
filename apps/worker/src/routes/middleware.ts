// Auth middleware stubs
// These will be replaced with real SSO/JWT validation later

import type { Env } from "../index.js";

/** Context extracted from auth headers/tokens */
export interface AuthContext {
  /** For admin routes: true if caller is admin */
  isAdmin: boolean;
  /** For tenant-scoped routes: the tenant ID */
  tenantId: string | null;
  /** Display name (email, username, etc.) */
  identity: string;
}

/**
 * Extract admin auth context.
 * Current stub: trusts X-Admin header (will be replaced with SSO).
 */
export function requireAdmin(_request: Request, _env: Env): AuthContext {
  // TODO: Replace with real admin SSO validation
  // For now, all /api/admin requests are trusted (secured by API_SECRET in ingress)
  return {
    isAdmin: true,
    tenantId: null,
    identity: "admin",
  };
}

/**
 * Extract tenant-scoped auth context.
 * Current stub: reads tenant ID from X-Tenant-Id header or URL.
 * Will be replaced with SSO token → org → tenant mapping.
 */
export function requireTenant(request: Request, _env: Env): AuthContext {
  const tenantId = request.headers.get("X-Tenant-Id");
  if (!tenantId) {
    throw new AuthError("X-Tenant-Id header required", 401);
  }
  return {
    isAdmin: false,
    tenantId,
    identity: "user",
  };
}

/**
 * Admin impersonation: extract tenant from admin context.
 * Allows admin to act as a specific tenant.
 */
export function requireAdminOrTenant(request: Request, _env: Env): AuthContext {
  const adminHeader = request.headers.get("X-Admin");
  const tenantId = request.headers.get("X-Tenant-Id");

  if (adminHeader) {
    return {
      isAdmin: true,
      tenantId: tenantId, // Admin can optionally scope to a tenant
      identity: "admin",
    };
  }

  if (!tenantId) {
    throw new AuthError("Authentication required", 401);
  }

  return {
    isAdmin: false,
    tenantId,
    identity: "user",
  };
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
