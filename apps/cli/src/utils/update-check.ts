/**
 * Update checker for o11y CLI
 * Checks npm registry for new versions and warns if outdated
 */

import { VERSION } from "./version.js";
import { output } from "./output.js";
import { canPrompt } from "./terminal.js";
import chalk from "chalk";

const NPM_REGISTRY = "https://registry.npmjs.org/-/package/@o11yfleet/cli/dist-tags";

interface NpmDistTags {
  latest: string;
  [key: string]: string;
}

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
}

function isNewer(current: string, latest: string): boolean {
  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

export async function checkForUpdates(): Promise<void> {
  // Skip in CI, JSON mode, or if NO_UPDATE_CHECK is set
  if (!canPrompt() || process.env.NO_UPDATE_CHECK === "1" || output.jsonMode) {
    return;
  }

  try {
    const resp = await fetch(NPM_REGISTRY, {
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) {
      return;
    }

    const tags = (await resp.json()) as NpmDistTags;
    const latestVersion = tags.latest;

    if (isNewer(VERSION, latestVersion)) {
      output.log("");
      output.warn(
        `A new version of o11y is available: ${chalk.green(latestVersion)} (current: ${VERSION})`,
      );
      output.log(`To update: npm install -g @o11yfleet/cli`);
    }
  } catch {
    // Silently ignore update check failures
  }
}

export function suppressUpdateCheck(): void {
  process.env.NO_UPDATE_CHECK = "1";
}
