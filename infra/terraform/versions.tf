terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.19.1"
    }
  }

  # Terraform HTTP backend pointing at the o11yfleet-tfstate Worker for
  # locking + R2 storage. The full backend config (URL, auth, lock_method)
  # lives in `justfile`'s `tf-init-remote` recipe and the matching CI
  # workflow steps. See infra/tfstate-worker/ for the Worker source.
  backend "http" {}
}
