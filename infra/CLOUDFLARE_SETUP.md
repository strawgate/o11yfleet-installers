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

### Site (Workers Static Assets custom domains)

The site surfaces are served by Terraform-managed Workers Static Assets:

- `o11yfleet.com` — marketing site
- `app.o11yfleet.com` — user portal (root redirects to `/portal/overview`)
- `admin.o11yfleet.com` — admin portal (root redirects to `/admin/overview`)

Terraform uploads the same built SPA bundle to one static site Worker per
environment and routes all three hostnames to it.

## GitHub Actions Secrets

Add these in GitHub repo Settings > Secrets and variables > Actions:

Environment-level deployment credentials:

| Secret                                 | Value                              | Notes                                         |
| -------------------------------------- | ---------------------------------- | --------------------------------------------- |
| `CLOUDFLARE_DEPLOY_API_TOKEN`          | (create with bootstrap script)     | See permissions below                         |
| `CLOUDFLARE_DEPLOY_ACCOUNT_ID`         | `417e8c0fd8f1a64e9f2c4845afa6dc56` | Workflows map this to `CLOUDFLARE_ACCOUNT_ID` |
| `TERRAFORM_STATE_R2_ACCESS_KEY_ID`     | (create with bootstrap script)     | R2 S3 access key for Terraform state          |
| `TERRAFORM_STATE_R2_SECRET_ACCESS_KEY` | (create with bootstrap script)     | R2 S3 secret key for Terraform state          |

Environment-level Worker and smoke-test secrets, configured separately for the
`dev`, `staging`, and `production` GitHub Environments:

| Secret                                  | Notes                                                             |
| --------------------------------------- | ----------------------------------------------------------------- |
| `O11YFLEET_API_BEARER_SECRET`           | Worker admin bearer and deploy smoke auth                         |
| `O11YFLEET_CLAIM_HMAC_SECRET`           | OpAMP enrollment claim signing                                    |
| `O11YFLEET_SEED_TENANT_USER_EMAIL`      | `/auth/seed` tenant user email; required in dev/staging/prod      |
| `O11YFLEET_SEED_TENANT_USER_PASSWORD`   | `/auth/seed` tenant user password; required in dev/staging/prod   |
| `O11YFLEET_SEED_ADMIN_EMAIL`            | `/auth/seed` admin email; required in dev/staging/prod            |
| `O11YFLEET_SEED_ADMIN_PASSWORD`         | `/auth/seed` admin password; required in dev/staging/prod         |
| `O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` | Optional; only required for SDK-backed AI guidance provider modes |
| `CLOUDFLARE_BILLING_API_TOKEN`          | Admin usage/spend: GraphQL Analytics API (Terraform-inherited)    |

### CF API Token Permissions

Prefer the bootstrap script so the token values are created and sent directly to
GitHub Environment secrets without printing:

```bash
just cloudflare-credentials-dry-run "dev staging prod"
just cloudflare-credentials-apply "dev staging prod"
```

The bootstrap script creates one deploy API token and one R2 state API token for
each environment. The deploy token permissions are equivalent to creating a
custom token with:

- **Zone > DNS > Edit** (for managing DNS records)
- **Zone > Workers Routes > Edit**
- **Zone > Zone > Read**
- **Account > Workers Scripts > Edit**
- **Account > D1 > Edit**
- **Account > R2 > Edit**
- **Account > Queues > Edit**
- **Account > Account Settings > Read**

Zone resources: the `o11yfleet.com` zone. Account resources: the o11yFleet
account. Add `--include-zero-trust` when `enable_admin_access=true`; that adds
the Cloudflare Access app/policy write permission for admin Access.

The R2 state token is scoped to object read/write/list on the Terraform state
bucket. Cloudflare R2 derives S3 credentials from the token response: the access
key id is the API token id, and the secret access key is the SHA-256 hash of the
API token value.

## Worker Runtime Secrets

Do not put runtime secrets in `wrangler.jsonc` `vars`; Wrangler uploads `vars`
as plaintext Worker configuration. Provision these as Worker secrets for each
deployed environment. Terraform-managed Worker versions inherit `O11YFLEET_API_BEARER_SECRET`,
`O11YFLEET_CLAIM_HMAC_SECRET`, and seed-account secrets from the latest Worker version by
default. Provision them before Terraform Worker deployments so the uploaded
version can inherit the secret bindings. AI guidance can also inherit the
optional `O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` when an environment's tfvars set an SDK
provider mode and include that secret in `worker_inherited_binding_names`;
Terraform provides the non-secret `O11YFLEET_AI_GUIDANCE_PROVIDER`, `O11YFLEET_AI_GUIDANCE_MODEL`,
and `O11YFLEET_AI_GUIDANCE_BASE_URL` Worker bindings.

`apps/worker/wrangler.jsonc` also declares these names under
`secrets.required` for the base, staging, and production Worker environments.
That makes Wrangler fail deploys/version uploads when a required secret binding
is missing, while Terraform validates that the production Worker version keeps
the same required inherited bindings.

Static site deployments do not get API Worker runtime secrets. The browser receives only
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

## Usage & Spend Bindings

The admin portal's Usage & Spend page uses the following binding and secret:

| Name                            | Source    | Notes                                 |
| ------------------------------- | --------- | ------------------------------------- |
| `CLOUDFLARE_BILLING_ACCOUNT_ID` | Terraform | From `cloudflare_account_id` variable |

The only secret required is `CLOUDFLARE_BILLING_API_TOKEN` for GraphQL Analytics API access.
Create a read-only billing/analytics token and set it as a Worker secret:

```bash
# Dry-run first to see what would be created
just cloudflare-usage-credentials-dry-run "staging prod"

# Create usage tokens and set them as Worker secrets
just cloudflare-usage-secrets "staging prod"
```

This creates a token with only Account Analytics and D1 Analytics read permissions,
scoped to the o11yFleet account. Terraform inherits the secret and makes it
available to deployed Worker versions.

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

| Resource             | ID                                     |
| -------------------- | -------------------------------------- |
| D1 Database (fp-db)  | `192ca9ca-bd47-4bd2-9321-fcdf62d9cf05` |
| API Worker           | `o11yfleet-worker`                     |
| Static site Worker   | `o11yfleet-site-worker`                |
| CF Account           | `417e8c0fd8f1a64e9f2c4845afa6dc56`     |
| Zone (o11yfleet.com) | `2650adcd696a6e400201a68323e90c5e`     |

## URLs

| Service              | URL                                                 |
| -------------------- | --------------------------------------------------- |
| Worker (workers.dev) | https://o11yfleet-worker.o11yfleet.workers.dev      |
| Worker (custom)      | https://api.o11yfleet.com                           |
| Site Worker          | https://o11yfleet-site-worker.o11yfleet.workers.dev |
| Site (custom)        | https://o11yfleet.com                               |
| Portal (custom)      | https://app.o11yfleet.com                           |
| Admin (custom)       | https://admin.o11yfleet.com                         |

Terraform non-production defaults:

| Service        | Staging URL                         | Dev URL                         |
| -------------- | ----------------------------------- | ------------------------------- |
| Worker API     | https://staging-api.o11yfleet.com   | https://dev-api.o11yfleet.com   |
| Marketing/docs | https://staging.o11yfleet.com       | https://dev.o11yfleet.com       |
| Portal         | https://staging-app.o11yfleet.com   | https://dev-app.o11yfleet.com   |
| Admin          | https://staging-admin.o11yfleet.com | https://dev-admin.o11yfleet.com |
| Site Worker    | `o11yfleet-site-worker-staging`     | `o11yfleet-site-worker-dev`     |
| API Worker     | `o11yfleet-worker-staging`          | `o11yfleet-worker-dev`          |
