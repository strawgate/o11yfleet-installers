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
  queue_name       = coalesce(var.queue_name, "${local.name_prefix}-events")
  worker_name      = coalesce(var.worker_script_name, local.env_slug == "prod" ? "${var.resource_prefix}-worker" : "${var.resource_prefix}-worker-${local.env_slug}")

  site_domain     = coalesce(var.site_domain, local.env_slug == "prod" ? var.zone_name : "${local.env_slug}.${var.zone_name}")
  app_domain      = coalesce(var.app_domain, local.env_slug == "prod" ? "app.${var.zone_name}" : "${local.env_slug}-app.${var.zone_name}")
  admin_domain    = coalesce(var.admin_domain, local.env_slug == "prod" ? "admin.${var.zone_name}" : "${local.env_slug}-admin.${var.zone_name}")
  api_domain      = coalesce(var.api_domain, local.env_slug == "prod" ? "api.${var.zone_name}" : "${local.env_slug}-api.${var.zone_name}")
  api_record_name = trimsuffix(local.api_domain, ".${var.zone_name}")

  admin_access_allowed_emails        = distinct(compact([for email in var.admin_access_allowed_emails : trimspace(email)]))
  admin_access_allowed_email_domains = distinct(compact([for domain in var.admin_access_allowed_email_domains : trimspace(domain)]))

  pages_projects = {
    site = {
      name   = coalesce(var.site_pages_project_name, "${local.name_prefix}-site")
      domain = local.site_domain
    }
    app = {
      name   = coalesce(var.app_pages_project_name, "${local.name_prefix}-app")
      domain = local.app_domain
    }
    admin = {
      name   = coalesce(var.admin_pages_project_name, "${local.name_prefix}-admin")
      domain = local.admin_domain
    }
  }

  pages_domains = {
    for key, project in local.pages_projects : key => project
    if contains(var.pages_custom_domains_to_attach, key)
  }

  worker_environment_name   = local.env_slug == "prod" ? "production" : local.env_slug
  worker_bundle_module_name = coalesce(var.worker_bundle_module_name, var.worker_bundle_path == null ? "index.js" : basename(var.worker_bundle_path))

  worker_resource_bindings = [
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
      name       = "FP_EVENTS"
      type       = "queue"
      queue_name = cloudflare_queue.events.queue_name
    },
    {
      name        = "CONFIG_DO"
      type        = "durable_object_namespace"
      class_name  = "ConfigDurableObject"
      script_name = local.worker_name
    },
    {
      name = "ENVIRONMENT"
      type = "plain_text"
      text = local.worker_environment_name
    },
    {
      name = "AI_GUIDANCE_PROVIDER"
      type = "plain_text"
      text = "minimax"
    },
    {
      name = "AI_GUIDANCE_MODEL"
      type = "plain_text"
      text = "MiniMax-M2.7"
    },
    {
      name = "AI_GUIDANCE_BASE_URL"
      type = "plain_text"
      text = "https://api.minimax.io/v1"
    },
    {
      name    = "FP_ANALYTICS"
      type    = "analytics_engine"
      dataset = var.worker_analytics_engine_dataset
    },
  ]

  worker_inherited_bindings = [
    for name in var.worker_inherited_binding_names : {
      name       = name
      type       = "inherit"
      version_id = "latest"
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

resource "cloudflare_queue" "events" {
  account_id = var.cloudflare_account_id
  queue_name = local.queue_name

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

resource "cloudflare_workers_route" "api" {
  zone_id = var.cloudflare_zone_id
  pattern = "${local.api_domain}/*"
  script  = cloudflare_worker.fleet.name
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

  migrations = {
    new_tag            = var.worker_durable_object_migration_tag
    new_sqlite_classes = ["ConfigDurableObject"]
  }

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

resource "cloudflare_queue_consumer" "events" {
  account_id  = var.cloudflare_account_id
  queue_id    = cloudflare_queue.events.queue_id
  type        = "worker"
  script_name = cloudflare_worker.fleet.name

  settings = {
    batch_size       = var.worker_queue_consumer_batch_size
    max_wait_time_ms = var.worker_queue_consumer_max_wait_time_ms
  }
}

resource "cloudflare_pages_project" "pages" {
  for_each = local.pages_projects

  account_id        = var.cloudflare_account_id
  name              = each.value.name
  production_branch = var.production_branch

  deployment_configs = {
    production = {
      always_use_latest_compatibility_date = false
      compatibility_date                   = var.pages_functions_compatibility_date
      compatibility_flags                  = []
      d1_databases                         = {}
      durable_object_namespaces            = {}
      environment_variables                = {}
      fail_open                            = false
      kv_namespaces                        = {}
      r2_buckets                           = {}
      secrets                              = {}
    }

    preview = {
      always_use_latest_compatibility_date = false
      compatibility_date                   = var.pages_functions_compatibility_date
      compatibility_flags                  = []
      d1_databases                         = {}
      durable_object_namespaces            = {}
      environment_variables                = {}
      fail_open                            = false
      kv_namespaces                        = {}
      r2_buckets                           = {}
      secrets                              = {}
    }
  }
}

resource "cloudflare_pages_domain" "pages" {
  for_each = local.pages_domains

  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.pages[each.key].name
  name         = each.value.domain
}

resource "cloudflare_zero_trust_access_application" "admin" {
  count = var.enable_admin_access ? 1 : 0

  zone_id                    = var.cloudflare_zone_id
  name                       = "${local.name_prefix} admin"
  domain                     = local.admin_domain
  type                       = "self_hosted"
  session_duration           = var.admin_access_session_duration
  app_launcher_visible       = true
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"

  destinations = [
    {
      type = "public"
      uri  = local.admin_domain
    }
  ]

  policies = [
    {
      name       = "${local.name_prefix} admin allow"
      decision   = "allow"
      precedence = 1
      include = concat(
        [
          for email in local.admin_access_allowed_emails : {
            email = {
              email = email
            }
            email_domain = null
          }
        ],
        [
          for domain in local.admin_access_allowed_email_domains : {
            email = null
            email_domain = {
              domain = domain
            }
          }
        ],
      )
    }
  ]
}
