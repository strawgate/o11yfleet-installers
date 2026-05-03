// Asserts the webhook handler kicks the ConfigValidationWorkflow with
// the right instance id + params. Doesn't run the workflow itself —
// that's exercised by config-validation.test.ts in a follow-up where
// we'd mock the GitHub API fetcher inside the workflow.
//
// We monkey-patch env.CONFIG_VALIDATION.create to capture invocations
// without disturbing the real workflow class. The webhook handler's
// "duplicate id" branch is also exercised by simulating the error
// the real Workflow API would throw on a redelivered SHA.

import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __clearWebhookDedupForTesting } from "../src/github/webhook.js";
import { bootstrapSchema } from "./fixtures/schema.js";

const SECRET = "test-webhook-secret-32-bytes-okay-okay";

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(macBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

interface CreateInvocation {
  id: string;
  params: Record<string, unknown>;
}

let invocations: CreateInvocation[];
let createImpl: (input: { id: string; params: unknown }) => Promise<unknown>;

beforeAll(async () => {
  await bootstrapSchema(env.FP_DB);
});

beforeEach(() => {
  __clearWebhookDedupForTesting();
  env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
  invocations = [];
  createImpl = async (input) => {
    invocations.push({ id: input.id, params: input.params as Record<string, unknown> });
    return { id: input.id, status: () => Promise.resolve({ status: "running" }) };
  };
  // Stub create on the real binding. WorkflowEntrypoint binding object
  // exposes a `create` method; we replace it for the duration of each test.
  (env.CONFIG_VALIDATION as unknown as { create: typeof createImpl }).create = createImpl;
});

async function postWebhook(event: string, payload: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = await sign(SECRET, body);
  return await exports.default.fetch("http://localhost/auth/github/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature,
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": `delivery-${Math.random()}`,
    },
    body,
  });
}

describe("webhook → ConfigValidationWorkflow kick", () => {
  it("push to default branch creates a workflow with deterministic id + params", async () => {
    const response = await postWebhook("push", {
      ref: "refs/heads/main",
      after: "abc1234",
      repository: { full_name: "octo/cat", default_branch: "main" },
      installation: { id: 42 },
      commits: [{ id: "abc1234" }],
    });
    expect(response.status).toBe(202);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]!.id).toBe("validate-octo-cat-abc1234");
    expect(invocations[0]!.params).toEqual({
      installation_id: 42,
      owner: "octo",
      repo: "cat",
      sha: "abc1234",
    });
  });

  it("push to a non-default branch is ignored (PR handler covers feature branches)", async () => {
    const response = await postWebhook("push", {
      ref: "refs/heads/feature/x",
      after: "abc1234",
      repository: { full_name: "octo/cat", default_branch: "main" },
      installation: { id: 42 },
    });
    expect(response.status).toBe(204);
    expect(invocations).toHaveLength(0);
  });

  it("branch deletion (after = all-zero SHA) does not kick the workflow", async () => {
    const response = await postWebhook("push", {
      ref: "refs/heads/main",
      after: "0000000000000000000000000000000000000000",
      repository: { full_name: "octo/cat", default_branch: "main" },
      installation: { id: 42 },
    });
    expect(response.status).toBe(202);
    expect(invocations).toHaveLength(0);
  });

  it("pull_request:synchronize kicks workflow with head SHA + pr_number", async () => {
    const response = await postWebhook("pull_request", {
      action: "synchronize",
      number: 7,
      pull_request: { head: { sha: "deadbeef", ref: "feature" } },
      repository: { full_name: "octo/cat" },
      installation: { id: 42 },
    });
    expect(response.status).toBe(202);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]!.id).toBe("validate-octo-cat-deadbeef");
    expect(invocations[0]!.params).toEqual({
      installation_id: 42,
      owner: "octo",
      repo: "cat",
      sha: "deadbeef",
      pr_number: 7,
    });
  });

  it("pull_request:assigned does not kick workflow", async () => {
    const response = await postWebhook("pull_request", {
      action: "assigned",
      number: 7,
      pull_request: { head: { sha: "deadbeef" } },
      repository: { full_name: "octo/cat" },
      installation: { id: 42 },
    });
    expect(response.status).toBe(204);
    expect(invocations).toHaveLength(0);
  });

  it("duplicate workflow id (Workflow API rejects) is logged at info, not thrown", async () => {
    // Simulate the Workflow API's "already exists" rejection path —
    // the expected outcome for two webhook deliveries for the same SHA.
    (env.CONFIG_VALIDATION as unknown as { create: typeof createImpl }).create = async () => {
      throw new Error("instance with id validate-octo-cat-abc1234 already exists");
    };
    const response = await postWebhook("push", {
      ref: "refs/heads/main",
      after: "abc1234",
      repository: { full_name: "octo/cat", default_branch: "main" },
      installation: { id: 42 },
    });
    // Webhook still 202s — duplicate is the *expected* outcome, not a failure.
    expect(response.status).toBe(202);
  });
});
