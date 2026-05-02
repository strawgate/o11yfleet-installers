terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
  }

  backend "s3" {}
}

provider "cloudflare" {}

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

resource "cloudflare_d1_database" "fleet" {
  account_id = var.cloudflare_account_id
  name       = local.d1_database_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "configs" {
  account_id = var.cloudflare_account_id
  name       = local.r2_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = local.api_record_name
  type    = "AAAA"
  content = "100::"
  ttl     = 1
  proxied = true
  comment = "Routes ${local.api_domain} to the ${local.worker_name} Worker"
}

resource "cloudflare_worker" "fleet" {
  account_id = var.cloudflare_account_id
  name       = local.worker_name

  subdomain = {
    enabled          = var.worker_subdomain_enabled
    previews_enabled = var.worker_subdomain_previews_enabled
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_workers_cron_trigger" "fleet" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.fleet.name

  schedules = [
    for cron in local.worker_crons : {
      cron = cron
    }
  ]

  depends_on = [cloudflare_workers_deployment.fleet]
}

resource "cloudflare_workers_route" "api" {
  zone_id = var.cloudflare_zone_id
  pattern = "${local.api_domain}/*"
  script  = cloudflare_worker.fleet.name

  depends_on = [cloudflare_workers_deployment.fleet]
}

resource "cloudflare_worker_version" "fleet" {
  count = var.manage_worker_deployment ? 1 : 0

  account_id          = var.cloudflare_account_id
  worker_id           = cloudflare_worker.fleet.id
  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = var.worker_compatibility_flags
  main_module         = local.worker_bundle_module_name

  modules = [
    {
      name         = local.worker_bundle_module_name
      content_type = var.worker_bundle_content_type
      content_file = var.worker_bundle_path
    }
  ]

  bindings = concat(local.worker_resource_bindings, local.worker_inherited_bindings)

  migrations = var.worker_include_durable_object_migration ? {
    new_tag            = var.worker_durable_object_migration_tag
    new_sqlite_classes = ["ConfigDurableObject"]
  } : null

  annotations = {
    workers_message = "Terraform-managed o11yFleet Worker version"
  }
}

resource "cloudflare_workers_deployment" "fleet" {
  count = var.manage_worker_deployment ? 1 : 0

  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.fleet.name
  strategy    = "percentage"

  versions = [
    {
      version_id = cloudflare_worker_version.fleet[0].id
      percentage = 100
    }
  ]

  annotations = {
    workers_message = "Terraform-managed o11yFleet Worker deployment"
  }
}

resource "cloudflare_worker" "site" {
  account_id = var.cloudflare_account_id
  name       = local.site_worker_name

  subdomain = {
    enabled          = var.site_worker_subdomain_enabled
    previews_enabled = var.site_worker_subdomain_previews_enabled
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "site" {
  for_each = local.site_dns_records

  zone_id  = var.cloudflare_zone_id
  name     = each.value.record_name
  type     = "CNAME"
  content  = "${cloudflare_worker.site.name}.${var.cloudflare_account_id}.workers.dev"
  ttl      = 1
  proxied  = true
  comment  = "Routes ${each.value.domain} to the ${cloudflare_worker.site.name} static-assets Worker"
}

resource "cloudflare_workers_route" "site" {
  for_each = local.site_surfaces

  zone_id = var.cloudflare_zone_id
  pattern = "${each.value.domain}/*"
  script  = cloudflare_worker.site.name

  depends_on = [cloudflare_workers_deployment.site]
}

resource "cloudflare_worker_version" "site" {
  count = var.manage_site_deployment ? 1 : 0

  account_id          = var.cloudflare_account_id
  worker_id           = cloudflare_worker.site.id
  compatibility_date  = var.site_worker_compatibility_date
  compatibility_flags = var.site_worker_compatibility_flags
  main_module         = local.site_worker_module_name

  modules = [
    {
      name         = local.site_worker_module_name
      content_type = var.site_worker_module_content_type
      content_file = var.site_worker_module_path
    },
    {
      name         = "_headers"
      content_type = "text/plain"
      content_file = var.site_headers_path
    }
  ]

  assets = {
    directory = var.site_assets_directory
    config = {
      not_found_handling = "single-page-application"
      run_worker_first   = ["/", "/portal/*", "/admin/*", "/*.html"]
    }
  }

  bindings = local.site_worker_bindings

  annotations = {
    workers_message = "Terraform-managed o11yFleet static site Worker version"
  }

  lifecycle {
    precondition {
      condition     = try(length(trimspace(var.site_assets_directory)) > 0, false)
      error_message = "site_assets_directory must be set when manage_site_deployment is true."
    }
    precondition {
      condition     = try(length(trimspace(var.site_worker_module_path)) > 0, false)
      error_message = "site_worker_module_path must be set when manage_site_deployment is true."
    }
    precondition {
      condition     = try(length(trimspace(var.site_headers_path)) > 0, false)
      error_message = "site_headers_path must be set when manage_site_deployment is true."
    }
  }
}

resource "cloudflare_workers_deployment" "site" {
  count = var.manage_site_deployment ? 1 : 0

  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.site.name
  strategy    = "percentage"

  versions = [
    {
      version_id = cloudflare_worker_version.site[0].id
      percentage = 100
    }
  ]

  annotations = {
    workers_message = "Terraform-managed o11yFleet static site Worker deployment"
  }
}
