terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "local" {}
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID"
}

variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"
}

# D1 Database
resource "cloudflare_d1_database" "fp_db" {
  account_id = var.cloudflare_account_id
  name       = "fp-db-${var.environment}"
}

# R2 Bucket
resource "cloudflare_r2_bucket" "fp_configs" {
  account_id = var.cloudflare_account_id
  name       = "fp-configs-${var.environment}"
}

# Queue
resource "cloudflare_queue" "fp_events" {
  account_id = var.cloudflare_account_id
  name       = "fp-events-${var.environment}"
}

# Outputs
output "d1_database_id" {
  value = cloudflare_d1_database.fp_db.id
}

output "r2_bucket_name" {
  value = cloudflare_r2_bucket.fp_configs.name
}

output "queue_id" {
  value = cloudflare_queue.fp_events.id
}
