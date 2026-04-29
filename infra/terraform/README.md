# Cloudflare Terraform

This stack owns the stable Cloudflare control-plane resources for o11yFleet:

- D1 database for tenants, auth, configuration metadata, and enrollment tokens.
- R2 bucket for configuration YAML blobs.
- Queue for fleet events.
- DNS record and Worker route for the API hostname.
- Split Cloudflare Pages projects and custom domains for marketing, app, and admin.
- Optional Cloudflare Access application and policy for the admin hostname.

Wrangler still deploys Worker code and Pages assets. Terraform owns the resources those deploys target.

## Target Layout

| Surface               | Resource                                           |
| --------------------- | -------------------------------------------------- |
| `o11yfleet.com`       | Marketing/docs Pages project                       |
| `app.o11yfleet.com`   | Customer app Pages project                         |
| `admin.o11yfleet.com` | Admin Pages project protected by Cloudflare Access |
| `api.o11yfleet.com`   | Worker route to `o11yfleet-worker`                 |

Non-production defaults use prefixed hostnames such as `staging-app.o11yfleet.com` and resource names such as `o11yfleet-staging-db`.

Pages projects and Pages custom domains are intentionally separate. By default, Terraform creates all three Pages projects but attaches only the `site` custom domain. Add `app` or `admin` to `pages_custom_domains_to_attach` only after the matching deployment workflow is publishing the right asset bundle to that project.

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
```

The production tfvars intentionally point D1/R2/Queue at the existing names so those data-bearing resources can be imported instead of recreated. They also attach only the existing marketing custom domain until app/admin deployment workflows are split.

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

| Variable                         | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `TF_STATE_BUCKET`                | R2 bucket that stores Terraform state         |
| `TF_STATE_ENDPOINT`              | R2 S3 endpoint URL for the Cloudflare account |
| `TF_STATE_REGION`                | Optional; defaults to `auto`                  |
| `TERRAFORM_REMOTE_STATE_ENABLED` | Set to `true` after the state bucket exists   |
| `TERRAFORM_APPLY_ENABLED`        | Set to `true` only after production imports   |

The `production` GitHub environment should require reviewer approval when the
GitHub plan supports it. If required reviewers are not available, restrict the
environment to the `main` deployment branch policy and leave
`TERRAFORM_APPLY_ENABLED` unset until the first production imports are complete
and the plan shows no replacement for D1, R2, or Queue.

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

Use `cf-terraforming` or the Cloudflare dashboard to look up existing DNS record, Worker route, Pages project/domain, R2, Queue, and Access IDs before importing those resources. After imports, run:

```bash
terraform plan -var-file=envs/prod.tfvars
```

The plan should show no replacement for D1, R2, or Queue. If it wants to replace a data-bearing resource, stop and fix the import or name override first.

## Wrangler Boundary

`apps/worker/wrangler.jsonc` still deploys Worker code and declares runtime bindings. Once Terraform has imported and owns the API route, remove the route declaration from Wrangler in the same rollout that applies this stack. Until then, do not apply both managers against the same route without checking the plan.

## Admin Access

Set `enable_admin_access = true` only with at least one identity rule:

```hcl
enable_admin_access = true
admin_access_allowed_emails = [
  "admin@example.com",
]
```

Cloudflare Access identity providers are account configuration. This stack only manages the application and policy for `admin.o11yfleet.com`.
