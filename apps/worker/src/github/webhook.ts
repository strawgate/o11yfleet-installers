// Receives webhook deliveries from the o11yfleet GitHub App.
//
// Responsibilities:
//   1. Verify the X-Hub-Signature-256 HMAC against GITHUB_APP_WEBHOOK_SECRET
//      with a constant-time compare. Reject 401 on mismatch.
//   2. Dispatch by X-GitHub-Event header to a handler that ack's quickly.
//   3. Idempotency: same X-GitHub-Delivery within DEDUP_TTL_MS is a no-op.
//
// Deliberately out of scope (later PRs):
//   - Mapping installation_id → tenant_id (requires DB schema; #511)
//   - Calling GitHub APIs back (requires installation token minting; #511)
//   - Validation pipeline / Check Runs (#511)
//
// ─── Response time SLA ────────────────────────────────────────────────────
// GitHub requires a 2xx within 10 seconds or the delivery is marked failed
// and the app accumulates failure-rate against its delivery health metric.
// (See: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
// Handlers in this file MUST stay fast — anything that needs network I/O
// (GitHub API, file fetch, validators) belongs in a Cloudflare Workflow
// kicked off by the handler. The handler itself does HMAC + DB lookup +
// `WORKFLOW.create({ id: ..., params: ... })` + return 202. Targets <500ms
// at the 99th percentile.
//
// ─── Idempotency ──────────────────────────────────────────────────────────
// In-memory dedup is per-isolate. From the docs:
//   "If you request a redelivery, the X-GitHub-Delivery header will be the
//    same as in the original delivery."
// So the dedup catches the manual "Redeliver" UI button. GitHub's automatic
// retries get fresh delivery IDs and are not deduped here — but those are
// always for events GitHub thinks failed (non-2xx or timeout), which means
// our prior attempt didn't actually do the work to begin with. The work-
// level idempotency (don't post the same Check Run twice) lives in the
// workflow itself via deterministic Workflow instance IDs.

import type { Env } from "../index.js";
import { timingSafeEqual } from "../utils/crypto.js";
import { jsonError } from "../shared/errors.js";
import {
  deleteInstallation,
  syncInstallationRepos,
  updateInstallationRepos,
  upsertInstallation,
  type InstallationRepo,
} from "./installations-repo.js";

const DEDUP_TTL_MS = 5 * 60 * 1000;
const seenDeliveries = new Map<string, number>();

function recordDelivery(id: string): boolean {
  const now = Date.now();
  // Drop expired entries opportunistically — bounded by webhook RPS.
  for (const [key, ts] of seenDeliveries) {
    if (now - ts > DEDUP_TTL_MS) seenDeliveries.delete(key);
  }
  if (seenDeliveries.has(id)) return false;
  seenDeliveries.set(id, now);
  return true;
}

/** Test seam: clear in-memory dedup state between cases. */
export function __clearWebhookDedupForTesting(): void {
  seenDeliveries.clear();
}

interface HandlerContext {
  deliveryId: string;
  event: string;
  payload: unknown;
  env: Env;
}

interface HandlerResult {
  status: number;
  body?: Record<string, unknown>;
}

type EventHandler = (ctx: HandlerContext) => Promise<HandlerResult>;

const handlers: Record<string, EventHandler> = {
  ping: async () => ({ status: 200, body: { pong: true } }),
  installation: handleInstallation,
  installation_repositories: handleInstallationRepos,
  push: handlePush,
  pull_request: handlePullRequest,
};

export async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    // Mirror the existing "github auth not configured" pattern: tell the
    // caller why, don't pretend to accept the delivery.
    return jsonError("GitHub App webhook secret is not configured", 503);
  }

  const signatureHeader = request.headers.get("X-Hub-Signature-256");
  const event = request.headers.get("X-GitHub-Event");
  const deliveryId = request.headers.get("X-GitHub-Delivery");

  if (!signatureHeader || !event || !deliveryId) {
    return jsonError("Missing GitHub webhook headers", 400);
  }

  const rawBody = await request.text();
  const expected = await computeSignature(secret, rawBody);
  if (!timingSafeEqual(signatureHeader, expected)) {
    return jsonError("GitHub webhook signature mismatch", 401);
  }

  if (!recordDelivery(deliveryId)) {
    // Already handled this delivery in the recent past — ack without re-firing.
    console.warn({
      event: "github_webhook_replay_ignored",
      delivery_id: deliveryId,
      github_event: event,
    });
    return new Response(null, { status: 204 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError("GitHub webhook body is not valid JSON", 400);
  }

  const handler = handlers[event];
  if (!handler) {
    // Quietly accept events we don't subscribe to. GitHub treats any 2xx as
    // success and stops retrying, which is what we want for noise we'd
    // otherwise spend cycles deserializing.
    console.warn({
      event: "github_webhook_unsubscribed_event",
      delivery_id: deliveryId,
      github_event: event,
    });
    return new Response(null, { status: 204 });
  }

  try {
    const result = await handler({ deliveryId, event, payload, env });
    return new Response(result.body ? JSON.stringify(result.body) : null, {
      status: result.status,
      headers: result.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch (err) {
    // Remove from dedup map so GitHub can retry this delivery immediately.
    // The workflow's deterministic instance IDs handle concurrent duplicate
    // deliveries idempotently.
    seenDeliveries.delete(deliveryId);
    throw err;
  }
}

async function computeSignature(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBytes = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = Array.from(new Uint8Array(macBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// ─── event handlers ────────────────────────────────────────────────────
//
// These currently log and ack. The wire-up for "installation → DB row" and
// "push → check run" lands in #511; we want the transport tested in isolation
// first.

function logEvent(name: string, ctx: HandlerContext, extra: Record<string, unknown>): void {
  console.warn({
    event: name,
    delivery_id: ctx.deliveryId,
    github_event: ctx.event,
    ...extra,
  });
}

interface InstallationPayload {
  action?: string;
  installation?: {
    id?: number;
    account?: { login?: string; type?: string };
  };
  repositories?: Array<{ id?: number; full_name?: string }>;
}

async function handleInstallation(ctx: HandlerContext): Promise<HandlerResult> {
  const p = ctx.payload as InstallationPayload;
  const id = p.installation?.id;
  const login = p.installation?.account?.login;
  const type = p.installation?.account?.type;

  logEvent("github_app_installation", ctx, {
    action: p.action,
    installation_id: id,
    account_login: login,
    account_type: type,
    repo_count: p.repositories?.length ?? 0,
  });

  if (!id) {
    // Malformed event — log it (above) and ack so GitHub stops retrying.
    return { status: 202 };
  }

  switch (p.action) {
    case "created":
    case "new_permissions_accepted":
    case "unsuspend":
      // These actions write a row, so account metadata is required. Skip
      // (don't reject) if missing — the install is unusable without it
      // anyway, and the alternative is making GitHub keep retrying.
      if (!login || (type !== "User" && type !== "Organization")) {
        return { status: 202 };
      }
      await upsertInstallation(ctx.env, {
        installation_id: id,
        account_login: login,
        account_type: type,
      });
      await syncInstallationRepos(ctx.env, id, normalizeRepos(p.repositories));
      break;
    case "deleted":
      await deleteInstallation(ctx.env, id);
      break;
    // suspend / other actions: the installation row stays around so the
    // tenant link survives a temporary suspend; webhook lookups will
    // still find the row but the workflow can choose to skip work for
    // suspended installs once we surface that state.
  }
  return { status: 202 };
}

interface InstallationReposPayload {
  action?: string;
  installation?: { id?: number };
  repositories_added?: Array<{ id?: number; full_name?: string }>;
  repositories_removed?: Array<{ id?: number; full_name?: string }>;
}

async function handleInstallationRepos(ctx: HandlerContext): Promise<HandlerResult> {
  const p = ctx.payload as InstallationReposPayload;
  const id = p.installation?.id;
  logEvent("github_app_installation_repos", ctx, {
    action: p.action,
    installation_id: id,
    added: p.repositories_added?.map((r) => r.full_name),
    removed: p.repositories_removed?.map((r) => r.full_name),
  });
  if (!id) return { status: 202 };
  await updateInstallationRepos(
    ctx.env,
    id,
    normalizeRepos(p.repositories_added),
    normalizeRepos(p.repositories_removed),
  );
  return { status: 202 };
}

function normalizeRepos(
  raw: Array<{ id?: number; full_name?: string; default_branch?: string }> | undefined,
): InstallationRepo[] {
  if (!raw) return [];
  const out: InstallationRepo[] = [];
  for (const r of raw) {
    if (typeof r.id !== "number" || typeof r.full_name !== "string") continue;
    out.push({
      id: r.id,
      full_name: r.full_name,
      ...(typeof r.default_branch === "string" ? { default_branch: r.default_branch } : {}),
    });
  }
  return out;
}

interface PushPayload {
  ref?: string;
  before?: string;
  after?: string;
  repository?: { full_name?: string; default_branch?: string };
  installation?: { id?: number };
  commits?: Array<{ id?: string; modified?: string[]; added?: string[]; removed?: string[] }>;
}

async function handlePush(ctx: HandlerContext): Promise<HandlerResult> {
  const p = ctx.payload as PushPayload;
  const repoFull = p.repository?.full_name;
  const installationId = p.installation?.id;
  const sha = p.after;
  logEvent("github_app_push", ctx, {
    repository: repoFull,
    installation_id: installationId,
    ref: p.ref,
    after: sha,
    commit_count: p.commits?.length ?? 0,
  });

  // Only validate pushes to the default branch — feature-branch pushes
  // are covered by the pull_request handler. Without this guard the
  // workflow would fire twice for every PR push (once for the branch
  // push, once for the PR sync).
  const defaultRef = `refs/heads/${p.repository?.default_branch ?? "main"}`;
  if (p.ref !== defaultRef) {
    return { status: 204 };
  }

  if (!repoFull || !installationId || !sha || sha === "0000000000000000000000000000000000000000") {
    // Branch deletion (after = all-zero SHA) or malformed event — nothing to validate.
    return { status: 202 };
  }
  await kickValidationWorkflow(ctx, { repoFull, installationId, sha });
  return { status: 202 };
}

interface PullRequestPayload {
  action?: string;
  number?: number;
  pull_request?: { head?: { sha?: string; ref?: string } };
  repository?: { full_name?: string };
  installation?: { id?: number };
}

// `pull_request` event fires for ~30 actions, only a handful of which
// change the head commit / reopen review. Only those should kick the
// validation pipeline. Filtering at the receiver keeps the workflow
// concurrency budget for the events that actually move the system.
const PULL_REQUEST_ACTIONS_OF_INTEREST = new Set([
  "opened",
  "synchronize",
  "reopened",
  "edited",
  "ready_for_review",
]);

async function handlePullRequest(ctx: HandlerContext): Promise<HandlerResult> {
  const p = ctx.payload as PullRequestPayload;
  if (!p.action || !PULL_REQUEST_ACTIONS_OF_INTEREST.has(p.action)) {
    logEvent("github_app_pull_request_ignored", ctx, { action: p.action });
    return { status: 204 };
  }
  const repoFull = p.repository?.full_name;
  const installationId = p.installation?.id;
  const sha = p.pull_request?.head?.sha;
  logEvent("github_app_pull_request", ctx, {
    action: p.action,
    repository: repoFull,
    installation_id: installationId,
    number: p.number,
    head_sha: sha,
    head_ref: p.pull_request?.head?.ref,
  });
  if (!repoFull || !installationId || !sha) {
    return { status: 202 };
  }
  await kickValidationWorkflow(ctx, { repoFull, installationId, sha, prNumber: p.number });
  return { status: 202 };
}

interface KickArgs {
  repoFull: string;
  installationId: number;
  sha: string;
  prNumber?: number;
}

/**
 * Start the ConfigValidationWorkflow with a deterministic instance id
 * (`validate-{owner}-{repo}-{sha}`) so two webhook deliveries for the
 * same SHA collapse to a single workflow run — that's our work-level
 * idempotency, not the in-memory dedup which only covers manual
 * "Redeliver".
 *
 * If `CONFIG_VALIDATION` isn't bound (local dev without workflows
 * configured), log + skip rather than throw — the webhook itself still
 * 202s so GitHub doesn't keep retrying.
 */
async function kickValidationWorkflow(ctx: HandlerContext, args: KickArgs): Promise<void> {
  const workflow = ctx.env.CONFIG_VALIDATION;
  const [owner, repo] = args.repoFull.split("/");
  if (!owner || !repo) return;
  if (!workflow) {
    console.warn({
      event: "github_workflow_skipped_no_binding",
      delivery_id: ctx.deliveryId,
      repo: args.repoFull,
      sha: args.sha,
    });
    return;
  }
  const id = `validate-${owner}-${repo}-${args.sha}`;
  try {
    await workflow.create({
      id,
      params: {
        installation_id: args.installationId,
        owner,
        repo,
        sha: args.sha,
        ...(args.prNumber !== undefined ? { pr_number: args.prNumber } : {}),
      },
    });
    console.info({
      event: "github_workflow_created",
      delivery_id: ctx.deliveryId,
      workflow_id: id,
    });
  } catch (err) {
    // The Workflow API rejects duplicate ids with a recognizable error;
    // that's the *expected* path for redelivery + concurrent webhooks
    // for the same SHA, so log at info, not error.
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists|duplicate/i.test(message)) {
      console.info({
        event: "github_workflow_already_running",
        delivery_id: ctx.deliveryId,
        workflow_id: id,
      });
    } else {
      console.error({
        event: "github_workflow_create_failed",
        delivery_id: ctx.deliveryId,
        workflow_id: id,
        error: message,
      });
      throw err;
    }
  }
}
