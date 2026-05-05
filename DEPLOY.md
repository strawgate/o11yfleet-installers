# Deployment Runbook

This is the operator entry point for deploying o11yFleet to the shared
Cloudflare environments. For Terraform internals and import mechanics, see
[`infra/terraform/README.md`](infra/terraform/README.md). For Cloudflare account
IDs, existing production resource IDs, and secret setup, see
[`infra/CLOUDFLARE_SETUP.md`](infra/CLOUDFLARE_SETUP.md).

## Environments

| Environment | Worker API                          | Static site Worker              | Auto deploys |
| ----------- | ----------------------------------- | ------------------------------- | ------------ |
| `dev`       | `https://dev-api.o11yfleet.com`     | `o11yfleet-site-worker-dev`     | No           |
| `staging`   | `https://staging-api.o11yfleet.com` | `o11yfleet-site-worker-staging` | Gated `main` |
| `prod`      | `https://api.o11yfleet.com`         | `o11yfleet-site-worker`         | No           |

| Environment | Marketing/docs                  | App portal                          | Admin portal                          |
| ----------- | ------------------------------- | ----------------------------------- | ------------------------------------- |
| `dev`       | `https://dev.o11yfleet.com`     | `https://dev-app.o11yfleet.com`     | `https://dev-admin.o11yfleet.com`     |
| `staging`   | `https://staging.o11yfleet.com` | `https://staging-app.o11yfleet.com` | `https://staging-admin.o11yfleet.com` |
| `prod`      | `https://o11yfleet.com`         | `https://app.o11yfleet.com`         | `https://admin.o11yfleet.com`         |

`dev` and `staging` currently share the production Cloudflare account and DNS
zone, but their stateful resources and hostnames are environment-prefixed. Treat
them as shared environments: deploy them from `main`, not from feature branches.

## Source Of Truth

Terraform owns stable Cloudflare resources: D1, R2, Queues, Worker identities,
Worker routes, Worker versions/deployments, static site assets, DNS, and optional
Access configuration.

When moving an environment from Cloudflare Pages to Workers Static Assets, use
the application deploy path (`just deploy <env>`, **Deploy Environment**, or
the release workflow). The Terraform-only workflow is for control-plane changes
and does not upload a fresh site asset bundle.

Wrangler is still used for three things:

- Building the Worker bundle that Terraform uploads.
- Provisioning Worker runtime secrets through Cloudflare secret storage.
- Applying D1 migrations.

Those Wrangler operations are intentionally wrapped by `just` recipes. Shared
environment deploys should call `just deploy <env>` rather than invoking
Terraform, Wrangler, and smoke tests separately.

`just deploy <env>` first imports any Worker identities left behind by a
partial bootstrap, then applies only long-lived control-plane resources before
checking Worker secret inventory. That gives first-time environments a chance
to create the Worker script identity without creating routes before a Worker
version exists. CI sets
`AUTO_PROVISION_WORKER_SECRETS=true` so required Worker secrets are copied from
GitHub Environment secrets into Cloudflare before `worker-secrets-check`. For
local first bootstrap, either export the same secret environment variables and
set `AUTO_PROVISION_WORKER_SECRETS=true`, or provision the listed secrets
manually and rerun the same deploy. Fresh Workers with no uploaded versions use
one temporary `wrangler deploy --secrets-file` bootstrap version because
Cloudflare requires the first Worker upload to use `wrangler deploy` or C3;
later updates use versioned secret updates so Terraform can inherit from the
latest Worker version.

Do not use `wrangler deploy` as the normal Worker release path for shared
environments. Use the workflows or `just deploy <env>` so Terraform remains
authoritative.

## Required GitHub Configuration

Environment-level deployment credentials, configured separately for GitHub
Environments `dev`, `staging`, and `production`:

| Secret                     | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`    | Cloudflare account ID for all operations    |
| `TERRAFORM_DEPLOY_TOKEN`   | Cloudflare Workers/D1/R2/DNS/Pages write    |
| `TERRAFORM_READONLY_TOKEN` | Cloudflare Workers/D1/R2 read for plan jobs |

Repository-level Actions variables:

| Variable                             | Purpose                                               |
| ------------------------------------ | ----------------------------------------------------- |
| `TERRAFORM_STATE_R2_BUCKET`          | R2 bucket containing Terraform state                  |
| `TERRAFORM_STATE_R2_ENDPOINT`        | R2 S3 endpoint URL                                    |
| `TERRAFORM_STATE_R2_REGION`          | Optional; defaults to `auto`                          |
| `TERRAFORM_REMOTE_STATE_ENABLED`     | Enables remote-state plans in PRs and pushes          |
| `TERRAFORM_PRODUCTION_APPLY_ENABLED` | Enables production applies after imports are complete |
| `TERRAFORM_STAGING_DEPLOY_ENABLED`   | Enables automatic staging deploys from `main` CI      |

Environment-level application secrets, configured separately for the same
GitHub Environments:

| Secret                                  | Purpose                                  |
| --------------------------------------- | ---------------------------------------- |
| `O11YFLEET_API_BEARER_SECRET`           | Admin bearer and deploy smoke auth       |
| `O11YFLEET_CLAIM_HMAC_SECRET`           | Enrollment claim signing                 |
| `O11YFLEET_SEED_TENANT_USER_EMAIL`      | `/auth/seed` tenant user email           |
| `O11YFLEET_SEED_TENANT_USER_PASSWORD`   | `/auth/seed` tenant user password        |
| `O11YFLEET_SEED_ADMIN_EMAIL`            | `/auth/seed` admin email                 |
| `O11YFLEET_SEED_ADMIN_PASSWORD`         | `/auth/seed` admin password              |
| `O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` | Optional SDK-backed AI guidance provider |

Optional Cloudflare usage/spend estimate secrets can also be configured per
environment; see [`infra/CLOUDFLARE_SETUP.md`](infra/CLOUDFLARE_SETUP.md).

Do not print secret values in logs, PR comments, or issue comments. Verify
secret wiring by name and destination only.

### Cloudflare Credential Bootstrap

Use the TypeScript bootstrap script for deploy credentials. Terraform should not
manage the Cloudflare API tokens that Terraform itself needs to run, and it
should not store R2 S3 secret material in state.

Dry-run the target environments first:

```bash
npx tsx scripts/bootstrap-cloudflare-credentials.ts --envs "dev staging prod preview"
```

Apply after exporting or sourcing a bootstrap token with `API Tokens Write`:

```bash
npx tsx scripts/bootstrap-cloudflare-credentials.ts --apply --envs "dev staging prod preview"
```

**Flags:**

- `--apply`: Create resources (dry-run by default)
- `--envs "env1 env2"`: Space-separated environment list (default: "dev staging prod")
- `--skip-buckets`: Skip R2 bucket creation (use existing buckets)
- `--skip-workers`: Skip tfstate worker deployment (preview uses shared R2)

The script defaults to `~/Documents/repos/cloudflare/.env` and reads
`CLOUDFLARE_BOOTSTRAP_API_TOKEN` or `CLOUDFLARE_API_TOKEN`. It also supports
legacy `CLOUDFLARE_EMAIL` plus `CLOUDFLARE_GLOBAL_API_KEY`/`CLOUDFLARE_API_KEY`
bootstrap credentials. It verifies or creates the target GitHub Environments
before creating Cloudflare tokens. Creates per-environment tokens with least-privilege permissions:

- `TERRAFORM_READONLY_TOKEN`: Workers/D1/R2 Read (for plan jobs)
- `TERRAFORM_DEPLOY_TOKEN`: Workers/D1/R2/DNS/Workers Routes/Pages Write (for deploy jobs)

The old bash script (`scripts/bootstrap-cloudflare-credentials.sh`) is deprecated.
Use the TypeScript version for all new bootstrap operations.

The deploy token is scoped to the shared account and zone currently used by
`dev`, `staging`, and `prod`. Because all three environments currently share the
same Cloudflare account, zone, and Terraform state bucket, the separate tokens
improve rotation and auditability but are not a hard account-level isolation
boundary. Use separate Cloudflare accounts/zones and separate state buckets when
we need strict environment isolation.

## Worker Runtime Secrets

Provision Worker secrets before the first Worker deployment for an environment.
Terraform-managed Worker versions inherit these bindings from the latest Worker
version.

Verify the inventory without printing values:

```bash
just worker-secrets-check dev
just worker-secrets-check staging
just worker-secrets-check prod
```

| Name                                    | Required      | Purpose                                                                                                                                                     |
| --------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `O11YFLEET_API_BEARER_SECRET`           | Yes           | Deployment-level bearer secret for controlled bootstrap and tenant-scoped programmatic access. It is not accepted for `/api/admin/*` employee admin routes. |
| `O11YFLEET_CLAIM_HMAC_SECRET`           | Yes           | HMAC secret for enrollment and assignment claims.                                                                                                           |
| `O11YFLEET_SEED_TENANT_USER_EMAIL`      | Shared env    | Tenant user email used by `/auth/seed` in deployed environments.                                                                                            |
| `O11YFLEET_SEED_TENANT_USER_PASSWORD`   | Shared env    | Tenant user password used by `/auth/seed` in deployed environments.                                                                                         |
| `O11YFLEET_SEED_ADMIN_EMAIL`            | Shared env    | Admin email used by `/auth/seed` in deployed environments.                                                                                                  |
| `O11YFLEET_SEED_ADMIN_PASSWORD`         | Shared env    | Admin password used by `/auth/seed` in deployed environments.                                                                                               |
| `O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` | AI guidance   | Optional; enables SDK-backed AI guidance when Terraform sets `ai_guidance_provider` to `minimax` or `openai-compatible`.                                    |
| `GITHUB_APP_CLIENT_ID`                  | Self-service  | GitHub App OAuth client id used for social signup and login.                                                                                                |
| `GITHUB_APP_CLIENT_SECRET`              | Self-service  | GitHub App OAuth client secret used to exchange GitHub authorization codes.                                                                                 |
| `GITHUB_APP_ID`                         | Future GitOps | GitHub App id returned by the manifest flow; retained for repo installation features.                                                                       |
| `GITHUB_APP_WEBHOOK_SECRET`             | Future GitOps | GitHub App webhook secret returned by the manifest flow; retained for repo installation webhooks.                                                           |
| `GITHUB_APP_PRIVATE_KEY`                | Future GitOps | GitHub App private key returned by the manifest flow; retained for future installation-token minting.                                                       |

Worker runtime secrets live on the deployed API Worker, not in Terraform state
and not in the browser site. GitHub Actions secrets are only for deployment
tooling and smoke tests.

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

For Terraform validation, export the Cloudflare and R2 state credentials
described in [`infra/terraform/README.md`](infra/terraform/README.md), then run:

```bash
just tf-validate
just tf-plan dev
just tf-plan staging
just tf-plan prod
```

## Deploy `dev`

`dev` is a shared Cloudflare environment for integration testing. Use the manual
**Deploy Environment** GitHub workflow from `main`.

1. Open **Actions > Deploy Environment > Run workflow**.
2. Select branch `main`.
3. Set `environment=dev`.
4. Leave `require_state_ready=true` after the environment is bootstrapped.
5. Run the workflow and confirm site plus Worker health smoke tests pass.

Equivalent local command, with deploy credentials exported:

```bash
just deploy dev
```

The recipe builds the site with
`VITE_O11YFLEET_API_URL=https://dev-api.o11yfleet.com`, applies the
Terraform-managed static site Worker and assets, runs D1 migrations, and applies
the Terraform-managed API Worker version.

For a brand-new environment, `just deploy dev` also performs one
Terraform-managed Durable Object migration bootstrap before the normal Worker
rollout. Cloudflare requires the `ConfigDurableObject` class migration to be
deployed before a Worker version can bind that class, so the bootstrap uploads a
temporary Terraform Worker version with the migration and without `CONFIG_DO`,
then immediately replaces it with the normal Worker version that includes the
binding. See Cloudflare's [Terraform Durable Objects consideration](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/#considerations-with-durable-objects).
The helper skips itself after Terraform state has an API Worker deployment or
after Cloudflare already reports a Worker version with a Durable Object migration
tag.

## Deploy `staging`

Staging is the merge-confidence environment. The desired steady state is:

- PRs run CI and Terraform validation.
- Pushes to `main` run CI.
- If `TERRAFORM_STAGING_DEPLOY_ENABLED=true`, `main` CI automatically deploys
  staging after required checks pass.

First bootstrap or recovery deploy:

1. Run **Deploy Environment** from branch `main`.
2. Set `environment=staging`.
3. For first bootstrap only, set `require_state_ready=false`.
4. If the workflow stops at `worker-secrets-check`, provision the listed Worker
   secrets and rerun it.
5. After the deploy succeeds, run:

```bash
just tf-check-staging-readiness staging
```

1. Set `TERRAFORM_STAGING_DEPLOY_ENABLED=true` only after that preflight passes.

Manual local staging deploy:

```bash
just deploy staging
```

CI staging smoke covers `/healthz`, `/auth/seed`, config creation, enrollment
token creation, config stats, and static site route availability.

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

- `TERRAFORM_PRODUCTION_APPLY_ENABLED=true`
- GitHub Environment `production` approval, when configured.
- Worker runtime secrets already provisioned on the base `o11yfleet-worker`
  script.

The release workflow runs tests, deploys and smokes the production API Worker,
static site Worker/assets, D1 migrations, and API Worker through the same
`just deploy prod` path used by manual deploys. It then smoke-tests the
custom domains and the full API flow.

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

This workflow does not run D1 migrations, API Worker bundle rollout, static site
asset rollout, or smoke tests. For an application deploy, use **Deploy
Environment** or the release workflow.

## Post-Deploy Verification

Minimum checks:

```bash
curl -fsS https://dev-api.o11yfleet.com/healthz
curl -fsS https://staging-api.o11yfleet.com/healthz
curl -fsS https://api.o11yfleet.com/healthz
```

For the site, verify the custom domains relevant to the environment:

```bash
just smoke-aliases dev
just smoke-aliases staging
just smoke-aliases prod
```

This is the hard operator check for public custom-domain routing. GitHub and
third-party CI runner IPs can receive Cloudflare managed challenges or WAF 403s
even when the aliases are healthy from normal networks, so CI uses a
best-effort wrapper after the blocking workers.dev smoke tests.

For public marketing changes, verify the live bundle on the custom domain, not
just the deploy job result.

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

| Name                             | Purpose                                    |
| -------------------------------- | ------------------------------------------ |
| `O11YFLEET_AI_GUIDANCE_PROVIDER` | Provider mode; defaults to `fixture`.      |
| `O11YFLEET_AI_GUIDANCE_MODEL`    | Model name; defaults to the fixture model. |
| `O11YFLEET_AI_GUIDANCE_BASE_URL` | Provider API base URL.                     |

`O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` is the runtime secret that enables SDK-backed AI
guidance. Configure it as a Worker secret and include
`O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` in `worker_inherited_binding_names` only for
environments whose Terraform tfvars set `ai_guidance_provider` to `minimax` or
`openai-compatible`. Also configure it as a GitHub Actions secret for the manual
**AI Guidance Live Check** workflow.
Workflow mechanics are documented in
[`DEVELOPING.md`](DEVELOPING.md#ai-guidance-live-check).

## Admin Usage And Spend

The `/admin/usage` page estimates Cloudflare usage and spend from analytics
APIs. It does not read Cloudflare billing totals. Configure these Worker runtime
secrets to enable it:

| Name                            | Required | Source                                                                                                          |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_BILLING_API_TOKEN`  | Yes      | Cloudflare API token with the permissions needed for account analytics and Analytics Engine SQL reads.          |
| `CLOUDFLARE_BILLING_ACCOUNT_ID` | Yes      | Cloudflare account id used by usage and spend estimates. Bound by Terraform as `CLOUDFLARE_BILLING_ACCOUNT_ID`. |

Use `CLOUDFLARE_BILLING_API_TOKEN` for the runtime analytics token. The admin
usage page does not fall back to the deployment token; deployment tooling maps
`CLOUDFLARE_DEPLOY_API_TOKEN` to Cloudflare's conventional
`CLOUDFLARE_API_TOKEN` environment variable only inside CI/local deploy shells.

For local development, put runtime usage values in `apps/worker/.dev.vars`.
This file is ignored by git and should be `0600`.

## Just Recipes Used By Deploys

| Recipe                                    | What it does                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `just deploy <env>`                       | Full environment deploy: import partial Worker identities, apply control-plane resources, provision/check secrets, migrate D1, deploy API Worker, then deploy site. |
| `just deploy-staging`                     | `deploy staging` with `REQUIRE_TERRAFORM_STATE_READY=true`; refuses unless `TERRAFORM_STAGING_DEPLOY_ENABLED=true`.                                                 |
| `just tf-plan <env>`                      | Targeted Terraform plan for long-lived control-plane resources.                                                                                                     |
| `just tf-apply <env>`                     | Targeted Terraform apply for long-lived control-plane resources.                                                                                                    |
| `just tf-apply-control-plane <env>`       | Targeted apply used by deploys before secrets and code rollouts.                                                                                                    |
| `just tf-apply-worker-do-migration <env>` | First-time Terraform Worker rollout that applies the Durable Object class migration without binding `CONFIG_DO`.                                                    |
| `just tf-apply-worker <env>`              | Targeted Worker module rebuild plus Terraform-managed Worker rollout.                                                                                               |
| `just tf-apply-site <env>`                | Targeted static site Worker module and built assets rollout.                                                                                                        |
| `just tf-check-staging-readiness staging` | Verifies required Terraform state imports for staging.                                                                                                              |
| `just tf-check-prod-imports prod`         | Verifies required Terraform state imports for production.                                                                                                           |
| `just worker-secrets-check <env>`         | Verifies required Worker runtime secrets exist before Terraform inherits bindings.                                                                                  |
| `just worker-secrets-put <env>`           | Provisions required Worker runtime secrets from matching process environment variables; creates one temporary bootstrap version only when no Worker version exists. |
| `just d1-migrate <env>`                   | Applies D1 migrations to the env database using the D1 database ID from Terraform state.                                                                            |
| `just site-build <env>`                   | Builds the site with the env API URL.                                                                                                                               |
| `just env-api-url <env>`                  | Prints the env API URL.                                                                                                                                             |
| `just env-api-smoke-url <env>`            | Prints the API URL used by CI smoke tests. Non-prod smoke uses workers.dev URLs to avoid zone-level security challenges from CI runner IPs.                         |
| `just env-site-smoke-targets <env>`       | Prints static site smoke-test targets. Non-prod smoke uses workers.dev URLs to avoid zone-level security challenges from CI runner IPs.                             |
| `just env-site-alias-smoke-targets <env>` | Prints custom-domain site smoke targets for public environment aliases.                                                                                             |
| `just smoke-aliases <env>`                | Checks the custom API alias `/healthz` plus the custom site/app/admin aliases for one deployed environment.                                                         |
| `just smoke-aliases-ci <env>`             | Best-effort CI wrapper for public alias smoke; emits a warning instead of failing when runner IPs are blocked by Cloudflare.                                        |

Reusable GitHub composite actions keep deploy jobs aligned:

- `.github/actions/setup-deploy` installs Node, pnpm, Terraform, `just`, and
  workspace dependencies.
- `.github/actions/smoke-site` checks static site surfaces. Production uses
  custom domains; dev and staging use workers.dev URLs because GitHub runner IPs
  can receive Cloudflare managed challenges on the custom domains.
- `.github/actions/smoke-api` runs `/healthz`, `/auth/seed`, auth-cookie,
  configuration creation, enrollment-token creation, and stats smoke tests.
  Production uses the custom API domain; dev and staging use workers.dev for the
  same CI-runner challenge reason.
- Deploy and release workflows also run `just smoke-aliases-ci <env>` after the
  deploy-grade smoke tests. This catches missing DNS, Worker routes, or static
  site routes when runner IPs can reach the public custom-domain aliases, and it
  warns instead of failing when Cloudflare blocks the runner. Use
  `just smoke-aliases <env>` from an operator network as the blocking
  custom-domain verification.

## Rollback And Recovery

Preferred rollback is a forward fix through the same deploy path. For urgent
Worker rollback, use Cloudflare Worker version rollback only when the current
version is actively bad, then follow up by reconciling Terraform state and
running a clean Terraform plan before the next release.

Do not delete or recreate D1, R2, Queue, Worker identities, DNS records, or
routes in the dashboard unless the Terraform state plan and import/recovery path
are clear first.

If Terraform wants to replace a data-bearing resource, stop. Fix the import,
tfvars name, or state mapping before applying.
