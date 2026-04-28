/**
 * Version management
 * Reads version from package.json in parent directory
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Go up from dist/utils to package.json
const packageJsonPath = join(__dirname, "..", "..", "package.json");

let version: string | undefined;

try {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  version = pkg.version;
} catch {
  // Fallback if we can't read the package.json
}

export function getVersion(): string {
  return version || "0.0.0";
}

export const VERSION = getVersion();
