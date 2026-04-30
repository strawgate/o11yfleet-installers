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

Worker runtime secrets live on the deployed Worker, not in Terraform state and not in the Pages
site. GitHub Actions secrets are only for deployment tooling and smoke tests.

## Site Runtime Configuration

The browser site must not receive `API_SECRET`, `CLAIM_SECRET`, or any admin bearer token. Site
builds receive only non-secret configuration:

| Name                     | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `VITE_O11YFLEET_API_URL` | Public API base URL for the target env. |

The `just site-build <env>` recipe sets this automatically:

| Env       | API URL                             | Pages projects                                                               |
| --------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `dev`     | `https://dev-api.o11yfleet.com`     | `o11yfleet-dev-site`, `o11yfleet-dev-app`, `o11yfleet-dev-admin`             |
| `staging` | `https://staging-api.o11yfleet.com` | `o11yfleet-staging-site`, `o11yfleet-staging-app`, `o11yfleet-staging-admin` |
| `prod`    | `https://api.o11yfleet.com`         | `o11yfleet-site`, `o11yfleet-app`, `o11yfleet-admin`                         |

## Admin Usage & Spend

The `/admin/usage` page estimates Cloudflare usage and spend from analytics APIs. It does not read
Cloudflare billing totals. Configure these Worker runtime secrets to enable it:

| Name                                   | Required | Source                                                                                                                                         |
| -------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ANALYTICS_API_KEY` | Yes      | Cloudflare API token with the permissions needed for account analytics and Analytics Engine SQL reads.                                         |
| `CLOUDFLARE_ACCOUNT_ID`                | Yes      | Cloudflare account id.                                                                                                                         |
| `CLOUDFLARE_WORKER_SCRIPT_NAME`        | Yes      | Worker script name for invocation analytics. Local/prod: `o11yfleet-worker`; staging: `o11yfleet-worker-staging`; dev: `o11yfleet-worker-dev`. |
| `CLOUDFLARE_D1_DATABASE_ID`            | Yes      | D1 database id from `apps/worker/wrangler.jsonc`.                                                                                              |
| `CLOUDFLARE_R2_BUCKET_NAME`            | Yes      | R2 bucket name from `apps/worker/wrangler.jsonc`.                                                                                              |
| `CLOUDFLARE_ANALYTICS_DATASET`         | Yes      | Analytics Engine dataset from `apps/worker/wrangler.jsonc`.                                                                                    |

Use `CLOUDFLARE_ACCOUNT_ANALYTICS_API_KEY` for the runtime analytics token. The admin usage page
does not fall back to `CLOUDFLARE_API_TOKEN`; that name is reserved for deployment tooling.

For local development, put the runtime values in `apps/worker/.dev.vars`. This file is ignored by
git and should be `0600`.

## Deployment Commands

Terraform owns stable resources for every deployed environment. Wrangler remains the uploader for
Pages assets and the Worker bundle builder used by Terraform.

Before enabling Terraform-managed staging, retire/delete any legacy
`o11yfleet-worker-staging` Worker that was created outside Terraform and let
Terraform create the environment-specific Worker, D1, R2, Queue, DNS route, and
Pages projects. Import the staging Worker only if preserving its identity is
required. Do not point staging at production D1/R2/Queue.

Staging:

```bash
just tf-plan staging
just tf-apply staging
just tf-apply-worker staging
just d1-migrate staging
just site-build staging
just pages-deploy staging
```

Or run the combined recipe:

```bash
just deploy-staging
```

Production:

```bash
just ci
just tf-plan-worker prod
just tf-apply-worker prod
just d1-migrate prod
just site-build prod
just pages-deploy prod
```

After deploying, verify:

```bash
curl https://<worker-host>/healthz
```

Then sign in to the admin portal and check `/admin/health` and `/admin/usage`.
