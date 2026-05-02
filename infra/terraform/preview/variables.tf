variable "pr_number" {
  description = "Pull request number"
  type        = number
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
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

# Secrets
variable "o11yfleet_api_bearer_secret" {
  description = "API bearer secret"
  type        = string
  sensitive   = true
}

variable "o11yfleet_claim_hmac_secret" {
  description = "Claim HMAC secret"
  type        = string
  sensitive   = true
}

variable "o11yfleet_seed_admin_email" {
  description = "Seed admin email"
  type        = string
}

variable "o11yfleet_seed_admin_password" {
  description = "Seed admin password"
  type        = string
  sensitive   = true
}

variable "o11yfleet_seed_tenant_user_email" {
  description = "Seed tenant user email"
  type        = string
}

variable "o11yfleet_seed_tenant_user_password" {
  description = "Seed tenant user password"
  type        = string
  sensitive   = true
}
