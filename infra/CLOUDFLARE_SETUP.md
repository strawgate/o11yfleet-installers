# Cloudflare Deployment Setup

Terraform is the target source of truth for stable Cloudflare resources. See
[`terraform/README.md`](terraform/README.md) for the current stack, import
sequence, and rollout guardrails.

This file records the existing production resources that predate Terraform
ownership.

## Existing DNS Records

These records currently exist in the [Cloudflare Dashboard](https://dash.cloudflare.com/417e8c0fd8f1a64e9f2c4845afa6dc56) for zone `o11yfleet.com` and should be imported before Terraform manages them:

### Worker API

| Type | Name  | Content | Proxy      |
| ---- | ----- | ------- | ---------- |
| AAAA | `api` | `100::` | ✅ Proxied |

This routes `api.o11yfleet.com` → Worker (`o11yfleet-worker`).

### Site (Cloudflare Pages custom domains)

Current custom domains in Pages > o11yfleet-site > Custom domains:

- `o11yfleet.com` — marketing site
- `app.o11yfleet.com` — user portal (root redirects to `/portal/overview`)
- `admin.o11yfleet.com` — admin portal (root redirects to `/admin/overview`)

The Terraform target splits these into separate Pages projects:

- `o11yfleet-site` -> `o11yfleet.com`
- `o11yfleet-app` -> `app.o11yfleet.com`
- `o11yfleet-admin` -> `admin.o11yfleet.com`

The deployment workflows publish the same built SPA bundle to all three split
Pages projects, so Terraform can attach each custom domain to its target
project after the existing Pages custom domains are imported or detached from
the legacy project.

## GitHub Actions Secrets

Add these in GitHub repo Settings > Secrets and variables > Actions:

Repository-level deployment credentials:

| Secret                         | Value                              | Notes                                         |
| ------------------------------ | ---------------------------------- | --------------------------------------------- |
| `CLOUDFLARE_DEPLOY_API_TOKEN`  | (create in CF Dashboard)           | See permissions below                         |
| `CLOUDFLARE_DEPLOY_ACCOUNT_ID` | `417e8c0fd8f1a64e9f2c4845afa6dc56` | Workflows map this to `CLOUDFLARE_ACCOUNT_ID` |

Environment-level Worker and smoke-test secrets, configured separately for the
`dev`, `staging`, and `production` GitHub Environments:

| Secret                                | Notes                                                             |
| ------------------------------------- | ----------------------------------------------------------------- |
| `O11YFLEET_API_BEARER_SECRET`         | Worker admin bearer and deploy smoke auth                         |
| `O11YFLEET_CLAIM_HMAC_SECRET`         | OpAMP enrollment claim signing                                    |
| `O11YFLEET_SEED_TENANT_USER_EMAIL`    | `/auth/seed` tenant user email; required in dev/staging/prod      |
| `O11YFLEET_SEED_TENANT_USER_PASSWORD` | `/auth/seed` tenant user password; required in dev/staging/prod   |
| `O11YFLEET_SEED_ADMIN_EMAIL`          | `/auth/seed` admin email; required in dev/staging/prod            |
| `O11YFLEET_SEED_ADMIN_PASSWORD`       | `/auth/seed` admin password; required in dev/staging/prod         |
| `AI_GUIDANCE_MINIMAX_API_KEY`         | Optional; only required for SDK-backed AI guidance provider modes |
| `CLOUDFLARE_USAGE_ACCOUNT_ID`         | Optional admin usage/spend estimates                              |
| `CLOUDFLARE_USAGE_API_TOKEN`          | Optional admin usage/spend estimates                              |
| `CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME` | Optional admin usage/spend estimates                              |
| `CLOUDFLARE_USAGE_D1_DATABASE_ID`     | Optional admin usage/spend estimates                              |
| `CLOUDFLARE_USAGE_R2_BUCKET_NAME`     | Optional admin usage/spend estimates                              |
| `CLOUDFLARE_USAGE_ANALYTICS_DATASET`  | Optional admin usage/spend estimates                              |

### CF API Token Permissions

Create at Dashboard > My Profile > API Tokens > Create Token > Custom Token:

- **Zone > DNS > Edit** (for managing DNS records)
- **Zone > Zone > Read**
- **Account > Workers Scripts > Edit**
- **Account > Workers Tail > Read**
- **Account > D1 > Edit**
- **Account > R2 > Edit**
- **Account > Queues > Edit**
- **Account > Cloudflare Pages > Edit**
- **Account > Access: Apps and Policies > Edit** (for admin Access)

Zone resources: Include all zones in account.

## Worker Runtime Secrets

Do not put runtime secrets in `wrangler.jsonc` `vars`; Wrangler uploads `vars`
as plaintext Worker configuration. Provision these as Worker secrets for each
deployed environment. Terraform-managed Worker versions inherit `O11YFLEET_API_BEARER_SECRET`,
`O11YFLEET_CLAIM_HMAC_SECRET`, and seed-account secrets from the latest Worker version by
default. Provision them before Terraform Worker deployments so the uploaded
version can inherit the secret bindings. AI guidance can also inherit the optional
`AI_GUIDANCE_MINIMAX_API_KEY`; Terraform provides the non-secret `AI_GUIDANCE_PROVIDER`, `AI_GUIDANCE_MODEL`,
and `AI_GUIDANCE_BASE_URL` Worker bindings.

`apps/worker/wrangler.jsonc` also declares these names under
`secrets.required` for the base, staging, and production Worker environments.
That makes Wrangler fail deploys/version uploads when a required secret binding
is missing, while Terraform validates that the production Worker version keeps
the same required inherited bindings.

Pages deployments do not get Worker runtime secrets. The browser receives only
non-secret build-time values such as `VITE_O11YFLEET_API_URL`.

```bash
cd apps/worker
pnpm wrangler versions secret put O11YFLEET_CLAIM_HMAC_SECRET --env staging
pnpm wrangler versions secret put O11YFLEET_API_BEARER_SECRET --env staging
pnpm wrangler versions secret put O11YFLEET_SEED_TENANT_USER_EMAIL --env staging
pnpm wrangler versions secret put O11YFLEET_SEED_TENANT_USER_PASSWORD --env staging
pnpm wrangler versions secret put O11YFLEET_SEED_ADMIN_EMAIL --env staging
pnpm wrangler versions secret put O11YFLEET_SEED_ADMIN_PASSWORD --env staging

# Production Worker deploys are Terraform-managed and use the base
# o11yfleet-worker script identity, not Wrangler's -production script.
pnpm wrangler versions secret put O11YFLEET_CLAIM_HMAC_SECRET
pnpm wrangler versions secret put O11YFLEET_API_BEARER_SECRET
pnpm wrangler versions secret put O11YFLEET_SEED_TENANT_USER_EMAIL
pnpm wrangler versions secret put O11YFLEET_SEED_TENANT_USER_PASSWORD
pnpm wrangler versions secret put O11YFLEET_SEED_ADMIN_EMAIL
pnpm wrangler versions secret put O11YFLEET_SEED_ADMIN_PASSWORD
```

Use `wrangler versions secret put` for Terraform-managed scripts so secret
updates create a Worker version without immediately shifting traffic. Use
`wrangler secret put` only for bootstrap/recovery cases where an immediate
Wrangler deployment is intentional.

## Analytics Engine

Terraform binds `FP_ANALYTICS` to the `fp_analytics` dataset for
Terraform-managed Worker versions. Cloudflare creates Workers Analytics Engine
datasets automatically on the first write after a Worker binding is deployed,
so there is no separate dataset resource to create in Terraform.

To verify after deployment:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/417e8c0fd8f1a64e9f2c4845afa6dc56/analytics_engine/sql" \
  --header "Authorization: Bearer <API_TOKEN_WITH_ACCOUNT_ANALYTICS_READ>" \
  --data "SELECT event_type, count() FROM fp_analytics GROUP BY event_type LIMIT 10"
```

## Current Resource IDs

| Resource              | ID                                     |
| --------------------- | -------------------------------------- |
| D1 Database (fp-db)   | `192ca9ca-bd47-4bd2-9321-fcdf62d9cf05` |
| Worker                | `o11yfleet-worker`                     |
| Pages Project (site)  | `o11yfleet-site`                       |
| Pages Project (app)   | `o11yfleet-app`                        |
| Pages Project (admin) | `o11yfleet-admin`                      |
| CF Account            | `417e8c0fd8f1a64e9f2c4845afa6dc56`     |
| Zone (o11yfleet.com)  | `2650adcd696a6e400201a68323e90c5e`     |

## URLs

| Service              | URL                                            |
| -------------------- | ---------------------------------------------- |
| Worker (workers.dev) | https://o11yfleet-worker.o11yfleet.workers.dev |
| Worker (custom)      | https://api.o11yfleet.com                      |
| Site (pages.dev)     | https://o11yfleet-site.pages.dev               |
| Site (custom)        | https://o11yfleet.com                          |
| Portal (custom)      | https://app.o11yfleet.com                      |
| Admin (custom)       | https://admin.o11yfleet.com                    |

Terraform non-production defaults:

| Service        | Staging URL                          | Dev URL                          |
| -------------- | ------------------------------------ | -------------------------------- |
| Worker API     | https://staging-api.o11yfleet.com    | https://dev-api.o11yfleet.com    |
| Marketing/docs | https://staging.o11yfleet.com        | https://dev.o11yfleet.com        |
| Portal         | https://staging-app.o11yfleet.com    | https://dev-app.o11yfleet.com    |
| Admin          | https://staging-admin.o11yfleet.com  | https://dev-admin.o11yfleet.com  |
| Pages projects | `o11yfleet-staging-{site,app,admin}` | `o11yfleet-dev-{site,app,admin}` |
| Worker script  | `o11yfleet-worker-staging`           | `o11yfleet-worker-dev`           |
