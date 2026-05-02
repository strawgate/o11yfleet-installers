# `o11yfleet-tfstate` — Terraform state backend Worker

Vendored copy of [`cmackenzie1/tfstate-worker`](https://github.com/cmackenzie1/tfstate-worker) — a Cloudflare Worker that implements Terraform's HTTP backend protocol with proper LOCK/UNLOCK semantics, backed by R2.

## Why

R2's S3-compatible API (which `infra/terraform/` currently uses for state storage) does not support the DynamoDB-style locking that the AWS S3 backend uses. Without locking, two `terraform apply` runs against the same environment can race and corrupt state. Today the only mitigation is a GitHub Actions concurrency group on `terraform-deploy.yml`, which doesn't protect against a human running `just tf-apply` locally while CI is also applying.

This Worker plugs that gap. Costs ~nothing (one DO + R2 reads/writes are well inside CF Workers free-tier limits for our usage).

Source: [`cmackenzie1/tfstate-worker`](https://github.com/cmackenzie1/tfstate-worker) at the version vendored here. Re-syncing is a `cp -R` from upstream.

## Layout

| File | What |
|---|---|
| `src/index.ts` | Hono router; basic-auth on `/states/*` |
| `src/durableLock.ts` | `DurableLock` Durable Object — single-writer lock per state path |
| `wrangler.toml` | o11yfleet-specific config: account ID, R2 bucket, DO migration |
| `package.json` / `tsconfig.json` | Standalone npm project (NOT in the pnpm workspace) |
| `test/`, `biome.json`, `vitest.config.js` | Upstream tests + tooling, kept verbatim for easy re-sync |

## State path convention

R2 keys land at `${USERNAME}/${projectName}.tfstate`, where `USERNAME` is the Wrangler-provisioned secret. With the o11yfleet bootstrap (`USERNAME=o11yfleet`, `projectName={env}`):

| env | New R2 key |
|---|---|
| dev | `o11yfleet/dev.tfstate` |
| staging | `o11yfleet/staging.tfstate` |
| prod | `o11yfleet/prod.tfstate` |

This **differs** from the existing S3 backend layout (`o11yfleet/{env}/terraform.tfstate`). The migration step below copies the state files to the new keys before flipping the backend.

## Bootstrap (first deploy, one-time)

Run from this directory.

```bash
cd infra/tfstate-worker

# Install deps for the standalone project
npm install

# Authenticate wrangler against the o11yfleet account
npx wrangler login

# Deploy the worker (creates o11yfleet-tfstate.<account_id>.workers.dev)
npx wrangler deploy

# Set basic-auth credentials. Use long random values; record them in 1Password
# under the o11yfleet vault — they go into terraform backend config later.
openssl rand -hex 16 | npx wrangler secret put USERNAME
openssl rand -base64 32 | npx wrangler secret put PASSWORD

# Smoke test: /health requires no auth
curl -sf https://o11yfleet-tfstate.<account_id>.workers.dev/health
# OK
```

After deploy, the worker is at:
`https://o11yfleet-tfstate.417e8c0fd8f1a64e9f2c4845afa6dc56.workers.dev`

## State migration (per environment, one-time)

Done **after** the worker is deployed and credentials are stored. This is the cutover from the S3 backend to the HTTP backend. **Do dev first**, validate, then staging, then prod.

```bash
# 1. Copy state file in R2 from old key to new key (in-place; no data loss)
ENV=dev
ACCOUNT_ID=417e8c0fd8f1a64e9f2c4845afa6dc56
SRC_KEY="o11yfleet/${ENV}/terraform.tfstate"
DST_KEY="o11yfleet/${ENV}.tfstate"

aws s3 cp \
  "s3://o11yfleet-terraform-state/${SRC_KEY}" \
  "s3://o11yfleet-terraform-state/${DST_KEY}" \
  --endpoint-url "https://${ACCOUNT_ID}.r2.cloudflarestorage.com"

# 2. Update infra/terraform/versions.tf backend block from `s3 {}` to:
#    backend "http" {}

# 3. Re-init terraform with the new backend (no -migrate-state needed; we
#    already pre-staged the state file in step 1).
WORKER_BASE="https://o11yfleet-tfstate.${ACCOUNT_ID}.workers.dev"
PROJECT="${ENV}"
cd ../terraform
terraform init -reconfigure \
  -backend-config="address=${WORKER_BASE}/states/${PROJECT}" \
  -backend-config="lock_address=${WORKER_BASE}/states/${PROJECT}/lock" \
  -backend-config="unlock_address=${WORKER_BASE}/states/${PROJECT}/lock" \
  -backend-config="lock_method=LOCK" \
  -backend-config="unlock_method=UNLOCK" \
  -backend-config="username=${TFSTATE_USERNAME}" \
  -backend-config="password=${TFSTATE_PASSWORD}"

# 4. Verify nothing changes
terraform plan -var-file=envs/dev.tfvars

# 5. Once all 3 envs are migrated and clean, delete the old S3-backend keys:
aws s3 rm "s3://o11yfleet-terraform-state/o11yfleet/${ENV}/terraform.tfstate" \
  --endpoint-url "https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
```

## After migration

- Update `justfile`'s `tf-init-remote` recipe to drop the S3 backend args and use the http backend
- Update `.github/workflows/terraform-deploy.yml` env vars: replace `TERRAFORM_STATE_R2_*` with `TFSTATE_WORKER_USERNAME` / `TFSTATE_WORKER_PASSWORD`
- Drop the `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env exports from the deploy workflows; they're no longer needed for state access
- Keep `TERRAFORM_STATE_R2_BUCKET` if any other workflow still uses it

These follow-up changes belong in a separate PR after the cutover is verified working in all 3 envs.

## Verifying lock works

```bash
# Hold a lock from one terminal:
curl -X LOCK -u "$TFSTATE_USERNAME:$TFSTATE_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"ID":"test","Operation":"test","Info":"manual","Who":"me","Version":"1.0","Created":"now","Path":""}' \
  "https://o11yfleet-tfstate.${ACCOUNT_ID}.workers.dev/states/dev/lock"

# In a second terminal, attempt apply — should immediately fail with
# "Error acquiring the state lock":
just tf-plan dev

# Release:
curl -X UNLOCK -u "$TFSTATE_USERNAME:$TFSTATE_PASSWORD" \
  -d '{"ID":"test"}' \
  "https://o11yfleet-tfstate.${ACCOUNT_ID}.workers.dev/states/dev/lock"
```

## Local patches on top of upstream

Re-syncs need to preserve these:

| Patch | File | Why |
|---|---|---|
| Constant-time credential comparison | `src/index.ts` | Upstream uses `u === c.env.USERNAME && p === c.env.PASSWORD`, which leaks credential length and is vulnerable to timing attacks. Replaced with a manual constant-time compare. PR Rocket's `no-anti-patterns` check flagged this on initial vendor; keeping the patch on top of upstream. Worth proposing upstream. |
| `wrangler.toml` rewritten for o11yfleet | `wrangler.toml` | Upstream is a template; ours pins our account, R2 bucket, no custom domain. |

## Re-syncing from upstream

```bash
git clone https://github.com/cmackenzie1/tfstate-worker /tmp/tfstate-worker
diff -r /tmp/tfstate-worker/src infra/tfstate-worker/src
# Apply upstream changes you want; preserve our wrangler.toml AND the
# constant-time-compare patch in src/index.ts.
```
