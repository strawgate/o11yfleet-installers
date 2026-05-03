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
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __clearWebhookDedupForTesting } from "../src/github/webhook.js";
import { findInstallationById } from "../src/github/installations-repo.js";

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
  beforeAll(async () => {
    // Inline the github_installations and installation_repositories schema so
    // the DB-backed installation handlers can write rows. Mirrors the
    // production migration in packages/db/migrations/0002_github_installations.sql,
    // including the `tenant_id REFERENCES tenants(id)` foreign key.
    await env.FP_DB.exec(`CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY)`);
    await env.FP_DB.exec(
      `CREATE TABLE IF NOT EXISTS github_installations (` +
        `installation_id INTEGER PRIMARY KEY, ` +
        `account_login TEXT NOT NULL, ` +
        `account_type TEXT NOT NULL CHECK(account_type IN ('User', 'Organization')), ` +
        `tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL, ` +
        `config_path TEXT NOT NULL DEFAULT 'o11yfleet/config.yaml', ` +
        `created_at TEXT NOT NULL DEFAULT (datetime('now')), ` +
        `updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    await env.FP_DB.exec(
      `CREATE TABLE IF NOT EXISTS installation_repositories (` +
        `installation_id INTEGER NOT NULL ` +
        `REFERENCES github_installations(installation_id) ON DELETE CASCADE, ` +
        `repo_id INTEGER NOT NULL, ` +
        `full_name TEXT NOT NULL, ` +
        `default_branch TEXT, ` +
        `PRIMARY KEY (installation_id, repo_id))`,
    );
    await env.FP_DB.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_installation_repositories_full_name ` +
        `ON installation_repositories(full_name)`,
    );
  });

  beforeEach(async () => {
    __clearWebhookDedupForTesting();
    env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
    await env.FP_DB.prepare("DELETE FROM github_installations").run();
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

  it("dispatches pull_request events of interest with 202", async () => {
    for (const action of ["opened", "synchronize", "reopened", "edited", "ready_for_review"]) {
      const response = await postWebhook({
        event: "pull_request",
        payload: {
          action,
          number: 7,
          pull_request: { head: { sha: "abc", ref: "feature" } },
          repository: { full_name: "octo/cat" },
          installation: { id: 42 },
        },
      });
      expect(response.status, `action=${action}`).toBe(202);
    }
  });

  it("ignores pull_request actions outside the interest set with 204", async () => {
    // pull_request fires for ~30 actions; only the head-changing / re-review
    // ones should kick the workflow. Others (assigned, labeled, milestoned,
    // etc.) get dropped at the receiver to keep the workflow concurrency
    // budget for events that move the system.
    for (const action of ["assigned", "labeled", "review_requested", "milestoned"]) {
      const response = await postWebhook({
        event: "pull_request",
        payload: {
          action,
          number: 7,
          pull_request: { head: { sha: "abc", ref: "feature" } },
          repository: { full_name: "octo/cat" },
          installation: { id: 42 },
        },
      });
      expect(response.status, `action=${action}`).toBe(204);
    }
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

  it("installation:created persists the row in github_installations", async () => {
    const response = await postWebhook({
      event: "installation",
      payload: {
        action: "created",
        installation: { id: 4242, account: { login: "octo-org", type: "Organization" } },
        repositories: [
          { id: 100, full_name: "octo-org/repo-a" },
          { id: 101, full_name: "octo-org/repo-b" },
        ],
      },
    });
    expect(response.status).toBe(202);
    const row = await findInstallationById(env, 4242);
    expect(row).not.toBeNull();
    expect(row!.account_login).toBe("octo-org");
    expect(row!.repos.map((r) => r.full_name).sort()).toEqual([
      "octo-org/repo-a",
      "octo-org/repo-b",
    ]);
  });

  it("installation:deleted removes the row", async () => {
    await postWebhook({
      event: "installation",
      payload: {
        action: "created",
        installation: { id: 4243, account: { login: "octo", type: "User" } },
      },
    });
    await postWebhook({
      event: "installation",
      payload: {
        action: "deleted",
        installation: { id: 4243, account: { login: "octo", type: "User" } },
      },
    });
    expect(await findInstallationById(env, 4243)).toBeNull();
  });

  it("installation_repositories:added/removed updates the repos array", async () => {
    await postWebhook({
      event: "installation",
      payload: {
        action: "created",
        installation: { id: 4244, account: { login: "octo", type: "Organization" } },
        repositories: [{ id: 200, full_name: "octo/keep-me" }],
      },
    });
    await postWebhook({
      event: "installation_repositories",
      payload: {
        action: "added",
        installation: { id: 4244 },
        repositories_added: [{ id: 201, full_name: "octo/added" }],
        repositories_removed: [],
      },
    });
    await postWebhook({
      event: "installation_repositories",
      payload: {
        action: "removed",
        installation: { id: 4244 },
        repositories_added: [],
        repositories_removed: [{ id: 200, full_name: "octo/keep-me" }],
      },
    });
    const row = await findInstallationById(env, 4244);
    expect(row!.repos.map((r) => r.full_name)).toEqual(["octo/added"]);
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
