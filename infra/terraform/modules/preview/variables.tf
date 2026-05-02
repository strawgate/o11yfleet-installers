variable "pr_number" {
  description = "Pull request number for naming and identification"
  type        = number
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_workers_subdomain" {
  description = "Account-level workers.dev subdomain (e.g. \"o11yfleet\" for o11yfleet.workers.dev). The account-id form is only valid as a proxy CNAME target, not for direct browser access."
  type        = string
  default     = "o11yfleet"
}

variable "worker_bundle_path" {
  description = "Path to the built worker bundle"
  type        = string
}

variable "worker_bundle_module_name" {
  description = "Module name for the worker bundle"
  type        = string
  default     = "index.js"
}

variable "worker_compatibility_date" {
  description = "Workers compatibility date"
  type        = string
  default     = "2026-04-29"
}

variable "worker_compatibility_flags" {
  description = "Workers compatibility flags"
  type        = set(string)
  default     = ["nodejs_compat"]
}

variable "resource_prefix" {
  description = "Prefix for resource names"
  type        = string
  default     = "o11yfleet"
}

# Secrets that need to be set - these come from GitHub secrets or env
variable "secrets" {
  description = "Map of secret names to values for the worker"
  type        = map(string)
  default     = {}
  sensitive   = true
}

locals {
  env_name = "${var.resource_prefix}-pr-${var.pr_number}"
}
