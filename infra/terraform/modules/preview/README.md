# Preview Environment Module

Creates ephemeral Cloudflare Workers preview environments for pull requests.

## Usage

```hcl
module "preview" {
  source = "./modules/preview"

  pr_number            = 123
  branch_name          = "feat-new-feature"
  cloudflare_account_id = var.cloudflare_account_id
  worker_bundle_path   = "./dist/index.js"
  worker_bundle_module_name = "index.js"

  secrets = {
    O11YFLEET_API_BEARER_SECRET = "secret-value"
  }
}
```

## Resources Created

- `cloudflare_d1_database` - Preview database
- `cloudflare_r2_bucket` - Preview config storage
- `cloudflare_worker` - Worker script
- `cloudflare_worker_version` - Worker version with bindings
- `cloudflare_workers_deployment` - Active deployment

## Notes

- Resources use `prevent_destroy = false` for easy cleanup
- D1 migrations must be run separately after creation
- State should use a per-PR state file in R2

## CI Integration

State key format: `o11yfleet/preview/pr-{number}/terraform.tfstate`
