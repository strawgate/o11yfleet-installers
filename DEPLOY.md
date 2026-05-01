# Deployment Runbook

This is the operator entry point for deploying o11yFleet to the shared
Cloudflare environments. For Terraform internals and import mechanics, see
[`infra/terraform/README.md`](infra/terraform/README.md). For Cloudflare account
IDs, existing production resource IDs, and secret setup, see
[`infra/CLOUDFLARE_SETUP.md`](infra/CLOUDFLARE_SETUP.md).

## Environments

| Environment | Worker API                          | Pages projects                                                               | Auto deploys |
| ----------- | ----------------------------------- | ---------------------------------------------------------------------------- | ------------ |
| `dev`       | `https://dev-api.o11yfleet.com`     | `o11yfleet-dev-site`, `o11yfleet-dev-app`, `o11yfleet-dev-admin`             | No           |
| `staging`   | `https://staging-api.o11yfleet.com` | `o11yfleet-staging-site`, `o11yfleet-staging-app`, `o11yfleet-staging-admin` | Gated `main` |
| `prod`      | `https://api.o11yfleet.com`         | `o11yfleet-site`, `o11yfleet-app`, `o11yfleet-admin`                         | No           |

| Environment | Marketing/docs                  | App portal                          | Admin portal                          |
| ----------- | ------------------------------- | ----------------------------------- | ------------------------------------- |
| `dev`       | `https://dev.o11yfleet.com`     | `https://dev-app.o11yfleet.com`     | `https://dev-admin.o11yfleet.com`     |
| `staging`   | `https://staging.o11yfleet.com` | `https://staging-app.o11yfleet.com` | `https://staging-admin.o11yfleet.com` |
| `prod`      | `https://o11yfleet.com`         | `https://app.o11yfleet.com`         | `https://admin.o11yfleet.com`         |

`dev` and `staging` currently share the production Cloudflare account and DNS
zone, but their stateful resources and hostnames are environment-prefixed. Treat
them as shared environments: deploy them from `main`, not from feature branches.

## Source Of Truth

Terraform owns stable Cloudflare resources: D1, R2, Queues, Worker identity,
Worker routes, Worker versions/deployments, Pages projects, custom domains, DNS,
and optional Access configuration.

Wrangler is still used for four things:

- Building the Worker bundle that Terraform uploads.
- Provisioning Worker runtime secrets through Cloudflare secret storage.
- Applying D1 migrations.
- Uploading built Pages assets.

Do not use `wrangler deploy` as the normal Worker release path for shared
environments. Use the workflows or `just deploy-env <env>` so Terraform remains
authoritative.

## Required GitHub Configuration

Repository-level Actions secrets:

| Secret                                 | Purpose                                      |
| -------------------------------------- | -------------------------------------------- |
| `CLOUDFLARE_DEPLOY_API_TOKEN`          | Cloudflare Terraform and Wrangler deploy API |
| `CLOUDFLARE_DEPLOY_ACCOUNT_ID`         | Cloudflare account ID for Wrangler helpers   |
| `TERRAFORM_STATE_R2_ACCESS_KEY_ID`     | R2 S3 access key for Terraform state         |
| `TERRAFORM_STATE_R2_SECRET_ACCESS_KEY` | R2 S3 secret key for Terraform state         |

Repository-level Actions variables:

| Variable                             | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `TERRAFORM_STATE_R2_BUCKET`          | R2 bucket containing Terraform state                     |
| `TERRAFORM_STATE_R2_ENDPOINT`        | R2 S3 endpoint URL                                       |
| `TERRAFORM_STATE_R2_REGION`          | Optional; defaults to `auto`                             |
| `TERRAFORM_REMOTE_STATE_ENABLED`     | Enables remote-state plans in PRs and pushes             |
| `TERRAFORM_PROVIDER_V5_STATE_READY`  | Enables refresh/apply against migrated provider v5 state |
| `TERRAFORM_PRODUCTION_APPLY_ENABLED` | Enables production applies after imports are complete    |
| `TERRAFORM_STAGING_DEPLOY_ENABLED`   | Enables automatic staging deploys from `main` CI         |

Environment-level secrets, configured separately for GitHub Environments
`dev`, `staging`, and `production`:

| Secret                                | Purpose                                  |
| ------------------------------------- | ---------------------------------------- |
| `O11YFLEET_API_BEARER_SECRET`         | Admin bearer and deploy smoke auth       |
| `O11YFLEET_CLAIM_HMAC_SECRET`         | Enrollment claim signing                 |
| `O11YFLEET_SEED_TENANT_USER_EMAIL`    | `/auth/seed` tenant user email           |
| `O11YFLEET_SEED_TENANT_USER_PASSWORD` | `/auth/seed` tenant user password        |
| `O11YFLEET_SEED_ADMIN_EMAIL`          | `/auth/seed` admin email                 |
| `O11YFLEET_SEED_ADMIN_PASSWORD`       | `/auth/seed` admin password              |
| `AI_GUIDANCE_MINIMAX_API_KEY`         | Optional SDK-backed AI guidance provider |

Optional Cloudflare usage/spend estimate secrets can also be configured per
environment; see [`infra/CLOUDFLARE_SETUP.md`](infra/CLOUDFLARE_SETUP.md).

Do not print secret values in logs, PR comments, or issue comments. Verify
secret wiring by name and destination only.

## Worker Runtime Secrets

Provision Worker secrets before the first Worker deployment for an environment.
Terraform-managed Worker versions inherit these bindings from the latest Worker
version.

| Name                                  | Required      | Purpose                                                                                                                                                     |
| ------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `O11YFLEET_API_BEARER_SECRET`         | Yes           | Deployment-level bearer secret for controlled bootstrap and tenant-scoped programmatic access. It is not accepted for `/api/admin/*` employee admin routes. |
| `O11YFLEET_CLAIM_HMAC_SECRET`         | Yes           | HMAC secret for enrollment and assignment claims.                                                                                                           |
| `O11YFLEET_SEED_TENANT_USER_EMAIL`    | Shared env    | Tenant user email used by `/auth/seed` in deployed environments.                                                                                            |
| `O11YFLEET_SEED_TENANT_USER_PASSWORD` | Shared env    | Tenant user password used by `/auth/seed` in deployed environments.                                                                                         |
| `O11YFLEET_SEED_ADMIN_EMAIL`          | Shared env    | Admin email used by `/auth/seed` in deployed environments.                                                                                                  |
| `O11YFLEET_SEED_ADMIN_PASSWORD`       | Shared env    | Admin password used by `/auth/seed` in deployed environments.                                                                                               |
| `AI_GUIDANCE_MINIMAX_API_KEY`         | AI guidance   | Enables SDK-backed AI guidance when `AI_GUIDANCE_PROVIDER` is `minimax` or `openai-compatible`.                                                             |
| `GITHUB_APP_CLIENT_ID`                | Self-service  | GitHub App OAuth client id used for social signup and login.                                                                                                |
| `GITHUB_APP_CLIENT_SECRET`            | Self-service  | GitHub App OAuth client secret used to exchange GitHub authorization codes.                                                                                 |
| `GITHUB_APP_ID`                       | Future GitOps | GitHub App id returned by the manifest flow; retained for repo installation features.                                                                       |
| `GITHUB_APP_WEBHOOK_SECRET`           | Future GitOps | GitHub App webhook secret returned by the manifest flow; retained for repo installation webhooks.                                                           |
| `GITHUB_APP_PRIVATE_KEY`              | Future GitOps | GitHub App private key returned by the manifest flow; retained for future installation-token minting.                                                       |

Worker runtime secrets live on the deployed Worker, not in Terraform state and
not in the Pages site. GitHub Actions secrets are only for deployment tooling
and smoke tests.

To create the GitHub App, run the Worker locally and open
`http://localhost:8787/auth/github/app-manifest`. The manifest creates a public
GitHub App with only read access to account email addresses. After GitHub
redirects back, copy the returned values into Worker secrets for each deployed
environment.

For `dev` or `staging`:

```bash
cd apps/worker
pnpm wrangler versions secret put O11YFLEET_CLAIM_HMAC_SECRET --env dev
pnpm wrangler versions secret put O11YFLEET_API_BEARER_SECRET --env dev
pnpm wrangler versions secret put O11YFLEET_SEED_TENANT_USER_EMAIL --env dev
pnpm wrangler versions secret put O11YFLEET_SEED_TENANT_USER_PASSWORD --env dev
pnpm wrangler versions secret put O11YFLEET_SEED_ADMIN_EMAIL --env dev
pnpm wrangler versions secret put O11YFLEET_SEED_ADMIN_PASSWORD --env dev
```

Replace `--env dev` with `--env staging` for staging.

For production, use the base Worker script identity. Do not pass
`--env production`:

```bash
cd apps/worker
pnpm wrangler versions secret put O11YFLEET_CLAIM_HMAC_SECRET
pnpm wrangler versions secret put O11YFLEET_API_BEARER_SECRET
pnpm wrangler versions secret put O11YFLEET_SEED_TENANT_USER_EMAIL
pnpm wrangler versions secret put O11YFLEET_SEED_TENANT_USER_PASSWORD
pnpm wrangler versions secret put O11YFLEET_SEED_ADMIN_EMAIL
pnpm wrangler versions secret put O11YFLEET_SEED_ADMIN_PASSWORD
```

Use `wrangler versions secret put` for normal updates because it creates a new
Worker version without immediately shifting traffic. Use `wrangler secret put`
only for bootstrap or recovery cases where an immediate Wrangler deploy is
intentional.

## Preflight

Before any shared-environment deploy:

```bash
git switch main
git pull --ff-only
just ci-pr
```

For Terraform-only validation:

```bash
just tf-validate
just tf-plan-empty-state prod
```

For remote-state plans, export the Cloudflare and R2 state credentials described
in [`infra/terraform/README.md`](infra/terraform/README.md), then run:

```bash
just tf-plan dev
just tf-plan staging
just tf-plan prod
```

## Deploy `dev`

`dev` is a shared Cloudflare environment for integration testing. Use the manual
**Deploy Environment** GitHub workflow from `main`:

1. Open **Actions > Deploy Environment > Run workflow**.
2. Select branch `main`.
3. Set `environment=dev`.
4. Leave `require_state_ready=true` after the environment is bootstrapped.
5. Run the workflow and confirm Pages plus Worker health smoke tests pass.

Equivalent local command, with deploy credentials exported:

```bash
just deploy-env dev
```

The recipe applies Terraform control-plane resources, runs D1 migrations,
applies the Terraform-managed Worker version, builds the site with
`VITE_O11YFLEET_API_URL=https://dev-api.o11yfleet.com`, and deploys the same
bundle to the dev Pages projects.

## Deploy `staging`

Staging is the merge-confidence environment. The desired steady state is:

- PRs run CI and Terraform validation.
- Pushes to `main` run CI.
- If `TERRAFORM_STAGING_DEPLOY_ENABLED=true`, `main` CI automatically deploys
  staging after required checks pass.

First bootstrap or recovery deploy:

1. Confirm staging Worker secrets are provisioned.
2. Run **Deploy Environment** from branch `main`.
3. Set `environment=staging`.
4. For first bootstrap only, set `require_state_ready=false`.
5. After the deploy succeeds, run:

```bash
just tf-check-staging-readiness staging
```

1. Set `TERRAFORM_STAGING_DEPLOY_ENABLED=true` only after that preflight passes.

Manual local staging deploy:

```bash
just deploy-env staging
```

CI staging smoke covers `/healthz`, `/auth/seed`, config creation, enrollment
token creation, config stats, and Pages route availability.

## Deploy `prod`

Production should be deployed from an intentional release, not by ordinary
push-to-main automation.

Before the first production Terraform apply, production imports must be complete
and this preflight must pass:

```bash
just tf-check-prod-imports prod
```

Production deployment paths:

- Preferred application release: publish a GitHub Release, which runs
  `.github/workflows/release.yml`.
- Manual full-environment deploy: run **Deploy Environment** from branch `main`
  with `environment=prod`.
- Terraform control-plane apply only: run **Terraform Deploy** from branch
  `main` with `environment=prod` and `apply=true`.

Production requires:

- `TERRAFORM_PROVIDER_V5_STATE_READY=true`
- `TERRAFORM_PRODUCTION_APPLY_ENABLED=true`
- GitHub Environment `production` approval, when configured.
- Worker runtime secrets already provisioned on the base `o11yfleet-worker`
  script.

The release workflow runs tests, then starts separate production Worker and
Pages deploy jobs. The Worker job applies D1 migrations, deploys the Worker with
Terraform, and smoke-tests production auth and v1 APIs. The Pages job builds and
deploys all three production Pages projects, then a follow-up job smoke-tests
custom domains.

If a production deploy fails after D1 migrations but before Worker rollout, stop
and inspect whether the migration is backward-compatible with the currently
running Worker before retrying.

## Manual Terraform Workflow

Use **Terraform Deploy** for infrastructure plans and control-plane applies:

- Pull requests validate Terraform and may run a production plan when remote
  state is enabled.
- Manual dispatch can plan `dev`, `staging`, or `prod`.
- Manual applies must run from `main`.
- Production applies additionally require
  `TERRAFORM_PRODUCTION_APPLY_ENABLED=true`.

This workflow does not run D1 migrations, Worker bundle rollout, Pages deploys,
or smoke tests. For an application deploy, use **Deploy Environment** or the
release workflow.

## Post-Deploy Verification

Minimum checks:

```bash
curl -fsS https://dev-api.o11yfleet.com/healthz
curl -fsS https://staging-api.o11yfleet.com/healthz
curl -fsS https://api.o11yfleet.com/healthz
```

For Pages, verify the Pages project URLs and custom domains relevant to the
environment. For public marketing changes, verify the live bundle on the custom
domain, not just the Pages deploy job result.

Then sign in to the admin portal for the environment and check:

- `/admin/health` for Worker, D1, R2, Queue, and Durable Object health.
- `/admin/usage` for Cloudflare usage estimates, when the optional usage
  secrets are configured.

## Site Runtime Configuration

The browser site must not receive `O11YFLEET_API_BEARER_SECRET`,
`O11YFLEET_CLAIM_HMAC_SECRET`, or any admin bearer token. Site builds receive
only non-secret configuration:

| Name                     | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `VITE_O11YFLEET_API_URL` | Public API base URL for the target env. |

The `just site-build <env>` recipe sets this automatically from
`just env-api-url <env>`.

## AI Guidance

Terraform-managed Worker deployments set the non-secret AI guidance bindings:

| Name                    | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `AI_GUIDANCE_PROVIDER`  | Provider mode, currently `minimax`.            |
| `AI_GUIDANCE_MODEL`     | Model name, currently `MiniMax-M2.7`.          |
| `AI_GUIDANCE_BASE_URL`  | Provider API base URL.                         |
| `AI_GUIDANCE_FIXTURE_*` | Optional fixture guidance for non-SDK testing. |

`AI_GUIDANCE_MINIMAX_API_KEY` is the runtime secret that enables SDK-backed AI
guidance. Configure it as a Worker secret for deployed environments and as a
GitHub Actions secret for the manual **AI Guidance Live Check** workflow.
Workflow mechanics are documented in
[`DEVELOPING.md`](DEVELOPING.md#ai-guidance-live-check).

## Admin Usage And Spend

The `/admin/usage` page estimates Cloudflare usage and spend from analytics
APIs. It does not read Cloudflare billing totals. Configure these Worker runtime
secrets to enable it:

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

For local development, put runtime usage values in `apps/worker/.dev.vars`.
This file is ignored by git and should be `0600`.

## Just Recipes Used By Deploys

| Recipe                                    | What it does                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `just deploy-env <env>`                   | Full environment deploy: `tf-apply`, `d1-migrate`, `tf-apply-worker`, `site-build`, and `pages-deploy`.                 |
| `just deploy-staging`                     | `deploy-env staging` with `REQUIRE_TERRAFORM_STATE_READY=true`; refuses unless `TERRAFORM_STAGING_DEPLOY_ENABLED=true`. |
| `just tf-plan <env>`                      | Terraform plan for the env tfvars file.                                                                                 |
| `just tf-apply <env>`                     | Terraform apply for the env tfvars file.                                                                                |
| `just tf-apply-worker <env>`              | Worker module rebuild plus Terraform-managed Worker apply.                                                              |
| `just tf-check-staging-readiness staging` | Verifies required Terraform state imports for staging.                                                                  |
| `just tf-check-prod-imports prod`         | Verifies required Terraform state imports for production.                                                               |
| `just d1-migrate <env>`                   | Applies D1 migrations to the env database.                                                                              |
| `just site-build <env>`                   | Builds the site with the env API URL.                                                                                   |
| `just pages-deploy <env>`                 | Deploys the built site bundle to the env Pages projects.                                                                |
| `just env-api-url <env>`                  | Prints the env API URL.                                                                                                 |
| `just env-pages-projects <env>`           | Prints the env Pages project names.                                                                                     |
| `just env-pages-smoke-targets <env>`      | Prints Pages smoke-test targets.                                                                                        |

## Rollback And Recovery

Preferred rollback is a forward fix through the same deploy path. For urgent
Worker rollback, use Cloudflare Worker version rollback only when the current
version is actively bad, then follow up by reconciling Terraform state and
running a clean Terraform plan before the next release.

Do not delete or recreate D1, R2, Queue, Worker identity, or Pages projects in
the dashboard unless the Terraform state plan and import/recovery path are
clear first.

If Terraform wants to replace a data-bearing resource, stop. Fix the import,
tfvars name, or state mapping before applying.
