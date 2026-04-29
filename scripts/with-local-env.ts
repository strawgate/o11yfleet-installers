#!/usr/bin/env -S npx tsx
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultDevVarsPath = resolve(scriptDir, "../apps/worker/.dev.vars");

function closingQuoteIndex(value: string, quote: string): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0 && value.slice(index + 1).trim() === "") {
      return index;
    }
  }
  return -1;
}

function unescapeQuotedValue(value: string, quote: string): string {
  const inner = value.slice(1, -1);
  if (quote === "'") {
    return inner.replace(/\\(['\\])/g, "$1");
  }
  return inner.replace(/\\([\\'"nrt])/g, (_match, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return escaped;
    }
  });
}

function parseValue(
  lines: string[],
  startIndex: number,
  rawValue: string,
): { nextIndex: number; value: string } {
  const quote = rawValue[0];
  if (quote !== '"' && quote !== "'") {
    return { nextIndex: startIndex, value: rawValue };
  }

  let value = rawValue;
  let nextIndex = startIndex;
  while (closingQuoteIndex(value, quote) === -1 && nextIndex + 1 < lines.length) {
    nextIndex += 1;
    value += `\n${lines[nextIndex]}`;
  }

  const endQuoteIndex = closingQuoteIndex(value, quote);
  if (endQuoteIndex === -1) {
    return { nextIndex, value };
  }
  return { nextIndex, value: unescapeQuotedValue(value.slice(0, endQuoteIndex + 1), quote) };
}

export function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const parsed = parseValue(lines, index, trimmed.slice(equalsIndex + 1).trim());
    index = parsed.nextIndex;
    const value = parsed.value;
    if (key) env[key] = value;
  }

  return env;
}

export function readLocalEnv(path = defaultDevVarsPath): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

export function localCommandEnv(localEnv = readLocalEnv()): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...localEnv, ...process.env };
  if (merged.API_SECRET) {
    merged.O11YFLEET_API_KEY ??= merged.API_SECRET;
    merged.FP_API_KEY ??= merged.API_SECRET;
  }
  merged.FP_URL ??= "http://localhost:8787";
  return merged;
}

function main(): void {
  const rawArgs = process.argv.slice(2);
  const commandArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  const [command, ...args] = commandArgs;

  if (!command) {
    console.error("Usage: pnpm tsx scripts/with-local-env.ts -- <command> [...args]");
    process.exit(2);
  }

  const result = spawnSync(command, args, {
    env: localCommandEnv(),
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`Command terminated by signal ${result.signal}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
