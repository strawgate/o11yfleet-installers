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

Do not move the custom domains until the new Pages projects are provisioned and
the deployment workflow is ready to publish to them.

## GitHub Secrets

Add these in GitHub repo Settings > Secrets and variables > Actions:

| Secret                  | Value                              | Notes                 |
| ----------------------- | ---------------------------------- | --------------------- |
| `CLOUDFLARE_API_TOKEN`  | (create in CF Dashboard)           | See permissions below |
| `CLOUDFLARE_ACCOUNT_ID` | `417e8c0fd8f1a64e9f2c4845afa6dc56` |                       |

### CF API Token Permissions

Create at Dashboard > My Profile > API Tokens > Create Token > Custom Token:

- **Zone > DNS > Edit** (for managing DNS records)
- **Zone > Zone > Read**
- **Account > Workers Scripts > Edit**
- **Account > D1 > Edit**
- **Account > R2 > Edit**
- **Account > Queues > Edit**
- **Account > Cloudflare Pages > Edit**
- **Account > Access: Apps and Policies > Edit** (for admin Access)

Zone resources: Include all zones in account.

## Worker Runtime Secrets

Do not put runtime secrets in `wrangler.jsonc` `vars`; Wrangler uploads `vars` as plaintext Worker configuration. Provision these as Worker secrets for each deployed environment:

```bash
cd apps/worker
pnpm wrangler secret put CLAIM_SECRET --env staging
pnpm wrangler secret put API_SECRET --env staging
pnpm wrangler secret put SEED_TENANT_USER_EMAIL --env staging
pnpm wrangler secret put SEED_TENANT_USER_PASSWORD --env staging
pnpm wrangler secret put SEED_ADMIN_EMAIL --env staging
pnpm wrangler secret put SEED_ADMIN_PASSWORD --env staging

pnpm wrangler secret put CLAIM_SECRET --env production
pnpm wrangler secret put API_SECRET --env production
pnpm wrangler secret put SEED_TENANT_USER_EMAIL --env production
pnpm wrangler secret put SEED_TENANT_USER_PASSWORD --env production
pnpm wrangler secret put SEED_ADMIN_EMAIL --env production
pnpm wrangler secret put SEED_ADMIN_PASSWORD --env production
```

## Analytics Engine

`apps/worker/wrangler.jsonc` binds `FP_ANALYTICS` to the `fp_analytics` dataset in staging and production. Cloudflare creates Workers Analytics Engine datasets automatically on the first write after a Worker binding is deployed, so there is no separate dataset resource to create in Terraform.

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
| Worker               | `o11yfleet-worker`                     |
| Pages Project        | `o11yfleet-site`                       |
| CF Account           | `417e8c0fd8f1a64e9f2c4845afa6dc56`     |
| Zone (o11yfleet.com) | `2650adcd696a6e400201a68323e90c5e`     |

## URLs

| Service              | URL                                            |
| -------------------- | ---------------------------------------------- |
| Worker (workers.dev) | https://o11yfleet-worker.o11yfleet.workers.dev |
| Worker (custom)      | https://api.o11yfleet.com                      |
| Site (pages.dev)     | https://o11yfleet-site.pages.dev               |
| Site (custom)        | https://o11yfleet.com                          |
| Portal (custom)      | https://app.o11yfleet.com                      |
| Admin (custom)       | https://admin.o11yfleet.com                    |
