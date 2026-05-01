# Cloudflare Terraform

This stack owns the stable Cloudflare control-plane resources for o11yFleet:

- D1 database for tenants, auth, configuration metadata, and enrollment tokens.
- R2 bucket for configuration YAML blobs.
- Worker identity, Worker route, and the production Worker version/deployment.
- DNS record for the API hostname.
- Split Cloudflare Pages projects and custom domains for marketing, app, and admin.
- Optional Cloudflare Access application and policy for the admin hostname.

Wrangler still builds the Worker bundle and uploads Pages assets. Terraform owns
the resources those deploys target, including Worker bindings, Worker rollout,
Analytics Engine binding, and Pages deployment configuration. Add runtime
configuration to Terraform unless it is a secret that must stay out of state.

## Best-Practice Baseline

This stack follows these rules from the current Cloudflare and Terraform docs:

- Terraform should be authoritative for every resource it manages. If a
  Cloudflare resource already exists, either import it into state before apply
  or deliberately retire/delete it and let Terraform create the replacement.
- Do not manage the same Cloudflare resource through both Terraform and
  Wrangler/dashboard settings. Wrangler is allowed here only as a bundler,
  secret provisioning helper, D1 migration runner, and Pages asset uploader.
- Keep Cloudflare credentials and state backend credentials out of committed
  files. Use GitHub environment secrets in CI and local environment variables or
  an approved secret manager locally.
- Keep secrets out of Terraform state unless we explicitly choose a
  Terraform-managed secret source. Worker runtime secrets currently use
  Wrangler/Cloudflare secret storage plus Terraform `inherit` bindings.
- Prefer separate Cloudflare accounts and separate DNS zones for strong
  long-lived environment isolation. The current dev/staging templates share the
  o11yFleet account and zone as a pragmatic starting point, so every stateful
  resource name and hostname is environment-prefixed.

Primary references:

- Cloudflare Terraform best practices:
  <https://developers.cloudflare.com/terraform/advanced-topics/best-practices/>
- Cloudflare Workers IaC:
  <https://developers.cloudflare.com/workers/platform/infrastructure-as-code/>
- Cloudflare Workers secrets:
  <https://developers.cloudflare.com/workers/configuration/secrets/>
- Wrangler configuration source-of-truth rules:
  <https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth>
- Terraform sensitive variable guidance:
  <https://developer.hashicorp.com/terraform/tutorials/configuration-language/sensitive-variables>
- Terraform import blocks:
  <https://developer.hashicorp.com/terraform/language/import>

## Target Layout

| Surface               | Resource                                           |
| --------------------- | -------------------------------------------------- |
| `o11yfleet.com`       | Marketing/docs Pages project                       |
| `app.o11yfleet.com`   | Customer app Pages project                         |
| `admin.o11yfleet.com` | Admin Pages project protected by Cloudflare Access |
| `api.o11yfleet.com`   | Worker route to `o11yfleet-worker`                 |

Non-production defaults use prefixed hostnames such as
`staging-app.o11yfleet.com` and resource names such as
`o11yfleet-staging-db`.

Pages projects and Pages custom domains are intentionally separate. The production deploy workflows publish the same built SPA bundle to all three Pages projects, so production attaches the `site`, `app`, and `admin` custom domains to their split projects. For new non-production environments, add custom domains only after the matching deployment workflow is publishing the right asset bundle to that project.

For stronger future isolation, create a second Cloudflare account and zone such
as `o11yfleet-staging.com`, copy `envs/example.tfvars.example` to an untracked
environment file, and set that file's `cloudflare_account_id`,
`cloudflare_zone_id`, and `zone_name` to the staging account and zone. This is
the Cloudflare-recommended shape when account-level resources or zone-level
experiments need to be isolated from production.

## Validate

```bash
just tf-init
just tf-validate
```

## Plan

Planning and applying use shared remote state in R2. Export Cloudflare and R2
credentials first:

```bash
export CLOUDFLARE_DEPLOY_API_TOKEN=...
export CLOUDFLARE_DEPLOY_ACCOUNT_ID=417e8c0fd8f1a64e9f2c4845afa6dc56
export TERRAFORM_STATE_R2_BUCKET=o11yfleet-terraform-state
export TERRAFORM_STATE_R2_ENDPOINT=https://417e8c0fd8f1a64e9f2c4845afa6dc56.r2.cloudflarestorage.com
export TERRAFORM_STATE_R2_ACCESS_KEY_ID=...
export TERRAFORM_STATE_R2_SECRET_ACCESS_KEY=...

# Tool-required conventional names.
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_DEPLOY_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_DEPLOY_ACCOUNT_ID"
export AWS_ACCESS_KEY_ID="$TERRAFORM_STATE_R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$TERRAFORM_STATE_R2_SECRET_ACCESS_KEY"
```

`CLOUDFLARE_DEPLOY_API_TOKEN`, `TERRAFORM_STATE_R2_ACCESS_KEY_ID`, and
`TERRAFORM_STATE_R2_SECRET_ACCESS_KEY` are credentials. Do not place them in
`.tfvars` files or backend config files. Terraform's S3 backend still reads the
R2 credentials from the conventional `AWS_*` environment variables above.

The committed `envs/*.tfvars` files contain stable, non-secret identifiers and
environment-specific names. If you need private or experimental variable values,
put them in an untracked `*.auto.tfvars` file under `infra/terraform/` or pass
them as `TF_VAR_*` environment variables. `.gitignore` excludes those local
files.

```bash
just tf-plan staging
just tf-plan prod
just tf-plan-worker prod
```

The production tfvars intentionally point D1/R2 at the existing names so those data-bearing resources can be imported instead of recreated. They also attach all three Pages custom domains now that the deployment workflows publish to the split site/app/admin projects.

## GitHub Deployment

`.github/workflows/terraform-deploy.yml` is the deploy path for Terraform:

- Pull requests validate Terraform and, once remote state is enabled, run a production plan.
- Pushes to `main` run the same plan and apply production only when explicitly enabled.
- Manual dispatch can plan `dev`, `staging`, or `prod`; applying is restricted to the `main` branch and uses the matching GitHub environment.

`.github/workflows/deploy-environment.yml` is the manual full-environment
deploy path. It runs `just deploy-env <env>`, which applies Terraform control
plane resources, uploads a Terraform-managed Worker version, runs D1
migrations, builds the site for the target API URL, deploys all Pages projects,
and smoke-tests Pages plus `/healthz`.

`main` also has an automatic staging deploy in `.github/workflows/ci.yml`, but
only when `TERRAFORM_STAGING_DEPLOY_ENABLED=true`. Keep that disabled until
staging has been bootstrapped or imported, Worker secrets are provisioned, and
the manual full deploy is healthy.

Repository secrets:

| Secret                                 | Purpose                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| `CLOUDFLARE_DEPLOY_API_TOKEN`          | Cloudflare Terraform provider and Wrangler deploy access              |
| `CLOUDFLARE_DEPLOY_ACCOUNT_ID`         | Cloudflare account used by Wrangler deploy helpers                    |
| `TERRAFORM_STATE_R2_ACCESS_KEY_ID`     | R2 S3 access key for Terraform state                                  |
| `TERRAFORM_STATE_R2_SECRET_ACCESS_KEY` | R2 S3 secret key for Terraform state                                  |
| `O11YFLEET_API_BEARER_SECRET`          | Staging smoke-test bearer secret; prefer a staging environment secret |

Repository variables:

| Variable                             | Purpose                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `TERRAFORM_STATE_R2_BUCKET`          | R2 bucket that stores Terraform state                                              |
| `TERRAFORM_STATE_R2_ENDPOINT`        | R2 S3 endpoint URL for the Cloudflare account                                      |
| `TERRAFORM_STATE_R2_REGION`          | Optional; defaults to `auto`                                                       |
| `TERRAFORM_REMOTE_STATE_ENABLED`     | Set to `true` after the state bucket exists                                        |
| `TERRAFORM_PROVIDER_V5_STATE_READY`  | Set to `true` after the remote state is migrated/imported for provider v5          |
| `TERRAFORM_PRODUCTION_APPLY_ENABLED` | Set to `true` only after production imports                                        |
| `TERRAFORM_STAGING_DEPLOY_ENABLED`   | Set to `true` only after staging state and Worker secrets are ready for CI deploys |

The `production` GitHub environment should require reviewer approval when the
GitHub plan supports it. If required reviewers are not available, restrict the
environment to the `main` deployment branch policy and leave
`TERRAFORM_PRODUCTION_APPLY_ENABLED` unset until the first production imports are complete
and the plan shows no replacement for D1 or R2.

Provider v5 cannot refresh every provider v4 state shape directly. Leave
`TERRAFORM_PROVIDER_V5_STATE_READY` unset while this migration PR is under
review. Pull requests use a backend-disabled empty-state plan in that state so
they still validate provider schema without decoding v4 state. Pushes and
production Worker releases require the variable to be `true` after the state
migration and new imports below are complete.

Do not set `TERRAFORM_PROVIDER_V5_STATE_READY=true` until the production Worker
identity and data-bearing resources are already imported into remote state. The
production apply and release workflows run `just tf-check-prod-imports prod` as
a preflight so an accidentally enabled flag fails before Terraform can attempt a
Worker rollout.

## Adopting Existing Production Resources

Before the first production apply, import current resources into state.
Terraform cannot safely manage resources created in the Cloudflare dashboard
until they are imported. Cloudflare recommends `cf-terraforming` for discovery
and generated import commands, but import blocks are useful for this small,
known adoption set.

Known production IDs are documented in `../CLOUDFLARE_SETUP.md`.

```bash
just tf-init-remote prod

cd infra/terraform
terraform import \
  -var-file=envs/prod.tfvars \
  cloudflare_d1_database.fleet \
  "$CLOUDFLARE_ACCOUNT_ID/192ca9ca-bd47-4bd2-9321-fcdf62d9cf05"
```

For Terraform 1.5+ import-block-based adoption, copy `imports/prod.tf.example`
to `imports.prod.tf`, replace every placeholder ID with the current IDs from
`../CLOUDFLARE_SETUP.md` or Cloudflare discovery, run a production plan against
remote state, then apply the import. Do not commit a live `imports.prod.tf`;
`imports.*.tf` files are gitignored because Terraform evaluates import blocks
during every plan. After the import lands in state, delete the active
`imports.prod.tf` or archive it outside Terraform's active `.tf` files as an
operator record.

Use `cf-terraforming` or the Cloudflare dashboard to look up existing DNS record, Worker route, Pages project/domain, R2, and Access IDs before importing those resources. After imports, run:

```bash
terraform plan -var-file=envs/prod.tfvars
just tf-check-prod-imports prod
```

The plan should show no replacement for D1, R2, or the Worker. If it wants to replace a data-bearing resource or recreate the Worker
identity, stop and fix the import or name override first.

## Wrangler Boundary

`apps/worker/wrangler.jsonc` is now local-dev and bundling metadata. Terraform
owns the production Worker identity, route, bindings, version,
and deployment rollout, so production deploys should use `just tf-apply-worker
prod` instead of `wrangler deploy`.

The Worker migration uses provider 5.x resources:

- `cloudflare_worker` for the script identity and `workers.dev` subdomain settings.
- `cloudflare_workers_cron_trigger` for the Worker schedules.
- `cloudflare_worker_version` for code modules, compatibility date/flags, Durable Object migrations, and bindings.
- `cloudflare_workers_deployment` for the active version rollout.

`manage_worker_deployment` defaults to `false` so normal Terraform validation and
control-plane plans do not need a built bundle. `just tf-plan-worker prod` and
`just tf-apply-worker prod` build `apps/worker/dist` with Wrangler, then pass the
bundle path to Terraform with `manage_worker_deployment=true`.

Keep `worker_compatibility_date` in sync with `apps/worker/wrangler.jsonc`.
Wrangler performs the dry-run bundle build and Terraform uploads the resulting
module, so both tools should use the same compatibility date and flags. Bump
the date only after testing the Worker against the new Cloudflare runtime
behavior.
Keep `local.worker_crons` in sync with `apps/worker/wrangler.jsonc` triggers.
Terraform owns deployed Worker schedules; Wrangler triggers are retained for
local dry-runs and emergency Wrangler deployments.

`worker_durable_object_migration_tag` is the Worker Durable Object migration
tag Terraform sends with new Worker versions. Change it only when the Durable
Object migration list changes, such as adding, renaming, or deleting Durable
Object classes.

Terraform-managed Worker versions inherit `O11YFLEET_API_BEARER_SECRET`, `O11YFLEET_CLAIM_HMAC_SECRET`,
seed-account secrets, and the optional `AI_GUIDANCE_MINIMAX_API_KEY` from the latest Worker version by
default. Keep provisioning secret values with Wrangler until the project adopts Cloudflare
Secrets Store or another Terraform-managed secret source. If a production Worker
relies on additional dashboard/Wrangler-managed bindings, add their names to
`worker_inherited_binding_names` before the first Terraform Worker deployment.
Terraform validates that this inherited binding list still contains the runtime
secrets declared in `apps/worker/wrangler.jsonc` `secrets.required`, so deploy
plans cannot accidentally drop one of the required secret bindings.

Cloudflare's Terraform Worker version resource also supports `secret_text`
bindings, but those values are Terraform inputs and therefore become part of
Terraform state history. Do not switch to `secret_text` for `O11YFLEET_API_BEARER_SECRET` or
seed credentials unless the remote state access model, rotation policy, and
review process have been designed around secrets in state.

For production secret updates, run `wrangler versions secret put` against the
base Worker script identity, without `--env production`. Terraform owns the
production `o11yfleet-worker` script; Wrangler's `--env production` targets a
separate Wrangler environment script and is not the source Terraform inherits
from. Use `wrangler secret put` only for bootstrap or recovery cases where an
immediate Wrangler deployment is intentional.
If the Worker is ever destroyed outside Terraform and there is no latest version
to inherit from, recover by redeploying a temporary Wrangler version with the
required secrets or by moving those secrets to a Terraform-managed secret
source before running `tf-apply-worker` again.

Cloudflare Pages uses Wrangler only for asset uploads. Terraform owns Pages
project settings and both production and preview `deployment_configs`. If Pages
Functions later need bindings or secrets, add them to this Terraform stack so a
plan can show the full runtime config drift.

The `deploy-env` just recipe uses Terraform for environment control-plane
resources and Worker rollout, then Wrangler only for D1 migrations and Pages
asset upload. `deploy-staging` is the CI-safe wrapper around
`deploy-env staging`: it requires `TERRAFORM_STAGING_DEPLOY_ENABLED=true` and
checks staging state before applying.

The preferred staging cutover is to retire/delete any Wrangler-created staging
Worker and let Terraform create `o11yfleet-worker-staging`; import the old
Worker only if its identity must be preserved. Provision the required Worker
secrets before enabling the CI staging deploy.

### Staging Worker Terraform preflight and rollout

Before enabling `TERRAFORM_STAGING_DEPLOY_ENABLED=true` in CI, confirm staging
remote state has the required imports:

```bash
just tf-check-staging-readiness staging
```

If the check fails, the CI deploy job stops before any apply. Import the missing
resources or recreate the Wrangler-owned staging Worker/route under Terraform,
then rerun the preflight.

The preflight only validates Terraform state. Verify required Worker secrets
exist on the base Worker identity as a separate operator step before flipping
the deploy flag.

Plan/apply commands for local staging rollout:

```bash
just tf-plan-worker staging
just tf-apply-worker staging
```

Both commands build the Worker module using Wrangler dry-run output, then pass
`manage_worker_deployment=true` and `worker_bundle_path=...` to Terraform.
This ensures staging exercises the same Worker version/deployment resources that
production rollout (#230) will rely on.

For drift recovery, run a normal control-plane plan first:

```bash
just tf-plan staging
```

Then run `just tf-plan-worker staging` to verify the Worker version/deployment
changes. If Terraform wants to replace the Worker identity unexpectedly, stop
and repair imports/state before apply.

For a first manual bootstrap where staging resources do not exist yet, run the
manual **Deploy Environment** workflow for `staging` with
`require_state_ready=false`, or run locally:

```bash
just deploy-env staging
```

After that succeeds, run `just tf-check-staging-readiness staging`, set
`TERRAFORM_STAGING_DEPLOY_ENABLED=true`, and let the automatic `main` staging
deploy take over.

## Admin Access

Set `enable_admin_access = true` only with at least one identity rule:

```hcl
enable_admin_access = true
admin_access_allowed_emails = [
  "admin@example.com",
]
```

Cloudflare Access identity providers are account configuration. This stack only manages the application and policy for `admin.o11yfleet.com`.
