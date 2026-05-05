#!/usr/bin/env npx tsx

/**
 * Bootstrap Cloudflare credentials for per-environment isolation
 *
 * This script replaces the bash version (bootstrap-cloudflare-credentials.sh) with
 * a type-safe TypeScript implementation using native fetch for API calls.
 *
 * Creates:
 * - Per-environment R2 buckets for Terraform state isolation
 * - Per-environment tokens with least-privilege permissions:
 *   - TERRAFORM_READONLY_TOKEN: Workers/D1/R2 Read (plan only)
 *   - TERRAFORM_DEPLOY_TOKEN: Workers/D1/R2/DNS/Workers Routes/Pages Write (deploy)
 *
 * Note: TFSTATE worker deployment requires manual steps (see --help output)
 *
 * Usage:
 *   npx tsx scripts/bootstrap-cloudflare-credentials.ts --apply --envs "dev staging prod preview"
 *
 * Environment variables:
 *   CLOUDFLARE_API_TOKEN or CLOUDFLARE_BOOTSTRAP_API_TOKEN - Cloudflare API token
 *   GITHUB_TOKEN - GitHub token (needs repo:secret write permissions)
 *   CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID
 *   GITHUB_REPOSITORY - Override repo (default: strawgate/o11yfleet)
 */

import { parseArgs } from "node:util";
import { execSync } from "node:child_process";

// ============================================================================
// Types
// ============================================================================

interface CloudflareToken {
  id: string;
  name: string;
  status: string;
  issued_on: string;
  modified_on: string;
  last_used_on: string | null;
  value?: string; // Only present in create response
  policies: CloudflarePolicy[];
}

interface CloudflarePolicy {
  id: string;
  effect: "allow" | "deny";
  resources: Record<string, string>;
  permission_groups: { id: string; name: string }[];
}

interface PermissionGroup {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  category: string;
}

interface PermissionGroupsResponse {
  result: PermissionGroup[];
  result_info: {
    page: 1;
    per_page: number;
    total_pages: number;
    count: number;
    total_count: number;
  };
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
}

interface TokenCreateResponse {
  result: CloudflareToken;
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
}

interface R2Bucket {
  name: string;
  creation_date: string;
}

// ============================================================================
// Configuration
// ============================================================================

const ENVIRONMENTS: Record<string, { github: string; hasZone: boolean }> = {
  dev: { github: "dev", hasZone: true },
  staging: { github: "staging", hasZone: true },
  prod: { github: "production", hasZone: true },
  production: { github: "production", hasZone: true },
  preview: { github: "preview", hasZone: false },
};

const PERMISSION_GROUPS = {
  // Account-level permissions
  WORKERS_SCRIPTS_READ: "Workers Scripts Read",
  WORKERS_SCRIPTS_WRITE: "Workers Scripts Write",
  D1_READ: "D1 Read",
  D1_WRITE: "D1 Write",
  R2_STORAGE_READ: "Workers R2 Storage Read",
  R2_STORAGE_WRITE: "Workers R2 Storage Write",
  ACCOUNT_SETTINGS_READ: "Account Settings Read",
  PAGES_READ: "Pages Read",
  PAGES_WRITE: "Pages Write",
  // Zone-level permissions
  ZONE_READ: "Zone Read",
  ZONE_DNS_WRITE: "DNS Write",
  ZONE_WORKERS_ROUTES_WRITE: "Workers Routes Write",
};

// ============================================================================
// API Client
// ============================================================================

class CloudflareAPI {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, options);

    const data = (await response.json()) as T;

    if (!response.ok) {
      throw new Error(
        `Cloudflare API error: ${response.status} ${response.statusText} - ${JSON.stringify(data)}`,
      );
    }

    return data;
  }

  async getPermissionGroups(): Promise<PermissionGroup[]> {
    const data = await this.request<PermissionGroupsResponse>(
      "GET",
      "/user/tokens/permission_groups",
    );
    return data.result;
  }

  async getZoneForAccount(accountId: string): Promise<string | null> {
    const data = await this.request<{
      result: { id: string; name: string; account: { id: string } }[];
    }>("GET", `/zones?account.id=${accountId}`);
    return data.result[0]?.id ?? null;
  }

  async createToken(
    name: string,
    policies: {
      effect: string;
      resources: Record<string, string>;
      permission_groups: { id: string }[];
    }[],
  ): Promise<TokenCreateResponse> {
    const response = await this.request<TokenCreateResponse>("POST", "/user/tokens", {
      name,
      policies,
    });

    // Verify token was created successfully
    if (!response.success || !response.result) {
      throw new Error(`Failed to create token ${name}: ${JSON.stringify(response.errors)}`);
    }

    return response;
  }

  async createR2Bucket(accountId: string, name: string): Promise<boolean> {
    try {
      await this.request("POST", `/accounts/${accountId}/r2/buckets`, {
        name,
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return false; // Already exists
      }
      throw error;
    }
  }

  async listR2Buckets(accountId: string): Promise<R2Bucket[]> {
    const data = await this.request<{ result: R2Bucket[] }>(
      "GET",
      `/accounts/${accountId}/r2/buckets`,
    );
    return data.result;
  }
}

// ============================================================================
// GitHub API Client
// ============================================================================

class GitHubAPI {
  private token: string;
  private repo: string;

  constructor(token: string, repo: string) {
    this.token = token;
    this.repo = repo;
  }

  private async request<T>(method: string, path: string, body?: unknown, env?: string): Promise<T> {
    const base = "https://api.github.com";
    let url = `${base}/repos/${this.repo}${path}`;

    if (env) {
      url = `${base}/repos/${this.repo}/environments/${env}${path}`;
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok && response.status !== 404) {
      const data = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${data}`);
    }

    if (response.status === 404) {
      return null as T;
    }

    return response.json() as Promise<T>;
  }

  setSecret(name: string, value: string, env?: string): void {
    const args = ["secret", "set", name, "--body", value];
    if (env) args.push("--env", env);

    try {
      execSync(["gh", ...args].join(" "), {
        env: { ...process.env, GH_TOKEN: this.token },
        stdio: "pipe",
      });
    } catch (error) {
      throw new Error(
        `Failed to set secret ${name}${env ? ` for environment ${env}` : ""}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  setVariable(name: string, value: string, env: string): void {
    const escapedValue = value.replace(/"/g, '\\"');
    const cmd = `gh api --method PUT -f value="${escapedValue}" /repos/${this.repo}/environments/${env}/variables/${name}`;
    try {
      execSync(cmd, {
        env: { ...process.env, GH_TOKEN: this.token },
        stdio: "pipe",
      });
    } catch (error) {
      throw new Error(
        `Failed to set variable ${name} for environment ${env}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  environmentExists(env: string): boolean {
    try {
      execSync(`gh api /repos/${this.repo}/environments/${env}`, {
        env: { ...process.env, GH_TOKEN: this.token },
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Permission Resolver
// ============================================================================

class PermissionResolver {
  private groups: Map<string, PermissionGroup>;

  constructor(groups: PermissionGroup[]) {
    this.groups = new Map(groups.map((g) => [g.id, g]));
  }

  findId(name: string, scope?: string): string {
    const group = Array.from(this.groups.values()).find(
      (g) => g.name === name && (!scope || g.scopes.includes(scope)),
    );

    if (!group) {
      throw new Error(`Permission group not found: ${name} (${scope ?? "any scope"})`);
    }

    return group.id;
  }

  findIdsByNames(names: string[], scope?: string, required = true): string[] {
    const results: string[] = [];
    for (const name of names) {
      try {
        results.push(this.findId(name, scope));
      } catch {
        if (required) {
          throw new Error(`Required permission '${name}' not found (scope: ${scope ?? "any"})`);
        }
      }
    }
    return results;
  }
}

// ============================================================================
// Bootstrap Logic
// ============================================================================

interface BootstrapOptions {
  apply: boolean;
  environments: string[];
  skipBuckets: boolean;
  skipWorkers: boolean;
  tfstateWorkerDir: string;
}

async function bootstrap(options: BootstrapOptions): Promise<void> {
  const { apply, environments, skipBuckets, skipWorkers, tfstateWorkerDir } = options;

  // Get credentials from environment
  const cloudflareToken =
    process.env.CLOUDFLARE_BOOTSTRAP_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!cloudflareToken) {
    throw new Error("CLOUDFLARE_BOOTSTRAP_API_TOKEN or CLOUDFLARE_API_TOKEN is required");
  }

  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required");
  }

  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
  }

  const cf = new CloudflareAPI(cloudflareToken);
  const repo = process.env.GITHUB_REPOSITORY || "strawgate/o11yfleet";
  const gh = new GitHubAPI(githubToken, repo);

  console.log("==============================================");
  console.log("o11yfleet Bootstrap - Per-Environment Isolation");
  console.log("==============================================");
  console.log(`Account ID: ${accountId}`);
  console.log(`Target environments: ${environments.join(", ")}`);
  console.log(`TFSTATE worker dir: ${tfstateWorkerDir}`);
  console.log();

  // Resolve permission groups
  console.log("Resolving Cloudflare permission groups...");
  const groups = await cf.getPermissionGroups();
  const resolver = new PermissionResolver(groups);

  // Get zone for account
  const zoneId = await cf.getZoneForAccount(accountId);
  console.log(`Zone: ${zoneId ?? "none"}`);
  console.log();

  for (const envName of environments) {
    const env = ENVIRONMENTS[envName];
    if (!env) {
      console.log(`Unknown environment: ${envName}`);
      continue;
    }

    const githubEnv = env.github;
    console.log("==============================================");
    console.log(`Environment: ${envName} (GitHub: ${githubEnv})`);
    console.log("==============================================");

    // Verify GitHub environment exists
    const envExists = gh.environmentExists(githubEnv);
    if (!envExists) {
      console.log(`  GitHub environment ${githubEnv} does not exist, skipping`);
      continue;
    }
    console.log(`  GitHub environment ${githubEnv}: verified`);

    // Create R2 bucket
    const bucketName = `o11yfleet-tfstate-${envName}`;
    if (!skipBuckets) {
      console.log(`  R2 Bucket: ${bucketName}`);
      if (apply) {
        const created = await cf.createR2Bucket(accountId, bucketName);
        console.log(`    ${created ? "Created" : "Already exists"} bucket ${bucketName}`);
      } else {
        console.log(`    Would create bucket: ${bucketName}`);
      }
    } else {
      console.log(`  R2 Bucket: skipped (--skip-buckets)`);
    }

    // Determine if this env has a tfstate worker
    const hasTfstateWorker = envName !== "preview" && !skipWorkers;

    if (hasTfstateWorker) {
      console.log(`  TFSTATE Worker: ${bucketName}`);
      if (apply) {
        // Deploy tfstate worker via wrangler
        // This would require:
        // 1. Creating a wrangler config with env-specific settings
        // 2. Running wrangler deploy with --env flag
        // 3. Setting TFSTATE_USERNAME and TFSTATE_PASSWORD secrets
        console.log(`    TFSTATE worker deployment requires manual steps:
    - Deploy tfstate worker: cd ${tfstateWorkerDir} && npx wrangler deploy --env ${envName}
    - Set secrets: npx wrangler secret put TFSTATE_USERNAME --env ${envName}
                  npx wrangler secret put TFSTATE_PASSWORD --env ${envName}
    - Set GitHub var: gh variable set TFSTATE_WORKER_URL --env ${githubEnv} --body "https://..."`);
      } else {
        console.log(`    Would deploy tfstate worker`);
      }
    } else {
      console.log(`  TFSTATE Worker: skipped (preview uses its own R2 bucket)`);
    }

    // Get zone ID for this environment
    const envZoneId = env.hasZone ? zoneId : null;
    if (env.hasZone && !zoneId) {
      console.log(`  Warning: Zone not found, some resources may not be created`);
    }

    // Create tokens
    await createTokens(cf, gh, resolver, {
      envName,
      githubEnv,
      accountId,
      zoneId: envZoneId,
      apply,
    });

    // Set account ID
    console.log(`  CLOUDFLARE_ACCOUNT_ID:`);
    if (apply) {
      gh.setSecret("CLOUDFLARE_ACCOUNT_ID", accountId, githubEnv);
      console.log(`    github environment ${githubEnv}: set CLOUDFLARE_ACCOUNT_ID`);
    } else {
      console.log(`    would set CLOUDFLARE_ACCOUNT_ID`);
    }

    console.log();
  }

  console.log("==============================================");
  console.log("Bootstrap complete!");
  console.log("==============================================");
  console.log();
  console.log("Token usage:");
  console.log("  - TERRAFORM_READONLY_TOKEN: plan jobs (Workers/D1/R2 Read)");
  console.log("  - TERRAFORM_DEPLOY_TOKEN: deploy jobs (Workers/D1/R2/DNS/Workers Routes Write)");
}

interface TokenOptions {
  envName: string;
  githubEnv: string;
  accountId: string;
  zoneId: string | null;
  apply: boolean;
}

async function createTokens(
  cf: CloudflareAPI,
  gh: GitHubAPI,
  resolver: PermissionResolver,
  options: TokenOptions,
): Promise<void> {
  const { envName, githubEnv, accountId, zoneId, apply } = options;

  const suffix = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16) + "Z";
  const accountResource = `com.cloudflare.api.account.${accountId}`;

  // Account-level permissions
  const accountReadPerms = [
    PERMISSION_GROUPS.WORKERS_SCRIPTS_READ,
    PERMISSION_GROUPS.D1_READ,
    PERMISSION_GROUPS.R2_STORAGE_READ,
    PERMISSION_GROUPS.ACCOUNT_SETTINGS_READ,
  ];

  const accountWritePerms = [
    PERMISSION_GROUPS.WORKERS_SCRIPTS_WRITE,
    PERMISSION_GROUPS.D1_WRITE,
    PERMISSION_GROUPS.R2_STORAGE_WRITE,
    PERMISSION_GROUPS.PAGES_WRITE,
    PERMISSION_GROUPS.ACCOUNT_SETTINGS_READ,
  ];

  // Zone-level permissions
  const zoneReadPerms = zoneId ? [PERMISSION_GROUPS.ZONE_READ] : [];

  const zoneWritePerms = zoneId
    ? [PERMISSION_GROUPS.ZONE_DNS_WRITE, PERMISSION_GROUPS.ZONE_WORKERS_ROUTES_WRITE]
    : [];

  // ========================================
  // TERRAFORM_READONLY_TOKEN
  // ========================================
  console.log(`  TERRAFORM_READONLY_TOKEN (plan jobs only):`);

  const readonlyPolicy = {
    effect: "allow" as const,
    resources: { [accountResource]: "*" },
    permission_groups: resolver.findIdsByNames(accountReadPerms).map((id) => ({ id })),
  };

  if (apply) {
    const tokenName = `o11yfleet ${envName} terraform-readonly ${suffix}`;
    const response = await cf.createToken(tokenName, [readonlyPolicy]);
    const tokenValue = response.result.value;

    if (!tokenValue) {
      throw new Error(`Failed to create TERRAFORM_READONLY_TOKEN for ${envName}`);
    }

    gh.setSecret("TERRAFORM_READONLY_TOKEN", tokenValue, githubEnv);
    console.log(`    github environment ${githubEnv}: set TERRAFORM_READONLY_TOKEN`);
  } else {
    console.log(`    would create token: o11yfleet ${envName} terraform-readonly ${suffix}`);
    console.log(`    scope: Workers Read, D1 Read, R2 Read, Account Settings Read`);
  }

  // ========================================
  // TERRAFORM_DEPLOY_TOKEN
  // ========================================
  console.log(`  TERRAFORM_DEPLOY_TOKEN (apply/deploy jobs):`);

  const policies: {
    effect: string;
    resources: Record<string, string>;
    permission_groups: { id: string }[];
  }[] = [];

  // Account-level policy
  policies.push({
    effect: "allow",
    resources: { [accountResource]: "*" },
    permission_groups: resolver.findIdsByNames(accountWritePerms).map((id) => ({ id })),
  });

  // Zone-level policy (if zone exists)
  if (zoneId) {
    const zoneResource = `com.cloudflare.api.account.zone.${zoneId}`;
    policies.push({
      effect: "allow",
      resources: { [zoneResource]: "*" },
      permission_groups: resolver
        .findIdsByNames([...zoneReadPerms, ...zoneWritePerms])
        .map((id) => ({ id })),
    });
  }

  if (apply) {
    const tokenName = `o11yfleet ${envName} terraform-deploy ${suffix}`;
    const response = await cf.createToken(tokenName, policies);
    const tokenValue = response.result.value;

    if (!tokenValue) {
      throw new Error(`Failed to create TERRAFORM_DEPLOY_TOKEN for ${envName}`);
    }

    gh.setSecret("TERRAFORM_DEPLOY_TOKEN", tokenValue, githubEnv);
    console.log(`    github environment ${githubEnv}: set TERRAFORM_DEPLOY_TOKEN`);
  } else {
    console.log(`    would create token: o11yfleet ${envName} terraform-deploy ${suffix}`);
    console.log(
      `    scope: Workers Write, D1 Write, R2 Write, DNS Write, Workers Routes Write, Pages Write`,
    );
  }
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", short: "a" },
      envs: { type: "string", short: "e", default: "dev staging prod" },
      "skip-buckets": { type: "boolean", default: false },
      "skip-workers": { type: "boolean", default: false },
      "tfstate-worker-dir": {
        type: "string",
        default: "infra/tfstate-worker",
      },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Bootstrap Cloudflare credentials for per-environment isolation

Creates per-environment tokens with least-privilege permissions for CI/CD:
  - TERRAFORM_READONLY_TOKEN: Workers/D1/R2 Read (plan jobs only)
  - TERRAFORM_DEPLOY_TOKEN: Workers/D1/R2/DNS/Workers Routes/Pages Write (deploy jobs)

Usage: bootstrap-cloudflare-credentials.ts [options]

Options:
  --apply, -a           Create tokens and write GitHub secrets (default: dry-run)
  --envs, -e            Space-separated env list (default: "dev staging prod")
                        Supported: dev, staging, prod, preview
  --skip-buckets        Skip R2 bucket creation (use existing buckets)
  --skip-workers        Skip tfstate worker deployment (use shared R2 for preview)
  --tfstate-worker-dir  Path to tfstate-worker directory (default: infra/tfstate-worker)
  --help, -h            Show this help

Environment variables:
  CLOUDFLARE_API_TOKEN or CLOUDFLARE_BOOTSTRAP_API_TOKEN  Cloudflare API token
  GITHUB_TOKEN           GitHub token (needs repo:secret write permissions)
  CLOUDFLARE_ACCOUNT_ID  Cloudflare account ID
  GITHUB_REPOSITORY      Override repo (default: strawgate/o11yfleet)

GitHub secrets created per environment:
  - TERRAFORM_READONLY_TOKEN (env-scoped)
  - TERRAFORM_DEPLOY_TOKEN (env-scoped)
  - CLOUDFLARE_ACCOUNT_ID (env-scoped)
  - TFSTATE_USERNAME/PASSWORD (preview only)

Examples:
  # Dry run (show what would be created)
  npx tsx scripts/bootstrap-cloudflare-credentials.ts

  # Apply changes for all environments
  npx tsx scripts/bootstrap-cloudflare-credentials.ts --apply

  # Apply changes for specific environments
  npx tsx scripts/bootstrap-cloudflare-credentials.ts --apply --envs "dev staging preview"
    `);
    process.exit(0);
  }

  const environments = values.envs?.split(" ") ?? ["dev", "staging", "prod"];

  bootstrap({
    apply: values.apply ?? false,
    environments,
    skipBuckets: values["skip-buckets"] ?? false,
    skipWorkers: values["skip-workers"] ?? false,
    tfstateWorkerDir: values["tfstate-worker-dir"] ?? "infra/tfstate-worker",
  }).catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

main();
