# Preview environment Terraform configuration
# This is called from CI with per-PR state

terraform {
  required_version = ">= 1.0"

  backend "s3" {
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_check           = true
    # Endpoint and credentials provided via environment variables
  }
}

provider "cloudflare" {}

module "preview" {
  source = "../modules/preview"

  pr_number                  = var.pr_number
  cloudflare_account_id      = var.cloudflare_account_id
  worker_bundle_path         = var.worker_bundle_path
  worker_bundle_module_name  = var.worker_bundle_module_name
  worker_compatibility_date  = var.worker_compatibility_date
  worker_compatibility_flags = var.worker_compatibility_flags

  secrets = {
    O11YFLEET_API_BEARER_SECRET         = var.o11yfleet_api_bearer_secret
    O11YFLEET_CLAIM_HMAC_SECRET         = var.o11yfleet_claim_hmac_secret
    O11YFLEET_SEED_ADMIN_EMAIL          = var.o11yfleet_seed_admin_email
    O11YFLEET_SEED_ADMIN_PASSWORD       = var.o11yfleet_seed_admin_password
    O11YFLEET_SEED_TENANT_USER_EMAIL    = var.o11yfleet_seed_tenant_user_email
    O11YFLEET_SEED_TENANT_USER_PASSWORD = var.o11yfleet_seed_tenant_user_password
  }
}
