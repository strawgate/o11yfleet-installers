# Account and zone IDs are stable identifiers, not secrets. Keep credentials
# such as CLOUDFLARE_DEPLOY_API_TOKEN and R2 state keys in GitHub environment secrets
# or local environment variables, never in committed tfvars.
cloudflare_account_id = "417e8c0fd8f1a64e9f2c4845afa6dc56"
cloudflare_zone_id    = "2650adcd696a6e400201a68323e90c5e"
environment           = "prod"

# Existing production data-bearing resources. Import these before first apply.
d1_database_name = "fp-db"
r2_bucket_name   = "fp-configs"

# Only inherit required Worker secrets for now. Add CLOUDFLARE_BILLING_API_TOKEN,
# CLOUDFLARE_METRICS_API_TOKEN, and O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY once
# those optional tokens are provisioned on the production worker.
worker_inherited_binding_names = [
  "O11YFLEET_API_BEARER_SECRET",
  "O11YFLEET_CLAIM_HMAC_SECRET",
  "O11YFLEET_SEED_ADMIN_EMAIL",
  "O11YFLEET_SEED_ADMIN_PASSWORD",
  "O11YFLEET_SEED_TENANT_USER_EMAIL",
  "O11YFLEET_SEED_TENANT_USER_PASSWORD",
]
