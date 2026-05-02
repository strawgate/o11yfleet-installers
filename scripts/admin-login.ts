#!/usr/bin/env -S npx tsx
/**
 * Local-dev admin login helper.
 *
 * Reads dev secrets from `apps/worker/.dev.vars`, ensures the seeded
 * admin user exists via `/auth/seed`, then logs in as that user via
 * `/auth/login`. Prints `export FP_ADMIN_COOKIE='fp_session=…'` so the
 * caller can `eval "$(just admin-login)"` and use the cookie with curl
 * against `/api/admin/*` routes.
 *
 * Usage:
 *   just admin-login                # prints `export ...`
 *   eval "$(just admin-login)"      # populates FP_ADMIN_COOKIE
 *   curl -H "Cookie: $FP_ADMIN_COOKIE" -H "Origin: $FP_URL" \
 *        $FP_URL/api/admin/tenants
 *
 *   just admin-login --cookie       # prints just the cookie value
 */

import { readLocalEnv } from "./with-local-env.ts";

const FP_URL = process.env.FP_URL ?? "http://localhost:8787";
const env = readLocalEnv();

const API_KEY = process.env.O11YFLEET_API_BEARER_SECRET ?? env.O11YFLEET_API_BEARER_SECRET ?? "";
const ADMIN_EMAIL = process.env.O11YFLEET_SEED_ADMIN_EMAIL ?? env.O11YFLEET_SEED_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD =
  process.env.O11YFLEET_SEED_ADMIN_PASSWORD ?? env.O11YFLEET_SEED_ADMIN_PASSWORD ?? "";

const want = [
  "O11YFLEET_API_BEARER_SECRET",
  "O11YFLEET_SEED_ADMIN_EMAIL",
  "O11YFLEET_SEED_ADMIN_PASSWORD",
];
const missing = want.filter(
  (k) => !(k in process.env || k in env) || (env[k] ?? process.env[k] ?? "") === "",
);
if (missing.length) {
  console.error(`[admin-login] missing dev secrets: ${missing.join(", ")}`);
  console.error(`[admin-login] run \`just ensure-dev-secrets\` first.`);
  process.exit(1);
}

async function main(): Promise<void> {
  // 1. Idempotent admin-user provisioning.
  const seedRes = await fetch(`${FP_URL}/auth/seed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!seedRes.ok) {
    console.error(`[admin-login] /auth/seed failed: ${seedRes.status} ${await seedRes.text()}`);
    process.exit(1);
  }

  // 2. Login → session cookie.
  const loginRes = await fetch(`${FP_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: FP_URL },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error(`[admin-login] /auth/login failed: ${loginRes.status} ${await loginRes.text()}`);
    process.exit(1);
  }

  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/fp_session=([^;]+)/);
  if (!match) {
    console.error(
      `[admin-login] /auth/login returned no fp_session cookie (Set-Cookie: ${setCookie})`,
    );
    process.exit(1);
  }
  const cookie = `fp_session=${match[1]}`;

  if (process.argv.includes("--cookie")) {
    console.log(cookie);
  } else {
    console.log(`export FP_ADMIN_COOKIE='${cookie}'`);
    console.log(`export FP_URL='${FP_URL}'`);
  }
}

main().catch((err: unknown) => {
  console.error(`[admin-login] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
