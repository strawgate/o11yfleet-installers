# Fleet (API) Worker — code, route, cron, version, deployment.

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
    for cron in var.worker_crons : {
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

  lifecycle {
    precondition {
      condition     = try(length(trimspace(var.worker_bundle_path)) > 0, false)
      error_message = "worker_bundle_path must be set when manage_worker_deployment is true."
    }
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

# Site (static-assets) Worker — code, routes, version, deployment.
# DNS records for the site live in dns.tf.

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
