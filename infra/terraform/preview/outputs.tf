output "worker_url" {
  description = "URL of the deployed preview worker"
  value       = module.preview.worker_url
}

output "d1_database_uuid" {
  description = "UUID of the preview D1 database"
  value       = module.preview.d1_database_uuid
}

output "env_name" {
  description = "Environment name"
  value       = module.preview.env_name
}
