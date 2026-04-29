output "d1_database_id" {
  value       = cloudflare_d1_database.fleet.id
  description = "D1 database ID for Wrangler FP_DB binding."
}

output "d1_database_name" {
  value       = cloudflare_d1_database.fleet.name
  description = "D1 database name for Wrangler FP_DB binding."
}

output "r2_bucket_name" {
  value       = cloudflare_r2_bucket.configs.name
  description = "R2 bucket name for Wrangler FP_CONFIGS binding."
}

output "r2_bucket_id" {
  value       = cloudflare_r2_bucket.configs.id
  description = "R2 bucket Terraform/provider ID."
}

output "queue_name" {
  value       = cloudflare_queue.events.name
  description = "Queue name for Wrangler FP_EVENTS producer and consumer bindings."
}

output "queue_id" {
  value       = cloudflare_queue.events.id
  description = "Queue Terraform/provider ID."
}

output "api_domain" {
  value       = local.api_domain
  description = "API hostname routed to the Worker."
}

output "pages_projects" {
  value = {
    for key, project in cloudflare_pages_project.pages : key => {
      name                   = project.name
      subdomain              = project.subdomain
      intended_domain        = local.pages_projects[key].domain
      custom_domain_attached = contains(var.pages_custom_domains_to_attach, key)
    }
  }
  description = "Pages projects and domains managed by Terraform."
}

output "admin_access_application_id" {
  value       = var.enable_admin_access ? cloudflare_zero_trust_access_application.admin[0].id : null
  description = "Cloudflare Access application ID for admin."
}

output "admin_access_aud" {
  value       = var.enable_admin_access ? cloudflare_zero_trust_access_application.admin[0].aud : null
  description = "Cloudflare Access AUD tag for admin."
}
