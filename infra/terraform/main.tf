terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.52"
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

  site_domain  = coalesce(var.site_domain, local.env_slug == "prod" ? var.zone_name : "${local.env_slug}.${var.zone_name}")
  app_domain   = coalesce(var.app_domain, local.env_slug == "prod" ? "app.${var.zone_name}" : "${local.env_slug}-app.${var.zone_name}")
  admin_domain = coalesce(var.admin_domain, local.env_slug == "prod" ? "admin.${var.zone_name}" : "${local.env_slug}-admin.${var.zone_name}")
  api_domain   = coalesce(var.api_domain, local.env_slug == "prod" ? "api.${var.zone_name}" : "${local.env_slug}-api.${var.zone_name}")

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
}

resource "cloudflare_d1_database" "fleet" {
  account_id = var.cloudflare_account_id
  name       = local.d1_database_name
}

resource "cloudflare_r2_bucket" "configs" {
  account_id = var.cloudflare_account_id
  name       = local.r2_bucket_name
}

resource "cloudflare_queue" "events" {
  account_id = var.cloudflare_account_id
  name       = local.queue_name
}

resource "cloudflare_record" "api" {
  zone_id         = var.cloudflare_zone_id
  name            = local.api_domain
  type            = "AAAA"
  content         = "100::"
  proxied         = true
  allow_overwrite = true
  comment         = "Routes ${local.api_domain} to the ${var.worker_script_name} Worker"
}

resource "cloudflare_workers_route" "api" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "${local.api_domain}/*"
  script_name = var.worker_script_name
}

resource "cloudflare_pages_project" "pages" {
  for_each = local.pages_projects

  account_id        = var.cloudflare_account_id
  name              = each.value.name
  production_branch = var.production_branch
}

resource "cloudflare_pages_domain" "pages" {
  for_each = local.pages_domains

  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.pages[each.key].name
  domain       = each.value.domain
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

  destinations {
    type = "public"
    uri  = local.admin_domain
  }
}

resource "cloudflare_zero_trust_access_policy" "admin_allow" {
  count = var.enable_admin_access ? 1 : 0

  zone_id        = var.cloudflare_zone_id
  application_id = cloudflare_zero_trust_access_application.admin[0].id
  name           = "${local.name_prefix} admin allow"
  decision       = "allow"
  precedence     = 1

  dynamic "include" {
    for_each = length(local.admin_access_allowed_emails) > 0 ? [1] : []
    content {
      email = local.admin_access_allowed_emails
    }
  }

  dynamic "include" {
    for_each = length(local.admin_access_allowed_email_domains) > 0 ? [1] : []
    content {
      email_domain = local.admin_access_allowed_email_domains
    }
  }
}
