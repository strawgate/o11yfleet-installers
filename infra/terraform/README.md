# Cloudflare Terraform

This stack owns the stable Cloudflare control-plane resources for o11yFleet:

- D1 database for tenants, auth, configuration metadata, and enrollment tokens.
- R2 bucket for configuration YAML blobs.
- Queue for fleet events.
- Worker identity, Worker route, queue consumer, and the production Worker version/deployment.
- DNS record for the API hostname.
- Split Cloudflare Pages projects and custom domains for marketing, app, and admin.
- Optional Cloudflare Access application and policy for the admin hostname.

Wrangler still builds the Worker bundle and uploads Pages assets. Terraform owns
the resources those deploys target, including Worker bindings, Worker rollout,
Queue consumer settings, and Pages deployment configuration. Add runtime
configuration to Terraform unless it is a secret that must stay out of state.

## Target Layout

| Surface               | Resource                                           |
| --------------------- | -------------------------------------------------- |
| `o11yfleet.com`       | Marketing/docs Pages project                       |
| `app.o11yfleet.com`   | Customer app Pages project                         |
| `admin.o11yfleet.com` | Admin Pages project protected by Cloudflare Access |
| `api.o11yfleet.com`   | Worker route to `o11yfleet-worker`                 |

Non-production defaults use prefixed hostnames such as `staging-app.o11yfleet.com` and resource names such as `o11yfleet-staging-db`.

Pages projects and Pages custom domains are intentionally separate. The production deploy workflows publish the same built SPA bundle to all three Pages projects, so production attaches the `site`, `app`, and `admin` custom domains to their split projects. For new non-production environments, add custom domains only after the matching deployment workflow is publishing the right asset bundle to that project.

## Validate

```bash
just tf-init
just tf-validate
```

## Plan

Planning and applying use shared remote state in R2. Export Cloudflare and R2
credentials first:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=417e8c0fd8f1a64e9f2c4845afa6dc56
export TF_STATE_BUCKET=o11yfleet-terraform-state
export TF_STATE_ENDPOINT=https://417e8c0fd8f1a64e9f2c4845afa6dc56.r2.cloudflarestorage.com
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

```bash
just tf-plan staging
just tf-plan prod
just tf-plan-worker prod
```

The production tfvars intentionally point D1/R2/Queue at the existing names so those data-bearing resources can be imported instead of recreated. They also attach all three Pages custom domains now that the deployment workflows publish to the split site/app/admin projects.

## GitHub Deployment

`.github/workflows/terraform-deploy.yml` is the deploy path for Terraform:

- Pull requests validate Terraform and, once remote state is enabled, run a production plan.
- Pushes to `main` run the same plan and apply production only when explicitly enabled.
- Manual dispatch can plan either `staging` or `prod`; applying is restricted to the `main` branch and still runs through the `production` GitHub environment.

Repository secrets:

| Secret                       | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `CLOUDFLARE_API_TOKEN`       | Cloudflare Terraform provider access |
| `TF_STATE_ACCESS_KEY_ID`     | R2 S3 access key for Terraform state |
| `TF_STATE_SECRET_ACCESS_KEY` | R2 S3 secret key for Terraform state |

Repository variables:

| Variable                            | Purpose                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `TF_STATE_BUCKET`                   | R2 bucket that stores Terraform state                                     |
| `TF_STATE_ENDPOINT`                 | R2 S3 endpoint URL for the Cloudflare account                             |
| `TF_STATE_REGION`                   | Optional; defaults to `auto`                                              |
| `TERRAFORM_REMOTE_STATE_ENABLED`    | Set to `true` after the state bucket exists                               |
| `TERRAFORM_PROVIDER_V5_STATE_READY` | Set to `true` after the remote state is migrated/imported for provider v5 |
| `TERRAFORM_APPLY_ENABLED`           | Set to `true` only after production imports                               |

The `production` GitHub environment should require reviewer approval when the
GitHub plan supports it. If required reviewers are not available, restrict the
environment to the `main` deployment branch policy and leave
`TERRAFORM_APPLY_ENABLED` unset until the first production imports are complete
and the plan shows no replacement for D1, R2, or Queue.

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

Before the first production apply, import current resources into state. Terraform cannot safely manage resources created in the Cloudflare dashboard until they are imported.

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
to `imports.prod.tf`, replace every placeholder ID, run a production plan
against remote state, then delete `imports.prod.tf` after the imports are
recorded. Do not commit a live `imports.prod.tf`; import blocks are evaluated
during every plan.

Use `cf-terraforming` or the Cloudflare dashboard to look up existing DNS record, Worker route, Pages project/domain, R2, Queue, and Access IDs before importing those resources. After imports, run:

```bash
terraform plan -var-file=envs/prod.tfvars
just tf-check-prod-imports prod
```

The plan should show no replacement for D1, R2, Queue, the Worker, or the Queue
consumer. If it wants to replace a data-bearing resource or recreate the Worker
identity, stop and fix the import or name override first.

## Wrangler Boundary

`apps/worker/wrangler.jsonc` is now local-dev and bundling metadata. Terraform
owns the production Worker identity, route, queue consumer, bindings, version,
and deployment rollout, so production deploys should use `just tf-apply-worker
prod` instead of `wrangler deploy`.

The Worker migration uses provider 5.x resources:

- `cloudflare_worker` for the script identity and `workers.dev` subdomain settings.
- `cloudflare_worker_version` for code modules, compatibility date/flags, Durable Object migrations, and bindings.
- `cloudflare_workers_deployment` for the active version rollout.
- `cloudflare_queue_consumer` for the `fp-events` consumer settings.

`manage_worker_deployment` defaults to `false` so normal Terraform validation and
control-plane plans do not need a built bundle. `just tf-plan-worker prod` and
`just tf-apply-worker prod` build `apps/worker/dist` with Wrangler, then pass the
bundle path to Terraform with `manage_worker_deployment=true`.

Keep `worker_compatibility_date` in sync with `apps/worker/wrangler.jsonc`.
Wrangler performs the dry-run bundle build and Terraform uploads the resulting
module, so both tools should use the same compatibility date and flags. Bump
the date only after testing the Worker against the new Cloudflare runtime
behavior.

`worker_durable_object_migration_tag` is the Worker Durable Object migration
tag Terraform sends with new Worker versions. Change it only when the Durable
Object migration list changes, such as adding, renaming, or deleting Durable
Object classes.

Terraform-managed Worker versions inherit `API_SECRET` and `CLAIM_SECRET` from
the latest deployed Worker version by default. Keep provisioning secret values
with `wrangler secret put` until the project adopts Cloudflare Secrets Store or
another Terraform-managed secret source. If a production Worker relies on
additional dashboard/Wrangler-managed bindings, add their names to
`worker_inherited_binding_names` before the first Terraform Worker deployment.
If the Worker is ever destroyed outside Terraform and there is no latest version
to inherit from, recover by redeploying a temporary Wrangler version with the
required secrets or by moving those secrets to a Terraform-managed secret
source before running `tf-apply-worker` again.

Cloudflare Pages uses Wrangler only for asset uploads. Terraform owns Pages
project settings and both production and preview `deployment_configs`. If Pages
Functions later need bindings or secrets, add them to this Terraform stack so a
plan can show the full runtime config drift.

The `deploy-staging` just recipe still uses Wrangler directly. Treat it as the
legacy staging path until staging remote state imports mirror production and the
staging Worker rollout can use `tf-apply-worker staging`.

## Admin Access

Set `enable_admin_access = true` only with at least one identity rule:

```hcl
enable_admin_access = true
admin_access_allowed_emails = [
  "admin@example.com",
]
```

Cloudflare Access identity providers are account configuration. This stack only manages the application and policy for `admin.o11yfleet.com`.
