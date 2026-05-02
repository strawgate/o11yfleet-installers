// Webhook receiver transport tests. Asserts:
//   - HMAC-SHA256 signature verification (constant-time compare)
//   - Header presence checks
//   - Event-type dispatch (ping → 200, push/pull_request/installation → 202,
//     unknown event → 204)
//   - Idempotency: same X-GitHub-Delivery within TTL → no double-fire
//   - Misconfiguration: missing GITHUB_APP_WEBHOOK_SECRET → 503
//
// Handler business logic (DB writes, GH API calls, Check Runs) lives in
// later PRs and is intentionally not exercised here.

import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { __clearWebhookDedupForTesting } from "../src/github/webhook.js";

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

let nextDeliveryId = 0;
function freshDelivery(): string {
  nextDeliveryId += 1;
  return `delivery-${Date.now()}-${nextDeliveryId}`;
}

interface PostOpts {
  event: string;
  payload: Record<string, unknown>;
  deliveryId?: string;
  signature?: string;
  omitHeader?: "signature" | "event" | "delivery";
}

async function postWebhook(opts: PostOpts): Promise<Response> {
  const body = JSON.stringify(opts.payload);
  const signature = opts.signature ?? (await sign(SECRET, body));
  const deliveryId = opts.deliveryId ?? freshDelivery();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.omitHeader !== "signature") headers["X-Hub-Signature-256"] = signature;
  if (opts.omitHeader !== "event") headers["X-GitHub-Event"] = opts.event;
  if (opts.omitHeader !== "delivery") headers["X-GitHub-Delivery"] = deliveryId;
  return await exports.default.fetch("http://localhost/auth/github/webhook", {
    method: "POST",
    headers,
    body,
  });
}

describe("GitHub webhook receiver", () => {
  beforeEach(() => {
    __clearWebhookDedupForTesting();
    env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
  });

  it("rejects with 503 when GITHUB_APP_WEBHOOK_SECRET is unset", async () => {
    env.GITHUB_APP_WEBHOOK_SECRET = "";
    const response = await postWebhook({ event: "ping", payload: { zen: "Anything added" } });
    expect(response.status).toBe(503);
  });

  it("rejects with 400 when required headers are missing", async () => {
    for (const omit of ["signature", "event", "delivery"] as const) {
      const response = await postWebhook({
        event: "ping",
        payload: { zen: "x" },
        omitHeader: omit,
      });
      expect(response.status).toBe(400);
    }
  });

  it("rejects with 401 on HMAC mismatch", async () => {
    const response = await postWebhook({
      event: "ping",
      payload: { zen: "x" },
      signature: "sha256=deadbeef".padEnd(71, "0"),
    });
    expect(response.status).toBe(401);
  });

  it("rejects with 400 on non-JSON body but valid signature", async () => {
    const body = "not-json";
    const signature = await sign(SECRET, body);
    const response = await exports.default.fetch("http://localhost/auth/github/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": signature,
        "X-GitHub-Event": "ping",
        "X-GitHub-Delivery": freshDelivery(),
      },
      body,
    });
    expect(response.status).toBe(400);
  });

  it("answers ping with 200 + {pong: true}", async () => {
    const response = await postWebhook({
      event: "ping",
      payload: { zen: "Anything added dilutes everything else." },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pong: true });
  });

  it("dispatches push events with 202", async () => {
    const response = await postWebhook({
      event: "push",
      payload: {
        ref: "refs/heads/main",
        after: "0123456789abcdef",
        repository: { full_name: "octo/cat" },
        installation: { id: 42 },
        commits: [{ id: "0123456789abcdef" }],
      },
    });
    expect(response.status).toBe(202);
  });

  it("dispatches pull_request events with 202", async () => {
    const response = await postWebhook({
      event: "pull_request",
      payload: {
        action: "synchronize",
        number: 7,
        pull_request: { head: { sha: "abc", ref: "feature" } },
        repository: { full_name: "octo/cat" },
        installation: { id: 42 },
      },
    });
    expect(response.status).toBe(202);
  });

  it("dispatches installation events with 202", async () => {
    const response = await postWebhook({
      event: "installation",
      payload: {
        action: "created",
        installation: { id: 42, account: { login: "octo", type: "Organization" } },
      },
    });
    expect(response.status).toBe(202);
  });

  it("acks unsubscribed events with 204", async () => {
    const response = await postWebhook({
      event: "star",
      payload: { action: "created" },
    });
    expect(response.status).toBe(204);
  });

  it("idempotency: replaying the same X-GitHub-Delivery returns 204 without re-firing", async () => {
    const deliveryId = freshDelivery();
    const payload = { zen: "Approachable" };

    const first = await postWebhook({ event: "ping", payload, deliveryId });
    expect(first.status).toBe(200);

    const second = await postWebhook({ event: "ping", payload, deliveryId });
    expect(second.status).toBe(204);
  });
});
