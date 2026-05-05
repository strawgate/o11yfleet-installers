#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/bootstrap-cloudflare-credentials.sh [options]

Creates per-environment Cloudflare infrastructure with:
- Per-environment R2 buckets for Terraform state isolation
- Per-environment tfstate workers with isolated credentials
- Per-environment tokens with least-privilege permissions:
  - TERRAFORM_READONLY_TOKEN: Workers Read, D1 Read, R2 Read, Account Settings Read (plan only)
  - TERRAFORM_DEPLOY_TOKEN: Workers Write, D1 Write, R2 Write, DNS Write, Workers Routes Write, Account Settings Read (deploy)

Defaults to dry-run. Pass --apply to create resources and write GitHub secrets.
Secret values are never printed.

Options:
  --apply                 Create tokens, buckets, workers, and write GitHub secrets.
  --envs "dev staging"    Space-separated env list. Default: dev staging prod.
  --env-file PATH         Bootstrap env file. Default: ~/Documents/repos/cloudflare/.env
  --repo OWNER/REPO       GitHub repo. Default: detected by gh.
  --tfstate-worker-dir    Path to tfstate-worker directory. Default: infra/tfstate-worker.
  --skip-buckets          Skip R2 bucket creation (use existing buckets).
  --skip-workers          Skip tfstate worker deployment.
  --analytics-sql-tokens  Create Analytics Engine SQL API tokens.
  --preview               Alias for --envs preview.
  -h, --help              Show this help.

Required bootstrap env:
  CLOUDFLARE_BOOTSTRAP_API_TOKEN or CLOUDFLARE_API_TOKEN
  or CLOUDFLARE_EMAIL plus CLOUDFLARE_GLOBAL_API_KEY/CLOUDFLARE_API_KEY

Optional env:
  CLOUDFLARE_ACCOUNT_ID
USAGE
}

APPLY=false
TARGET_ENVS="dev staging prod"
ENV_FILE="${HOME}/Documents/repos/cloudflare/.env"
REPO=""
TFSTATE_WORKER_DIR="infra/tfstate-worker"
SKIP_BUCKETS=false
SKIP_WORKERS=false
ANALYTICS_SQL_TOKENS=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=true
      shift
      ;;
    --envs)
      TARGET_ENVS="${2:?--envs requires a value}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:?--env-file requires a value}"
      shift 2
      ;;
    --repo)
      REPO="${2:?--repo requires a value}"
      shift 2
      ;;
    --tfstate-worker-dir)
      TFSTATE_WORKER_DIR="${2:?--tfstate-worker-dir requires a value}"
      shift 2
      ;;
    --skip-buckets)
      SKIP_BUCKETS=true
      shift
      ;;
    --skip-workers)
      SKIP_WORKERS=true
      shift
      ;;
    --analytics-sql-tokens)
      ANALYTICS_SQL_TOKENS=true
      shift
      ;;
    --preview)
      TARGET_ENVS="preview"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Environment name normalization
normalize_env_name() {
  case "$1" in
    prod|production) printf '%s\n' "prod" ;;
    staging) printf '%s\n' "staging" ;;
    dev|development) printf '%s\n' "dev" ;;
    preview) printf '%s\n' "preview" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

# GitHub environment name
github_env_name() {
  case "$1" in
    prod) printf '%s\n' "production" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

env_file_names() {
  [ -r "$ENV_FILE" ] || return 0
  sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$ENV_FILE" | sort -u
}

die_missing_bootstrap_credentials() {
  {
    printf 'error: Cloudflare bootstrap credentials were not found after loading %s\n' "$ENV_FILE"
    printf '\n'
    printf 'Add one of these credential forms to the env file, or export it before running:\n'
    printf '  - CLOUDFLARE_BOOTSTRAP_API_TOKEN=<api-token-with-api-tokens-write>\n'
    printf '  - CLOUDFLARE_API_TOKEN=<api-token-with-api-tokens-write>\n'
    printf '  - CLOUDFLARE_EMAIL=<login-email> plus CLOUDFLARE_GLOBAL_API_KEY=<global-api-key>\n'
    printf '  - CLOUDFLARE_EMAIL=<login-email> plus CLOUDFLARE_API_KEY=<global-api-key>\n'
    printf '\n'
    printf 'Detected variable names in the env file, values hidden:\n'
    detected="$(env_file_names)"
    if [ -n "$detected" ]; then
      printf '%s\n' "$detected" | sed 's/^/  - /'
    else
      printf '  - none\n'
    fi
  } >&2
  exit 1
}

tfvar_value() {
  env_name="$1"
  key="$2"
  awk -v key="$key" '
    $1 == key && $2 == "=" {
      value = $3
      gsub(/^"/, "", value)
      gsub(/"$/, "", value)
      print value
      exit
    }
  ' "infra/terraform/envs/${env_name}.tfvars"
}

generate_password() {
  openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64
}

cf_api() {
  method="$1"
  path="$2"
  body="${3:-}"
  auth_headers=()
  if [ -n "$BOOTSTRAP_TOKEN" ]; then
    auth_headers+=(--header "Authorization: Bearer ${BOOTSTRAP_TOKEN}")
  else
    auth_headers+=(--header "X-Auth-Email: ${BOOTSTRAP_EMAIL}")
    auth_headers+=(--header "X-Auth-Key: ${BOOTSTRAP_KEY}")
  fi
  if [ -n "$body" ]; then
    curl -fsS \
      --request "$method" \
      "${auth_headers[@]}" \
      --header "Content-Type: application/json" \
      --data "$body" \
      "https://api.cloudflare.com/client/v4${path}"
  else
    curl -fsS \
      --request "$method" \
      "${auth_headers[@]}" \
      "https://api.cloudflare.com/client/v4${path}"
  fi
}

resolve_permission_group_id() {
  groups_json="$1"
  scope="$2"
  candidates="$3"
  id="$(
    jq -r --arg scope "$scope" --arg candidates "$candidates" '
      ($candidates | split("|")) as $names
      | .result
      | ..
      | objects
      | select(has("id") and has("name"))
      | . as $group
      | select($names | index($group.name))
      | select(
          if (.scopes? | type) == "array" then
            (.scopes | index($scope))
          elif (.scopes? | type) == "string" then
            .scopes == $scope
          elif (.scope? | type) == "string" then
            .scope == $scope
          else
            false
          end
        )
      | .id
    ' <<<"$groups_json" | head -n 1
  )"
  [ -n "$id" ] && [ "$id" != "null" ] || die "Cloudflare permission group not found: ${candidates} (${scope})"
  printf '%s\n' "$id"
}

permission_group_objects() {
  for id in "$@"; do
    printf '%s\n' "$id"
  done | jq -R '{id: .}' | jq -s .
}

create_token() {
  name="$1"
  policies_json="$2"
  payload="$(jq -n --arg name "$name" --argjson policies "$policies_json" \
    '{name: $name, policies: $policies}')"
  response="$(cf_api POST "/user/tokens" "$payload")"
  jq -e '.success == true' >/dev/null <<<"$response" || {
    jq '.errors' <<<"$response" >&2
    die "failed to create Cloudflare token ${name}"
  }
  printf '%s\n' "$response"
}

ensure_r2_bucket() {
  bucket_name="$1"
  existing="$(cf_api GET "/accounts/${ACCOUNT_ID}/r2/buckets/${bucket_name}")"
  if jq -e '.success == true' <<<"$existing" >/dev/null 2>&1; then
    log "  R2 bucket ${bucket_name} already exists"
    return 0
  fi
  
  response="$(cf_api POST "/accounts/${ACCOUNT_ID}/r2/buckets" \
    "$(jq -n --arg name "$bucket_name" '{name: $name}')")"
  if jq -e '.success == true' <<<"$response" >/dev/null 2>&1; then
    log "  created R2 bucket ${bucket_name}"
  else
    jq '.errors' <<<"$response" >&2
    die "failed to create R2 bucket ${bucket_name}"
  fi
}

set_github_secret() {
  env_name="$1"
  name="$2"
  value="$3"
  if [ "$APPLY" = true ]; then
    printf '%s' "$value" | gh secret set "$name" --repo "$REPO" --env "$env_name" >/dev/null
  fi
  log "  github environment ${env_name}: set ${name}"
}

set_github_env_variable() {
  env_name="$1"
  name="$2"
  value="$3"
  if [ "$APPLY" = true ]; then
    gh variable set "$name" --repo "$REPO" --env "$env_name" --body "$value" 2>/dev/null || true
  fi
  log "  github environment ${env_name}: set variable ${name}"
}

ensure_github_environment() {
  env_name="$1"
  gh api -X PUT "repos/${REPO}/environments/${env_name}" >/dev/null 2>&1
  log "  github environment ${env_name}: verified"
}

deploy_tfstate_worker() {
  env="$1"
  bucket_name="$2"
  username="$3"
  password="$4"
  
  worker_name="o11yfleet-tfstate-${env}"
  wrangler_config="${TFSTATE_WORKER_DIR}/wrangler-${env}.toml"
  
  cat > "$wrangler_config" <<EOF
name = "${worker_name}"
account_id = "${ACCOUNT_ID}"
compatibility_date = "2026-04-29"
compatibility_flags = ["nodejs_compat"]

main = "src/index.ts"

workers_dev = true

r2_buckets = [
    { binding = "TFSTATE_BUCKET", bucket_name = "${bucket_name}" },
]

[durable_objects]
bindings = [{ name = "TFSTATE_LOCK", class_name = "DurableLock" }]

[[migrations]]
tag = "v1"
new_classes = ["DurableLock"]
EOF

  if [ "$APPLY" = true ]; then
    pushd "$TFSTATE_WORKER_DIR" > /dev/null
    
    log "  deploying tfstate worker ${worker_name}..."
    npx wrangler deploy --env "$env" 2>&1 || {
      popd > /dev/null
      die "failed to deploy tfstate worker for ${env}"
    }
    
    popd > /dev/null
    
    echo "$username" | npx wrangler secret put USERNAME --env "$env" 2>/dev/null || true
    echo "$password" | npx wrangler secret put PASSWORD --env "$env" 2>/dev/null || true
    
    worker_url="https://${worker_name}.${ACCOUNT_ID}.workers.dev"
    log "  tfstate worker URL: ${worker_url}"
    
    echo "$worker_url"
  else
    echo "https://${worker_name}.${ACCOUNT_ID}.workers.dev"
  fi
}

# =============================================================================
# MAIN
# =============================================================================

require_command jq
require_command curl
require_command gh

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

if [ "$APPLY" = true ]; then
  [ -r "$ENV_FILE" ] || die "bootstrap env file is not readable: ${ENV_FILE}"
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

BOOTSTRAP_TOKEN="${CLOUDFLARE_BOOTSTRAP_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
BOOTSTRAP_KEY="${CLOUDFLARE_GLOBAL_API_KEY:-${CLOUDFLARE_API_KEY:-}}"
BOOTSTRAP_EMAIL="${CLOUDFLARE_EMAIL:-}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"

if [ "$APPLY" = true ]; then
  if [ -z "$BOOTSTRAP_TOKEN" ] && { [ -z "$BOOTSTRAP_KEY" ] || [ -z "$BOOTSTRAP_EMAIL" ]; }; then
    die_missing_bootstrap_credentials
  fi
  [ -n "$ACCOUNT_ID" ] || die "CLOUDFLARE_ACCOUNT_ID is required"
fi

log ""
log "=============================================="
log "o11yfleet Bootstrap - Per-Environment Isolation"
log "=============================================="
log "Repository: ${REPO}"
log "Account ID: ${ACCOUNT_ID:-<not set>}"
log "Target environments: ${TARGET_ENVS}"
log "TFSTATE worker dir: ${TFSTATE_WORKER_DIR}"
log ""

if [ "$APPLY" = false ]; then
  log "*** DRY RUN - no changes will be made ***"
  log "Re-run with --apply to create resources and secrets."
  log ""
fi

# Resolve permission groups
if [ "$APPLY" = true ]; then
  log "Resolving Cloudflare permission groups..."
  GROUPS_JSON="$(cf_api GET "/user/tokens/permission_groups")"

  # Write permissions (deploy token)
  ACCOUNT_WORKERS_SCRIPTS_WRITE_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Workers Scripts Write|Workers Scripts Edit")"
  ACCOUNT_D1_WRITE_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "D1 Write|D1 Edit")"
  ACCOUNT_R2_WRITE_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Workers R2 Storage Write|Workers R2 Storage Edit")"
  
  # Read permissions (readonly token)
  ACCOUNT_WORKERS_SCRIPTS_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Workers Scripts Read")"
  ACCOUNT_D1_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "D1 Read")"
  ACCOUNT_R2_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Workers R2 Storage Read")"
  
  # Common
  ACCOUNT_SETTINGS_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Account Settings Read")"
  
  # Zone-level
  ZONE_DNS_WRITE_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account.zone" "DNS Write|DNS Edit")"
  ZONE_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account.zone" "Zone Read")"
  ZONE_WORKERS_ROUTES_WRITE_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account.zone" "Workers Routes Write|Workers Routes Edit")"
  
  # R2 bucket
  R2_BUCKET_ITEM_WRITE_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.edge.r2.bucket" "Workers R2 Storage Bucket Item Write")"
  
  # Pages (for preview)
  ACCOUNT_PAGES_WRITE_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Pages Write")"
  
  # Analytics
  if [ "$ANALYTICS_SQL_TOKENS" = true ]; then
    ACCOUNT_ANALYTICS_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Analytics Read|Account Analytics Read")"
    D1_ANALYTICS_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "D1 Analytics Read|D1 Read")"
  fi
  
  log "  permission groups resolved"
fi

# Process each environment
for target_env in $TARGET_ENVS; do
  env="$(normalize_env_name "$target_env")"
  gh_env="$(github_env_name "$env")"
  
  log ""
  log "=============================================="
  log "Environment: ${env} (GitHub: ${gh_env})"
  log "=============================================="
  
  if [ "$env" = "preview" ]; then
    env_account_id="${CLOUDFLARE_ACCOUNT_ID:-${ACCOUNT_ID:-}}"
    env_zone_id=""
    has_zone=false
  else
    env_account_id="$(tfvar_value "$env" cloudflare_account_id 2>/dev/null || echo "$ACCOUNT_ID")"
    env_zone_id="$(tfvar_value "$env" cloudflare_zone_id 2>/dev/null || echo "")"
    [ -n "$env_zone_id" ] && has_zone=true || has_zone=false
  fi
  
  [ -n "$env_account_id" ] || env_account_id="$ACCOUNT_ID"
  [ -n "$env_account_id" ] || die "missing Cloudflare account id for ${env}"
  
  log "  account: ${env_account_id}"
  log "  zone: ${env_zone_id:-none}"
  
  if [ "$APPLY" = true ]; then
    ensure_github_environment "$gh_env"
  fi
  
  # =============================================================================
  # R2 BUCKETS
  # =============================================================================
  bucket_name="o11yfleet-tfstate-${env}"
  
  if [ "$SKIP_BUCKETS" = false ]; then
    log ""
    log "  R2 Bucket:"
    if [ "$APPLY" = false ]; then
      log "    would create/verify bucket: ${bucket_name}"
    else
      ensure_r2_bucket "$bucket_name"
    fi
  else
    log "  R2 Bucket: skipped (--skip-buckets)"
  fi
  
  # =============================================================================
  # TFSTATE WORKER (not used for preview - preview has its own R2 bucket)
  # =============================================================================
  if [ "$SKIP_WORKERS" = false ] && [ "$env" != "preview" ]; then
    log ""
    log "  TFSTATE Worker:"
    worker_username="$(printf '%s' "$env")"
    worker_password="$(generate_password)"
    
    if [ "$APPLY" = false ]; then
      log "    would deploy worker: o11yfleet-tfstate-${env}"
      log "    would bind to bucket: ${bucket_name}"
      log "    would set USERNAME/PASSWORD secrets"
      worker_url="https://o11yfleet-tfstate-${env}.${env_account_id}.workers.dev"
      log "    worker URL: ${worker_url}"
    else
      worker_url="$(deploy_tfstate_worker "$env" "$bucket_name" "$worker_username" "$worker_password")"
      set_github_env_variable "$gh_env" "TFSTATE_WORKER_URL" "$worker_url"
      set_github_secret "$gh_env" "TFSTATE_USERNAME" "$worker_username"
      set_github_secret "$gh_env" "TFSTATE_PASSWORD" "$worker_password"
    fi
  else
    log "  TFSTATE Worker: skipped (preview uses its own R2 bucket)"
  fi
  
  # =============================================================================
  # TFSTATE SECRETS FOR PREVIEW (use shared R2, not per-env worker)
  # =============================================================================
  if [ "$env" = "preview" ]; then
    log ""
    log "  Preview TFSTATE (uses shared R2 bucket, not tfstate worker):"
    preview_tfstate_username="preview"
    preview_tfstate_password="$(generate_password)"
    # Preview uses the shared R2 bucket - set credentials for it
    if [ "$APPLY" = false ]; then
      log "    would set TFSTATE_USERNAME/TFSTATE_PASSWORD secrets"
      log "    (uses shared o11yfleet-terraform-state R2 bucket)"
    else
      # The preview R2 bucket is shared, we don't need separate creds
      # but we set them for consistency in case preview needs tfstate worker later
      set_github_secret "$gh_env" "TFSTATE_USERNAME" "$preview_tfstate_username"
      set_github_secret "$gh_env" "TFSTATE_PASSWORD" "$preview_tfstate_password"
    fi
  fi
  
  # =============================================================================
  # TOKENS
  # =============================================================================
  suffix="$(date -u +%Y%m%dT%H%M%SZ)"
  
  # --- TERRAFORM_READONLY_TOKEN ---
  # Read-only permissions for plan jobs
  log ""
  log "  TERRAFORM_READONLY_TOKEN (plan jobs only):"
  readonly_account_groups="$(permission_group_objects "$ACCOUNT_WORKERS_SCRIPTS_READ_ID" "$ACCOUNT_D1_READ_ID" "$ACCOUNT_R2_READ_ID" "$ACCOUNT_SETTINGS_READ_ID")"
  readonly_policies="$(
    jq -n \
      --arg account_resource "com.cloudflare.api.account.${env_account_id}" \
      --argjson account_groups "$readonly_account_groups" \
      '[
        {
          effect: "allow",
          resources: {($account_resource): "*"},
          permission_groups: $account_groups
        }
      ]'
  )"
  
  if [ "$APPLY" = false ]; then
    log "    would create token: o11yfleet ${env} terraform-readonly ${suffix}"
    log "    scope: Workers Read, D1 Read, R2 Read, Account Settings Read"
  else
    readonly_response="$(create_token "o11yfleet ${env} terraform-readonly ${suffix}" "$readonly_policies")"
    readonly_token="$(jq -r '.result.value' <<<"$readonly_response")"
    [ -n "$readonly_token" ] && [ "$readonly_token" != "null" ] || die "failed to create TERRAFORM_READONLY_TOKEN for ${env}"
    set_github_secret "$gh_env" TERRAFORM_READONLY_TOKEN "$readonly_token"
  fi
  
  # --- TERRAFORM_DEPLOY_TOKEN ---
  # Write permissions for apply/deploy jobs (app + site via terraform + wrangler)
  log ""
  log "  TERRAFORM_DEPLOY_TOKEN (apply/deploy jobs):"
  deploy_account_groups="$(permission_group_objects "$ACCOUNT_WORKERS_SCRIPTS_WRITE_ID" "$ACCOUNT_D1_WRITE_ID" "$ACCOUNT_R2_WRITE_ID" "$ACCOUNT_PAGES_WRITE_ID" "$ACCOUNT_SETTINGS_READ_ID")"
  
  if [ "$has_zone" = true ]; then
    zone_groups="$(permission_group_objects "$ZONE_DNS_WRITE_ID" "$ZONE_READ_ID" "$ZONE_WORKERS_ROUTES_WRITE_ID")"
    deploy_policies="$(
      jq -n \
        --arg account_resource "com.cloudflare.api.account.${env_account_id}" \
        --arg zone_resource "com.cloudflare.api.account.zone.${env_zone_id}" \
        --argjson account_groups "$deploy_account_groups" \
        --argjson zone_groups "$zone_groups" \
        '[
          {
            effect: "allow",
            resources: {($account_resource): "*"},
            permission_groups: $account_groups
          },
          {
            effect: "allow",
            resources: {($zone_resource): "*"},
            permission_groups: $zone_groups
          }
        ]'
    )"
  else
    deploy_policies="$(
      jq -n \
        --arg account_resource "com.cloudflare.api.account.${env_account_id}" \
        --argjson account_groups "$deploy_account_groups" \
        '[
          {
            effect: "allow",
            resources: {($account_resource): "*"},
            permission_groups: $account_groups
          }
        ]'
    )"
  fi
  
  if [ "$APPLY" = false ]; then
    log "    would create token: o11yfleet ${env} terraform-deploy ${suffix}"
    log "    scope: Workers Write, D1 Write, R2 Write, DNS Write, Workers Routes Write, Account Settings Read"
  else
    deploy_response="$(create_token "o11yfleet ${env} terraform-deploy ${suffix}" "$deploy_policies")"
    deploy_token="$(jq -r '.result.value' <<<"$deploy_response")"
    [ -n "$deploy_token" ] && [ "$deploy_token" != "null" ] || die "failed to create TERRAFORM_DEPLOY_TOKEN for ${env}"
    set_github_secret "$gh_env" TERRAFORM_DEPLOY_TOKEN "$deploy_token"
  fi
  
  # --- CLOUDFLARE_ACCOUNT_ID ---
  log ""
  log "  CLOUDFLARE_ACCOUNT_ID:"
  set_github_secret "$gh_env" CLOUDFLARE_ACCOUNT_ID "$env_account_id"
  
  # --- ANALYTICS_SQL_TOKENS ---
  if [ "$ANALYTICS_SQL_TOKENS" = true ]; then
    log ""
    log "  Analytics SQL Tokens:"
    analytics_account_resource="com.cloudflare.api.account.${env_account_id}"
    analytics_sql_groups="$(permission_group_objects "$ACCOUNT_ANALYTICS_READ_ID" "$D1_ANALYTICS_READ_ID")"
    analytics_sql_policies="$(
      jq -n \
        --arg account_resource "$analytics_account_resource" \
        --argjson analytics_sql_groups "$analytics_sql_groups" \
        '[
          {
            effect: "allow",
            resources: {($account_resource): "*"},
            permission_groups: $analytics_sql_groups
          }
        ]'
    )"
    
    if [ "$APPLY" = false ]; then
      log "    would create token: o11yfleet ${env} analytics-sql ${suffix}"
      log "    scope: Account Analytics, D1 Analytics"
    else
      analytics_sql_response="$(create_token "o11yfleet ${env} analytics-sql ${suffix}" "$analytics_sql_policies")"
      analytics_sql_token="$(jq -r '.result.value' <<<"$analytics_sql_response")"
      [ -n "$analytics_sql_token" ] && [ "$analytics_sql_token" != "null" ] || die "failed to create analytics sql token for ${env}"
      set_github_secret "$gh_env" CLOUDFLARE_METRICS_API_TOKEN "$analytics_sql_token"
      set_github_secret "$gh_env" CLOUDFLARE_METRICS_ACCOUNT_ID "$env_account_id"
    fi
  fi
  
done

log ""
log "=============================================="
if [ "$APPLY" = true ]; then
  log "Bootstrap complete! Secrets written to GitHub."
  log ""
  log "Token usage:"
  log "  - TERRAFORM_READONLY_TOKEN: plan jobs (Workers Read, D1 Read, R2 Read)"
  log "  - TERRAFORM_DEPLOY_TOKEN: apply/deploy jobs (Workers Write, D1 Write, R2 Write, DNS Write, Workers Routes Write)"
  log ""
  log "Next steps:"
  log "  1. Verify TFSTATE_WORKER_URL variables per environment"
  log "  2. Test terraform plan in dev environment"
else
  log "Dry run complete. Re-run with --apply to create resources."
fi
log "=============================================="
