// Daily cron: diff the live GitHub App config against the canonical
// `infra/github-app/o11yfleet.json` manifest. Logs a structured
// drift report when permissions or events have changed.
//
// Why this exists: GitHub's app-manifest flow is bootstrap-only. Once
// an App is created from the manifest, there's no API to push manifest
// updates back to the live App — admins edit it through the web UI
// instead. Anyone with admin can silently change permissions or events
// and the only signal would be a deploy starting to fail on a missing
// scope or a webhook that stopped firing.
//
// `GET /app` returns the live App's `permissions` and `events` arrays
// (but NOT URLs, hooks, or callback URLs — those are web-UI-only).
// We diff what the API exposes against the manifest and log when they
// differ. The check is intentionally read-only and silent on no-drift;
// drift produces a single `console.warn` with the specific keys.
//
// Future enhancement: open a GitHub issue when drift is detected. That
// requires the App to have `issues: write`, which it currently lacks.
// For now the structured log lands in Workers Logs and OTel; a routine
// Logs query / dashboard alert will surface drift to operators.

import manifestJson from "../../../../infra/github-app/o11yfleet.json";
import { generateAppJwt } from "../github/installation-token.js";
import { githubApi } from "../github/api.js";

interface DriftCheckEnv {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}

/** Subset of `GET /app` we actually compare against. */
interface AppApiResponse {
  permissions?: Record<string, string>;
  events?: string[];
}

interface ExpectedManifest {
  default_permissions: Record<string, string>;
  default_events: readonly string[];
}

/**
 * Runtime guard against a malformed manifest. The bundler-imported JSON
 * is typed as `unknown`-via-cast; without a check, a missing or wrong-shaped
 * field would silently produce empty / incorrect drift reports (e.g., every
 * permission would look "removed from manifest" if `default_permissions`
 * were missing). Throwing at module load surfaces the problem immediately —
 * the worker fails to boot, which is the right failure mode for a config
 * file that ships in the bundle.
 */
export function assertManifestShape(value: unknown): asserts value is ExpectedManifest {
  if (!value || typeof value !== "object") {
    throw new Error("manifest-drift-check: manifest is not an object");
  }
  const v = value as Record<string, unknown>;
  if (!v["default_permissions"] || typeof v["default_permissions"] !== "object") {
    throw new Error(
      "manifest-drift-check: manifest.default_permissions is missing or not an object",
    );
  }
  for (const [key, level] of Object.entries(v["default_permissions"] as object)) {
    if (typeof level !== "string") {
      throw new Error(
        `manifest-drift-check: manifest.default_permissions.${key} is not a string (got ${typeof level})`,
      );
    }
  }
  if (!Array.isArray(v["default_events"])) {
    throw new Error("manifest-drift-check: manifest.default_events is missing or not an array");
  }
  for (const event of v["default_events"]) {
    if (typeof event !== "string") {
      throw new Error(
        `manifest-drift-check: manifest.default_events contains a non-string entry (got ${typeof event})`,
      );
    }
  }
}

assertManifestShape(manifestJson);
const expected: ExpectedManifest = manifestJson;

export interface DriftReport {
  /** Permissions present in the manifest but missing/different on the live App. */
  permissionsAddedInManifest: Record<string, string>;
  permissionsChanged: Record<string, { manifest: string; live: string }>;
  permissionsRemovedFromManifest: Record<string, string>;
  /** Events declared in the manifest but absent on the live App. */
  eventsAddedInManifest: string[];
  /** Events on the live App but not declared in the manifest. */
  eventsRemovedFromManifest: string[];
  /** True when every diff bucket is empty. */
  noDrift: boolean;
}

/**
 * Pure function: given the manifest's expected shape and the live
 * `GET /app` response, produce a drift report. Tested directly without
 * the network call.
 */
export function diffManifestAgainstLive(
  manifest: ExpectedManifest,
  live: AppApiResponse,
): DriftReport {
  const livePerms = live.permissions ?? {};
  const liveEvents = new Set(live.events ?? []);
  const manifestEvents = new Set(manifest.default_events);

  const permissionsAddedInManifest: Record<string, string> = {};
  const permissionsChanged: Record<string, { manifest: string; live: string }> = {};
  for (const [name, level] of Object.entries(manifest.default_permissions)) {
    const liveLevel = livePerms[name];
    if (liveLevel === undefined) {
      permissionsAddedInManifest[name] = level;
    } else if (liveLevel !== level) {
      permissionsChanged[name] = { manifest: level, live: liveLevel };
    }
  }

  const permissionsRemovedFromManifest: Record<string, string> = {};
  for (const [name, level] of Object.entries(livePerms)) {
    if (!(name in manifest.default_permissions)) {
      permissionsRemovedFromManifest[name] = level;
    }
  }

  const eventsAddedInManifest: string[] = [];
  for (const event of manifestEvents) {
    if (!liveEvents.has(event)) eventsAddedInManifest.push(event);
  }
  const eventsRemovedFromManifest: string[] = [];
  for (const event of liveEvents) {
    if (!manifestEvents.has(event)) eventsRemovedFromManifest.push(event);
  }

  const noDrift =
    Object.keys(permissionsAddedInManifest).length === 0 &&
    Object.keys(permissionsChanged).length === 0 &&
    Object.keys(permissionsRemovedFromManifest).length === 0 &&
    eventsAddedInManifest.length === 0 &&
    eventsRemovedFromManifest.length === 0;

  return {
    permissionsAddedInManifest,
    permissionsChanged,
    permissionsRemovedFromManifest,
    eventsAddedInManifest,
    eventsRemovedFromManifest,
    noDrift,
  };
}

/**
 * Cron entry point. Mints an App JWT, calls `GET /app`, diffs against
 * the bundled manifest, logs a structured report on drift. Silent on
 * no-drift (no point in spamming logs every day with "everything fine").
 *
 * Returns the report so callers/tests can inspect it. Errors propagate
 * — a failed JWT mint or a 5xx from GitHub should surface via the
 * cron's failure metric, not get swallowed.
 */
export async function runManifestDriftCheck(env: DriftCheckEnv): Promise<DriftReport | null> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    // Worker isn't provisioned with GitHub App credentials — no drift
    // check possible. Silent return; the drift check is opt-in for
    // environments that have the App configured.
    return null;
  }

  const jwt = await generateAppJwt({
    appId: env.GITHUB_APP_ID,
    privateKeyPem: env.GITHUB_APP_PRIVATE_KEY,
  });
  const res = await githubApi<AppApiResponse>("GET", "/app", { token: jwt });
  if (!res.ok || !res.data) {
    throw new Error(
      `manifest-drift-check: GET /app returned ${res.status}: ${JSON.stringify(res.data)}`,
    );
  }

  const report = diffManifestAgainstLive(expected, res.data);

  if (!report.noDrift) {
    console.warn({
      event: "github_app_manifest_drift",
      // Stable JSON keys for log queries / alerting.
      permissions_added_to_manifest: report.permissionsAddedInManifest,
      permissions_changed: report.permissionsChanged,
      permissions_removed_from_manifest: report.permissionsRemovedFromManifest,
      events_added_in_manifest: report.eventsAddedInManifest,
      events_removed_from_manifest: report.eventsRemovedFromManifest,
      manifest_path: "infra/github-app/o11yfleet.json",
      // Reminder for log readers: GET /app doesn't expose URL fields.
      caveat:
        "callback_urls, redirect_url, hook_attributes.url, setup_url are not returned by GET /app and are NOT compared. A no-drift check above does not mean those match.",
      remediation:
        "Reconcile in https://github.com/settings/apps/o11yfleet (org admins might use a different path).",
    });
  }

  return report;
}
