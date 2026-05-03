// Wrapper tests for createCheckRun / updateCheckRun.
// Mocked fetch via the same `fetcher` injection pattern used by api.test.ts.

import { describe, expect, it, vi } from "vitest";
import { createCheckRun, updateCheckRun } from "../src/github/check-runs.js";

interface FetchCall {
  url: string;
  method?: string;
  body?: unknown;
}

function makeFetcher(
  responseBody: object,
  status = 201,
): {
  fetcher: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetcher: typeof fetch = vi.fn(async (url, init) => {
    const i = init ?? {};
    let parsed: unknown;
    try {
      parsed = i.body ? JSON.parse(String(i.body)) : undefined;
    } catch {
      parsed = i.body;
    }
    calls.push({ url: String(url), method: i.method, body: parsed });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("createCheckRun", () => {
  it("POSTs to /repos/{owner}/{repo}/check-runs with the right body shape", async () => {
    const { fetcher, calls } = makeFetcher({
      id: 999,
      html_url: "https://github.com/o/r/runs/999",
      status: "in_progress",
      conclusion: null,
    });
    const created = await createCheckRun(
      "ghs-x",
      {
        owner: "octo",
        repo: "cat",
        head_sha: "abcd1234",
        name: "o11yfleet / config validation",
        status: "in_progress",
        external_id: "validate-octo-cat-abcd1234",
      },
      { fetcher },
    );

    expect(created.id).toBe(999);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/octo/cat/check-runs");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({
      head_sha: "abcd1234",
      name: "o11yfleet / config validation",
      status: "in_progress",
      external_id: "validate-octo-cat-abcd1234",
    });
  });

  it("propagates the output (summary + annotations) when present", async () => {
    const { fetcher, calls } = makeFetcher({
      id: 1,
      html_url: "x",
      status: "completed",
      conclusion: "failure",
    });
    await createCheckRun(
      "t",
      {
        owner: "o",
        repo: "r",
        head_sha: "deadbeef",
        name: "x",
        status: "completed",
        conclusion: "failure",
        output: {
          title: "Bad",
          summary: "❌ Something broke",
          annotations: [
            {
              path: "x.yaml",
              start_line: 3,
              end_line: 3,
              annotation_level: "failure",
              message: "nope",
            },
          ],
        },
      },
      { fetcher },
    );

    const body = calls[0]!.body as { conclusion: string; output: { annotations: unknown[] } };
    expect(body.conclusion).toBe("failure");
    expect(body.output.annotations).toHaveLength(1);
  });

  it("throws on non-2xx", async () => {
    const { fetcher } = makeFetcher({ message: "no permission" }, 403);
    await expect(
      createCheckRun(
        "t",
        { owner: "o", repo: "r", head_sha: "x", name: "x", status: "queued" },
        { fetcher },
      ),
    ).rejects.toThrow(/403/);
  });
});

describe("updateCheckRun", () => {
  it("PATCHes /repos/{owner}/{repo}/check-runs/{id} with body sans owner/repo/id", async () => {
    const { fetcher, calls } = makeFetcher({
      id: 42,
      html_url: "x",
      status: "completed",
      conclusion: "success",
    });
    await updateCheckRun(
      "t",
      {
        owner: "octo",
        repo: "cat",
        check_run_id: 42,
        status: "completed",
        conclusion: "success",
        output: { title: "ok", summary: "✅" },
      },
      { fetcher },
    );

    expect(calls[0]!.url).toBe("https://api.github.com/repos/octo/cat/check-runs/42");
    expect(calls[0]!.method).toBe("PATCH");
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.owner).toBeUndefined();
    expect(body.repo).toBeUndefined();
    expect(body.check_run_id).toBeUndefined();
    expect(body.status).toBe("completed");
    expect(body.conclusion).toBe("success");
  });
});
