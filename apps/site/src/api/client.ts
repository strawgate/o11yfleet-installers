// api/client.ts — Typed API client for o11yfleet.
// Replaces the old window.FP global with a modern, typed module.

import type { z } from "zod";
import {
  apiErrorResponseSchema,
  authLoginResponseSchema,
  type ApiErrorResponse,
  type AuthLoginResponse,
  type AuthUser,
} from "@o11yfleet/core/api";

import { stripUrlParam } from "./strip-url-param.js";

/* ------------------------------------------------------------------ */
/*  Error types                                                       */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number;
  code?: string;
  field?: string;
  detail?: string;
  constructor(message: string, status: number, body?: ApiErrorResponse) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.field = body?.field;
    this.detail = body?.detail;
  }
}

/** Thrown on 401/403 so the app can redirect to login. */
export class AuthError extends ApiError {
  constructor(message = "Session expired") {
    super(message, 401);
    this.name = "AuthError";
  }
}

/* ------------------------------------------------------------------ */
/*  API base detection                                                */
/* ------------------------------------------------------------------ */

function isLocalOverride(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function detectApiBase(): string {
  const host = window.location.hostname;
  const buildApiUrl = import.meta.env.VITE_O11YFLEET_API_URL?.trim();

  // In local development, use relative URLs by default so requests go through
  // vite's proxy (same-origin = cookies work). Allow ?api= override for direct access.
  if (host === "localhost" || host === "127.0.0.1") {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get("api") || localStorage.getItem("fp-api-base");
    if (apiParam) {
      const url = stripUrlParam(window.location.href, "api");
      window.history.replaceState({}, "", url);
      if (isLocalOverride(apiParam)) return apiParam;
    }
    // Use relative URLs (empty string) to leverage vite proxy; fall back to
    // explicit env var if set.
    if (!buildApiUrl) return "";
    return buildApiUrl;
  }

  if (buildApiUrl) return buildApiUrl;

  if (
    host === "staging.o11yfleet.com" ||
    host.endsWith(".staging.o11yfleet.com") ||
    host.startsWith("staging-")
  ) {
    return "https://staging-api.o11yfleet.com";
  }
  if (
    host === "dev.o11yfleet.com" ||
    host.endsWith(".dev.o11yfleet.com") ||
    host.startsWith("dev-")
  ) {
    return "https://dev-api.o11yfleet.com";
  }
  if (host.endsWith(".o11yfleet.com") || host === "o11yfleet.com") {
    return "https://api.o11yfleet.com";
  }
  // Handle Cloudflare Pages preview deployments - use the baked-in API target
  if (
    host.endsWith(".pages.dev") &&
    typeof __VITE_API_TARGET__ === "string" &&
    __VITE_API_TARGET__
  ) {
    return __VITE_API_TARGET__;
  }
  if (host.endsWith(".workers.dev")) {
    if (host === "o11yfleet-site-worker-staging.o11yfleet.workers.dev") {
      return "https://staging-api.o11yfleet.com";
    }
    if (host === "o11yfleet-site-worker-dev.o11yfleet.workers.dev") {
      return "https://dev-api.o11yfleet.com";
    }
    return "https://o11yfleet-worker.o11yfleet.workers.dev";
  }
  return "";
}

const _apiBase = detectApiBase();
localStorage.removeItem("fp-api-base");
export const apiBase: string = _apiBase;

export function apiUrl(path: string): string {
  return apiBase + path;
}

/* ------------------------------------------------------------------ */
/*  Core fetch helpers                                                */
/* ------------------------------------------------------------------ */

async function extractError(
  method: string,
  path: string,
  res: Response,
): Promise<ApiErrorResponse> {
  try {
    const parsed = apiErrorResponseSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data;
  } catch {
    /* no JSON body */
  }
  return { error: `${method} ${path}: ${res.status}` };
}

/** Low-level fetch wrapper — adds credentials, throws on auth failures. */
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(apiBase + path, { ...opts, credentials: "include" });
  if (res.status === 401) {
    throw new AuthError("Session expired");
  }
  if (res.status === 403) {
    const body = await extractError("", path, res);
    throw new ApiError(body.error || "Forbidden", 403, body);
  }
  return res;
}

/** GET JSON */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const body = await extractError("GET", path, res);
    throw new ApiError(body.error, res.status, body);
  }
  return res.json() as Promise<T>;
}

/** POST JSON */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errorBody = await extractError("POST", path, res);
    throw new ApiError(errorBody.error, res.status, errorBody);
  }
  return res.json() as Promise<T>;
}

/** POST raw text (e.g. YAML upload) */
export async function apiPostText<T>(path: string, text: string): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: text,
  });
  if (!res.ok) {
    const body = await extractError("POST", path, res);
    throw new ApiError(body.error, res.status, body);
  }
  return res.json() as Promise<T>;
}

/** PUT JSON */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = await extractError("PUT", path, res);
    throw new ApiError(errorBody.error, res.status, errorBody);
  }
  return res.json() as Promise<T>;
}

/** DELETE */
export async function apiDel<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok) {
    const body = await extractError("DELETE", path, res);
    throw new ApiError(body.error, res.status, body);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/*  Schema-validated helpers (mirrors worker's typedJsonResponse)     */
/* ------------------------------------------------------------------ */

/**
 * Validate a payload against a Zod schema. In dev/test, warn on mismatch
 * and return the parsed-or-raw value (don't throw — schema drift shouldn't
 * crash a page that already received the data). In prod, skip the check
 * for a zero-overhead pass-through.
 *
 * Mirrors the contract of `apps/worker/src/shared/responses.ts:typedJsonResponse`
 * so client and server share the same validate-only-in-dev posture.
 *
 * Caveat: on validation failure, we cast raw data to z.output<T>. For schemas
 * with `.transform()`, raw and parsed types diverge — schemas used here should
 * be plain object/extend shapes without transforms.
 */
function validateResponse<T extends z.ZodType>(
  schema: T,
  data: unknown,
  path: string,
): z.output<T> {
  if (import.meta.env.PROD) return data as z.output<T>;
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(`[typed-client] ${path} response failed schema validation:`, result.error.issues);
    return data as z.output<T>;
  }
  return result.data;
}

/** GET JSON with response-schema validation in dev. */
export async function apiGetTyped<T extends z.ZodType>(
  schema: T,
  path: string,
): Promise<z.output<T>> {
  const raw = await apiGet<unknown>(path);
  return validateResponse(schema, raw, path);
}

/** POST JSON with response-schema validation in dev. */
export async function apiPostTyped<T extends z.ZodType>(
  schema: T,
  path: string,
  body?: unknown,
): Promise<z.output<T>> {
  const raw = await apiPost<unknown>(path, body);
  return validateResponse(schema, raw, path);
}

/** PUT JSON with response-schema validation in dev. */
export async function apiPutTyped<T extends z.ZodType>(
  schema: T,
  path: string,
  body: unknown,
): Promise<z.output<T>> {
  const raw = await apiPut<unknown>(path, body);
  return validateResponse(schema, raw, path);
}

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                      */
/* ------------------------------------------------------------------ */

export type LoginResponse = AuthLoginResponse;

export interface User extends AuthUser {
  id: string;
}

export function normalizeUser(raw: AuthUser): User {
  const id = raw.id ?? raw.userId;
  if (!id) throw new ApiError("User response missing user id", 500);
  return {
    id,
    userId: raw.userId ?? raw.id,
    email: raw.email,
    name: raw.name,
    displayName: raw.displayName,
    role: raw.role,
    tenant_id: raw.tenant_id,
    tenantId: raw.tenantId ?? raw.tenant_id,
    isImpersonation: raw.isImpersonation,
    tenantStatus: raw.tenantStatus,
  };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(apiBase + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    let msg = "Login failed";
    let errorBody: ApiErrorResponse | undefined;
    try {
      const parsed = apiErrorResponseSchema.safeParse(await res.json());
      if (parsed.success) {
        errorBody = parsed.data;
        msg = parsed.data.error;
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status, errorBody);
  }
  const parsed = authLoginResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError("Invalid login response from server", 500);
  }
  return { user: normalizeUser(parsed.data.user) };
}

export async function logout(): Promise<void> {
  try {
    await fetch(apiBase + "/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    /* ignore network errors on logout */
  }
}
