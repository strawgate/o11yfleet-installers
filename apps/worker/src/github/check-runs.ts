// Thin wrappers over GitHub's Check Runs API.
//
// Check Runs are GitHub's first-class status-on-a-commit primitive — they
// show up in the PR's checks panel alongside CI, can be marked required
// in branch protection, and support per-line annotations. That makes them
// the right surface for "o11yfleet says this collector config doesn't
// validate" feedback.
//
// Two-stage lifecycle:
//   1. createCheckRun(...status: "in_progress") at the start of the
//      validation pipeline so the user immediately sees it spinning in
//      the PR.
//   2. updateCheckRun(check_run_id, conclusion, output) when the
//      validators finish, with the markdown summary + per-line annotations.
//
// Both calls are idempotent if the caller uses a deterministic external_id
// (we use `o11yfleet-validate-{owner}-{repo}-{sha}`), but the Check Runs
// API doesn't enforce that — multiple creates produce multiple check runs.
// The workflow's instance-id-based dedup is the actual idempotency layer.

import { githubApi } from "./api.js";

export type CheckRunStatus = "queued" | "in_progress" | "completed";
export type CheckRunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required";

export interface CheckRunAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice" | "warning" | "failure";
  message: string;
  /** Optional; when set, GitHub renders the annotation against this column range. */
  start_column?: number;
  end_column?: number;
  title?: string;
  raw_details?: string;
}

export interface CheckRunOutput {
  /** Required by GitHub. ~1 line of markdown. */
  title: string;
  /** Required by GitHub. Full markdown summary; supports collapsible <details>. */
  summary: string;
  /** Optional longer markdown body; rendered below the summary. */
  text?: string;
  /** Optional per-line annotations. Capped at 50 per call by GitHub. */
  annotations?: CheckRunAnnotation[];
}

export interface CreateCheckRunInput {
  owner: string;
  repo: string;
  /** Commit SHA the check run targets. */
  head_sha: string;
  /** Display name in the GitHub UI. Use a stable string per check kind. */
  name: string;
  status: CheckRunStatus;
  /** Stable client-supplied id; helps dashboards correlate retries. */
  external_id?: string;
  /** When status === "completed". */
  conclusion?: CheckRunConclusion;
  output?: CheckRunOutput;
}

export interface UpdateCheckRunInput {
  owner: string;
  repo: string;
  check_run_id: number;
  status?: CheckRunStatus;
  conclusion?: CheckRunConclusion;
  output?: CheckRunOutput;
}

export interface CheckRun {
  id: number;
  html_url: string;
  status: CheckRunStatus;
  conclusion: CheckRunConclusion | null;
}

interface FetcherOpt {
  fetcher?: typeof fetch;
}

export async function createCheckRun(
  token: string,
  input: CreateCheckRunInput,
  opts: FetcherOpt = {},
): Promise<CheckRun> {
  const { owner, repo, ...body } = input;
  const res = await githubApi<CheckRun>("POST", `/repos/${owner}/${repo}/check-runs`, {
    token,
    body,
    fetcher: opts.fetcher,
  });
  if (!res.ok || res.data === null) {
    throw new Error(`createCheckRun ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function updateCheckRun(
  token: string,
  input: UpdateCheckRunInput,
  opts: FetcherOpt = {},
): Promise<CheckRun> {
  const { owner, repo, check_run_id, ...body } = input;
  const res = await githubApi<CheckRun>(
    "PATCH",
    `/repos/${owner}/${repo}/check-runs/${check_run_id}`,
    { token, body, fetcher: opts.fetcher },
  );
  if (!res.ok || res.data === null) {
    throw new Error(`updateCheckRun ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}
