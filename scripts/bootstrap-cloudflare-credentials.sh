#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/bootstrap-cloudflare-credentials.sh [options]

Creates per-environment Cloudflare deploy API tokens and R2 S3 credentials for
Terraform state, then stores them as GitHub Environment secrets.

Defaults to dry-run. Pass --apply to create tokens and write GitHub secrets.
Secret values are never printed.

Options:
  --apply                 Create tokens and write GitHub secrets.
  --envs "dev staging"    Space-separated env list. Default: dev staging prod.
  --env-file PATH         Bootstrap env file. Default: ~/Documents/repos/cloudflare/.env
  --repo OWNER/REPO       GitHub repo. Default: detected by gh.
  --state-bucket NAME     R2 bucket for Terraform state. Default: gh variable or env.
  --include-zero-trust    Add Access app/policy write permission for admin Access.
  -h, --help              Show this help.

Required bootstrap env:
  CLOUDFLARE_BOOTSTRAP_API_TOKEN or CLOUDFLARE_API_TOKEN
  or CLOUDFLARE_EMAIL plus CLOUDFLARE_GLOBAL_API_KEY/CLOUDFLARE_API_KEY

Optional env:
  CLOUDFLARE_DEPLOY_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_ZONE_ID
USAGE
}

APPLY=false
TARGET_ENVS="dev staging prod"
ENV_FILE="${HOME}/Documents/repos/cloudflare/.env"
REPO=""
STATE_BUCKET="${TERRAFORM_STATE_R2_BUCKET:-}"
INCLUDE_ZERO_TRUST=false

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
    --state-bucket)
      STATE_BUCKET="${2:?--state-bucket requires a value}"
      shift 2
      ;;
    --include-zero-trust)
      INCLUDE_ZERO_TRUST=true
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
    printf 'Add one of these credential forms to the env file, or export it before running this script:\n'
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
    printf '\n'
    printf 'Do not paste secret values into chat or logs. Rename the existing token variable or export one of the accepted names.\n'
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

github_env_name() {
  case "$1" in
    prod|production) printf '%s\n' "production" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

sha256_hex() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  else
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  fi
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

set_github_secret() {
  env_name="$1"
  name="$2"
  value="$3"
  if [ "$APPLY" = true ]; then
    printf '%s' "$value" | gh secret set "$name" --repo "$REPO" --env "$env_name" >/dev/null
  fi
  log "  github environment ${env_name}: set ${name}"
}

ensure_github_environment() {
  env_name="$1"
  gh api -X PUT "repos/${REPO}/environments/${env_name}" >/dev/null
  gh api "repos/${REPO}/environments/${env_name}/secrets/public-key" >/dev/null
}

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
ACCOUNT_ID="${CLOUDFLARE_DEPLOY_ACCOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID:-}}"

if [ "$APPLY" = true ]; then
  if [ -z "$BOOTSTRAP_TOKEN" ] && { [ -z "$BOOTSTRAP_KEY" ] || [ -z "$BOOTSTRAP_EMAIL" ]; }; then
    die_missing_bootstrap_credentials
  fi
fi

if [ -z "$STATE_BUCKET" ]; then
  STATE_BUCKET="$(gh variable get TERRAFORM_STATE_R2_BUCKET --repo "$REPO" 2>/dev/null || true)"
fi
[ -n "$STATE_BUCKET" ] || die "set --state-bucket or TERRAFORM_STATE_R2_BUCKET"

if [ "$APPLY" = false ]; then
  log "Dry run. Re-run with --apply to create Cloudflare tokens and write GitHub secrets."
fi
log "Repository: ${REPO}"
log "Terraform state bucket: ${STATE_BUCKET}"
log "Target environments: ${TARGET_ENVS}"

if [ "$APPLY" = true ]; then
  for target_env in $TARGET_ENVS; do
    case "$target_env" in
      dev|staging|prod|production) ;;
      *) die "unknown environment: ${target_env}" ;;
    esac
    gh_env="$(github_env_name "$target_env")"
    ensure_github_environment "$gh_env" || die "failed to create or verify GitHub environment ${gh_env}"
    log "Verified GitHub environment: ${gh_env}"
  done

  GROUPS_JSON="$(cf_api GET "/user/tokens/permission_groups")"

  ACCOUNT_WORKERS_SCRIPTS_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Workers Scripts Write|Workers Scripts Edit")"
  ACCOUNT_D1_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "D1 Write|D1 Edit")"
  ACCOUNT_R2_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Workers R2 Storage Write|Workers R2 Storage Edit")"
  ACCOUNT_QUEUES_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Queues Write|Queues Edit")"
  ACCOUNT_SETTINGS_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Account Settings Read")"
  ZONE_DNS_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account.zone" "DNS Write|DNS Edit")"
  ZONE_READ_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account.zone" "Zone Read")"
  ZONE_WORKERS_ROUTES_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account.zone" "Workers Routes Write|Workers Routes Edit")"
  R2_BUCKET_ITEM_WRITE_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.edge.r2.bucket" "Workers R2 Storage Bucket Item Write")"
  if [ "$INCLUDE_ZERO_TRUST" = true ]; then
    ACCOUNT_ACCESS_ID="$(resolve_permission_group_id "$GROUPS_JSON" "com.cloudflare.api.account" "Access: Apps and Policies Write|Access: Apps and Policies Edit|Zero Trust Write|Zero Trust Edit")"
  fi
fi

for target_env in $TARGET_ENVS; do
  case "$target_env" in
    dev|staging|prod|production) ;;
    *) die "unknown environment: ${target_env}" ;;
  esac

  tf_env="$target_env"
  [ "$tf_env" = "production" ] && tf_env="prod"
  gh_env="$(github_env_name "$target_env")"

  env_account_id="$(tfvar_value "$tf_env" cloudflare_account_id)"
  env_zone_id="$(tfvar_value "$tf_env" cloudflare_zone_id)"
  [ -n "$env_account_id" ] || env_account_id="$ACCOUNT_ID"
  [ -n "$env_zone_id" ] || env_zone_id="${CLOUDFLARE_ZONE_ID:-}"
  [ -n "$env_account_id" ] || die "missing Cloudflare account id for ${target_env}"
  [ -n "$env_zone_id" ] || die "missing Cloudflare zone id for ${target_env}"

  log ""
  log "Environment: ${target_env} -> GitHub environment ${gh_env}"
  log "  account: ${env_account_id}"
  log "  zone: ${env_zone_id}"

  if [ "$APPLY" = false ]; then
    log "  would create deploy token scoped to Workers, D1, R2, Queues, DNS, Workers Routes"
    log "  would create R2 state token scoped to bucket ${STATE_BUCKET}"
    log "  would write CLOUDFLARE_DEPLOY_* and TERRAFORM_STATE_R2_* secrets"
    continue
  fi

  account_group_ids=(
    "$ACCOUNT_WORKERS_SCRIPTS_ID"
    "$ACCOUNT_D1_ID"
    "$ACCOUNT_R2_ID"
    "$ACCOUNT_QUEUES_ID"
    "$ACCOUNT_SETTINGS_READ_ID"
  )
  if [ "$INCLUDE_ZERO_TRUST" = true ]; then
    account_group_ids+=("$ACCOUNT_ACCESS_ID")
  fi
  account_groups="$(permission_group_objects "${account_group_ids[@]}")"
  zone_groups="$(permission_group_objects "$ZONE_DNS_ID" "$ZONE_READ_ID" "$ZONE_WORKERS_ROUTES_ID")"

  deploy_policies="$(
    jq -n \
      --arg account_resource "com.cloudflare.api.account.${env_account_id}" \
      --arg zone_resource "com.cloudflare.api.account.zone.${env_zone_id}" \
      --argjson account_groups "$account_groups" \
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

  suffix="$(date -u +%Y%m%dT%H%M%SZ)"
  deploy_response="$(create_token "o11yfleet ${target_env} deploy ${suffix}" "$deploy_policies")"
  deploy_token="$(jq -r '.result.value' <<<"$deploy_response")"
  [ -n "$deploy_token" ] && [ "$deploy_token" != "null" ] || die "Cloudflare did not return deploy token value"

  r2_bucket_resource="com.cloudflare.edge.r2.bucket.${env_account_id}_default_${STATE_BUCKET}"
  r2_groups="$(permission_group_objects "$R2_BUCKET_ITEM_WRITE_ID")"
  r2_policies="$(
    jq -n \
      --arg bucket_resource "$r2_bucket_resource" \
      --argjson r2_groups "$r2_groups" \
      '[
        {
          effect: "allow",
          resources: {($bucket_resource): "*"},
          permission_groups: $r2_groups
        }
      ]'
  )"
  r2_response="$(create_token "o11yfleet ${target_env} terraform state ${suffix}" "$r2_policies")"
  r2_access_key_id="$(jq -r '.result.id' <<<"$r2_response")"
  r2_token_value="$(jq -r '.result.value' <<<"$r2_response")"
  [ -n "$r2_access_key_id" ] && [ "$r2_access_key_id" != "null" ] || die "Cloudflare did not return R2 token id"
  [ -n "$r2_token_value" ] && [ "$r2_token_value" != "null" ] || die "Cloudflare did not return R2 token value"
  r2_secret_access_key="$(sha256_hex "$r2_token_value")"

  set_github_secret "$gh_env" CLOUDFLARE_DEPLOY_API_TOKEN "$deploy_token"
  set_github_secret "$gh_env" CLOUDFLARE_DEPLOY_ACCOUNT_ID "$env_account_id"
  set_github_secret "$gh_env" TERRAFORM_STATE_R2_ACCESS_KEY_ID "$r2_access_key_id"
  set_github_secret "$gh_env" TERRAFORM_STATE_R2_SECRET_ACCESS_KEY "$r2_secret_access_key"
done

log ""
if [ "$APPLY" = true ]; then
  log "Done. Secret values were not printed."
else
  log "Dry run complete."
fi
