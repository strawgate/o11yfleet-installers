// Transport tests for the GitHub API client. Mock fetch via the
// `fetcher` injection — we don't want any real network in the suite.

import { describe, expect, it, vi } from "vitest";
import { githubApi } from "../src/github/api.js";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function makeFetcher(
  body: string,
  status = 200,
  contentType = "application/json",
): {
  fetcher: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetcher: typeof fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    // Node's Response constructor rejects bodies on 204/205/304; coerce
    // to null in that case so tests can simulate empty responses.
    const bodyForResponse = status === 204 || status === 205 || status === 304 ? null : body;
    return new Response(bodyForResponse, {
      status,
      headers: { "Content-Type": contentType },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("githubApi", () => {
  it("sends Authorization, Accept, User-Agent, and Api-Version headers", async () => {
    const { fetcher, calls } = makeFetcher(`{"id":1}`);
    await githubApi("GET", "/repos/o/r", { token: "t-1", fetcher });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer t-1");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["User-Agent"]).toBe("o11yfleet-worker");
    expect(headers["X-GitHub-Api-Version"]).toBe("2026-03-10");
  });

  it("prefixes relative paths with the GitHub API base", async () => {
    const { fetcher, calls } = makeFetcher(`{}`);
    await githubApi("GET", "/repos/o/r", { token: "t", fetcher });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r");
  });

  it("normalizes relative paths missing a leading slash", async () => {
    const { fetcher, calls } = makeFetcher(`{}`);
    await githubApi("GET", "repos/o/r", { token: "t", fetcher });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r");
  });

  it("passes absolute URLs through unchanged", async () => {
    const { fetcher, calls } = makeFetcher(`{}`);
    await githubApi("GET", "https://api.github.com/repos/o/r/contents/x", { token: "t", fetcher });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/contents/x");
  });

  it("rejects absolute URLs outside the GitHub API origin", async () => {
    const { fetcher } = makeFetcher(`{}`);
    await expect(
      githubApi("GET", "https://evil.example.com/path", { token: "t", fetcher }),
    ).rejects.toThrow("URL must be on https://api.github.com");
  });

  it("serializes body as JSON and sets Content-Type", async () => {
    const { fetcher, calls } = makeFetcher(`{}`);
    await githubApi("POST", "/x", { token: "t", body: { hello: "world" }, fetcher });
    const init = calls[0]!.init;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ hello: "world" });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns parsed JSON for 2xx with ok: true", async () => {
    const { fetcher } = makeFetcher(`{"id":42,"name":"thing"}`);
    const res = await githubApi<{ id: number; name: string }>("GET", "/x", { token: "t", fetcher });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: 42, name: "thing" });
  });

  it("returns the body on non-2xx with ok: false", async () => {
    const { fetcher } = makeFetcher(`{"message":"nope","status":"404"}`, 404);
    const res = await githubApi<{ message: string }>("GET", "/x", { token: "t", fetcher });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.data?.message).toBe("nope");
  });

  it("returns null data on 204 (no JSON parse)", async () => {
    const { fetcher } = makeFetcher("", 204, "text/plain");
    const res = await githubApi("DELETE", "/x", { token: "t", fetcher });
    expect(res.status).toBe(204);
    expect(res.data).toBeNull();
  });

  it("wraps non-JSON bodies as {message: text}", async () => {
    const { fetcher } = makeFetcher("plain error text", 500, "text/plain");
    const res = await githubApi<{ message: string }>("GET", "/x", { token: "t", fetcher });
    expect(res.ok).toBe(false);
    expect(res.data?.message).toBe("plain error text");
  });
});
