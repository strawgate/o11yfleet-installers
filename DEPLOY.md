# Deployment

This document is the operational checklist for deploying O11yFleet and enabling admin-only
Cloudflare usage estimates.

## Deployment Credentials

These credentials are used by CI, Terraform, and Wrangler to deploy infrastructure. They are not
read by the running Worker unless explicitly configured as Worker secrets.

| Name                             | Where                                   | Purpose                                                                                            |
| -------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`           | GitHub Actions secret or local shell    | Allows Wrangler/Terraform to deploy Workers, Pages, D1 migrations, and other Cloudflare resources. |
| `CLOUDFLARE_ACCOUNT_ID`          | GitHub Actions secret or local shell    | Selects the Cloudflare account for deployments.                                                    |
| Terraform remote state variables | GitHub Actions variables or local shell | Configure remote Terraform state; see `infra/terraform/`.                                          |

## Worker Runtime Secrets

Set these on the Worker with `wrangler secret put` for every deployed environment. Do not commit
the values.

| Name                        | Required       | Purpose                                                                                |
| --------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `API_SECRET`                | Yes            | Deployment-level bearer secret for controlled bootstrap and programmatic admin access. |
| `CLAIM_SECRET`              | Yes            | HMAC secret for enrollment and assignment claims.                                      |
| `SEED_TENANT_USER_EMAIL`    | Bootstrap only | Initial tenant user email used by `/auth/seed`.                                        |
| `SEED_TENANT_USER_PASSWORD` | Bootstrap only | Initial tenant user password used by `/auth/seed`.                                     |
| `SEED_ADMIN_EMAIL`          | Bootstrap only | Initial admin email used by `/auth/seed`.                                              |
| `SEED_ADMIN_PASSWORD`       | Bootstrap only | Initial admin password used by `/auth/seed`.                                           |
| `MINIMAX_API_KEY`           | Optional       | Enables AI guidance when the MiniMax provider is selected.                             |
| `LLM_PROVIDER`              | Optional       | Selects the AI guidance provider.                                                      |
| `LLM_MODEL`                 | Optional       | Selects the AI guidance model.                                                         |
| `LLM_BASE_URL`              | Optional       | Overrides the AI guidance provider base URL.                                           |

## Admin Usage & Spend

The `/admin/usage` page estimates Cloudflare usage and spend from analytics APIs. It does not read
Cloudflare billing totals. Configure these Worker runtime secrets to enable it:

| Name                                   | Required | Source                                                                                                                                                          |
| -------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ANALYTICS_API_KEY` | Yes      | Cloudflare API token with the permissions needed for account analytics and Analytics Engine SQL reads.                                                          |
| `CLOUDFLARE_ACCOUNT_ID`                | Yes      | Cloudflare account id.                                                                                                                                          |
| `CLOUDFLARE_WORKER_SCRIPT_NAME`        | Yes      | Worker script name for invocation analytics. Local default: `o11yfleet-worker`; staging: `o11yfleet-worker-staging`; production: `o11yfleet-worker-production`. |
| `CLOUDFLARE_D1_DATABASE_ID`            | Yes      | D1 database id from `apps/worker/wrangler.jsonc`.                                                                                                               |
| `CLOUDFLARE_R2_BUCKET_NAME`            | Yes      | R2 bucket name from `apps/worker/wrangler.jsonc`.                                                                                                               |
| `CLOUDFLARE_ANALYTICS_DATASET`         | Yes      | Analytics Engine dataset from `apps/worker/wrangler.jsonc`.                                                                                                     |

Use `CLOUDFLARE_ACCOUNT_ANALYTICS_API_KEY` for the runtime analytics token. The admin usage page
does not fall back to `CLOUDFLARE_API_TOKEN`; that name is reserved for deployment tooling.

For local development, put the runtime values in `apps/worker/.dev.vars`. This file is ignored by
git and should be `0600`.

## Deployment Commands

```bash
just ci
just tf-plan-worker prod
just tf-apply-worker prod
```

Staging still has a legacy direct deploy command until Terraform-managed staging rollout is fully
aligned:

```bash
just deploy-staging
```

After deploying, verify:

```bash
curl https://<worker-host>/healthz
```

Then sign in to the admin portal and check `/admin/health` and `/admin/usage`.
