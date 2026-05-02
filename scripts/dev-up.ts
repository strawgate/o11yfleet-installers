#!/usr/bin/env -S npx tsx
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";

import { localCommandEnv } from "./with-local-env.ts";

const startupTimeoutMs = 90_000;

type ManagedProcess = {
  name: string;
  child: ChildProcess;
};

type EarlyExitHandler = (processInfo: ManagedProcess, reason: string, exitCode: number) => void;

function log(message: string): void {
  console.log(`[dev-up] ${message}`);
}

function start(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onEarlyExit: EarlyExitHandler,
): ManagedProcess {
  log(`starting ${name}: ${[command, ...args].join(" ")}`);
  const child = spawn(command, args, {
    env,
    stdio: "inherit",
  });
  const processInfo = { name, child };
  child.once("exit", (code, signal) => {
    onEarlyExit(processInfo, signal ?? `code ${code ?? "unknown"}`, code ?? 1);
  });
  child.once("error", (error) => {
    onEarlyExit(processInfo, error.message, 1);
  });
  return processInfo;
}

async function waitForUrl(url: string, path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = new URL(path, url).toString();

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const requestTimeout = setTimeout(
      () => controller.abort(),
      Math.min(5_000, deadline - Date.now()),
    );
    try {
      const response = await fetch(healthUrl, { signal: controller.signal });
      if (response.ok) return;
    } catch {
      // Keep polling until timeout.
    } finally {
      clearTimeout(requestTimeout);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1_000);
    });
  }

  throw new Error(`Timed out waiting for ${healthUrl}`);
}

function runChecked(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  log(`running: ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? "unknown status"}`);
  }
}

function siteListenArgs(siteUrl: string): string[] {
  const url = new URL(siteUrl);
  return ["--host", url.hostname, "--port", url.port || (url.protocol === "https:" ? "443" : "80")];
}

function stopAll(processes: ManagedProcess[]): void {
  for (const processInfo of processes) {
    if (!processInfo.child.killed) {
      log(`stopping ${processInfo.name}`);
      processInfo.child.kill("SIGTERM");
    }
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const reset = args.has("--reset");
  const skipSeed = args.has("--no-seed");
  // Populate .dev.vars with strong random values for any placeholder
  // dev secrets. Idempotent — real values are preserved. Done before
  // we read the env so the worker boots with the freshly-generated
  // values. Safe to run on every dev-up.
  const ensure = spawnSync("pnpm", ["tsx", "scripts/ensure-dev-secrets.ts"], {
    stdio: "inherit",
  });
  if (ensure.status !== 0) {
    console.error("[dev-up] ensure-dev-secrets failed");
    process.exit(ensure.status ?? 1);
  }
  const env = localCommandEnv();
  const workerUrl = env.FP_URL ?? "http://localhost:8787";
  const siteUrl = env.UI_URL ?? "http://127.0.0.1:3000";
  const processes: ManagedProcess[] = [];
  let shuttingDown = false;

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopAll(processes);
  };
  const handleEarlyExit: EarlyExitHandler = (processInfo, reason, exitCode): void => {
    if (shuttingDown) return;
    console.error(`[dev-up] ${processInfo.name} exited early: ${reason}`);
    shutdown();
    process.exit(exitCode);
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(143);
  });

  const worker = start(
    "worker",
    "pnpm",
    ["--dir=apps/worker", "wrangler", "dev"],
    env,
    handleEarlyExit,
  );
  processes.push(worker);

  const site = start(
    "site",
    "pnpm",
    ["--dir=apps/site", "dev", ...siteListenArgs(siteUrl)],
    env,
    handleEarlyExit,
  );
  processes.push(site);

  try {
    log(`waiting for worker health at ${workerUrl}/healthz`);
    await waitForUrl(workerUrl, "/healthz", startupTimeoutMs);
    log("worker is healthy");

    log(`waiting for site at ${siteUrl}`);
    await waitForUrl(siteUrl, "/", startupTimeoutMs);
    log("site is responding");

    if (skipSeed) {
      log("skipping migrations and seed because --no-seed was provided");
    } else {
      runChecked("just", ["db-migrate"], env);
      runChecked("pnpm", ["tsx", "scripts/seed-local.ts", ...(reset ? ["--reset"] : [])], env);
    }

    console.log("");
    log(`worker: ${workerUrl}`);
    log(`site:   ${siteUrl}`);
    log("press Ctrl+C to stop worker and site");
    if (process.stdin.isTTY) {
      process.stdin.resume();
    }
  } catch (error) {
    shutdown();
    console.error(`[dev-up] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(`[dev-up] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
