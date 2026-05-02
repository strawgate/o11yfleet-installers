variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID that owns Workers, D1, R2, Queues, and Zero Trust resources."

  validation {
    condition     = length(trimspace(var.cloudflare_account_id)) > 0
    error_message = "cloudflare_account_id must not be empty."
  }
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare zone ID for zone_name."

  validation {
    condition     = length(trimspace(var.cloudflare_zone_id)) > 0
    error_message = "cloudflare_zone_id must not be empty."
  }
}

variable "zone_name" {
  type        = string
  description = "Primary DNS zone managed by this stack."
  default     = "o11yfleet.com"
}

variable "environment" {
  type        = string
  description = "Environment name. Use prod, staging, or dev."

  validation {
    condition     = contains(["prod", "production", "staging", "dev"], var.environment)
    error_message = "environment must be one of prod, production, staging, or dev."
  }
}

variable "resource_prefix" {
  type        = string
  description = "Prefix used for Cloudflare resource names."
  default     = "o11yfleet"
}

variable "worker_script_name" {
  type        = string
  description = "Optional Cloudflare Worker script name override. Defaults to o11yfleet-worker for prod and o11yfleet-worker-<env> for non-prod."
  default     = null
}

variable "worker_subdomain_enabled" {
  type        = bool
  description = "Whether the Worker is available on the workers.dev subdomain."
  default     = true
}

variable "worker_subdomain_previews_enabled" {
  type        = bool
  description = "Whether Worker preview URLs are enabled on workers.dev."
  default     = true
}

variable "manage_worker_deployment" {
  type        = bool
  description = "When true, Terraform uploads a Worker version from worker_bundle_path and rolls deployment traffic to it."
  default     = false
}

variable "worker_bundle_path" {
  type        = string
  description = "Path to the Wrangler-built Worker module that Terraform uploads when manage_worker_deployment is true."
  default     = null
}

variable "worker_bundle_module_name" {
  type        = string
  description = "Module name Terraform sends to Cloudflare for the Worker bundle. Defaults to basename(worker_bundle_path)."
  default     = null
}

variable "worker_bundle_content_type" {
  type        = string
  description = "Content type for the main Worker module uploaded by Terraform."
  default     = "application/javascript+module"
}

variable "worker_compatibility_date" {
  type        = string
  description = "Compatibility date Terraform applies to Worker versions."
  default     = "2026-04-29"

  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-\\d{2}$", var.worker_compatibility_date))
    error_message = "worker_compatibility_date must use YYYY-MM-DD format."
  }
}

variable "worker_compatibility_flags" {
  type        = set(string)
  description = "Compatibility flags Terraform applies to Worker versions."
  default     = ["nodejs_compat"]
}

variable "worker_analytics_engine_dataset" {
  type        = string
  description = "Analytics Engine dataset bound to FP_ANALYTICS in Terraform-managed Worker versions."
  default     = "fp_analytics"
}

variable "ai_guidance_provider" {
  type        = string
  description = "AI guidance provider mode exposed to the Worker. Use fixture/deterministic without an SDK key, or minimax/openai-compatible with O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY inherited."
  default     = "fixture"

  validation {
    condition     = contains(["fixture", "deterministic", "minimax", "openai-compatible"], var.ai_guidance_provider)
    error_message = "ai_guidance_provider must be fixture, deterministic, minimax, or openai-compatible."
  }
}

variable "ai_guidance_model" {
  type        = string
  description = "AI guidance model name exposed to the Worker."
  default     = "o11yfleet-guidance-fixture"
}

variable "ai_guidance_base_url" {
  type        = string
  description = "OpenAI-compatible AI guidance base URL exposed to the Worker. Empty for fixture mode."
  default     = ""
}

variable "worker_inherited_binding_names" {
  type        = set(string)
  description = "Existing Worker bindings to inherit from the latest deployed version, primarily secrets that should not be stored in Terraform state."
  default = [
    "O11YFLEET_API_BEARER_SECRET",
    "O11YFLEET_CLAIM_HMAC_SECRET",
    "O11YFLEET_SEED_ADMIN_EMAIL",
    "O11YFLEET_SEED_ADMIN_PASSWORD",
    "O11YFLEET_SEED_TENANT_USER_EMAIL",
    "O11YFLEET_SEED_TENANT_USER_PASSWORD",
    "CLOUDFLARE_BILLING_API_TOKEN",
    "CLOUDFLARE_METRICS_API_TOKEN",
    "O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY",
  ]

  validation {
    condition = alltrue([
      for name in [
        "O11YFLEET_API_BEARER_SECRET",
        "O11YFLEET_CLAIM_HMAC_SECRET",
        "O11YFLEET_SEED_ADMIN_EMAIL",
        "O11YFLEET_SEED_ADMIN_PASSWORD",
        "O11YFLEET_SEED_TENANT_USER_EMAIL",
        "O11YFLEET_SEED_TENANT_USER_PASSWORD",
      ] : contains(var.worker_inherited_binding_names, name)
    ])
    error_message = "worker_inherited_binding_names must include the required Worker secrets listed in apps/worker/wrangler.jsonc secrets.required."
  }
}

variable "signup_auto_approve" {
  type        = bool
  description = "When true, new tenant signups are auto-approved without admin review. Set to false for soft-launch gating."
  default     = false
}

variable "email_from" {
  type        = string
  description = "From address for outgoing emails bound to O11YFLEET_EMAIL_FROM (e.g. 'O11yFleet <noreply@yourdomain.com>')."
  default     = null
}

variable "worker_durable_object_migration_tag" {
  type        = string
  description = "Durable Object migration tag applied to Terraform-managed Worker versions."
  default     = "v1"
}

variable "worker_include_durable_object_binding" {
  type        = bool
  description = "Whether Terraform-managed Worker versions bind CONFIG_DO. Disable only for the first-time Durable Object migration bootstrap."
  default     = true
}

variable "worker_include_durable_object_migration" {
  type        = bool
  description = "Whether Terraform-managed Worker versions apply the ConfigDurableObject class migration. Enable only for the first-time Durable Object migration bootstrap."
  default     = false
}

variable "site_worker_script_name" {
  type        = string
  description = "Optional Cloudflare Worker script name override for the static-assets site Worker. Defaults to o11yfleet-site-worker for prod and o11yfleet-site-worker-<env> for non-prod."
  default     = null
}

variable "site_worker_subdomain_enabled" {
  type        = bool
  description = "Whether the static-assets Worker is available on the workers.dev subdomain."
  default     = true
}

variable "site_worker_subdomain_previews_enabled" {
  type        = bool
  description = "Whether static-assets Worker preview URLs are enabled on workers.dev."
  default     = true
}

variable "manage_site_deployment" {
  type        = bool
  description = "When true, Terraform uploads the built site assets and rolls the static-assets Worker deployment to them."
  default     = false
}

variable "site_assets_directory" {
  type        = string
  description = "Path to the built site asset directory that Terraform uploads when manage_site_deployment is true."
  default     = null
}

variable "site_worker_module_path" {
  type        = string
  description = "Path to the static-assets Worker module that handles SPA fallback and app/admin root redirects."
  default     = null
}

variable "site_worker_module_name" {
  type        = string
  description = "Module name Terraform sends to Cloudflare for the static-assets Worker module. Defaults to basename(site_worker_module_path)."
  default     = null
}

variable "site_worker_module_content_type" {
  type        = string
  description = "Content type for the static-assets Worker module uploaded by Terraform."
  default     = "application/javascript+module"
}

variable "site_headers_path" {
  type        = string
  description = "Path to the static site _headers file uploaded as Workers Static Assets metadata."
  default     = null
}

variable "site_worker_compatibility_date" {
  type        = string
  description = "Compatibility date Terraform applies to static-assets Worker versions."
  default     = "2026-04-29"

  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-\\d{2}$", var.site_worker_compatibility_date))
    error_message = "site_worker_compatibility_date must use YYYY-MM-DD format."
  }
}

variable "site_worker_compatibility_flags" {
  type        = set(string)
  description = "Compatibility flags Terraform applies to static-assets Worker versions."
  default     = []
}

variable "d1_database_name" {
  type        = string
  description = "Override D1 database name, mainly for importing existing production resources."
  default     = null
}

variable "r2_bucket_name" {
  type        = string
  description = "Override R2 bucket name, mainly for importing existing production resources."
  default     = null
}

variable "site_domain" {
  type        = string
  description = "Override marketing/docs custom domain."
  default     = null
}

variable "app_domain" {
  type        = string
  description = "Override customer app custom domain."
  default     = null
}

variable "admin_domain" {
  type        = string
  description = "Override admin custom domain."
  default     = null
}

variable "api_domain" {
  type        = string
  description = "Override API custom domain."
  default     = null
}

# Note: `manage_worker_deployment requires worker_bundle_path` is enforced
# by a `precondition` on cloudflare_worker_version.fleet (workers.tf), which
# is a hard gate at plan time. The site_worker_version uses the same pattern.
# A `check {}` block at this level would only emit a warning, not a failure.
