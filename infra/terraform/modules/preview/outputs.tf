output "worker_url" {
  description = "URL of the deployed preview worker"
  # Direct workers.dev access requires the account's subdomain (e.g. "o11yfleet"),
  # not the account ID. <account-id>.workers.dev only works as a proxy CNAME
  # target — it does not resolve in a browser.
  value = "https://${cloudflare_worker.preview.name}.${var.cloudflare_workers_subdomain}.workers.dev"
}

output "worker_name" {
  description = "Name of the preview worker"
  value       = cloudflare_worker.preview.name
}

output "d1_database_id" {
  description = "ID of the preview D1 database"
  value       = cloudflare_d1_database.preview.id
}

output "d1_database_uuid" {
  description = "UUID of the preview D1 database (for wrangler migrations)"
  value       = cloudflare_d1_database.preview.uuid
}

output "r2_bucket_name" {
  description = "Name of the preview R2 bucket"
  value       = cloudflare_r2_bucket.preview.name
}

output "env_name" {
  description = "Environment name used for naming"
  value       = local.env_name
}
