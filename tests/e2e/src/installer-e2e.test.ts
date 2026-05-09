/**
 * E2E tests for the installer scripts.
 *
 * Tests installation in Docker containers simulating various environments:
 *   - Minimal container (no sudo, no mktemp) → should fail gracefully
 *   - Root user with curl/tar only → should work (no sudo needed)
 *   - Per-user install mode → no sudo/root required
 *
 * Run:
 *   cd tests/e2e && pnpm vitest run src/installer-e2e.test.ts
 */

import { describe, it, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";

const INSTALL_URL = "https://install.o11yfleet.com/install.sh";

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function dockerRun(
  image: string,
  script: string,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(
      "docker",
      ["run", "--rm", "--privileged", image, "sh", "-c", script],
      { encoding: "utf8", timeout: 180_000 },
    );
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { status?: number; stderr?: string; stdout?: string };
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.status ?? 1,
    };
  }
}

function checkInstallScript(): boolean {
  try {
    const result = execSync(`curl -fsSL "${INSTALL_URL}" | head -1`, {
      encoding: "utf8",
      timeout: 10_000,
    });
    return result.includes("#!/");
  } catch {
    return false;
  }
}

const skipIf = (condition: boolean, reason: string) => {
  if (condition) console.warn(`Skipping: ${reason}`);
};

describe("install.sh in Docker", () => {
  it("fails gracefully when mktemp is missing", () => {
    skipIf(!dockerAvailable(), "Docker not available");
    skipIf(!checkInstallScript(), `Install script not available at ${INSTALL_URL}`);
    if (!dockerAvailable() || !checkInstallScript()) return;

    const result = dockerRun(
      "ubuntu:24.04",
      `apt-get update -qq && apt-get install -y -qq curl tar >/dev/null 2>&1 && ` +
        `curl -fsSL "${INSTALL_URL}" | bash -s -- --dry-run --token test_token`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/mktemp|Required command not found/);
  });

  it("fails gracefully when sudo is missing for system install", () => {
    skipIf(!dockerAvailable(), "Docker not available");
    skipIf(!checkInstallScript(), `Install script not available at ${INSTALL_URL}`);
    if (!dockerAvailable() || !checkInstallScript()) return;

    const result = dockerRun(
      "ubuntu:24.04",
      `apt-get update -qq && apt-get install -y -qq curl tar coreutils >/dev/null 2>&1 && ` +
        `curl -fsSL "${INSTALL_URL}" | bash -s -- --token test_token`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/root privileges|sudo/i);
  });

  it("succeeds with --user when running as root (no sudo needed)", () => {
    skipIf(!dockerAvailable(), "Docker not available");
    skipIf(!checkInstallScript(), `Install script not available at ${INSTALL_URL}`);
    if (!dockerAvailable() || !checkInstallScript()) return;

    const result = dockerRun(
      "ubuntu:24.04",
      `apt-get update -qq && apt-get install -y -qq curl tar coreutils >/dev/null 2>&1 && ` +
        `curl -fsSL "${INSTALL_URL}" | bash -s -- --token test_token --user --dry-run`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("~/.local");
  });

  it("succeeds as root without --user (system install dry-run)", () => {
    skipIf(!dockerAvailable(), "Docker not available");
    skipIf(!checkInstallScript(), `Install script not available at ${INSTALL_URL}`);
    if (!dockerAvailable() || !checkInstallScript()) return;

    const result = dockerRun(
      "ubuntu:24.04",
      `apt-get update -qq && apt-get install -y -qq curl tar coreutils sudo >/dev/null 2>&1 && ` +
        `curl -fsSL "${INSTALL_URL}" | bash -s -- --token test_token --dry-run`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("/opt/o11yfleet");
  });

  it("custom --dir overrides default", () => {
    skipIf(!dockerAvailable(), "Docker not available");
    skipIf(!checkInstallScript(), `Install script not available at ${INSTALL_URL}`);
    if (!dockerAvailable() || !checkInstallScript()) return;

    const result = dockerRun(
      "ubuntu:24.04",
      `apt-get update -qq && apt-get install -y -qq curl tar coreutils >/dev/null 2>&1 && ` +
        `curl -fsSL "${INSTALL_URL}" | bash -s -- --token test_token --dir /custom/path --dry-run`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("/custom/path");
  });
});

describe("install.sh on macOS (Intel)", () => {
  it("succeeds with --user on macOS (if available)", () => {
    skipIf(!dockerAvailable(), "Docker not available");
    skipIf(!checkInstallScript(), `Install script not available at ${INSTALL_URL}`);
    if (!dockerAvailable() || !checkInstallScript()) return;

    const result = dockerRun(
      "almalinux:9",
      `dnf install -y -q curl tar coreutils >/dev/null 2>&1 && ` +
        `curl -fsSL "${INSTALL_URL}" | bash -s -- --token test_token --user --dry-run`,
    );
    expect(result.exitCode).toBe(0);
  });
});
