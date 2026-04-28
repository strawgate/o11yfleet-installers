// api/client.ts — Typed API client for o11yfleet.
// Replaces the old window.FP global with a modern, typed module.

/* ------------------------------------------------------------------ */
/*  Error types                                                       */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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

export function detectApiBase(): string {
  const host = window.location.hostname;

  // Allow ?api= override only in local development
  if (host === "localhost" || host === "127.0.0.1") {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("api") || localStorage.getItem("fp-api-base");
    if (explicit) return explicit;
    return "http://localhost:8787";
  }

  if (host.endsWith(".o11yfleet.com") || host === "o11yfleet.com") {
    return "https://api.o11yfleet.com";
  }
  if (host.endsWith(".pages.dev")) {
    return "https://o11yfleet-worker.o11yfleet.workers.dev";
  }
  return "";
}

export const apiBase: string = detectApiBase();
if (apiBase) localStorage.setItem("fp-api-base", apiBase);

/* ------------------------------------------------------------------ */
/*  Core fetch helpers                                                */
/* ------------------------------------------------------------------ */

async function extractError(method: string, path: string, res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* no JSON body */
  }
  return `${method} ${path}: ${res.status}`;
}

/** Low-level fetch wrapper — adds credentials, throws on auth failures. */
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(apiBase + path, { ...opts, credentials: "include" });
  if (res.status === 401) {
    throw new AuthError("Session expired");
  }
  if (res.status === 403) {
    const msg = await extractError("", path, res);
    throw new ApiError(msg || "Forbidden", 403);
  }
  return res;
}

/** GET JSON */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new ApiError(await extractError("GET", path, res), res.status);
  return res.json() as Promise<T>;
}

/** POST JSON */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(await extractError("POST", path, res), res.status);
  return res.json() as Promise<T>;
}

/** POST raw text (e.g. YAML upload) */
export async function apiPostText<T>(path: string, text: string): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: text,
  });
  if (!res.ok) throw new ApiError(await extractError("POST", path, res), res.status);
  return res.json() as Promise<T>;
}

/** PUT JSON */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(await extractError("PUT", path, res), res.status);
  return res.json() as Promise<T>;
}

/** DELETE */
export async function apiDel<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await extractError("DELETE", path, res), res.status);
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/*  Auth helpers                                                      */
/* ------------------------------------------------------------------ */

export interface LoginResponse {
  user: User;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  role?: string;
  tenant_id?: string;
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
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<LoginResponse>;
}

export async function logout(): Promise<void> {
  try {
    await fetch(apiBase + "/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    /* ignore network errors on logout */
  }
}
