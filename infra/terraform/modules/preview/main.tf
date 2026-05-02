# Preview Environment Module
# Creates ephemeral resources for PR preview deployments

terraform {
  required_version = ">= 1.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# D1 Database for preview
resource "cloudflare_d1_database" "preview" {
  account_id = var.cloudflare_account_id
  name       = local.env_name

  read_replication = {
    mode    = "disabled"
    enabled = false
  }

  # Allow destruction for cleanup
  lifecycle {
    prevent_destroy = false
  }
}

# R2 Bucket for preview configs
resource "cloudflare_r2_bucket" "preview" {
  account_id = var.cloudflare_account_id
  name       = local.env_name

  lifecycle {
    prevent_destroy = false
  }
}

# Worker script (the actual worker deployment uses wrangler with this as base)
resource "cloudflare_worker" "preview" {
  account_id = var.cloudflare_account_id
  name       = local.env_name

  subdomain = {
    enabled          = true
    previews_enabled = true
  }

  lifecycle {
    prevent_destroy = false
  }
}

# Worker version with bindings to D1 and R2
resource "cloudflare_worker_version" "preview" {
  account_id          = var.cloudflare_account_id
  worker_id           = cloudflare_worker.preview.id
  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = var.worker_compatibility_flags
  main_module         = var.worker_bundle_module_name

  modules = [
    {
      name         = var.worker_bundle_module_name
      content_type = "application/javascript+module"
      content_file = var.worker_bundle_path
    }
  ]

  bindings = concat(
    [
      # D1 binding
      {
        name        = "FP_DB"
        type        = "d1"
        database_id = cloudflare_d1_database.preview.uuid
      },
      # R2 binding
      {
        name        = "FP_CONFIGS"
        type        = "r2_bucket"
        bucket_name = cloudflare_r2_bucket.preview.name
      },
      # Environment var (use "staging" for preview since preview behaves like staging)
      {
        name = "ENVIRONMENT"
        type = "plain_text"
        text = "staging"
      },
      # Preview identifier for the PR
      {
        name = "PREVIEW_ID"
        type = "plain_text"
        text = "pr-${var.pr_number}"
      },
      # Analytics
      {
        name    = "FP_ANALYTICS"
        type    = "analytics_engine"
        dataset = "fp_analytics_preview"
      },
    ],
    # Add secrets as bindings with their values
    [for name, value in var.secrets : {
      name = name
      type = "secret_text"
      text = value
    }]
  )
}

# Deploy the worker version
resource "cloudflare_workers_deployment" "preview" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.preview.name
  strategy    = "percentage"

  versions = [
    {
      version_id = cloudflare_worker_version.preview.id
      percentage = 100
    }
  ]
}
