# Cloudflare Deployment Setup

## DNS Records Needed

Add these DNS records in the [Cloudflare Dashboard](https://dash.cloudflare.com/417e8c0fd8f1a64e9f2c4845afa6dc56) for zone `o11yfleet.com`:

### Worker API

| Type | Name  | Content | Proxy      |
| ---- | ----- | ------- | ---------- |
| AAAA | `api` | `100::` | ✅ Proxied |

This routes `api.o11yfleet.com` → Worker (`o11yfleet-worker`).

### Site (Cloudflare Pages custom domains)

Add these as **Custom Domains** in Pages > o11yfleet-site > Custom domains:

- `o11yfleet.com` — marketing site
- `app.o11yfleet.com` — user portal (root redirects to `/portal/overview`)
- `admin.o11yfleet.com` — admin portal (root redirects to `/admin/overview`)

Pages auto-creates CNAME records when you add custom domains.

## GitHub Secrets

Add these in GitHub repo Settings > Secrets and variables > Actions:

| Secret                  | Value                              | Notes                 |
| ----------------------- | ---------------------------------- | --------------------- |
| `CLOUDFLARE_API_TOKEN`  | (create in CF Dashboard)           | See permissions below |
| `CLOUDFLARE_ACCOUNT_ID` | `417e8c0fd8f1a64e9f2c4845afa6dc56` |                       |

### CF API Token Permissions

Create at Dashboard > My Profile > API Tokens > Create Token > Custom Token:

- **Zone > DNS > Edit** (for managing DNS records)
- **Zone > Zone > Read**
- **Account > Workers Scripts > Edit**
- **Account > D1 > Edit**
- **Account > R2 > Edit**
- **Account > Queues > Edit**
- **Account > Cloudflare Pages > Edit**

Zone resources: Include all zones in account.

## Analytics Engine

Enable at: https://dash.cloudflare.com/417e8c0fd8f1a64e9f2c4845afa6dc56/workers/analytics-engine

Then uncomment the `analytics_engine_datasets` block in `apps/worker/wrangler.jsonc` and redeploy.

## Current Resource IDs

| Resource             | ID                                     |
| -------------------- | -------------------------------------- |
| D1 Database (fp-db)  | `192ca9ca-bd47-4bd2-9321-fcdf62d9cf05` |
| Worker               | `o11yfleet-worker`                     |
| Pages Project        | `o11yfleet-site`                       |
| CF Account           | `417e8c0fd8f1a64e9f2c4845afa6dc56`     |
| Zone (o11yfleet.com) | `2650adcd696a6e400201a68323e90c5e`     |

## URLs

| Service              | URL                                            |
| -------------------- | ---------------------------------------------- |
| Worker (workers.dev) | https://o11yfleet-worker.o11yfleet.workers.dev |
| Worker (custom)      | https://api.o11yfleet.com                      |
| Site (pages.dev)     | https://o11yfleet-site.pages.dev               |
| Site (custom)        | https://o11yfleet.com                          |
| Portal (custom)      | https://app.o11yfleet.com                      |
| Admin (custom)       | https://admin.o11yfleet.com                    |
