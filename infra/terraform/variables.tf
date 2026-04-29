variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID that owns Workers, Pages, D1, R2, Queues, and Zero Trust resources."

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

variable "production_branch" {
  type        = string
  description = "Git branch Cloudflare Pages treats as production."
  default     = "main"
}

variable "pages_functions_compatibility_date" {
  type        = string
  description = "Compatibility date Terraform applies to Pages Functions production and preview deployment configs."
  default     = "2026-04-26"

  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-\\d{2}$", var.pages_functions_compatibility_date))
    error_message = "pages_functions_compatibility_date must use YYYY-MM-DD format."
  }
}

variable "worker_script_name" {
  type        = string
  description = "Cloudflare Worker script name. Terraform owns the script identity, API route, queue consumer, and optionally code deployments."
  default     = "o11yfleet-worker"
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

variable "worker_inherited_binding_names" {
  type        = set(string)
  description = "Existing Worker bindings to inherit from the latest deployed version, primarily secrets that should not be stored in Terraform state."
  default     = ["API_SECRET", "CLAIM_SECRET"]
}

variable "worker_durable_object_migration_tag" {
  type        = string
  description = "Durable Object migration tag applied to Terraform-managed Worker versions."
  default     = "v1"
}

variable "worker_queue_consumer_batch_size" {
  type        = number
  description = "Maximum number of messages delivered to the Worker queue consumer per batch."
  default     = 100

  validation {
    condition     = var.worker_queue_consumer_batch_size >= 1 && var.worker_queue_consumer_batch_size <= 100
    error_message = "worker_queue_consumer_batch_size must be between 1 and 100."
  }
}

variable "worker_queue_consumer_max_wait_time_ms" {
  type        = number
  description = "Maximum time the queue waits for a batch to fill before invoking the Worker, in milliseconds."
  default     = 5000

  validation {
    condition     = var.worker_queue_consumer_max_wait_time_ms >= 0 && var.worker_queue_consumer_max_wait_time_ms <= 60000
    error_message = "worker_queue_consumer_max_wait_time_ms must be between 0 and 60000."
  }
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

variable "queue_name" {
  type        = string
  description = "Override Queue name, mainly for importing existing production resources."
  default     = null
}

variable "site_pages_project_name" {
  type        = string
  description = "Override marketing/docs Pages project name."
  default     = null
}

variable "app_pages_project_name" {
  type        = string
  description = "Override customer app Pages project name."
  default     = null
}

variable "admin_pages_project_name" {
  type        = string
  description = "Override admin Pages project name."
  default     = null
}

variable "pages_custom_domains_to_attach" {
  type        = set(string)
  description = "Pages custom domains Terraform should attach now. Keep app/admin out until their deploy workflows are ready for cutover."
  default     = ["site"]

  validation {
    condition     = alltrue([for domain in var.pages_custom_domains_to_attach : contains(["site", "app", "admin"], domain)])
    error_message = "pages_custom_domains_to_attach may only contain site, app, or admin."
  }
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

variable "enable_admin_access" {
  type        = bool
  description = "Whether Terraform should manage a Cloudflare Access application and allow policy for the admin domain."
  default     = false
}

variable "admin_access_allowed_emails" {
  type        = list(string)
  description = "Explicit email addresses allowed through Cloudflare Access for the admin app."
  default     = []

  validation {
    condition     = alltrue([for email in var.admin_access_allowed_emails : length(trimspace(email)) > 0 && email == trimspace(email)])
    error_message = "admin_access_allowed_emails entries must not be blank or padded with whitespace."
  }
}

variable "admin_access_allowed_email_domains" {
  type        = list(string)
  description = "Email domains allowed through Cloudflare Access for the admin app."
  default     = []

  validation {
    condition     = alltrue([for domain in var.admin_access_allowed_email_domains : length(trimspace(domain)) > 0 && domain == trimspace(domain)])
    error_message = "admin_access_allowed_email_domains entries must not be blank or padded with whitespace."
  }
}

variable "admin_access_session_duration" {
  type        = string
  description = "Cloudflare Access admin session duration."
  default     = "12h"
}

check "admin_access_has_identity_rule" {
  assert {
    condition = (
      !var.enable_admin_access ||
      length(local.admin_access_allowed_emails) > 0 ||
      length(local.admin_access_allowed_email_domains) > 0
    )
    error_message = "enable_admin_access requires admin_access_allowed_emails or admin_access_allowed_email_domains."
  }
}

check "worker_deployment_has_bundle" {
  assert {
    condition     = !var.manage_worker_deployment || try(length(trimspace(var.worker_bundle_path)) > 0, false)
    error_message = "manage_worker_deployment requires worker_bundle_path."
  }
}
