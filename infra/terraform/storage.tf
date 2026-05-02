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
