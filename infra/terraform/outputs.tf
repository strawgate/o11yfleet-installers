output "d1_database_id" {
  value       = cloudflare_d1_database.fleet.uuid
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

output "api_domain" {
  value       = local.api_domain
  description = "API hostname routed to the Worker."
}

output "worker_name" {
  value       = cloudflare_worker.fleet.name
  description = "Worker script identity managed by Terraform."
}

output "worker_deployment_id" {
  value       = var.manage_worker_deployment ? cloudflare_workers_deployment.fleet[0].id : null
  description = "Active Terraform-managed Worker deployment ID when manage_worker_deployment is enabled."
}

output "site_worker_name" {
  value       = cloudflare_worker.site.name
  description = "Static-assets Worker script identity managed by Terraform."
}

output "site_worker_deployment_id" {
  value       = var.manage_site_deployment ? cloudflare_workers_deployment.site[0].id : null
  description = "Active Terraform-managed static-assets Worker deployment ID when manage_site_deployment is enabled."
}

output "site_surfaces" {
  value = {
    for key, surface in local.site_surfaces : key => {
      domain = surface.domain
      route  = try(cloudflare_workers_route.site[key].pattern, null)
    }
  }
  description = "Static site surfaces routed to the static-assets Worker."
}

