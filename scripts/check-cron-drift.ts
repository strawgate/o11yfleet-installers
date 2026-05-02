#!/usr/bin/env -S npx tsx
/**
 * Drift check between Terraform's `worker_crons` variable and Wrangler's
 * `triggers.crons`. Both sides need to stay in sync so the CF account's
 * actual cron schedule matches what terraform declares it manages.
 *
 * Sources:
 *   - infra/terraform/variables.tf  → `worker_crons` default
 *   - apps/worker/wrangler.jsonc    → `triggers.crons` at top level AND
 *                                     in every named env block (Wrangler
 *                                     does NOT inherit the top-level
 *                                     triggers into env blocks).
 *
 * Exit 0 when everything matches. Exit 1 with a clear diff message
 * otherwise.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const variablesPath = resolve(repoRoot, "infra/terraform/variables.tf");
const wranglerPath = resolve(repoRoot, "apps/worker/wrangler.jsonc");

/**
 * Strip JSONC comments and trailing commas so JSON.parse works. Conservative
 * approach: only strip `//` line comments and `/* … *\/` block comments outside
 * of string literals, and trailing commas before `}` or `]`.
 */
function jsoncToJson(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let stringQuote = "";
  while (i < input.length) {
    const ch = input[i]!;
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < input.length) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringQuote) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length - 1 && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  // Strip trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function parseTfWorkerCrons(source: string): string[] {
  // Matches:
  //   variable "worker_crons" {
  //     ...
  //     default     = ["0 0 * * *", "17 3 * * *"]
  //     ...
  //   }
  const block = source.match(/variable\s+"worker_crons"\s*\{[\s\S]*?^\}/m);
  if (!block) {
    throw new Error(`worker_crons variable not found in ${variablesPath}. Did this file move?`);
  }
  const defaultMatch = block[0].match(/default\s*=\s*\[([\s\S]*?)\]/);
  if (!defaultMatch) {
    throw new Error(
      `worker_crons variable has no \`default\` block. Update this script if you intentionally removed the default.`,
    );
  }
  const items = [...defaultMatch[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  if (items.length === 0) {
    throw new Error(`worker_crons default is empty.`);
  }
  return items;
}

type WranglerCronOccurrence = { path: string; crons: string[] };

function collectWranglerCrons(parsed: unknown): WranglerCronOccurrence[] {
  const result: WranglerCronOccurrence[] = [];
  function walk(node: unknown, path: string): void {
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const triggers = obj.triggers;
    if (triggers !== undefined && triggers !== null && typeof triggers === "object") {
      const crons = (triggers as Record<string, unknown>).crons;
      if (Array.isArray(crons)) {
        const stringCrons = crons.filter((c): c is string => typeof c === "string");
        if (stringCrons.length === crons.length) {
          result.push({ path: `${path}.triggers.crons`, crons: stringCrons });
        }
      }
    }
    if (typeof obj.env === "object" && obj.env !== null) {
      for (const [envName, envBlock] of Object.entries(obj.env as Record<string, unknown>)) {
        walk(envBlock, `${path}.env.${envName}`);
      }
    }
  }
  walk(parsed, "$");
  return result;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function main(): void {
  const variablesSrc = readFileSync(variablesPath, "utf8");
  const wranglerSrc = readFileSync(wranglerPath, "utf8");

  const tfCrons = parseTfWorkerCrons(variablesSrc);
  let wrangler;
  try {
    wrangler = JSON.parse(jsoncToJson(wranglerSrc));
  } catch (err) {
    console.error(`Failed to parse wrangler.jsonc as JSON: ${(err as Error).message}`);
    process.exit(2);
  }

  const occurrences = collectWranglerCrons(wrangler);
  if (occurrences.length === 0) {
    console.error(
      `Found no triggers.crons in apps/worker/wrangler.jsonc. Either Wrangler stopped using crons, or the parser missed them. Update this script.`,
    );
    process.exit(2);
  }

  const failures: string[] = [];

  for (const occ of occurrences) {
    if (!arraysEqual(occ.crons, tfCrons)) {
      failures.push(
        `  • ${occ.path}\n      wrangler: ${JSON.stringify(occ.crons)}\n      terraform: ${JSON.stringify(tfCrons)}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      [
        `Cron drift detected between Terraform's worker_crons variable`,
        `(${variablesPath}) and Wrangler's triggers.crons in`,
        `apps/worker/wrangler.jsonc.`,
        ``,
        `Mismatches:`,
        ...failures,
        ``,
        `Fix: pick one source of truth, then update the other to match.`,
        `Both sides must list the same crons in the same order.`,
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `Cron schedules in sync: ${tfCrons.length} cron(s), ${occurrences.length} wrangler occurrence(s) all match.`,
  );
}

main();
