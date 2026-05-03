// Minimal GitHub REST API client.
//
// Pure transport — every call site passes its own bearer token (either an
// app JWT for /app/* endpoints, or an installation token for /repos/*).
// JSON encode/decode + base URL + the User-Agent + accept headers GitHub
// requires. Anything fancier (rate-limit retry, pagination) lives in
// caller code where it can be tuned per use case.

const GITHUB_API = "https://api.github.com";
const GITHUB_API_ORIGIN = "https://api.github.com";
const USER_AGENT = "o11yfleet-worker";
const ACCEPT = "application/vnd.github+json";
const API_VERSION = "2026-03-10";

export interface GithubApiOptions {
  /** Bearer token: app JWT or installation access token. */
  token: string;
  /** JSON-serializable body for POST/PATCH/PUT. */
  body?: unknown;
  /** Optional override of the User-Agent. */
  userAgent?: string;
  /** Optional fetch override for tests. */
  fetcher?: typeof fetch;
}

export interface GithubApiResponse<T> {
  status: number;
  ok: boolean;
  /** Parsed JSON body, or null for 204 / empty responses. */
  data: T | null;
  /** Raw response for callers that need headers (e.g. rate-limit). */
  response: Response;
}

/**
 * Issue a single GitHub REST API request. Returns parsed JSON for 2xx and
 * `{status, ok: false, data: {message, ...}}` for non-2xx — callers branch
 * on `ok` rather than throwing, so the workflow can decide whether to retry
 * or fail the step.
 */
export async function githubApi<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  opts: GithubApiOptions,
): Promise<GithubApiResponse<T>> {
  let url: string;
  if (path.startsWith("http")) {
    // Reject any caller-supplied absolute URL — prevents SSRF if a caller
    // is ever passed unsanitized input. Only GitHub API absolute URLs are
    // allowed (needed for the test mock path).
    let parsed: URL;
    try {
      parsed = new URL(path);
    } catch {
      throw new Error(`Invalid URL: ${path}`);
    }
    if (parsed.origin !== GITHUB_API_ORIGIN) {
      throw new Error(`URL must be on ${GITHUB_API_ORIGIN}: ${path}`);
    }
    url = path;
  } else {
    // Tolerate callers that pass paths without a leading slash so URL
    // joining stays predictable regardless of how each call site formats.
    const normalized = path.startsWith("/") ? path : `/${path}`;
    url = `${GITHUB_API}${normalized}`;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    Accept: ACCEPT,
    "User-Agent": opts.userAgent ?? USER_AGENT,
    "X-GitHub-Api-Version": API_VERSION,
  };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const fetcher = opts.fetcher ?? fetch;
  const response = await fetcher(url, { method, headers, body });
  // GitHub's empty responses (e.g. DELETE 204) shouldn't be JSON-parsed.
  let data: unknown = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
  }
  return {
    status: response.status,
    ok: response.ok,
    data: data as T | null,
    response,
  };
}
