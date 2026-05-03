// Cloudflare Workflow that drives the GitOps Check Run validation pipeline.
//
// Triggered by the webhook handler with an instance id of
// `validate-{owner}-{repo}-{sha}` so two webhook deliveries for the same
// SHA collapse to one workflow → the Check Run is created exactly once.
//
// Steps (each is `step.do(...)` so the result is auto-persisted and the
// step retries independently on transient GitHub API failures):
//   1. resolve-installation — find the installation row for the repo
//   2. mint-token — exchange app JWT for an installation access token
//   3. fetch-config — GET /repos/{owner}/{repo}/contents/{path}@{sha}
//   4. create-check-run — POST a Check Run in `in_progress` status
//   5. validate — pure-fn: YAML parse + (future) schema + fleet checks
//   6. complete-check-run — PATCH with conclusion + annotations
//
// If any step exhausts its retries the workflow itself fails; we surface
// that to the user by trying to update the Check Run to `action_required`
// in a final catch-all step. (Best-effort — if even *that* fails, the
// stale `in_progress` Check Run will time out on GitHub's side after
// 7 days, which is acceptable for a control-plane bug.)

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../index.js";
import { findInstallationByRepo } from "../github/installations-repo.js";
import { getInstallationToken } from "../github/installation-token.js";
import { githubApi } from "../github/api.js";
import {
  createCheckRun,
  updateCheckRun,
  type CheckRunAnnotation,
  type CheckRunConclusion,
} from "../github/check-runs.js";
import { validateCollectorConfig } from "../github/validate-config.js";

export interface ConfigValidationParams {
  /** GitHub installation id from the webhook payload. */
  installation_id: number;
  /** Repository owner login. */
  owner: string;
  /** Repository name (no owner prefix). */
  repo: string;
  /** Commit SHA to validate. */
  sha: string;
  /** Optional PR number for log correlation; not required for the API calls. */
  pr_number?: number;
  /** Override the configured config_path lookup; useful for tests. */
  config_path_override?: string;
}

const CHECK_RUN_NAME = "o11yfleet / config validation";
const MAX_ANNOTATIONS_PER_REQUEST = 50;

export class ConfigValidationWorkflow extends WorkflowEntrypoint<Env, ConfigValidationParams> {
  override async run(
    event: WorkflowEvent<ConfigValidationParams>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const { installation_id, owner, repo, sha } = event.payload;
    const fullName = `${owner}/${repo}`;

    // ─── 1. resolve installation row ────────────────────────────────
    const install = await step.do("resolve-installation", async () => {
      const row = await findInstallationByRepo(this.env, fullName);
      if (!row) {
        throw new Error(`No github_installations row covers ${fullName}`);
      }
      if (row.installation_id !== installation_id) {
        // Defense-in-depth: webhook says installation X, DB says Y for
        // this repo. Refuse to proceed; surfaces a real bug rather than
        // letting tokens for one tenant act on another tenant's repo.
        throw new Error(
          `Installation mismatch for ${fullName}: webhook=${installation_id} db=${row.installation_id}`,
        );
      }
      return {
        config_path: event.payload.config_path_override ?? row.config_path,
        tenant_id: row.tenant_id,
      };
    });

    // ─── 2. mint installation token ─────────────────────────────────
    const token = await step.do(
      "mint-installation-token",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => getInstallationToken(this.env, installation_id),
    );

    // ─── 3. fetch the file at the head SHA ──────────────────────────
    const yaml = await step.do(
      "fetch-config",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const path = encodeURIComponent(install.config_path);
        const res = await githubApi<{ content?: string; encoding?: string }>(
          "GET",
          `/repos/${owner}/${repo}/contents/${path}?ref=${sha}`,
          { token },
        );
        if (res.status === 404) {
          // The file isn't in the repo at this SHA. Treat as a "neutral"
          // outcome rather than a failure — the user just hasn't created
          // the config yet, or this PR doesn't touch it.
          return null;
        }
        if (!res.ok || !res.data?.content) {
          throw new Error(`fetch-config ${res.status}: ${JSON.stringify(res.data)}`);
        }
        if (res.data.encoding !== "base64") {
          throw new Error(`Unexpected contents encoding: ${res.data.encoding}`);
        }
        // GitHub base64-encodes file content with newlines every 60 chars.
        return atob(res.data.content.replace(/\n/g, ""));
      },
    );

    if (yaml === null) {
      // Skip the rest of the pipeline if there's no file to validate.
      // We don't post a Check Run for "no file" because doing so would
      // create check noise on every PR that doesn't touch the config.
      return { skipped: true, reason: "config file not present at head sha" };
    }

    // ─── 4. create the Check Run in `in_progress` ───────────────────
    const checkRun = await step.do(
      "create-check-run",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () =>
        createCheckRun(token, {
          owner,
          repo,
          head_sha: sha,
          name: CHECK_RUN_NAME,
          status: "in_progress",
          external_id: `validate-${owner}-${repo}-${sha}`,
        }),
    );

    try {
      // ─── 5. validate (pure fn, no I/O, no retry) ────────────────────
      const result = await step.do("validate", async () =>
        validateCollectorConfig({ path: install.config_path, yaml }),
      );

      // ─── 6. complete the Check Run ──────────────────────────────────
      const truncated = result.annotations.length > MAX_ANNOTATIONS_PER_REQUEST;
      const annotations: CheckRunAnnotation[] = result.annotations
        .slice(0, MAX_ANNOTATIONS_PER_REQUEST)
        .map((a) => ({
          path: a.path,
          start_line: a.start_line,
          end_line: a.end_line,
          annotation_level: a.level,
          message: a.message,
          ...(a.title ? { title: a.title } : {}),
        }));
      const truncationNote = truncated
        ? `\n\n_Showing the first ${MAX_ANNOTATIONS_PER_REQUEST} of ${result.annotations.length} findings. Fix these and re-push to see the rest._`
        : "";

      await step.do(
        "complete-check-run",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () =>
          updateCheckRun(token, {
            owner,
            repo,
            check_run_id: checkRun.id,
            status: "completed",
            conclusion: conclusionToCheckRun(result.conclusion),
            output: {
              title: result.summary,
              summary: result.summary + truncationNote,
              ...(result.text ? { text: result.text } : {}),
              annotations,
            },
          }),
      );

      return {
        check_run_id: checkRun.id,
        conclusion: result.conclusion,
        annotation_count: result.annotations.length,
      };
    } catch (err) {
      // Best-effort fail-safe: don't leave an in_progress Check Run
      // hanging when validation/complete-check-run blew up. We swallow
      // any failure of the finalizer itself so the original error still
      // surfaces as the workflow failure (and GitHub will time the run
      // out after 7 days as a backstop).
      await step
        .do("complete-check-run-on-failure", async () =>
          updateCheckRun(token, {
            owner,
            repo,
            check_run_id: checkRun.id,
            status: "completed",
            conclusion: "action_required",
            output: {
              title: "Config validation workflow failed",
              summary:
                "The validation workflow failed before producing results. Please retry the push or open an issue if this persists.",
            },
          }),
        )
        .catch(() => undefined);
      throw err;
    }
  }
}

function conclusionToCheckRun(c: "success" | "failure" | "neutral"): CheckRunConclusion {
  // 1:1 today; declared as a function so future "warning" / "skipped"
  // mappings have a single edit point.
  return c;
}
