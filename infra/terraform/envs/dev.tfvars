# Dev currently shares the canonical Cloudflare account and zone, but all
# stateful resources and hostnames are environment-prefixed. Move these IDs to
# a dedicated account/zone if dev needs account-level isolation.
cloudflare_account_id = "417e8c0fd8f1a64e9f2c4845afa6dc56"
cloudflare_zone_id    = "2650adcd696a6e400201a68323e90c5e"
environment           = "dev"
