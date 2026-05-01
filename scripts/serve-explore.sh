#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="${O11YFLEET_EXPLORE_LOG_DIR:-/tmp/o11yfleet-explore}"
COLLECTOR_PROCESS_MARKER="fake-collector.ts"
COLLECTOR_READY_MARKER="Assignment claim saved for future reconnects"
SITE_PROCESS_MARKER="pnpm --dir=apps/site dev"
SITE_READY_MARKER="ready in"
WORKER_PROCESS_MARKER="pnpm --dir=apps/worker wrangler dev"
WORKER_READY_MARKER="[wrangler:info] Ready on"
WORKER_ENV_FILE=""

# GitHub Actions cleans up background processes that inherit this marker at the
# end of a step. The explore stack intentionally spans subsequent agent steps.
unset RUNNER_TRACKING_ID

# Keep wrangler telemetry out of explore runs. The workflow network firewall is
# intentionally narrow, and telemetry calls should not become UX findings.
export WRANGLER_SEND_METRICS="${WRANGLER_SEND_METRICS:-false}"

stop_pid_file() {
  local file="$1"
  local expected="$2"
  local failed=0
  [ -f "$file" ] || return 0
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if process_matches "$pid" "$expected"; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        process_matches "$pid" "$expected" || break
        sleep 0.5
      done
      if process_matches "$pid" "$expected"; then
        echo "Timed out stopping pid $pid ($expected)" >&2
        failed=1
      fi
    fi
  done <"$file"
  rm -f "$file"
  return "$failed"
}

stop_stack() {
  local failed=0
  stop_pid_file "$LOG_DIR/collectors.pid" "$COLLECTOR_PROCESS_MARKER" || failed=1
  stop_pid_file "$LOG_DIR/site.pid" "$SITE_PROCESS_MARKER" || failed=1
  stop_pid_file "$LOG_DIR/worker.pid" "$WORKER_PROCESS_MARKER" || failed=1
  remove_worker_env_file
  return "$failed"
}

disown_stack() {
  local pid
  for pid in "$worker_pid" "$site_pid"; do
    [ -n "$pid" ] || continue
    disown "$pid" 2>/dev/null || true
  done
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    disown "$pid" 2>/dev/null || true
  done <"$LOG_DIR/collectors.pid"
}

process_matches() {
  local pid="$1"
  local expected="$2"
  local uid
  local args

  uid=$(ps -p "$pid" -o uid= 2>/dev/null | tr -d "[:space:]") || return 1
  [ "$uid" = "$(id -u)" ] || return 1

  args=$(ps -p "$pid" -o args= 2>/dev/null) || return 1
  [[ "$args" == *"$expected"* ]]
}

log_has_marker() {
  local file="$1"
  local marker="$2"
  grep -Fq "$marker" "$file" 2>/dev/null
}

log_has_startup_error() {
  local file="$1"
  grep -Eqi "EADDRINUSE|address already in use|listen EADDRINUSE" "$file" 2>/dev/null
}

wait_for_url() {
  local url="$1"
  local attempts="${2:-1}"
  local delay="${3:-1}"
  local connect_timeout="${4:-2}"
  local max_time="${5:-5}"

  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS --connect-timeout "$connect_timeout" --max-time "$max_time" "$url" >/dev/null; then
      return 0
    fi
    [ "$attempt" -lt "$attempts" ] && sleep "$delay"
  done

  return 1
}

cleanup_on_exit() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    stop_stack
  fi
  remove_worker_env_file
}

remove_worker_env_file() {
  local path_file="$LOG_DIR/worker-env.path"
  local env_file="${WORKER_ENV_FILE:-}"
  if [ -z "$env_file" ] && [ -f "$path_file" ]; then
    env_file="$(cat "$path_file")"
  fi
  if [ -n "$env_file" ] && [ -f "$env_file" ]; then
    rm -f "$env_file"
  fi
  rm -f "$path_file"
  WORKER_ENV_FILE=""
}

write_worker_env_file() {
  [ -n "${AI_GUIDANCE_MINIMAX_API_KEY:-}" ] || return 0

  WORKER_ENV_FILE="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/o11yfleet-worker-env.XXXXXX")"
  chmod 600 "$WORKER_ENV_FILE"
  printf '%s\n' "$WORKER_ENV_FILE" >"$LOG_DIR/worker-env.path"
  chmod 600 "$LOG_DIR/worker-env.path"
  cat apps/worker/.dev.vars >"$WORKER_ENV_FILE"
  {
    printf '\n'
    printf 'AI_GUIDANCE_MINIMAX_API_KEY=%s\n' "$AI_GUIDANCE_MINIMAX_API_KEY"
  } >>"$WORKER_ENV_FILE"
}

ensure_dev_vars() {
  local vars_file="apps/worker/.dev.vars"
  if [ ! -f "$vars_file" ]; then
    : >"$vars_file"
  fi

  ensure_dev_var() {
    local key="$1"
    local value="$2"
    grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "$vars_file" 2>/dev/null ||
      printf '%s=%s\n' "$key" "$value" >>"$vars_file"
  }

  ensure_dev_var ENVIRONMENT dev
  ensure_dev_var O11YFLEET_API_BEARER_SECRET dev-local-api-secret-1234567890x
  ensure_dev_var O11YFLEET_CLAIM_HMAC_SECRET dev-local-claim-secret-12345678x
  ensure_dev_var O11YFLEET_SEED_TENANT_USER_EMAIL demo@o11yfleet.com
  ensure_dev_var O11YFLEET_SEED_TENANT_USER_PASSWORD demo-password
  ensure_dev_var O11YFLEET_SEED_ADMIN_EMAIL admin@o11yfleet.com
  ensure_dev_var O11YFLEET_SEED_ADMIN_PASSWORD admin-password

  chmod 600 "$vars_file"
}

FP_URL="${FP_URL:-http://127.0.0.1:8787}"
UI_URL="${UI_URL:-http://127.0.0.1:3000}"
WORKER_LISTEN=$(
  FP_URL="$FP_URL" node -e 'const u = new URL(process.env.FP_URL); const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname; const port = u.port || (u.protocol === "https:" ? "443" : "80"); console.log(host + " " + port);'
)
SITE_LISTEN=$(
  UI_URL="$UI_URL" node -e 'const u = new URL(process.env.UI_URL); const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname; const port = u.port || (u.protocol === "https:" ? "443" : "80"); console.log(host + " " + port);'
)
read -r WORKER_HOST WORKER_PORT <<<"$WORKER_LISTEN"
read -r SITE_HOST SITE_PORT <<<"$SITE_LISTEN"

mkdir -p "$LOG_DIR/collectors"

if [ "${1:-}" = "down" ]; then
  stop_stack
  echo "Stopped explore stack."
  exit 0
fi

if [ "${1:-}" = "status" ]; then
  failed=0
  status_retries="${O11YFLEET_EXPLORE_STATUS_RETRIES:-10}"
  status_delay="${O11YFLEET_EXPLORE_STATUS_DELAY_SECONDS:-2}"
  if ! [[ "$status_retries" =~ ^[0-9]+$ ]] || ! [[ "$status_delay" =~ ^[0-9]+$ ]]; then
    echo "Invalid status retry config: O11YFLEET_EXPLORE_STATUS_RETRIES and O11YFLEET_EXPLORE_STATUS_DELAY_SECONDS must be non-negative integers." >&2
    exit 2
  fi

  if wait_for_url "$FP_URL/healthz" "$status_retries" "$status_delay"; then
    echo "Worker healthy: $FP_URL/healthz"
  else
    echo "Worker unhealthy: $FP_URL/healthz" >&2
    [ -f "$LOG_DIR/worker.log" ] && tail -40 "$LOG_DIR/worker.log" >&2
    failed=1
  fi

  if wait_for_url "$UI_URL/" "$status_retries" "$status_delay"; then
    echo "Site healthy: $UI_URL/"
  else
    echo "Site unhealthy: $UI_URL/" >&2
    [ -f "$LOG_DIR/site.log" ] && tail -40 "$LOG_DIR/site.log" >&2
    failed=1
  fi
  exit "$failed"
fi

if [ "${1:-}" = "start" ]; then
  COLLECTOR_COUNT="${2:-0}"
else
  COLLECTOR_COUNT="${1:-0}"
fi
if ! [[ "$COLLECTOR_COUNT" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 [start <collector-count>|<collector-count>|status|down]" >&2
  exit 2
fi
ensure_dev_vars
trap cleanup_on_exit EXIT
stop_stack

WORKER_VAR_ARGS=()
# Always set ENVIRONMENT=dev to enable local dev CORS (localhost origins allowed)
WORKER_VAR_ARGS+=(--var "ENVIRONMENT:dev")
if [ -n "${AI_GUIDANCE_MINIMAX_API_KEY:-}" ]; then
  write_worker_env_file
  WORKER_VAR_ARGS+=(--var "AI_GUIDANCE_PROVIDER:${AI_GUIDANCE_PROVIDER:-minimax}")
  WORKER_VAR_ARGS+=(--var "AI_GUIDANCE_MODEL:${AI_GUIDANCE_MODEL:-MiniMax-M2.7}")
  WORKER_VAR_ARGS+=(--var "AI_GUIDANCE_BASE_URL:${AI_GUIDANCE_BASE_URL:-https://api.minimax.io/v1}")
fi

echo "Starting worker at $FP_URL"
worker_command=(pnpm --dir=apps/worker wrangler dev src/index.ts)
if [ -n "${WORKER_ENV_FILE:-}" ]; then
  worker_command+=("--env-file=$WORKER_ENV_FILE")
fi
worker_command+=(--ip "$WORKER_HOST" --port "$WORKER_PORT")
if [ "${#WORKER_VAR_ARGS[@]}" -gt 0 ]; then
  worker_command+=("${WORKER_VAR_ARGS[@]}")
fi
"${worker_command[@]}" >"$LOG_DIR/worker.log" 2>&1 &
worker_pid=$!
echo "$worker_pid" >"$LOG_DIR/worker.pid"

echo "Starting site at $UI_URL"
pnpm --dir=apps/site dev --host "$SITE_HOST" --port "$SITE_PORT" >"$LOG_DIR/site.log" 2>&1 &
site_pid=$!
echo "$site_pid" >"$LOG_DIR/site.pid"

echo "Waiting for worker health..."
for _ in $(seq 1 60); do
  if log_has_startup_error "$LOG_DIR/worker.log"; then
    break
  fi
  if process_matches "$worker_pid" "$WORKER_PROCESS_MARKER" &&
    log_has_marker "$LOG_DIR/worker.log" "$WORKER_READY_MARKER" &&
    curl -fsS --connect-timeout 2 --max-time 5 "$FP_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! process_matches "$worker_pid" "$WORKER_PROCESS_MARKER" ||
  ! log_has_marker "$LOG_DIR/worker.log" "$WORKER_READY_MARKER" ||
  log_has_startup_error "$LOG_DIR/worker.log" ||
  ! curl -fsS --connect-timeout 2 --max-time 5 "$FP_URL/healthz" >/dev/null; then
  echo "Worker failed to start"
  tail -80 "$LOG_DIR/worker.log"
  exit 1
fi
remove_worker_env_file

echo "Waiting for site..."
for _ in $(seq 1 60); do
  if log_has_startup_error "$LOG_DIR/site.log"; then
    break
  fi
  if process_matches "$site_pid" "$SITE_PROCESS_MARKER" &&
    log_has_marker "$LOG_DIR/site.log" "$SITE_READY_MARKER" &&
    curl -fsS --connect-timeout 2 --max-time 5 "$UI_URL/" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! process_matches "$site_pid" "$SITE_PROCESS_MARKER" ||
  ! log_has_marker "$LOG_DIR/site.log" "$SITE_READY_MARKER" ||
  log_has_startup_error "$LOG_DIR/site.log" ||
  ! curl -fsS --connect-timeout 2 --max-time 5 "$UI_URL/" >/dev/null; then
  echo "Site failed to start"
  tail -80 "$LOG_DIR/site.log"
  exit 1
fi

(cd apps/worker && CI=1 pnpm wrangler d1 migrations apply fp-db --local)
pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/seed-local.ts --reset

TOKEN=$(
  node -e 'const fs = require("fs"); const state = JSON.parse(fs.readFileSync(".local-state.json", "utf8")); process.stdout.write(state.enrollment_token);'
)

: >"$LOG_DIR/collectors.pid"

if [ "$COLLECTOR_COUNT" -gt 0 ]; then
  for i in $(seq -w 1 "$COLLECTOR_COUNT"); do
    FP_URL="$FP_URL" pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/fake-collector.ts --token "$TOKEN" --name "collector-$i" >"$LOG_DIR/collectors/collector-$i.log" 2>&1 &
    echo "$!" >>"$LOG_DIR/collectors.pid"
  done

  echo "Waiting for collectors..."
  for _ in $(seq 1 30); do
    alive=0
    ready=0
    collector_index=1
    while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      collector_name=$(printf "%0${#COLLECTOR_COUNT}d" "$collector_index")
      collector_log="$LOG_DIR/collectors/collector-$collector_name.log"
      if process_matches "$pid" "$COLLECTOR_PROCESS_MARKER"; then
        alive=$((alive + 1))
      fi
      if grep -Fq "$COLLECTOR_READY_MARKER" "$collector_log" 2>/dev/null; then
        ready=$((ready + 1))
      fi
      collector_index=$((collector_index + 1))
    done <"$LOG_DIR/collectors.pid"
    [ "$alive" -eq "$COLLECTOR_COUNT" ] && [ "$ready" -eq "$COLLECTOR_COUNT" ] && break
    sleep 1
  done

  if [ "${alive:-0}" -ne "$COLLECTOR_COUNT" ] || [ "${ready:-0}" -ne "$COLLECTOR_COUNT" ]; then
    echo "Collector startup incomplete: expected $COLLECTOR_COUNT, alive ${alive:-0}, ready ${ready:-0}"
    ls -la "$LOG_DIR/collectors" 2>/dev/null || true
    for log in "$LOG_DIR"/collectors/collector-*.log; do
      [ -f "$log" ] || continue
      echo "--- $log ---"
      tail -80 "$log"
    done
    exit 1
  fi
else
  echo "Skipping fake collectors."
fi

echo "Explore stack ready:"
echo "  Site:   $UI_URL"
echo "  Worker: $FP_URL"
echo "  Logs:   $LOG_DIR"
echo "  Demo:   demo@o11yfleet.com / demo-password"
echo "  Admin:  admin@o11yfleet.com / admin-password"
disown_stack
trap - EXIT
