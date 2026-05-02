locals {
  env_slug    = var.environment == "production" ? "prod" : var.environment
  name_prefix = "${var.resource_prefix}-${local.env_slug}"

  d1_database_name = coalesce(var.d1_database_name, "${local.name_prefix}-db")
  r2_bucket_name   = coalesce(var.r2_bucket_name, "${local.name_prefix}-configs")
  worker_name      = coalesce(var.worker_script_name, local.env_slug == "prod" ? "${var.resource_prefix}-worker" : "${var.resource_prefix}-worker-${local.env_slug}")

  site_domain     = coalesce(var.site_domain, local.env_slug == "prod" ? var.zone_name : "${local.env_slug}.${var.zone_name}")
  app_domain      = coalesce(var.app_domain, local.env_slug == "prod" ? "app.${var.zone_name}" : "${local.env_slug}-app.${var.zone_name}")
  admin_domain    = coalesce(var.admin_domain, local.env_slug == "prod" ? "admin.${var.zone_name}" : "${local.env_slug}-admin.${var.zone_name}")
  api_domain      = coalesce(var.api_domain, local.env_slug == "prod" ? "api.${var.zone_name}" : "${local.env_slug}-api.${var.zone_name}")
  api_record_name = trimsuffix(local.api_domain, ".${var.zone_name}")

  site_surfaces = {
    site = {
      domain = local.site_domain
    }
    app = {
      domain = local.app_domain
    }
    admin = {
      domain = local.admin_domain
    }
  }

  site_dns_records = {
    for key, surface in local.site_surfaces : key => merge(surface, {
      record_name = surface.domain == var.zone_name ? var.zone_name : trimsuffix(surface.domain, ".${var.zone_name}")
    })
  }

  worker_environment_name   = local.env_slug == "prod" ? "production" : local.env_slug
  worker_bundle_module_name = coalesce(var.worker_bundle_module_name, var.worker_bundle_path == null ? "index.js" : basename(var.worker_bundle_path))
  worker_crons              = ["0 0 * * *", "17 3 * * *"]
  site_worker_name          = coalesce(var.site_worker_script_name, local.env_slug == "prod" ? "${var.resource_prefix}-site-worker" : "${var.resource_prefix}-site-worker-${local.env_slug}")
  site_worker_module_name   = coalesce(var.site_worker_module_name, var.site_worker_module_path == null ? "site-worker.js" : basename(var.site_worker_module_path))

  worker_base_bindings = [
    {
      name        = "FP_DB"
      type        = "d1"
      database_id = cloudflare_d1_database.fleet.uuid
    },
    {
      name        = "FP_CONFIGS"
      type        = "r2_bucket"
      bucket_name = cloudflare_r2_bucket.configs.name
    },
    {
      name = "ENVIRONMENT"
      type = "plain_text"
      text = local.worker_environment_name
    },
    {
      name = "O11YFLEET_AI_GUIDANCE_PROVIDER"
      type = "plain_text"
      text = var.ai_guidance_provider
    },
    {
      name = "O11YFLEET_AI_GUIDANCE_MODEL"
      type = "plain_text"
      text = var.ai_guidance_model
    },
    {
      name = "O11YFLEET_AI_GUIDANCE_BASE_URL"
      type = "plain_text"
      text = var.ai_guidance_base_url
    },
    {
      name    = "FP_ANALYTICS"
      type    = "analytics_engine"
      dataset = var.worker_analytics_engine_dataset
    },
    {
      name = "CLOUDFLARE_ACCOUNT_ID"
      type = "plain_text"
      text = var.cloudflare_account_id
    },
    {
      name = "CLOUDFLARE_BILLING_ACCOUNT_ID"
      type = "plain_text"
      text = var.cloudflare_account_id
    },
    {
      name = "CLOUDFLARE_METRICS_ACCOUNT_ID"
      type = "plain_text"
      text = var.cloudflare_account_id
    },
    {
      name = "O11YFLEET_SIGNUP_AUTO_APPROVE"
      type = "plain_text"
      text = var.signup_auto_approve ? "true" : "false"
    },
    {
      name = "O11YFLEET_EMAIL_FROM"
      type = "plain_text"
      text = coalesce(var.email_from, "O11yFleet <noreply@o11yfleet.com>")
    },
    {
      name         = "CLOUDFLARE_EMAIL_SENDER"
      type         = "send_email"
      email_domain = local.api_domain
    },
  ]

  worker_durable_object_bindings = var.worker_include_durable_object_binding ? [
    {
      name        = "CONFIG_DO"
      type        = "durable_object_namespace"
      class_name  = "ConfigDurableObject"
      script_name = local.worker_name
    }
  ] : []

  worker_resource_bindings = concat(local.worker_base_bindings, local.worker_durable_object_bindings)

  worker_inherited_bindings = [
    for name in var.worker_inherited_binding_names : {
      name       = name
      type       = "inherit"
      version_id = "latest"
    }
  ]

  site_worker_bindings = [
    {
      name = "ASSETS"
      type = "assets"
    }
  ]
}
