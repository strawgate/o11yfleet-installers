cloudflare_account_id = "417e8c0fd8f1a64e9f2c4845afa6dc56"
cloudflare_zone_id    = "2650adcd696a6e400201a68323e90c5e"
environment           = "prod"

# Existing production data-bearing resources. Import these before first apply.
d1_database_name = "fp-db"
r2_bucket_name   = "fp-configs"
queue_name       = "fp-events"

# Keep the existing marketing project name during adoption; app/admin are new split targets.
site_pages_project_name  = "o11yfleet-site"
app_pages_project_name   = "o11yfleet-app"
admin_pages_project_name = "o11yfleet-admin"

# The deploy workflows publish the same SPA bundle to all three split Pages
# projects, so Terraform can move each custom hostname to its target project.
pages_custom_domains_to_attach = ["site", "app", "admin"]

# Enable after the Access identity allow-list is final.
enable_admin_access = false
