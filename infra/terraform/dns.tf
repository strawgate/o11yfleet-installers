resource "cloudflare_dns_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = local.api_record_name
  type    = "AAAA"
  content = "100::"
  ttl     = 1
  proxied = true
  comment = "Routes ${local.api_domain} to the ${local.worker_name} Worker"
}

resource "cloudflare_dns_record" "site" {
  for_each = local.site_dns_records

  zone_id = var.cloudflare_zone_id
  name    = each.value.record_name
  type    = "CNAME"
  content = "${cloudflare_worker.site.name}.${var.cloudflare_account_id}.workers.dev"
  ttl     = 1
  proxied = true
  comment = "Routes ${each.value.domain} to the ${cloudflare_worker.site.name} static-assets Worker"
}
