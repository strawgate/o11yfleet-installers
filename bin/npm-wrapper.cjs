#!/usr/bin/env node
/**
 * O11yFleet Installer - NPM Entry Point
 *
 * Usage:
 *   npx o11yfleet-install --token fp_enroll_...
 *   npm i -g o11yfleet-install && o11yfleet-install --token fp_enroll_...
 *
 * This is a thin wrapper that downloads and runs the native binary.
 */

const { spawn } = require("child_process");
const { createWriteStream, chmodSync, existsSync } = require("fs");
const { join, dirname } = require("path");
const { mkdirSync } = require("fs");

const INSTALLER_BASE_URL = "https://install.o11yfleet.com/releases";

function getPlatform() {
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "x64";
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  return `${platform}-${arch}`;
}

function getBinaryName() {
  return process.platform === "win32" ? "o11yfleet-install.exe" : "o11yfleet-install";
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const writer = createWriteStream(dest);
  response.body.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);

  // Parse token from args
  let token = "";
  const filteredArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--token" && i + 1 < args.length) {
      token = args[++i];
    } else if (arg.startsWith("--token=")) {
      token = arg.replace("--token=", "");
    } else if (arg.startsWith("fp_enroll_") && !token) {
      token = arg;
    } else {
      filteredArgs.push(arg);
    }
  }

  if (!token && !filteredArgs.includes("--dry-run")) {
    console.error("\n  Error: Enrollment token required");
    console.error("  Usage: npx o11yfleet-install --token fp_enroll_...\n");
    process.exit(1);
  }

  const platform = getPlatform();
  const binName = getBinaryName();
  const binDir = join(dirname(__dirname), "bin");
  const binPath = join(binDir, binName);

  mkdirSync(binDir, { recursive: true });

  console.log("");
  console.log("  O11yFleet Installer (npm)");
  console.log("  ──────────────────────────");
  console.log(`  Platform: ${platform}`);
  console.log("");

  // Download if not exists or if token provided (always download fresh for now)
  const url = `${INSTALLER_BASE_URL}/${platform}/${binName}`;
  console.log(`  Downloading from ${url}...`);

  try {
    await download(url, binPath);
    chmodSync(binPath, 0o755);
  } catch (err) {
    console.error(`\n  Error: Failed to download installer`);
    console.error(`  URL: ${url}`);
    console.error(`  Error: ${err.message}\n`);
    process.exit(1);
  }

  console.log("  Running installer...\n");

  // Run the binary with original args
  const child = spawn(binPath, [...(token ? ["--token", token] : []), ...filteredArgs], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("close", (code) => {
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});
