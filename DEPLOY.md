# Deployment

This document is the operational checklist for deploying O11yFleet and enabling admin-only
Cloudflare usage estimates.

## Deployment Credentials

These credentials are used by CI, Terraform, and Wrangler to deploy infrastructure. They are not
read by the running Worker unless explicitly configured as Worker secrets.

| Name                             | Where                                   | Purpose                                                                                            |
| -------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_DEPLOY_API_TOKEN`    | GitHub Actions secret                   | Allows Wrangler/Terraform to deploy Workers, Pages, D1 migrations, and other Cloudflare resources. |
| `CLOUDFLARE_DEPLOY_ACCOUNT_ID`   | GitHub Actions secret                   | Selects the Cloudflare account for deployments. Workflows map this to `CLOUDFLARE_ACCOUNT_ID`.     |
| Terraform remote state variables | GitHub Actions variables or local shell | Configure remote Terraform state; see `infra/terraform/`.                                          |

## Worker Runtime Secrets

Set these on the Worker with `wrangler versions secret put` for every Terraform-managed deployed
environment. Do not commit the values.

| Name                                  | Required       | Purpose                                                                                                                                                     |
| ------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `O11YFLEET_API_BEARER_SECRET`         | Yes            | Deployment-level bearer secret for controlled bootstrap and tenant-scoped programmatic access. It is not accepted for `/api/admin/*` employee admin routes. |
| `O11YFLEET_CLAIM_HMAC_SECRET`         | Yes            | HMAC secret for enrollment and assignment claims.                                                                                                           |
| `O11YFLEET_SEED_TENANT_USER_EMAIL`    | Bootstrap only | Initial tenant user email used by `/auth/seed`.                                                                                                             |
| `O11YFLEET_SEED_TENANT_USER_PASSWORD` | Bootstrap only | Initial tenant user password used by `/auth/seed`.                                                                                                          |
| `O11YFLEET_SEED_ADMIN_EMAIL`          | Bootstrap only | Initial admin email used by `/auth/seed`.                                                                                                                   |
| `O11YFLEET_SEED_ADMIN_PASSWORD`       | Bootstrap only | Initial admin password used by `/auth/seed`.                                                                                                                |
| `AI_GUIDANCE_MINIMAX_API_KEY`         | AI guidance    | Enables SDK-backed AI guidance when `AI_GUIDANCE_PROVIDER` is `minimax` or `openai-compatible`.                                                             |
| `GITHUB_APP_CLIENT_ID`                | Self-service   | GitHub App OAuth client id used for social signup and login.                                                                                                |
| `GITHUB_APP_CLIENT_SECRET`            | Self-service   | GitHub App OAuth client secret used to exchange GitHub authorization codes.                                                                                 |
| `GITHUB_APP_ID`                       | Future GitOps  | GitHub App id returned by the manifest flow; retained for repo installation features.                                                                       |
| `GITHUB_APP_WEBHOOK_SECRET`           | Future GitOps  | GitHub App webhook secret returned by the manifest flow; retained for repo installation webhooks.                                                           |
| `GITHUB_APP_PRIVATE_KEY`              | Future GitOps  | GitHub App private key returned by the manifest flow; retained for future installation-token minting.                                                       |
| `AI_GUIDANCE_PROVIDER`                | Terraform var  | Non-secret Worker binding set to `minimax` for Terraform-managed deployments.                                                                               |
| `AI_GUIDANCE_MODEL`                   | Terraform var  | Non-secret Worker binding set to `MiniMax-M2.7` for Terraform-managed deployments.                                                                          |
| `AI_GUIDANCE_BASE_URL`                | Terraform var  | Non-secret Worker binding set to `https://api.minimax.io/v1` for Terraform-managed deployments.                                                             |

Worker runtime secrets live on the deployed Worker, not in Terraform state and not in the Pages
site. GitHub Actions secrets are only for deployment tooling and smoke tests.

To create the GitHub App, run the Worker locally and open
`http://localhost:8787/auth/github/app-manifest`. The manifest creates a public GitHub App with
only read access to account email addresses. After GitHub redirects back, copy the returned values
into Worker secrets for each deployed environment.

## AI Guidance Live Check

Configure the `AI_GUIDANCE_MINIMAX_API_KEY` GitHub Actions secret to enable the manual
**AI Guidance Live Check** workflow. Workflow mechanics, defaults, and the
non-secret provider env vars it sets are documented in
[`DEVELOPING.md`](./DEVELOPING.md#ai-guidance-live-check).

## Site Runtime Configuration

The browser site must not receive `O11YFLEET_API_BEARER_SECRET`, `O11YFLEET_CLAIM_HMAC_SECRET`, or any admin bearer token. Site
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

| Name                                  | Required | Source                                                                                                                                         |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_USAGE_API_TOKEN`          | Yes      | Cloudflare API token with the permissions needed for account analytics and Analytics Engine SQL reads.                                         |
| `CLOUDFLARE_USAGE_ACCOUNT_ID`         | Yes      | Cloudflare account id used by usage and spend estimates.                                                                                       |
| `CLOUDFLARE_USAGE_WORKER_SCRIPT_NAME` | Yes      | Worker script name for invocation analytics. Local/prod: `o11yfleet-worker`; staging: `o11yfleet-worker-staging`; dev: `o11yfleet-worker-dev`. |
| `CLOUDFLARE_USAGE_D1_DATABASE_ID`     | Yes      | D1 database id from `apps/worker/wrangler.jsonc`.                                                                                              |
| `CLOUDFLARE_USAGE_R2_BUCKET_NAME`     | Yes      | R2 bucket name from `apps/worker/wrangler.jsonc`.                                                                                              |

Use `CLOUDFLARE_USAGE_API_TOKEN` for the runtime analytics token. The admin
usage page does not fall back to the deployment token; deployment tooling maps
`CLOUDFLARE_DEPLOY_API_TOKEN` to Cloudflare's conventional
`CLOUDFLARE_API_TOKEN` environment variable only inside CI/local deploy shells.

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

Full environment deploy:

```bash
just deploy-env dev
just deploy-env staging
just deploy-env prod
```

The manual **Deploy Environment** GitHub workflow runs the same recipe and then
smoke-tests Pages plus `/healthz`. Use `require_state_ready=false` only for a
first dev/staging bootstrap where Terraform state is intentionally empty.

Automatic staging deploys from `main` are gated by
`TERRAFORM_STAGING_DEPLOY_ENABLED=true` and run `just deploy-staging`, which
requires staging Terraform state/imports before applying.

Staging, step by step:

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
