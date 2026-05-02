# Cloudflare Terraform

This stack owns the stable Cloudflare control-plane resources for o11yFleet:

- D1 database for tenants, auth, configuration metadata, and enrollment tokens.
- R2 bucket for configuration YAML blobs.
- API Worker identity, Worker route, and Worker version/deployment.
- Static site Worker identity, routes, DNS records, assets, and Worker deployment.

Wrangler still builds the API Worker bundle and manages D1 migrations/secrets.
Terraform owns the deployed Worker versions, static site assets, Worker bindings,
Worker rollout, routes, and DNS. Add runtime configuration to Terraform unless
it is a secret that must stay out of state.

## Best-Practice Baseline

This stack follows these rules from the current Cloudflare and Terraform docs:

- Terraform should be authoritative for every resource it manages. If a
  Cloudflare resource already exists, either import it into state before apply
  or deliberately retire/delete it and let Terraform create the replacement.
- Do not manage the same Cloudflare resource through both Terraform and
  Wrangler/dashboard settings. Wrangler is allowed here only as a bundler,
  secret provisioning helper, and D1 migration runner.
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

| Surface               | Resource                                     |
| --------------------- | -------------------------------------------- |
| `o11yfleet.com`       | Static site Worker route                     |
| `app.o11yfleet.com`   | Static site Worker route                     |
| `admin.o11yfleet.com` | Static site Worker route protected by Access |
| `api.o11yfleet.com`   | Worker route to `o11yfleet-worker`           |

Non-production defaults use prefixed hostnames such as
`staging-app.o11yfleet.com` and resource names such as
`o11yfleet-staging-db`.

The same built SPA bundle is uploaded as Workers Static Assets and served by one
static site Worker per environment. The Worker script in
`apps/site/public/_worker.js` handles app/admin root redirects and SPA fallback.

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

Create and rotate those credentials with the bootstrap script, not Terraform:

```bash
just cloudflare-credentials-dry-run "dev staging prod"
just cloudflare-credentials-apply "dev staging prod"
```

The script creates per-environment Cloudflare deploy tokens and R2 state tokens
and stores them as GitHub Environment secrets. Terraform should not manage these
tokens in this stack because that creates a bootstrap cycle and would put the
credentials or derived R2 secret material in Terraform state.

The committed `envs/*.tfvars` files contain stable, non-secret identifiers and
environment-specific names. If you need private or experimental variable values,
put them in an untracked `*.auto.tfvars` file under `infra/terraform/` or pass
them as `TF_VAR_*` environment variables. `.gitignore` excludes those local
files.

```bash
just tf-plan staging
just tf-plan prod
just tf-plan-worker prod
just site-build prod
just tf-plan-site prod
```

The production tfvars intentionally point D1/R2/Queue at the existing names so
those data-bearing resources can be imported instead of recreated.

## GitHub Deployment

`.github/workflows/terraform-deploy.yml` is the deploy path for Terraform:

- Pull requests validate Terraform and, once remote state is enabled, run a production plan.
- Pushes to `main` run the same plan and apply production only when explicitly enabled.
- Manual dispatch can plan `dev`, `staging`, or `prod`; applying is restricted to the `main` branch and uses the matching GitHub environment.

`.github/workflows/deploy-environment.yml` is the manual full-environment
deploy path. It runs `just deploy-env <env>`, which applies Terraform control
plane resources, uploads the Terraform-managed static site Worker/assets, runs
D1 migrations, uploads a Terraform-managed API Worker version, and smoke-tests
the site plus the deploy-grade API flow. The workflow is restricted to `main`
for the shared `dev`, `staging`, and `prod` environments; per-PR deploys should
use a separate preview environment rather than mutating shared long-lived state.

`.github/workflows/release.yml` is the production application release path. It
is intentionally a thin wrapper around `just deploy-env prod`, so release,
manual, and staging deploys keep the same ordering and preflights.

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
| `TERRAFORM_PRODUCTION_APPLY_ENABLED` | Set to `true` only after production imports                                        |
| `TERRAFORM_STAGING_DEPLOY_ENABLED`   | Set to `true` only after staging state and Worker secrets are ready for CI deploys |

The `production` GitHub environment should require reviewer approval when the
GitHub plan supports it. If required reviewers are not available, restrict the
environment to the `main` deployment branch policy and leave
`TERRAFORM_PRODUCTION_APPLY_ENABLED` unset until the first production imports are complete
and the plan shows no replacement for D1 or R2.

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

Use `cf-terraforming` or the Cloudflare dashboard to look up existing DNS
record, Worker route, Worker, R2, Queue, and Access IDs before importing those
resources. After imports, run:

```bash
terraform plan -var-file=envs/prod.tfvars
just tf-check-prod-imports prod
```

The plan should show no replacement for D1, R2, Queue, the Worker, or the Queue
consumer. If it wants to replace a data-bearing resource or recreate the Worker
identity, stop and fix the import or name override first.

## Deployment Boundary

`apps/worker/wrangler.jsonc` is now local-dev and bundling metadata. Terraform
owns the production API Worker identity, route, queue consumer, bindings,
version, and deployment rollout, so production deploys should use
`just tf-apply-worker prod` instead of `wrangler deploy`.

The Worker migration uses provider 5.x resources:

- `cloudflare_worker` for the script identity and `workers.dev` subdomain settings.
- `cloudflare_workers_cron_trigger` for the Worker schedules.
- `cloudflare_worker_version` for code modules, compatibility date/flags, Durable Object migrations, and bindings.
- `cloudflare_workers_deployment` for the active version rollout.
- `cloudflare_worker_version.site` for static site asset uploads.

`manage_worker_deployment` defaults to `false` so normal Terraform validation and
control-plane plans do not need a built bundle. `just tf-plan-worker prod` and
`just tf-apply-worker prod` build `apps/worker/dist` with Wrangler, then pass the
bundle path to Terraform with `manage_worker_deployment=true`.

Brand-new environments run one extra targeted Worker apply through
`just tf-apply-worker-do-migration-if-needed <env>` before the normal Worker
rollout. Cloudflare documents that a Durable Object class migration must be
applied before a Worker version can bind that class, so this first apply sets
`worker_include_durable_object_migration=true` and
`worker_include_durable_object_binding=false`. The normal rollout then sets the
opposite flags, binding `CONFIG_DO` without repeating the migration. The helper
skips itself once `cloudflare_workers_deployment.fleet[0]` exists in Terraform
state, or when the current Cloudflare Worker deployment's version already has a
Durable Object migration tag. See Cloudflare's Terraform Durable Objects
consideration:
<https://developers.cloudflare.com/workers/platform/infrastructure-as-code/#considerations-with-durable-objects>.

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

Terraform-managed Worker versions inherit `O11YFLEET_API_BEARER_SECRET`,
`O11YFLEET_CLAIM_HMAC_SECRET`, and seed-account secrets from the latest Worker
version by default. Keep provisioning secret values with Wrangler until the
project adopts Cloudflare Secrets Store or another Terraform-managed secret
source. Optional secrets such as `AI_GUIDANCE_MINIMAX_API_KEY` should only be
added to `worker_inherited_binding_names` in environments whose tfvars also set
the matching non-secret provider mode, such as `ai_guidance_provider =
"minimax"`. Terraform validates that this inherited binding list still contains
the runtime secrets declared in `apps/worker/wrangler.jsonc` `secrets.required`,
so deploy plans cannot accidentally drop one of the required secret bindings.

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

The static site uses Workers Static Assets. `just site-build <env>` builds
`apps/site/dist`, writes an `.assetsignore` that excludes Worker control
files, and `just tf-apply-site <env>` passes the asset directory plus
`apps/site/public/_worker.js` to Terraform with `manage_site_deployment=true`.
This keeps the public frontend deploy in Terraform rather than a separate
Wrangler asset upload.

The `deploy-env` just recipe uses Terraform for environment control-plane
resources, static site rollout, and API Worker rollout, then Wrangler only for
D1 migrations and secret inventory checks. It imports Worker identities left by
partial bootstrap attempts, runs a targeted control-plane Terraform pass so new
environments can create Worker script identities, then runs
`worker-secrets-check` before D1 migrations or API Worker rollout so Terraform
does not inherit an incomplete binding set. Fresh Workers with no uploaded
versions use one temporary `wrangler deploy --secrets-file` bootstrap version
because Cloudflare requires the first Worker upload to use Wrangler deploy or
C3; existing Workers keep using `wrangler versions secret put`. Optional
runtime secrets are only provisioned when the matching process environment
variable is set. D1 migrations use a temporary Wrangler config populated from
Terraform's real D1 database ID, so checked-in non-production Wrangler
placeholders are not used for remote migrations. New environments then run a
Terraform Durable Object migration-only Worker deployment before the normal
Worker rollout, because Cloudflare requires the class migration to exist before
the Worker version binds `CONFIG_DO`. Worker routes, cron triggers, queue
consumers, and site routes are applied by the targeted code-rollout recipes
after their Worker deployments exist.
`deploy-staging` is the CI-safe wrapper around `deploy-env staging`: it requires
`TERRAFORM_STAGING_DEPLOY_ENABLED=true` and checks staging state before
applying.

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
just site-build staging
just tf-plan-site staging
just tf-apply-site staging
just tf-plan-worker staging
just tf-apply-worker staging
```

The site commands upload the built SPA bundle as Workers Static Assets. The
Worker commands build the API Worker module using Wrangler dry-run output, then pass
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

When cutting an environment over from Cloudflare Pages, use the application
deploy path (`just deploy-env <env>`, the **Deploy Environment** workflow, or
the release workflow) so Terraform creates the static site Worker version,
deployment, DNS records, and routes together. A control-plane-only Terraform
apply can create the Worker identity, DNS, and routes, but it intentionally does
not upload the built site assets unless `manage_site_deployment=true`.

## Reference

<!-- BEGIN_TF_DOCS -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 1.5 |
| <a name="requirement_cloudflare"></a> [cloudflare](#requirement\_cloudflare) | 5.19.1 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_cloudflare"></a> [cloudflare](#provider\_cloudflare) | 5.19.1 |

## Resources

| Name | Type |
|------|------|
| [cloudflare_d1_database.fleet](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/d1_database) | resource |
| [cloudflare_dns_record.api](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/dns_record) | resource |
| [cloudflare_dns_record.site](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/dns_record) | resource |
| [cloudflare_r2_bucket.configs](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/r2_bucket) | resource |
| [cloudflare_worker.fleet](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/worker) | resource |
| [cloudflare_worker.site](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/worker) | resource |
| [cloudflare_worker_version.fleet](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/worker_version) | resource |
| [cloudflare_worker_version.site](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/worker_version) | resource |
| [cloudflare_workers_cron_trigger.fleet](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/workers_cron_trigger) | resource |
| [cloudflare_workers_deployment.fleet](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/workers_deployment) | resource |
| [cloudflare_workers_deployment.site](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/workers_deployment) | resource |
| [cloudflare_workers_route.api](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/workers_route) | resource |
| [cloudflare_workers_route.site](https://registry.terraform.io/providers/cloudflare/cloudflare/5.19.1/docs/resources/workers_route) | resource |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_admin_domain"></a> [admin\_domain](#input\_admin\_domain) | Override admin custom domain. | `string` | `null` | no |
| <a name="input_ai_guidance_base_url"></a> [ai\_guidance\_base\_url](#input\_ai\_guidance\_base\_url) | OpenAI-compatible AI guidance base URL exposed to the Worker. Empty for fixture mode. | `string` | `""` | no |
| <a name="input_ai_guidance_model"></a> [ai\_guidance\_model](#input\_ai\_guidance\_model) | AI guidance model name exposed to the Worker. | `string` | `"o11yfleet-guidance-fixture"` | no |
| <a name="input_ai_guidance_provider"></a> [ai\_guidance\_provider](#input\_ai\_guidance\_provider) | AI guidance provider mode exposed to the Worker. Use fixture/deterministic without an SDK key, or minimax/openai-compatible with O11YFLEET\_AI\_GUIDANCE\_MINIMAX\_API\_KEY inherited. | `string` | `"fixture"` | no |
| <a name="input_api_domain"></a> [api\_domain](#input\_api\_domain) | Override API custom domain. | `string` | `null` | no |
| <a name="input_app_domain"></a> [app\_domain](#input\_app\_domain) | Override customer app custom domain. | `string` | `null` | no |
| <a name="input_cloudflare_account_id"></a> [cloudflare\_account\_id](#input\_cloudflare\_account\_id) | Cloudflare account ID that owns Workers, D1, R2, and Zero Trust resources. | `string` | n/a | yes |
| <a name="input_cloudflare_zone_id"></a> [cloudflare\_zone\_id](#input\_cloudflare\_zone\_id) | Cloudflare zone ID for zone\_name. | `string` | n/a | yes |
| <a name="input_d1_database_name"></a> [d1\_database\_name](#input\_d1\_database\_name) | Override D1 database name, mainly for importing existing production resources. | `string` | `null` | no |
| <a name="input_email_from"></a> [email\_from](#input\_email\_from) | From address for outgoing emails bound to O11YFLEET\_EMAIL\_FROM (e.g. 'O11yFleet <noreply@yourdomain.com>'). | `string` | `null` | no |
| <a name="input_environment"></a> [environment](#input\_environment) | Environment name. Use prod, staging, or dev. | `string` | n/a | yes |
| <a name="input_manage_site_deployment"></a> [manage\_site\_deployment](#input\_manage\_site\_deployment) | When true, Terraform uploads the built site assets and rolls the static-assets Worker deployment to them. | `bool` | `false` | no |
| <a name="input_manage_worker_deployment"></a> [manage\_worker\_deployment](#input\_manage\_worker\_deployment) | When true, Terraform uploads a Worker version from worker\_bundle\_path and rolls deployment traffic to it. | `bool` | `false` | no |
| <a name="input_r2_bucket_name"></a> [r2\_bucket\_name](#input\_r2\_bucket\_name) | Override R2 bucket name, mainly for importing existing production resources. | `string` | `null` | no |
| <a name="input_resource_prefix"></a> [resource\_prefix](#input\_resource\_prefix) | Prefix used for Cloudflare resource names. | `string` | `"o11yfleet"` | no |
| <a name="input_signup_auto_approve"></a> [signup\_auto\_approve](#input\_signup\_auto\_approve) | When true, new tenant signups are auto-approved without admin review. Set to false for soft-launch gating. | `bool` | `false` | no |
| <a name="input_site_assets_directory"></a> [site\_assets\_directory](#input\_site\_assets\_directory) | Path to the built site asset directory that Terraform uploads when manage\_site\_deployment is true. | `string` | `null` | no |
| <a name="input_site_domain"></a> [site\_domain](#input\_site\_domain) | Override marketing/docs custom domain. | `string` | `null` | no |
| <a name="input_site_headers_path"></a> [site\_headers\_path](#input\_site\_headers\_path) | Path to the static site \_headers file uploaded as Workers Static Assets metadata. | `string` | `null` | no |
| <a name="input_site_worker_compatibility_date"></a> [site\_worker\_compatibility\_date](#input\_site\_worker\_compatibility\_date) | Compatibility date Terraform applies to static-assets Worker versions. | `string` | `"2026-04-29"` | no |
| <a name="input_site_worker_compatibility_flags"></a> [site\_worker\_compatibility\_flags](#input\_site\_worker\_compatibility\_flags) | Compatibility flags Terraform applies to static-assets Worker versions. | `set(string)` | `[]` | no |
| <a name="input_site_worker_module_content_type"></a> [site\_worker\_module\_content\_type](#input\_site\_worker\_module\_content\_type) | Content type for the static-assets Worker module uploaded by Terraform. | `string` | `"application/javascript+module"` | no |
| <a name="input_site_worker_module_name"></a> [site\_worker\_module\_name](#input\_site\_worker\_module\_name) | Module name Terraform sends to Cloudflare for the static-assets Worker module. Defaults to basename(site\_worker\_module\_path). | `string` | `null` | no |
| <a name="input_site_worker_module_path"></a> [site\_worker\_module\_path](#input\_site\_worker\_module\_path) | Path to the static-assets Worker module that handles SPA fallback and app/admin root redirects. | `string` | `null` | no |
| <a name="input_site_worker_script_name"></a> [site\_worker\_script\_name](#input\_site\_worker\_script\_name) | Optional Cloudflare Worker script name override for the static-assets site Worker. Defaults to o11yfleet-site-worker for prod and o11yfleet-site-worker-<env> for non-prod. | `string` | `null` | no |
| <a name="input_site_worker_subdomain_enabled"></a> [site\_worker\_subdomain\_enabled](#input\_site\_worker\_subdomain\_enabled) | Whether the static-assets Worker is available on the workers.dev subdomain. | `bool` | `true` | no |
| <a name="input_site_worker_subdomain_previews_enabled"></a> [site\_worker\_subdomain\_previews\_enabled](#input\_site\_worker\_subdomain\_previews\_enabled) | Whether static-assets Worker preview URLs are enabled on workers.dev. | `bool` | `true` | no |
| <a name="input_worker_analytics_engine_dataset"></a> [worker\_analytics\_engine\_dataset](#input\_worker\_analytics\_engine\_dataset) | Analytics Engine dataset bound to FP\_ANALYTICS in Terraform-managed Worker versions. | `string` | `"fp_analytics"` | no |
| <a name="input_worker_bundle_content_type"></a> [worker\_bundle\_content\_type](#input\_worker\_bundle\_content\_type) | Content type for the main Worker module uploaded by Terraform. | `string` | `"application/javascript+module"` | no |
| <a name="input_worker_bundle_module_name"></a> [worker\_bundle\_module\_name](#input\_worker\_bundle\_module\_name) | Module name Terraform sends to Cloudflare for the Worker bundle. Defaults to basename(worker\_bundle\_path). | `string` | `null` | no |
| <a name="input_worker_bundle_path"></a> [worker\_bundle\_path](#input\_worker\_bundle\_path) | Path to the Wrangler-built Worker module that Terraform uploads when manage\_worker\_deployment is true. | `string` | `null` | no |
| <a name="input_worker_compatibility_date"></a> [worker\_compatibility\_date](#input\_worker\_compatibility\_date) | Compatibility date Terraform applies to Worker versions. | `string` | `"2026-04-29"` | no |
| <a name="input_worker_compatibility_flags"></a> [worker\_compatibility\_flags](#input\_worker\_compatibility\_flags) | Compatibility flags Terraform applies to Worker versions. | `set(string)` | <pre>[<br/>  "nodejs_compat"<br/>]</pre> | no |
| <a name="input_worker_crons"></a> [worker\_crons](#input\_worker\_crons) | Cron schedules for Terraform-managed Worker cron triggers. Must match `triggers.crons` in apps/worker/wrangler.jsonc — drift is checked by scripts/check-cron-drift.ts and the same script wired into CI's fast job. | `list(string)` | <pre>[<br/>  "0 0 * * *",<br/>  "17 3 * * *"<br/>]</pre> | no |
| <a name="input_worker_durable_object_migration_tag"></a> [worker\_durable\_object\_migration\_tag](#input\_worker\_durable\_object\_migration\_tag) | Durable Object migration tag applied to Terraform-managed Worker versions. | `string` | `"v1"` | no |
| <a name="input_worker_include_durable_object_binding"></a> [worker\_include\_durable\_object\_binding](#input\_worker\_include\_durable\_object\_binding) | Whether Terraform-managed Worker versions bind CONFIG\_DO. Disable only for the first-time Durable Object migration bootstrap. | `bool` | `true` | no |
| <a name="input_worker_include_durable_object_migration"></a> [worker\_include\_durable\_object\_migration](#input\_worker\_include\_durable\_object\_migration) | Whether Terraform-managed Worker versions apply the ConfigDurableObject class migration. Enable only for the first-time Durable Object migration bootstrap. | `bool` | `false` | no |
| <a name="input_worker_inherited_binding_names"></a> [worker\_inherited\_binding\_names](#input\_worker\_inherited\_binding\_names) | Existing Worker bindings to inherit from the latest deployed version, primarily secrets that should not be stored in Terraform state. | `set(string)` | <pre>[<br/>  "O11YFLEET_API_BEARER_SECRET",<br/>  "O11YFLEET_CLAIM_HMAC_SECRET",<br/>  "O11YFLEET_SEED_ADMIN_EMAIL",<br/>  "O11YFLEET_SEED_ADMIN_PASSWORD",<br/>  "O11YFLEET_SEED_TENANT_USER_EMAIL",<br/>  "O11YFLEET_SEED_TENANT_USER_PASSWORD",<br/>  "CLOUDFLARE_BILLING_API_TOKEN",<br/>  "CLOUDFLARE_METRICS_API_TOKEN",<br/>  "O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY"<br/>]</pre> | no |
| <a name="input_worker_script_name"></a> [worker\_script\_name](#input\_worker\_script\_name) | Optional Cloudflare Worker script name override. Defaults to o11yfleet-worker for prod and o11yfleet-worker-<env> for non-prod. | `string` | `null` | no |
| <a name="input_worker_subdomain_enabled"></a> [worker\_subdomain\_enabled](#input\_worker\_subdomain\_enabled) | Whether the Worker is available on the workers.dev subdomain. | `bool` | `true` | no |
| <a name="input_worker_subdomain_previews_enabled"></a> [worker\_subdomain\_previews\_enabled](#input\_worker\_subdomain\_previews\_enabled) | Whether Worker preview URLs are enabled on workers.dev. | `bool` | `true` | no |
| <a name="input_zone_name"></a> [zone\_name](#input\_zone\_name) | Primary DNS zone managed by this stack. | `string` | `"o11yfleet.com"` | no |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_api_domain"></a> [api\_domain](#output\_api\_domain) | API hostname routed to the Worker. |
| <a name="output_d1_database_id"></a> [d1\_database\_id](#output\_d1\_database\_id) | D1 database ID for Wrangler FP\_DB binding. |
| <a name="output_d1_database_name"></a> [d1\_database\_name](#output\_d1\_database\_name) | D1 database name for Wrangler FP\_DB binding. |
| <a name="output_r2_bucket_id"></a> [r2\_bucket\_id](#output\_r2\_bucket\_id) | R2 bucket Terraform/provider ID. |
| <a name="output_r2_bucket_name"></a> [r2\_bucket\_name](#output\_r2\_bucket\_name) | R2 bucket name for Wrangler FP\_CONFIGS binding. |
| <a name="output_site_surfaces"></a> [site\_surfaces](#output\_site\_surfaces) | Static site surfaces routed to the static-assets Worker. |
| <a name="output_site_worker_deployment_id"></a> [site\_worker\_deployment\_id](#output\_site\_worker\_deployment\_id) | Active Terraform-managed static-assets Worker deployment ID when manage\_site\_deployment is enabled. |
| <a name="output_site_worker_name"></a> [site\_worker\_name](#output\_site\_worker\_name) | Static-assets Worker script identity managed by Terraform. |
| <a name="output_worker_deployment_id"></a> [worker\_deployment\_id](#output\_worker\_deployment\_id) | Active Terraform-managed Worker deployment ID when manage\_worker\_deployment is enabled. |
| <a name="output_worker_name"></a> [worker\_name](#output\_worker\_name) | Worker script identity managed by Terraform. |
<!-- END_TF_DOCS -->
