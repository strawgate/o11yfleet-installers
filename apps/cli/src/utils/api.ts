/**
 * API client for o11yfleet
 */

import { getApiUrl, getSession, getTenantId } from "./config.js";
import { output } from "./output.js";
import { getCommandName } from "./command-name.js";

// Track if we've already warned about credential precedence to avoid flooding stderr
let warnedApiKeyPrecedence = false;

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const apiUrl = await getApiUrl();
  const session = await getSession();
  const tenantId = await getTenantId();

  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  // Auth: prefer token env var or stored token, fall back to session cookie
  if (process.env.O11YFLEET_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.O11YFLEET_API_KEY}`;
    // Warn once per process when both API key and session are present
    if (!warnedApiKeyPrecedence && (session.token || session.cookie)) {
      console.warn(
        "Warning: Both O11YFLEET_API_KEY and a session are present. API key takes precedence.",
      );
      warnedApiKeyPrecedence = true;
    }
  } else if (session.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  } else if (session.cookie) {
    headers["Cookie"] = `fp_session=${session.cookie}`;
  }

  if (tenantId) {
    headers["X-Tenant-Id"] = tenantId;
  }

  let resp: Response;
  try {
    resp = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers,
    });
  } catch (err) {
    return {
      data: undefined,
      error: err instanceof Error ? err.message : String(err),
      status: 0,
    };
  }

  // Read body once as text, then parse appropriately
  const text = await resp.text();
  let data: T | undefined;
  let error: string | undefined;

  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(text) as { error?: string };
      if (!resp.ok) {
        error = json.error || resp.statusText;
      } else {
        data = json as T;
      }
    } catch {
      error = text || resp.statusText;
    }
  } else {
    if (!resp.ok) {
      error = text || resp.statusText;
    } else {
      // For plain-text responses on success, return the string directly.
      // Callers expecting JSON should handle type mismatches appropriately.
      data = text as unknown as T;
    }
  }

  if (!resp.ok && !error) {
    error = resp.statusText;
  }

  return {
    data,
    error,
    status: resp.status,
  };
}

export async function requireAuth(): Promise<void> {
  const session = await getSession();
  if (!session.cookie && !session.token && !process.env.O11YFLEET_API_KEY) {
    output.error(`Not logged in. Run '${getCommandName()} login' first.`);
    output.log("Or set O11YFLEET_API_KEY environment variable for CI.");
    process.exit(1);
  }
}

export async function getCurrentUser(): Promise<{
  userId: string;
  email: string;
  tenantId?: string;
}> {
  const resp = await apiRequest("/auth/me");
  if (resp.error || !resp.data) {
    throw new ApiError("Not authenticated", resp.status, resp.error);
  }
  const data = resp.data as { user?: { userId: string; email: string; tenantId?: string } };
  if (!data.user) {
    throw new ApiError("Not authenticated", resp.status, "No user in response");
  }
  return data.user;
}
