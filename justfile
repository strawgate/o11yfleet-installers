# o11yFleet

# Default recipe
default:
    @just --list

# Install dependencies
install:
    pnpm install

    # Check environment readiness
doctor:
    #!/usr/bin/env bash
    set -euo pipefail
    FAIL=0

    echo "=== o11yFleet Environment Check ==="

    node --version | grep -qE "^v(2[2-9]|[3-9][0-9])\." && echo "✓ Node.js 22+" || { echo "✗ Node.js 22+ required"; FAIL=1; }
    pnpm --version | grep -qE "^(9|[1-9][0-9])\." && echo "✓ pnpm 9+" || { echo "✗ pnpm 9+ required"; FAIL=1; }
    just --version | grep -qE "[0-9]+\.[0-9]+" && echo "✓ just" || { echo "✗ just required"; FAIL=1; }
    npx wrangler --version | grep -qE "^[0-9]+\." && echo "✓ wrangler" || { echo "✗ wrangler required"; FAIL=1; }

    if [ -f apps/worker/.dev.vars ]; then
        echo "✓ .dev.vars exists"
    else
        echo "✗ .dev.vars missing (run: cp apps/worker/.dev.vars.example apps/worker/.dev.vars)"
        FAIL=1
    fi

    if [ -f apps/worker/.dev.vars ]; then
        read_dev_var() {
            awk -F= -v key="$1" '
                /^[[:space:]]*#/ { next }
                $1 ~ "^[[:space:]]*" key "[[:space:]]*$" {
                    sub(/^[^=]*=/, "")
                    gsub(/^[[:space:]]+|[[:space:]]+$/, "")
                    print
                    exit
                }
            ' apps/worker/.dev.vars
        }

        O11YFLEET_API_BEARER_SECRET=$(read_dev_var O11YFLEET_API_BEARER_SECRET)
        if [ -z "$O11YFLEET_API_BEARER_SECRET" ] || [[ "$O11YFLEET_API_BEARER_SECRET" == dev-local* ]]; then
            echo "✗ O11YFLEET_API_BEARER_SECRET missing or placeholder — update .dev.vars with a real value"
            FAIL=1
        else
            echo "✓ O11YFLEET_API_BEARER_SECRET set in .dev.vars"
        fi
        O11YFLEET_CLAIM_HMAC_SECRET=$(read_dev_var O11YFLEET_CLAIM_HMAC_SECRET)
        if [ -z "$O11YFLEET_CLAIM_HMAC_SECRET" ] || [[ "$O11YFLEET_CLAIM_HMAC_SECRET" == dev-local* ]]; then
            echo "✗ O11YFLEET_CLAIM_HMAC_SECRET missing or placeholder — update .dev.vars with a real value"
            FAIL=1
        else
            echo "✓ O11YFLEET_CLAIM_HMAC_SECRET set in .dev.vars"
        fi
    fi

    if npx wrangler whoami &>/dev/null; then
        echo "✓ Cloudflare authenticated"
    else
        echo "✗ Cloudflare not authenticated (run: npx wrangler login)"
        FAIL=1
    fi

    echo ""
    if [ "$FAIL" -eq 0 ]; then
        echo "✓ Environment ready!"
    else
        echo "✗ Fix the issues above before continuing"
        exit 1
    fi

# Smart changed-file check for the current branch/worktree
check *args:
    pnpm tsx scripts/dev-check.ts {{args}}

# Show the changed-file check plan as JSON without running commands
check-json *args:
    pnpm tsx scripts/dev-check.ts --json {{args}}

# Smart staged-file check used by pre-commit
check-staged:
    pnpm tsx scripts/dev-check.ts --staged

# Run the same gate that Husky uses before commits
precommit: check-staged

# Check generated Worker types are current
typegen-check:
    pnpm --filter @o11yfleet/worker typegen:check

# Test local dev-loop scripts
test-dev-check:
    pnpm test:dev-check

# Lint repo maintenance scripts
lint-scripts:
    pnpm lint:scripts

# Fast full check: lint, typecheck, and unit tests
check-all:
    pnpm turbo lint typecheck test
    pnpm lint:type-aware

# Lint all packages
lint:
    pnpm turbo lint

# Type check all packages
typecheck:
    pnpm turbo typecheck

# Run fast unit tests
test:
    pnpm turbo test

# Run mutation testing across packages that have a `mutate` script.
# Slow (multi-minute); not part of the regular CI gate. Run before
# major refactors or when expanding property tests to verify the
# new tests actually catch bugs.
mutate:
    pnpm --filter @o11yfleet/core mutate
    pnpm --filter @o11yfleet/worker mutate

# Run vitest coverage across packages. Reports go to
# {package}/reports/coverage/. Worker has two test runners (Node and
# workerd) — both produce a separate report; merging into a unified
# view is a follow-up.
coverage:
    pnpm --filter @o11yfleet/core coverage
    pnpm --filter @o11yfleet/worker coverage
    pnpm --filter @o11yfleet/worker coverage:runtime

# Run all fast CI checks
ci: typegen-check check-all lint-scripts test-dev-check docs-api-check fmt-check

# Local equivalent of the fast pre-PR gate
ci-fast: ci

# Local equivalent of the required PR checks, including slow browser/runtime coverage
ci-pr:
    just reproduce-check lint-typecheck
    just reproduce-check test-fast
    just reproduce-check test-slow
    just reproduce-check deploy-validate
    just reproduce-check terraform-plan

# Reproduce a named GitHub check locally
reproduce-check check:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{check}}" in
      lint-typecheck)
        pnpm turbo lint
        pnpm lint:scripts
        pnpm lint:type-aware
        pnpm test:dev-check
        pnpm prettier --cache --cache-location node_modules/.cache/prettier/.prettier-cache --check .
        pnpm --filter @o11yfleet/worker typegen:check
        pnpm turbo typecheck
        pnpm tsx scripts/audit-sql-bindings.ts
        ;;
      test-fast)
        pnpm --filter @o11yfleet/core test
        pnpm --filter @o11yfleet/site test
        ;;
      test-slow)
        pnpm --filter @o11yfleet/worker test:runtime
        pnpm --filter @o11yfleet/ui-tests exec playwright install chromium
        pnpm --filter @o11yfleet/ui-tests test:e2e
        ;;
      deploy-validate)
        just worker-bundle
        just tf-validate
        ;;
      terraform-validate)
        just tf-validate
        ;;
      terraform-plan)
        just tf-plan prod
        ;;
      *)
        printf 'Unknown check: %s\n' "{{check}}" >&2
        printf 'Known checks: lint-typecheck, test-fast, test-slow, deploy-validate, terraform-validate, terraform-plan\n' >&2
        exit 2
        ;;
    esac

# Format code
fmt:
    pnpm prettier --write .

# Check formatting
fmt-check:
    pnpm prettier --cache --cache-location node_modules/.cache/prettier/.prettier-cache --check .

# Check API docs against current worker routes
docs-api-check:
    pnpm tsx scripts/check-api-docs.ts

# Audit DO SQL helper calls for placeholder/binding-count mismatches.
# Catches the bug class behind PR #426's upsertPendingDevice gap (13
# placeholders, 12 bound params). Static analysis only — skips
# dynamically-built queries (`${...}` template subs, `...spread` args).
sql-audit:
    pnpm tsx scripts/audit-sql-bindings.ts

# Generate strong random values for any placeholder secrets in
# apps/worker/.dev.vars. Idempotent: real values are preserved. Run
# automatically by `just dev-up`; can be invoked directly to refresh
# placeholders without restarting the dev stack.
ensure-dev-secrets:
    pnpm tsx scripts/ensure-dev-secrets.ts

# Log in as the seeded admin and print an `export` line for use with
# curl. Pairs with the trust-boundary cleanup in PR #426 — admin routes
# require a session cookie or OIDC, never a bearer token.
#
#   eval "$(just admin-login)"
#   curl -H "Cookie: $FP_ADMIN_COOKIE" -H "Origin: $FP_URL" \
#        $FP_URL/api/admin/tenants
#
# Pass `--cookie` to print just the `fp_session=…` value (handy for
# scripts).
admin-login *args:
    @pnpm tsx scripts/admin-login.ts {{args}}

# Dev mode — start worker locally
# Note: --var ENVIRONMENT:dev enables local dev CORS (allows localhost origins)
dev:
    cd apps/worker && pnpm wrangler dev --var ENVIRONMENT:dev

# Dev mode — start management UI
ui:
    cd apps/site && pnpm dev

# Start worker + site, wait for health, migrate, and seed local data
dev-up:
    pnpm tsx scripts/dev-up.ts

# Same as dev-up, but force-reset local seed data
dev-up-reset:
    pnpm tsx scripts/dev-up.ts --reset

# Start a seeded local stack for interactive explore agents
serve-explore collectors="55":
    bash scripts/serve-explore.sh {{collectors}}

# Stop the local stack started by serve-explore
explore-down:
    bash scripts/serve-explore.sh down

# Check health for the local stack started by serve-explore
explore-status:
    bash scripts/serve-explore.sh status

# Reset local D1 and seed data while just dev is already running
dev-reset: db-migrate seed-reset
    @echo "Local dev reset complete."
    @echo "Worker: http://localhost:8787"
    @echo "Site:   http://127.0.0.1:3000"

# Generate protobuf types
proto-gen:
    cd packages/core && pnpm buf generate

# Database migrations (local)
db-migrate:
    cd apps/worker && CI=1 pnpm wrangler d1 migrations apply fp-db --local

# Seed local dev environment (creates tenant, config, enrollment token)
seed:
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/seed-local.ts

# Re-seed (destroys and recreates local dev state)
seed-reset:
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/seed-local.ts --reset

# Start a fake OTel Collector (connects to local worker via OpAMP)
collector name="fake-collector":
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/fake-collector.ts --name {{name}}

# Start multiple fake collectors
collectors count="3":
    #!/usr/bin/env bash
    for i in $(seq 1 {{count}}); do
        pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/fake-collector.ts --name "collector-$i" &
    done
    echo "Started {{count}} collectors. Press Ctrl+C to stop all."
    wait

# Upload a YAML config and roll it out to connected agents
push-config file="configs/basic-otlp.yaml":
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/push-config.ts {{file}}

# Show fleet status (agents, configs, stats)
fleet:
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/show-fleet.ts

# Health check
healthz:
    curl -s http://localhost:8787/healthz | jq .

# Full local dev setup: migrate, seed, show status
setup: db-migrate seed fleet

# Run benchmark suite
bench:
    pnpm tsx experiments/src/benchmark.ts

# Run core codec/state-machine microbenchmarks (vitest bench)
bench-core:
    cd packages/core && pnpm bench

# Run pipeline-management model experiments
pipeline-experiment:
    pnpm tsx experiments/src/pipeline-management.ts

# Run benchmark and save results to file
bench-save:
    pnpm tsx experiments/src/benchmark.ts 2>&1 | tee experiments/benchmark-results.txt

# Check worker bundle size (dry-run deploy)
bundle-size:
    #!/usr/bin/env bash
    cd apps/worker
    npx wrangler deploy --env="" --dry-run --outdir dist 2>&1 | tail -5 || true
    BUNDLE=$(find dist -name '*.js' -o -name '*.mjs' 2>/dev/null | head -1)
    if [ -z "$BUNDLE" ]; then echo "⚠ No bundle found"; exit 0; fi
    RAW=$(wc -c < "$BUNDLE" | tr -d ' ')
    GZ=$(gzip -c "$BUNDLE" | wc -c | tr -d ' ')
    echo "Raw: $((RAW / 1024)) KB  |  Gzip: $((GZ / 1024)) KB"

# Build the Worker bundle that Terraform uploads.
worker-bundle env="prod" out="apps/worker/dist":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production) WRANGLER_ENV="production" ;;
      staging|dev) WRANGLER_ENV="{{env}}" ;;
      local|"") WRANGLER_ENV="" ;;
      *)
        printf 'unknown worker bundle env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac
    REPO_ROOT="$(pwd)"
    OUT_DIR="$(node -e 'const path = require("node:path"); const root = path.resolve(process.argv[1]); const out = path.resolve(root, process.argv[2]); if (out === root || !out.startsWith(root + path.sep)) process.exit(1); process.stdout.write(out)' "$REPO_ROOT" "{{out}}")" || {
        printf 'worker-bundle out must stay under %s: %s\n' "$REPO_ROOT" "{{out}}" >&2
        exit 1
    }
    rm -rf "$OUT_DIR"
    mkdir -p "$OUT_DIR"
    cd apps/worker
    if [ -n "$WRANGLER_ENV" ]; then
        pnpm exec wrangler deploy --env "$WRANGLER_ENV" --dry-run --outdir "$OUT_DIR" >&2
    else
        pnpm exec wrangler deploy --env="" --dry-run --outdir "$OUT_DIR" >&2
    fi
    BUNDLES=()
    while IFS= read -r bundle; do
        BUNDLES+=("$bundle")
    done < <(find "$OUT_DIR" -type f \( -name '*.js' -o -name '*.mjs' \) | sort)
    if [ "${#BUNDLES[@]}" -eq 0 ]; then
        echo "No Worker bundle found under {{out}}"
        exit 1
    fi
    if [ "${#BUNDLES[@]}" -ne 1 ]; then
        printf 'Expected exactly one Worker entry bundle, found %s\n' "${#BUNDLES[@]}" >&2
        printf ' - %s\n' "${BUNDLES[@]}" >&2
        exit 1
    fi
    BUNDLE="${BUNDLES[0]}"
    GZ=$(gzip -c "$BUNDLE" | wc -c | tr -d ' ')
    if [ "$GZ" -gt $((3 * 1024 * 1024)) ]; then
        printf 'Worker bundle exceeds 3MB compressed budget: %s bytes\n' "$GZ" >&2
        exit 1
    fi
    echo "$BUNDLE"

# Run property-based tests only
test-properties:
    pnpm --filter @o11yfleet/core vitest run test/state-machine-properties.test.ts

# Run core tests only (fast, no workerd)
test-core:
    pnpm --filter @o11yfleet/core test

# Run worker unit tests only (fast, no workerd)
test-worker:
    pnpm --filter @o11yfleet/worker test

# Run worker runtime tests only (workerd/Cloudflare runtime)
test-runtime:
    pnpm --filter @o11yfleet/worker test:runtime

# Smoke test (single agent lifecycle, requires `just dev` running)
smoke-test:
    pnpm tsx scripts/with-local-env.ts -- pnpm --filter @o11yfleet/load-test smoke

# Alias for local end-to-end smoke test
smoke-local: smoke-test

# Smoke test collector enrollment against wrangler dev (requires `just dev` running)
smoke-collector:
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/smoke-collector/run.ts

# Smoke test collector enrollment against a specific URL
smoke-collector-url url="${FP_URL:-http://localhost:8787}":
    WORKER_URL="{{url}}" CONCURRENT_AGENTS=3 pnpm tsx scripts/smoke-collector/run.ts

# Smoke test token revocation against wrangler dev (requires `just dev` running)
smoke-revocation:
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/smoke-token-revocation/run.ts

# OpAMP protocol compliance tests (requires `just dev` running)
test-opamp:
    cd tests/opamp && pnpm vitest run

# Load test (default: 50 agents, requires `just dev` running)
load-test agents="50" ramp="10" steady="30":
    pnpm --filter @o11yfleet/load-test load -- --agents={{agents}} --ramp={{ramp}} --steady={{steady}}

# CI load test with pass/fail criteria (25 agents, 30s)
load-test-ci:
    pnpm --filter @o11yfleet/load-test load -- --agents=25 --ramp=10 --steady=30

# 1K agent load test — single process, parallel enrollment
load-test-1k:
    pnpm --filter @o11yfleet/load-test load -- --agents=1000 --concurrency=50 --ramp=30 --steady=60 --heartbeat=15

# 5K agent load test — single process, high concurrency
load-test-5k:
    pnpm --filter @o11yfleet/load-test load -- --agents=5000 --concurrency=100 --ramp=60 --steady=60 --heartbeat=30

# 10K agent load test — multi-process
load-test-10k:
    ulimit -n 65536 && pnpm --filter @o11yfleet/load-test load -- --agents=10000 --concurrency=200 --workers=4 --ramp=120 --steady=60 --heartbeat=30

# 30K agent load test with realistic turmoil profile — multi-process
# Simulates a production fleet with failing exporters, flapping, restarts, config rejects
# Run against staging: FP_URL=https://worker.your-account.workers.dev just load-test-30k
load-test-30k:
    ulimit -n 65536 && pnpm --filter @o11yfleet/load-test load -- --agents=30000 --concurrency=150 --workers=6 --ramp=180 --steady=120 --heartbeat=30 --profile=realistic-30k

# 30K healthy-only load test — baseline throughput without turmoil
load-test-30k-baseline:
    ulimit -n 65536 && pnpm --filter @o11yfleet/load-test load -- --agents=30000 --concurrency=150 --workers=6 --ramp=180 --steady=120 --heartbeat=30 --profile=healthy

# 100K agent load test — multi-process fan-out
load-test-100k:
    ulimit -n 65536 && pnpm --filter @o11yfleet/load-test load -- --agents=100000 --concurrency=200 --workers=10 --ramp=300 --steady=120 --heartbeat=60

# CPU profile load test (200 agents, 60s, generates .cpuprofile)
load-test-profile:
    ulimit -n 4096 && node --cpu-prof --cpu-prof-dir=./profiles --import tsx/esm tests/load/src/load-test.ts --agents=200 --ramp=20 --steady=60

# ─── Real OTel Collector Fleet (Docker) ─────────────────────────────

# Start real OTel Collectors in Docker (requires `just dev` + `just setup`)
collectors-docker count="3":
    ./configs/smoke-test/docker/launch-collectors.sh {{count}}

# Stop the Docker collector fleet
collectors-docker-down:
    cd configs/smoke-test/docker && docker compose down --remove-orphans

# Show logs from Docker collector fleet
collectors-docker-logs:
    cd configs/smoke-test/docker && docker compose logs -f

# ─── E2E & UI Testing ───────────────────────────────────────────────

# Full-stack E2E tests (requires `just dev` running)
test-e2e:
    cd tests/e2e && pnpm run test:e2e

# E2E tests with real OTel Collectors (requires `just dev` + Docker)
test-e2e-collector:
    cd tests/e2e-collector && pnpm vitest run

# Run multi-version collector compatibility matrix (requires Docker + worker running).
# Pass an empty `version` to run the full matrix; otherwise pin to a single tag.
# We intentionally do NOT export `COLLECTOR_VERSION=""` when no version is given,
# because that would mask any value already in the caller's environment.
test-collector-matrix version="":
    #!/usr/bin/env bash
    set -euo pipefail
    cd tests/e2e-collector
    if [ -n "{{version}}" ]; then
        COLLECTOR_VERSION="{{version}}" pnpm vitest run src/version-matrix.test.ts --reporter=verbose
    else
        pnpm vitest run src/version-matrix.test.ts --reporter=verbose
    fi

# UI tests with Playwright (starts the site dev server automatically)
test-ui:
    cd tests/ui && pnpm run test:e2e

# Optional real-provider AI guidance audit. Requires MINIMAX_API_KEY.
ai-guidance-audit collectors="20":
    bash scripts/run-ai-guidance-audit.sh {{collectors}}

# Install Playwright browsers (one-time setup)
playwright-install:
    cd tests/ui && npx playwright install --with-deps chromium

# ─── Load Generator (Cloudflare Worker) ──────────────────────────────

# Deploy load generator to staging
deploy-loadgen:
    cd tests/load-gen-worker && pnpm wrangler deploy --env staging

# Start 50K agent load test
loadgen-50k:
    curl -X POST https://o11yfleet-loadgen-staging.workers.dev/start \
      -H "Content-Type: application/json" \
      -d '{"target":"https://o11yfleet-worker-staging.o11yfleet.workers.dev","agents":50000,"shards":10}'

# Check load generator status
loadgen-status:
    curl -s https://o11yfleet-loadgen-staging.workers.dev/status | jq .

# Stop load generator
loadgen-stop:
    curl -X POST https://o11yfleet-loadgen-staging.workers.dev/stop | jq .

# ─── Infrastructure ──────────────────────────────────────────────────

# Terraform init without backend access; enough for validation.
tf-init:
    cd infra/terraform && TF_DATA_DIR=.terraform/validate terraform init -backend=false

# Terraform init against the o11yfleet-tfstate Worker backend (HTTP backend
# with proper LOCK/UNLOCK + R2 storage). Worker source: infra/tfstate-worker/.
# State paths follow `${TFSTATE_USERNAME}/<env>.tfstate` per the Worker's
# routing — the .env-stored TFSTATE_USERNAME also acts as the R2 key prefix.
tf-init-remote env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    : "${TFSTATE_WORKER_URL:?Set TFSTATE_WORKER_URL (e.g. https://o11yfleet-tfstate.o11yfleet.workers.dev)}"
    : "${TFSTATE_USERNAME:?Set TFSTATE_USERNAME (basic-auth username on the Worker)}"
    : "${TFSTATE_PASSWORD:?Set TFSTATE_PASSWORD (basic-auth password on the Worker)}"
    # Strip a trailing slash so we never emit `//states/...`, and require https://
    # so backend creds + state traffic can't accidentally go in the clear.
    worker_url="${TFSTATE_WORKER_URL%/}"
    case "$worker_url" in
        https://*) ;;
        *) echo "TFSTATE_WORKER_URL must use https:// (got: $worker_url)" >&2; exit 1 ;;
    esac
    cd infra/terraform
    terraform init -reconfigure \
        -backend-config="address=${worker_url}/states/{{env}}" \
        -backend-config="lock_address=${worker_url}/states/{{env}}/lock" \
        -backend-config="unlock_address=${worker_url}/states/{{env}}/lock" \
        -backend-config="lock_method=LOCK" \
        -backend-config="unlock_method=UNLOCK" \
        -backend-config="username=${TFSTATE_USERNAME}" \
        -backend-config="password=${TFSTATE_PASSWORD}"

# Terraform validate
tf-validate: tf-init
    cd infra/terraform && TF_DATA_DIR=.terraform/validate terraform validate

# Terraform plan for an environment tfvars file against remote state.
tf-plan env="staging" refresh="true": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    refresh_arg=()
    if [ "{{refresh}}" = "false" ]; then
        refresh_arg=(-refresh=false)
    fi
    targets=(
        -target=cloudflare_d1_database.fleet
        -target=cloudflare_r2_bucket.configs
        -target=cloudflare_dns_record.api
        -target=cloudflare_dns_record.site
        -target=cloudflare_worker.fleet
        -target=cloudflare_worker.site
    )
    cd infra/terraform
    # Use the `${arr[@]+...}` idiom so the empty `refresh_arg=()` doesn't trip
    # `set -u` ("unbound variable") when refresh defaults to "true".
    terraform plan ${refresh_arg[@]+"${refresh_arg[@]}"} "${targets[@]}" -var-file=envs/{{env}}.tfvars

# Terraform state addresses required before non-production Worker rollout checks.
tf-required-rollout-state:
    #!/usr/bin/env bash
    set -euo pipefail
    printf '%s\n' \
        cloudflare_d1_database.fleet \
        cloudflare_r2_bucket.configs \
        cloudflare_dns_record.api \
        cloudflare_worker.fleet

# Production imports required before enabling provider v5 apply paths. These
# include the already-routed production Worker traffic resources.
tf-required-imports:
    #!/usr/bin/env bash
    set -euo pipefail
    just --quiet tf-required-rollout-state
    printf '%s\n' \
        cloudflare_workers_cron_trigger.fleet \
        cloudflare_workers_route.api

# Verify production imports are in remote state before enabling v5 apply paths.
tf-check-prod-imports env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    cd infra/terraform
    # These production resources must be adopted before cutover; the static site
    # Worker and routes may still be created by Terraform during rollout.
    mapfile -t required < <(just --quiet tf-required-imports)
    missing=()
    for resource in "${required[@]}"; do
        if ! terraform state show "$resource" >/dev/null 2>&1; then
            missing+=("$resource")
        fi
    done
    if [ "${#missing[@]}" -ne 0 ]; then
        printf 'Missing required imported resources in %s remote state:\n' "{{env}}" >&2
        printf ' - %s\n' "${missing[@]}" >&2
        printf 'Import these before enabling production Terraform apply.\n' >&2
        exit 1
    fi

# Verify staging imports/state are ready before Terraform-managed Worker deploys.
tf-check-staging-readiness env="staging": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    cd infra/terraform
    mapfile -t required < <(just --quiet tf-required-rollout-state)
    missing=()
    for resource in "${required[@]}"; do
        if ! terraform state show "$resource" >/dev/null 2>&1; then
            missing+=("$resource")
        fi
    done
    if [ "${#missing[@]}" -ne 0 ]; then
        printf 'Staging Terraform state is not ready for Worker deploys. Missing imports in %s state:\n' "{{env}}" >&2
        printf ' - %s\n' "${missing[@]}" >&2
        printf 'Run terraform import (or retire the Wrangler-managed staging Worker/route and apply once) before CI deploy.\n' >&2
        exit 1
    fi

# Terraform apply for an environment tfvars file against remote state. Narrow to
# the long-lived control-plane resources (Worker code/version/deployment lifecycle
# is owned by tf-apply-worker / tf-apply-site).
tf-apply env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    targets=(
        -target=cloudflare_d1_database.fleet
        -target=cloudflare_r2_bucket.configs
        -target=cloudflare_dns_record.api
        -target=cloudflare_dns_record.site
        -target=cloudflare_worker.fleet
        -target=cloudflare_worker.site
    )
    cd infra/terraform
    terraform apply "${targets[@]}" -var-file=envs/{{env}}.tfvars -auto-approve

# ─── Preview Environments ─────────────────────────────────────────────

# Terraform init for preview environment (per-PR state in R2)
tf-preview-init pr="123":
    #!/usr/bin/env bash
    set -euo pipefail
    : "${TERRAFORM_STATE_R2_BUCKET:?Set TERRAFORM_STATE_R2_BUCKET}"
    : "${TERRAFORM_STATE_R2_ENDPOINT:?Set TERRAFORM_STATE_R2_ENDPOINT}"
    : "${AWS_ACCESS_KEY_ID:?Set AWS_ACCESS_KEY_ID}"
    : "${AWS_SECRET_ACCESS_KEY:?Set AWS_SECRET_ACCESS_KEY}"
    cd infra/terraform/preview
    terraform init -reconfigure \
        -backend-config="bucket=${TERRAFORM_STATE_R2_BUCKET}" \
        -backend-config="key=o11yfleet/preview/pr-{{pr}}/terraform.tfstate" \
        -backend-config="region=${TERRAFORM_STATE_R2_REGION:-auto}" \
        -backend-config="endpoint=${TERRAFORM_STATE_R2_ENDPOINT}" \
        -backend-config="skip_credentials_validation=true" \
        -backend-config="skip_metadata_api_check=true" \
        -backend-config="skip_region_check=true" \
        -backend-config="force_path_style=true"

# Terraform apply for preview environment
tf-preview-apply pr="123" branch="feature-branch" worker_bundle="./dist/index.js":
    #!/usr/bin/env bash
    set -euo pipefail
    just tf-preview-init {{pr}}
    cd infra/terraform/preview
    terraform apply \
        -var="pr_number={{pr}}" \
        -var="branch_name={{branch}}" \
        -var="cloudflare_account_id=${CLOUDFLARE_ACCOUNT_ID}" \
        -var="worker_bundle_path={{worker_bundle}}" \
        -var="o11yfleet_api_bearer_secret=${O11YFLEET_API_BEARER_SECRET}" \
        -var="o11yfleet_claim_hmac_secret=${O11YFLEET_CLAIM_HMAC_SECRET}" \
        -var="o11yfleet_seed_admin_email=${O11YFLEET_SEED_ADMIN_EMAIL}" \
        -var="o11yfleet_seed_admin_password=${O11YFLEET_SEED_ADMIN_PASSWORD}" \
        -var="o11yfleet_seed_tenant_user_email=${O11YFLEET_SEED_TENANT_USER_EMAIL}" \
        -var="o11yfleet_seed_tenant_user_password=${O11YFLEET_SEED_TENANT_USER_PASSWORD}" \
        -auto-approve

# Terraform destroy for preview environment
tf-preview-destroy pr="123":
    #!/usr/bin/env bash
    set -euo pipefail
    just tf-preview-init {{pr}}
    cd infra/terraform/preview
    terraform destroy -var="pr_number={{pr}}" -var="branch_name=deleted" -auto-approve

# Terraform output for preview environment
tf-preview-output pr="123" output="worker_url":
    #!/usr/bin/env bash
    set -euo pipefail
    just tf-preview-init {{pr}}
    cd infra/terraform/preview
    terraform output -raw {{output}}

# Print the API URL for a deployment environment.
env-api-url env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production) printf '%s\n' "https://api.o11yfleet.com" ;;
      staging) printf '%s\n' "https://staging-api.o11yfleet.com" ;;
      dev) printf '%s\n' "https://dev-api.o11yfleet.com" ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

# Print the API URL used by CI smoke tests. Non-prod uses workers.dev because
# GitHub runner IPs can receive managed challenges on zone custom domains.
env-api-smoke-url env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production) printf '%s\n' "https://api.o11yfleet.com" ;;
      staging|dev) printf '%s\n' "https://o11yfleet-worker-{{env}}.o11yfleet.workers.dev" ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

# Print the D1 database name for a deployment environment.
env-d1-name env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production) printf '%s\n' "fp-db" ;;
      staging|dev) printf '%s\n' "o11yfleet-{{env}}-db" ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

# Print smoke-test targets for the static site Worker in a deployment environment.
env-site-smoke-targets env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production)
        printf '%s\n' \
          "site|https://o11yfleet.com/" \
          "app|https://app.o11yfleet.com/portal/overview" \
          "admin|https://admin.o11yfleet.com/admin/overview"
        ;;
      staging|dev)
        printf '%s\n' \
          "site|https://o11yfleet-site-worker-{{env}}.o11yfleet.workers.dev/" \
          "app|https://o11yfleet-site-worker-{{env}}.o11yfleet.workers.dev/portal/overview" \
          "admin|https://o11yfleet-site-worker-{{env}}.o11yfleet.workers.dev/admin/overview"
        ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

# Print custom-domain smoke-test targets for public environment aliases.
env-site-alias-smoke-targets env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production)
        printf '%s\n' \
          "site|https://o11yfleet.com/" \
          "app|https://app.o11yfleet.com/portal/overview" \
          "admin|https://admin.o11yfleet.com/admin/overview"
        ;;
      staging)
        printf '%s\n' \
          "site|https://staging.o11yfleet.com/" \
          "app|https://staging-app.o11yfleet.com/portal/overview" \
          "admin|https://staging-admin.o11yfleet.com/admin/overview"
        ;;
      dev)
        printf '%s\n' \
          "site|https://dev.o11yfleet.com/" \
          "app|https://dev-app.o11yfleet.com/portal/overview" \
          "admin|https://dev-admin.o11yfleet.com/admin/overview"
        ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

# Smoke-test public custom-domain aliases for one deployed environment.
smoke-aliases env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    api_url="$(just --quiet env-api-url "{{env}}")"
    tmp="$(mktemp)"
    status="$(curl -sS --connect-timeout 5 --max-time 20 -o "$tmp" -w '%{http_code}' "$api_url/healthz" || true)"
    if [ "$status" != "200" ]; then
        echo "api alias failed: $status $api_url/healthz" >&2
        cat "$tmp" >&2
        rm -f "$tmp"
        exit 1
    fi
    rm -f "$tmp"
    echo "api alias ok: $api_url/healthz"
    targets="$(just --quiet env-site-alias-smoke-targets "{{env}}")"
    printf '%s\n' "$targets" | while IFS='|' read -r surface url; do
        [ -n "$surface" ] || continue
        tmp="$(mktemp)"
        status="$(curl -sS --connect-timeout 5 --max-time 20 -o "$tmp" -w '%{http_code}' "$url" || true)"
        if [ "$status" != "200" ]; then
            echo "$surface alias failed: $status $url" >&2
            cat "$tmp" >&2
            rm -f "$tmp"
            exit 1
        fi
        if ! grep -q '<div id="root"></div>' "$tmp"; then
            echo "$surface alias did not include React root marker: $url" >&2
            rm -f "$tmp"
            exit 1
        fi
        rm -f "$tmp"
        echo "$surface alias ok: $url"
    done

# Best-effort public alias smoke for GitHub-hosted or third-party CI runners.
smoke-aliases-ci env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    # Some Cloudflare managed challenges/WAF rules can return 403 to runner IPs
    # even while the same aliases are healthy from normal networks. Keep
    # `smoke-aliases` as the hard operator check.
    if just --quiet smoke-aliases "{{env}}"; then
        exit 0
    fi
    status=$?
    echo "::warning title=Public alias smoke was blocked::just smoke-aliases {{env}} failed with exit ${status}. Deploy-grade workers.dev/API smoke passed separately; rerun just smoke-aliases {{env}} from an operator network to verify public custom domains."

# Build the site bundle for a deployment environment.
site-build env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    API_URL="$(just --quiet env-api-url {{env}})"
    VITE_O11YFLEET_API_URL="$API_URL" pnpm --filter @o11yfleet/site run build
    printf '%s\n' _worker.js _headers _redirects > apps/site/dist/.assetsignore

# Run D1 migrations for a deployment environment.
d1-migrate env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    DB_NAME="$(just --quiet env-d1-name {{env}})"
    case "{{env}}" in
      prod|production|staging|dev) ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

    REPO_ROOT="$(pwd)"
    D1_DATABASE_ID="$(cd infra/terraform && terraform output -raw d1_database_id)"
    TMP_CONFIG="$(mktemp "$REPO_ROOT/apps/worker/.wrangler-d1-{{env}}.XXXXXX.jsonc")"
    trap 'rm -f "$TMP_CONFIG"' EXIT
    node -e 'const fs = require("node:fs"); const [configPath, databaseName, databaseId] = process.argv.slice(1); fs.writeFileSync(configPath, JSON.stringify({ name: "o11yfleet-d1-migrations", main: "src/index.ts", compatibility_date: "2026-04-29", d1_databases: [{ binding: "FP_DB", database_name: databaseName, database_id: databaseId, migrations_dir: "../../packages/db/migrations" }] }, null, 2));' "$TMP_CONFIG" "$DB_NAME" "$D1_DATABASE_ID"

    pnpm --filter @o11yfleet/worker exec wrangler d1 migrations apply "$DB_NAME" --remote --config "$TMP_CONFIG"

# Print required Worker runtime secrets for shared deployments.
worker-required-secrets:
    #!/usr/bin/env bash
    set -euo pipefail
    printf '%s\n' \
        O11YFLEET_API_BEARER_SECRET \
        O11YFLEET_CLAIM_HMAC_SECRET \
        O11YFLEET_SEED_ADMIN_EMAIL \
        O11YFLEET_SEED_ADMIN_PASSWORD \
        O11YFLEET_SEED_TENANT_USER_EMAIL \
        O11YFLEET_SEED_TENANT_USER_PASSWORD

# Print optional Worker runtime secrets that are provisioned when present.
worker-optional-secrets:
    #!/usr/bin/env bash
    set -euo pipefail
    printf '%s\n' \
        O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY

# Verify required Worker runtime secrets exist before Terraform inherits bindings.
worker-secrets-check env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production) WRANGLER_ENV="" ;;
      staging|dev) WRANGLER_ENV="{{env}}" ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

    args=(secret list --format json)
    if [ -n "$WRANGLER_ENV" ]; then
        args+=(--env "$WRANGLER_ENV")
    fi

    SECRET_NAMES=$(pnpm --filter @o11yfleet/worker exec wrangler "${args[@]}" | jq -r '.[].name')
    missing=()
    while IFS= read -r name; do
        if ! printf '%s\n' "$SECRET_NAMES" | grep -Fxq "$name"; then
            missing+=("$name")
        fi
    done < <(just --quiet worker-required-secrets)
    if [ "${#missing[@]}" -ne 0 ]; then
        printf 'Missing required Worker secrets for %s:\n' "{{env}}" >&2
        printf ' - %s\n' "${missing[@]}" >&2
        if [ -n "$WRANGLER_ENV" ]; then
            printf 'Provision each missing secret with: cd apps/worker && pnpm wrangler versions secret put <NAME> --env %s\n' "$WRANGLER_ENV" >&2
        else
            printf 'Provision each missing secret with: cd apps/worker && pnpm wrangler versions secret put <NAME>\n' >&2
        fi
        exit 1
    fi

# Provision required Worker runtime secrets from matching process environment
# variables. Intended for CI bootstrap after the Worker script identity exists.
worker-secrets-put env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production) WRANGLER_ENV="" ;;
      staging|dev) WRANGLER_ENV="{{env}}" ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

    mapfile -t required < <(just --quiet worker-required-secrets)
    mapfile -t optional < <(just --quiet worker-optional-secrets)

    for name in "${required[@]}"; do
        value="${!name:-}"
        if [ -z "$value" ]; then
            printf 'Missing process environment variable for Worker secret: %s\n' "$name" >&2
            exit 1
        fi
    done
    managed=("${required[@]}")
    for name in "${optional[@]}"; do
        if [ -n "${!name:-}" ]; then
            managed+=("$name")
        fi
    done

    version_args=(versions list --json)
    if [ -n "$WRANGLER_ENV" ]; then
        version_args+=(--env "$WRANGLER_ENV")
    fi

    versions_stderr="$(mktemp)"
    trap 'rm -f "$versions_stderr"' EXIT
    set +e
    versions_json="$(pnpm --filter @o11yfleet/worker exec wrangler "${version_args[@]}" 2>"$versions_stderr")"
    versions_status=$?
    set -e

    if [ "$versions_status" -ne 0 ]; then
        if grep -Eq "has no versions|no uploaded versions" "$versions_stderr"; then
            just worker-bootstrap-secret-version "{{env}}"
            for name in "${managed[@]}"; do
                printf 'Provisioned Worker secret binding for %s in %s\n' "$name" "{{env}}"
            done
            exit 0
        fi
        cat "$versions_stderr" >&2
        exit "$versions_status"
    fi

    if ! node -e 'const input = process.argv[1] || ""; let versions; try { versions = JSON.parse(input); } catch { process.exit(2); } process.exit(Array.isArray(versions) && versions.length > 0 ? 0 : 1);' "$versions_json"; then
        just worker-bootstrap-secret-version "{{env}}"
        for name in "${managed[@]}"; do
            printf 'Provisioned Worker secret binding for %s in %s\n' "$name" "{{env}}"
        done
        exit 0
    fi

    for name in "${managed[@]}"; do
        value="${!name}"
        args=(versions secret put "$name")
        if [ -n "$WRANGLER_ENV" ]; then
            args+=(--env "$WRANGLER_ENV")
        fi
        printf '%s' "$value" | pnpm --filter @o11yfleet/worker exec wrangler "${args[@]}" >/dev/null
        printf 'Provisioned Worker secret binding for %s in %s\n' "$name" "{{env}}"
    done

# Create the first Worker version with required secrets when Terraform has only
# created the script identity. Cloudflare requires the first Worker upload to go
# through wrangler deploy/C3 before versioned operations can run.
worker-bootstrap-secret-version env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production|staging|dev) ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

    mapfile -t required < <(just --quiet worker-required-secrets)
    mapfile -t optional < <(just --quiet worker-optional-secrets)
    for name in "${required[@]}"; do
        value="${!name:-}"
        if [ -z "$value" ]; then
            printf 'Missing process environment variable for Worker secret: %s\n' "$name" >&2
            exit 1
        fi
    done
    managed=("${required[@]}")
    for name in "${optional[@]}"; do
        if [ -n "${!name:-}" ]; then
            managed+=("$name")
        fi
    done

    WORKER_NAME="$(cd infra/terraform && terraform output -raw worker_name)"
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    node -e 'const fs = require("node:fs"); const [configPath, workerPath, secretsPath, workerName, ...secretNames] = process.argv.slice(1); fs.writeFileSync(workerPath, "export default { async fetch() { return new Response(\"Worker bootstrap in progress\", { status: 503 }); } };"); fs.writeFileSync(configPath, JSON.stringify({ name: workerName, main: "bootstrap.mjs", compatibility_date: "2026-04-29", workers_dev: false, routes: [] }, null, 2)); const secrets = {}; for (const name of secretNames) secrets[name] = process.env[name]; fs.writeFileSync(secretsPath, JSON.stringify(secrets)); fs.chmodSync(secretsPath, 0o600);' "$TMP_DIR/wrangler.jsonc" "$TMP_DIR/bootstrap.mjs" "$TMP_DIR/secrets.json" "$WORKER_NAME" "${managed[@]}"

    pnpm --filter @o11yfleet/worker exec wrangler deploy --config "$TMP_DIR/wrangler.jsonc" --cwd "$TMP_DIR" --secrets-file "$TMP_DIR/secrets.json" --message "Temporary secret bootstrap for Terraform-managed rollout"

# Import existing Worker identities that Cloudflare created but Terraform did not
# record, which can happen when a first bootstrap apply fails after the API
# accepts the create request.
tf-import-existing-workers env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    : "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID to the Cloudflare account ID}"
    case "{{env}}" in
      prod|production)
        worker_name="o11yfleet-worker"
        site_worker_name="o11yfleet-site-worker"
        ;;
      staging|dev)
        worker_name="o11yfleet-worker-{{env}}"
        site_worker_name="o11yfleet-site-worker-{{env}}"
        ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac

    cd infra/terraform
    for spec in "cloudflare_worker.fleet:${worker_name}" "cloudflare_worker.site:${site_worker_name}"; do
        address="${spec%%:*}"
        name="${spec#*:}"
        if terraform state show "$address" >/dev/null 2>&1; then
            printf 'Terraform state already has %s\n' "$address"
            continue
        fi

        set +e
        output="$(terraform import -var-file=envs/{{env}}.tfvars "$address" "${CLOUDFLARE_ACCOUNT_ID}/${name}" 2>&1)"
        status=$?
        set -e
        if [ "$status" -eq 0 ]; then
            printf 'Imported existing Cloudflare Worker %s into %s\n' "$name" "$address"
        elif printf '%s\n' "$output" | grep -Eiq 'not found|does not exist|could not find|404|10007|script_not_found'; then
            printf 'No existing Cloudflare Worker to import for %s (%s)\n' "$address" "$name"
        else
            printf 'Failed to import Cloudflare Worker %s into %s:\n%s\n' "$name" "$address" "$output" >&2
            exit "$status"
        fi
    done

# Terraform apply for long-lived control-plane resources only. Deployment
# resources are intentionally handled by tf-apply-worker and tf-apply-site.
tf-apply-control-plane env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    targets=(
        -target=cloudflare_d1_database.fleet
        -target=cloudflare_r2_bucket.configs
        -target=cloudflare_dns_record.api
        -target=cloudflare_dns_record.site
        -target=cloudflare_worker.fleet
        -target=cloudflare_worker.site
    )
    cd infra/terraform
    terraform apply "${targets[@]}" -var-file=envs/{{env}}.tfvars -auto-approve

# Terraform plan that includes the Worker code bundle and deployment rollout.
tf-plan-worker env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    BUNDLE_PATH="$(just --quiet worker-bundle {{env}})"
    if [ -z "$BUNDLE_PATH" ]; then
        echo "worker-bundle did not emit a bundle path" >&2
        exit 1
    fi
    if [ ! -f "$BUNDLE_PATH" ]; then
        printf 'Worker bundle path does not exist: %s\n' "$BUNDLE_PATH" >&2
        exit 1
    fi
    cd infra/terraform
    targets=(
        -target=cloudflare_r2_bucket.configs
        -target=cloudflare_dns_record.api
        -target=cloudflare_worker.fleet
        -target=cloudflare_worker_version.fleet
        -target=cloudflare_workers_deployment.fleet
        -target=cloudflare_workers_cron_trigger.fleet
        -target=cloudflare_workers_route.api
    )
    terraform plan \
        "${targets[@]}" \
        -var-file=envs/{{env}}.tfvars \
        -var=manage_worker_deployment=true \
        -var=worker_include_durable_object_binding=true \
        -var=worker_include_durable_object_migration=false \
        -var="worker_bundle_path=$BUNDLE_PATH"

# First-time Durable Object migration bootstrap. Cloudflare requires the class
# migration to be deployed before a Worker version can bind that class.
tf-apply-worker-do-migration env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    BUNDLE_PATH="$(just --quiet worker-bundle {{env}})"
    if [ -z "$BUNDLE_PATH" ]; then
        echo "worker-bundle did not emit a bundle path" >&2
        exit 1
    fi
    if [ ! -f "$BUNDLE_PATH" ]; then
        printf 'Worker bundle path does not exist: %s\n' "$BUNDLE_PATH" >&2
        exit 1
    fi
    cd infra/terraform
    targets=(
        -target=cloudflare_r2_bucket.configs
        -target=cloudflare_worker.fleet
        -target=cloudflare_worker_version.fleet
        -target=cloudflare_workers_deployment.fleet
    )
    terraform apply \
        "${targets[@]}" \
        -var-file=envs/{{env}}.tfvars \
        -var=manage_worker_deployment=true \
        -var=worker_include_durable_object_binding=false \
        -var=worker_include_durable_object_migration=true \
        -var="worker_bundle_path=$BUNDLE_PATH" \
        -auto-approve

# Run the Durable Object bootstrap only before Terraform owns an API Worker deployment.
tf-apply-worker-do-migration-if-needed env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production) WRANGLER_ENV="" ;;
      staging|dev) WRANGLER_ENV="{{env}}" ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac
    cd infra/terraform
    if terraform state list | grep -Fx 'cloudflare_workers_deployment.fleet[0]' >/dev/null 2>&1; then
        echo "Terraform state already has cloudflare_workers_deployment.fleet[0]; skipping Durable Object migration bootstrap"
        exit 0
    fi
    cd ../..
    deployment_args=(deployments list --json)
    version_args=(versions view)
    if [ -n "$WRANGLER_ENV" ]; then
        deployment_args+=(--env "$WRANGLER_ENV")
        version_args+=(--env "$WRANGLER_ENV")
    fi
    set +e
    deployments_json="$(pnpm --filter @o11yfleet/worker exec wrangler "${deployment_args[@]}" 2>&1)"
    deployments_status=$?
    set -e
    if [ "$deployments_status" -ne 0 ]; then
        if printf '%s\n' "$deployments_json" | grep -Eiq 'no deployments|no versions|not found|does not exist|not been deployed|404'; then
            deployments_json="[]"
        else
            printf 'Failed to inspect existing Cloudflare Worker deployments:\n%s\n' "$deployments_json" >&2
            exit "$deployments_status"
        fi
    fi
    current_version_id="$(node -e 'let deployments = []; try { deployments = JSON.parse(process.argv[1] || "[]"); } catch {} const latest = deployments.slice().sort((a, b) => String(a.created_on || "").localeCompare(String(b.created_on || ""))).at(-1); const active = latest?.versions?.find((version) => Number(version.percentage) > 0) || latest?.versions?.[0]; process.stdout.write(active?.version_id || "");' "$deployments_json")"
    if [ -n "$current_version_id" ]; then
        version_json="$(pnpm --filter @o11yfleet/worker exec wrangler "${version_args[@]}" "$current_version_id" --json)"
        if node -e 'const version = JSON.parse(process.argv[1] || "{}"); const runtime = version.resources?.script_runtime || {}; const migrations = runtime.migrations || {}; const tag = runtime.migration_tag || migrations.new_tag; process.exit(typeof tag === "string" && tag.length > 0 ? 0 : 1);' "$version_json"; then
            echo "Current Cloudflare Worker deployment already has a Durable Object migration tag; skipping Durable Object migration bootstrap"
            exit 0
        fi
    fi
    just tf-apply-worker-do-migration {{env}}

# Terraform plan that includes the static site Worker module and built assets.
tf-plan-site env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    SITE_ASSETS_DIR="$(pwd)/apps/site/dist"
    SITE_WORKER_MODULE_PATH="$(pwd)/apps/site/public/_worker.js"
    SITE_HEADERS_PATH="$(pwd)/apps/site/public/_headers"
    if [ ! -d "$SITE_ASSETS_DIR" ]; then
        printf 'Site assets directory does not exist: %s\nRun: just site-build %s\n' "$SITE_ASSETS_DIR" "{{env}}" >&2
        exit 1
    fi
    if [ ! -f "$SITE_WORKER_MODULE_PATH" ]; then
        printf 'Site Worker module does not exist: %s\n' "$SITE_WORKER_MODULE_PATH" >&2
        exit 1
    fi
    if [ ! -f "$SITE_HEADERS_PATH" ]; then
        printf 'Site headers file does not exist: %s\n' "$SITE_HEADERS_PATH" >&2
        exit 1
    fi
    cd infra/terraform
    targets=(
        -target=cloudflare_worker.site
        -target=cloudflare_dns_record.site
        -target=cloudflare_worker_version.site
        -target=cloudflare_workers_deployment.site
        -target=cloudflare_workers_route.site
    )
    terraform plan \
        "${targets[@]}" \
        -var-file=envs/{{env}}.tfvars \
        -var=manage_site_deployment=true \
        -var="site_assets_directory=$SITE_ASSETS_DIR" \
        -var="site_worker_module_path=$SITE_WORKER_MODULE_PATH" \
        -var="site_headers_path=$SITE_HEADERS_PATH"

# Terraform apply that includes the Worker code bundle and deployment rollout.
tf-apply-worker env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    BUNDLE_PATH="$(just --quiet worker-bundle {{env}})"
    if [ -z "$BUNDLE_PATH" ]; then
        echo "worker-bundle did not emit a bundle path" >&2
        exit 1
    fi
    if [ ! -f "$BUNDLE_PATH" ]; then
        printf 'Worker bundle path does not exist: %s\n' "$BUNDLE_PATH" >&2
        exit 1
    fi
    cd infra/terraform
    targets=(
        -target=cloudflare_r2_bucket.configs
        -target=cloudflare_dns_record.api
        -target=cloudflare_worker.fleet
        -target=cloudflare_worker_version.fleet
        -target=cloudflare_workers_deployment.fleet
        -target=cloudflare_workers_cron_trigger.fleet
        -target=cloudflare_workers_route.api
    )
    terraform apply \
        "${targets[@]}" \
        -var-file=envs/{{env}}.tfvars \
        -var=manage_worker_deployment=true \
        -var=worker_include_durable_object_binding=true \
        -var=worker_include_durable_object_migration=false \
        -var="worker_bundle_path=$BUNDLE_PATH" \
        -auto-approve

# Terraform apply that includes the static site Worker module and built assets.
tf-apply-site env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    SITE_ASSETS_DIR="$(pwd)/apps/site/dist"
    SITE_WORKER_MODULE_PATH="$(pwd)/apps/site/public/_worker.js"
    SITE_HEADERS_PATH="$(pwd)/apps/site/public/_headers"
    if [ ! -d "$SITE_ASSETS_DIR" ]; then
        printf 'Site assets directory does not exist: %s\nRun: just site-build %s\n' "$SITE_ASSETS_DIR" "{{env}}" >&2
        exit 1
    fi
    if [ ! -f "$SITE_WORKER_MODULE_PATH" ]; then
        printf 'Site Worker module does not exist: %s\n' "$SITE_WORKER_MODULE_PATH" >&2
        exit 1
    fi
    if [ ! -f "$SITE_HEADERS_PATH" ]; then
        printf 'Site headers file does not exist: %s\n' "$SITE_HEADERS_PATH" >&2
        exit 1
    fi
    cd infra/terraform
    targets=(
        -target=cloudflare_worker.site
        -target=cloudflare_dns_record.site
        -target=cloudflare_worker_version.site
        -target=cloudflare_workers_deployment.site
        -target=cloudflare_workers_route.site
    )
    terraform apply \
        "${targets[@]}" \
        -var-file=envs/{{env}}.tfvars \
        -var=manage_site_deployment=true \
        -var="site_assets_directory=$SITE_ASSETS_DIR" \
        -var="site_worker_module_path=$SITE_WORKER_MODULE_PATH" \
        -var="site_headers_path=$SITE_HEADERS_PATH" \
        -auto-approve

# Deploy the static site Worker and smoke-test all site surfaces.
site-deploy env="prod":
    just site-build {{env}}
    just tf-apply-site {{env}}

# Deploy control-plane resources, static site assets, D1 migrations, and Worker code.
deploy-env env="staging":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{env}}" in
      prod|production)
        TARGET="prod"
        just tf-check-prod-imports prod
        ;;
      staging)
        TARGET="staging"
        if [ "${REQUIRE_TERRAFORM_STATE_READY:-false}" = "true" ]; then
            just tf-check-staging-readiness staging
        fi
        ;;
      dev)
        TARGET="dev"
        ;;
      *)
        printf 'unknown deployment env: %s\n' "{{env}}" >&2
        exit 2
        ;;
    esac
    just tf-import-existing-workers "$TARGET"
    just tf-apply-control-plane "$TARGET"
    if [ "${AUTO_PROVISION_WORKER_SECRETS:-false}" = "true" ]; then
        just worker-secrets-put "$TARGET"
    fi
    just worker-secrets-check "$TARGET"
    just d1-migrate "$TARGET"
    just tf-apply-worker-do-migration-if-needed "$TARGET"
    just tf-apply-worker "$TARGET"
    just site-build "$TARGET"
    just tf-apply-site "$TARGET"

# Deploy staging from CI after staging has been bootstrapped/imported.
deploy-staging:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "${TERRAFORM_STAGING_DEPLOY_ENABLED:-false}" != "true" ]; then
        echo "deploy-staging is disabled; set TERRAFORM_STAGING_DEPLOY_ENABLED=true to enable it." >&2
        exit 1
    fi
    REQUIRE_TERRAFORM_STATE_READY=true just deploy-env staging

# Dry-run Cloudflare deploy/state credential bootstrap.
cloudflare-credentials-dry-run envs="dev staging prod" env_file="":
    #!/usr/bin/env bash
    set -euo pipefail
    args=(--envs "{{envs}}")
    if [ -n "{{env_file}}" ]; then
        args+=(--env-file "{{env_file}}")
    fi
    ./scripts/bootstrap-cloudflare-credentials.sh "${args[@]}"

# Create Cloudflare deploy/state credentials and store them as GitHub Environment secrets.
cloudflare-credentials-apply envs="dev staging prod" env_file="":
    #!/usr/bin/env bash
    set -euo pipefail
    args=(--apply --envs "{{envs}}")
    if [ -n "{{env_file}}" ]; then
        args+=(--env-file "{{env_file}}")
    fi
    ./scripts/bootstrap-cloudflare-credentials.sh "${args[@]}"

# Dry-run usage API token creation (read-only GraphQL Analytics).
cloudflare-usage-credentials-dry-run envs="dev staging prod":
    #!/usr/bin/env bash
    set -euo pipefail
    ./scripts/bootstrap-cloudflare-credentials.sh --usage-tokens --envs "{{envs}}"

# Create usage API tokens and write to a JSON file for wrangler ingestion.
cloudflare-usage-credentials-apply envs="dev staging prod":
    #!/usr/bin/env bash
    set -euo pipefail
    set -euo pipefail
    tmpfile="$(mktemp)"
    trap 'rm -f "$tmpfile"' EXIT
    ./scripts/bootstrap-cloudflare-credentials.sh --usage-tokens --usage-output "$tmpfile" --apply --envs "{{envs}}"
    echo ""
    echo "Usage tokens written to $tmpfile:"
    cat "$tmpfile"

# Set usage API tokens as Worker secrets for each environment.
cloudflare-usage-secrets envs="dev staging prod":
    #!/usr/bin/env bash
    set -euo pipefail
    tmpfile="$(mktemp)"
    trap 'rm -f "$tmpfile"' EXIT
    ./scripts/bootstrap-cloudflare-credentials.sh --usage-tokens --usage-output "$tmpfile" --apply --envs "{{envs}}"
    echo ""
    echo "Setting CLOUDFLARE_BILLING_API_TOKEN secrets..."
    cd apps/worker
    while IFS= read -r line; do
        env_name="$(echo "$line" | jq -r 'keys[0]')"
        token="$(echo "$line" | jq -r '.[].token')"
        if [ "$env_name" = "prod" ] || [ "$env_name" = "production" ]; then
            echo "Setting CLOUDFLARE_BILLING_API_TOKEN for production..."
            echo "$token" | pnpm wrangler versions secret put CLOUDFLARE_BILLING_API_TOKEN --name o11yfleet-worker 2>&1
        else
            echo "Setting CLOUDFLARE_BILLING_API_TOKEN for $env_name..."
            echo "$token" | pnpm wrangler versions secret put CLOUDFLARE_BILLING_API_TOKEN --env "$env_name" 2>&1
        fi
    done < <(jq -c '.' "$tmpfile")
    echo ""
    echo "Done setting billing API token secrets."

# ─── Full CI Pipeline ────────────────────────────────────────────────

# Run the extended local gate, including workerd and browser tests
ci-full: ci test-runtime test-ui
    @echo "✓ CI pipeline passed"

# ─── CLI ─────────────────────────────────────────────────────────────

# Login to o11yfleet
cli-login email="demo@o11yfleet.com" password="demo-password":
    pnpm --filter @o11yfleet/cli dev login --email {{email}} --password {{password}}

# Show current user
cli-me:
    pnpm --filter @o11yfleet/cli dev me

# List configurations
cli-configs:
    pnpm --filter @o11yfleet/cli dev config:list

# Create a configuration
cli-config-create name="test-config":
    pnpm --filter @o11yfleet/cli dev config:create --name {{name}}

# Upload config and rollout
cli-push config-id="CHANGE_ME" file="configs/basic-otlp.yaml":
    pnpm --filter @o11yfleet/cli dev config:upload --config-id {{config-id}} --file {{file}}
    pnpm --filter @o11yfleet/cli dev config:rollout --config-id {{config-id}}

# List agents
cli-agents config-id="CHANGE_ME":
    pnpm --filter @o11yfleet/cli dev agents:list --config-id {{config-id}}

# Agent stats
cli-stats config-id="CHANGE_ME":
    pnpm --filter @o11yfleet/cli dev agents:list --config-id {{config-id}} --stats

# Benchmark provisioning
cli-bench-provisioning api-key="CHANGE_ME":
    pnpm --filter @o11yfleet/cli dev bench:provisioning --api-key {{api-key}}

# Benchmark config push
cli-bench-push config-id="CHANGE_ME":
    pnpm --filter @o11yfleet/cli dev bench:config-push --config-id {{config-id}}

# Benchmark enrollment
cli-bench-enrollment config-id="CHANGE_ME" collectors="10":
    pnpm --filter @o11yfleet/cli dev bench:enrollment --config-id {{config-id}} --collectors {{collectors}}

# Mixed Config DO workload (experiment harness, issue #233)
mixed-load agents="2000" duration="300" rollout_every="30" list_rps="2" stats_rps="2" reconnect_pct="5" concurrency="100" output="./artifacts/mixed-load.json":
    mkdir -p "$(dirname "{{output}}")"
    pnpm --filter @o11yfleet/load-test mixed -- --agents={{agents}} --duration={{duration}} --rollout-every={{rollout_every}} --list-rps={{list_rps}} --stats-rps={{stats_rps}} --reconnect-pct={{reconnect_pct}} --concurrency={{concurrency}} --output={{output}}

# ─── Preview Deployments ─────────────────────────────────────────────

# Create a preview environment for local testing
preview-create name="test-preview":
    #!/usr/bin/env bash
    set -euo pipefail
    
    ENV_NAME="{{name}}"
    echo "Creating preview environment: $ENV_NAME"
    
    echo "Creating D1 database..."
    DATABASE_OUTPUT=$(npx wrangler d1 create "o11yfleet-${ENV_NAME}" --columnar --location=weur 2>&1 || echo "")
    DATABASE_ID=$(echo "$DATABASE_OUTPUT" | grep -oP 'database_id = "\K[^"]+' || echo "")
    
    if [ -z "$DATABASE_ID" ]; then
        echo "Failed to create D1 database"
        exit 1
    fi
    
    echo "Database created: $DATABASE_ID"
    echo "export PREVIEW_DB_ID='$DATABASE_ID'" > .preview-${ENV_NAME}.env
    echo "export PREVIEW_ENV_NAME='$ENV_NAME'" >> .preview-${ENV_NAME}.env
    echo "Created .preview-${ENV_NAME}.env with database ID"

# Deploy a preview environment
preview-deploy name="test-preview":
    #!/usr/bin/env bash
    set -euo pipefail
    
    ENV_NAME="{{name}}"
    
    if [ ! -f ".preview-${ENV_NAME}.env" ]; then
        echo "Preview environment not found. Run: just preview-create $ENV_NAME"
        exit 1
    fi
    
    source ".preview-${ENV_NAME}.env"
    
    echo "Applying migrations..."
    cd apps/worker
    cat > /tmp/wrangler-migrate.toml << TOML
    name = "o11yfleet-preview"
    main = "src/index.ts"
    compatibility_date = "2026-04-29"
    d1_databases = [
      { binding = "FP_DB", database_name = "o11yfleet-${PREVIEW_ENV_NAME}", database_id = "${PREVIEW_DB_ID}", migrations_dir = "../../packages/db/migrations" }
    ]
    TOML
    pnpm exec wrangler d1 migrations apply "o11yfleet-${PREVIEW_ENV_NAME}" --remote --config /tmp/wrangler-migrate.toml
    
    echo "Deploying worker..."
    cat wrangler.jsonc | jq '
      .env |= (. + {
        "'"${PREVIEW_ENV_NAME}"'": {
          "main": "src/instrumented.ts",
          "routes": [],
          "vars": { "ENVIRONMENT": "'"${PREVIEW_ENV_NAME}"'" },
          "d1_databases": [
            { binding = "FP_DB", database_name = "o11yfleet-'"${PREVIEW_ENV_NAME}"'", database_id = "'"${PREVIEW_DB_ID}"'", migrations_dir = "../../packages/db/migrations" }
          ]
        }
      })
    ' > wrangler-preview.jsonc
    
    pnpm exec wrangler deploy --env "${PREVIEW_ENV_NAME}" --config wrangler-preview.jsonc --secrets-file apps/worker/.dev.vars
    rm -f wrangler-preview.jsonc
    
    echo ""
    echo "Preview deployed!"
    ACCOUNT_ID=$(npx wrangler whoami 2>/dev/null | grep "Account ID" | awk '{print $NF')
    echo "URL: https://o11yfleet-worker.${PREVIEW_ENV_NAME}.${ACCOUNT_ID}.workers.dev"

# Cleanup a preview environment
preview-cleanup name="test-preview":
    #!/usr/bin/env bash
    set -euo pipefail
    
    ENV_NAME="{{name}}"
    
    echo "Cleaning up preview environment: $ENV_NAME"
    cd apps/worker
    pnpm exec wrangler delete --env "${ENV_NAME}" --force 2>/dev/null || echo "Worker already deleted or not found"
    cd ..
    npx wrangler d1 delete "o11yfleet-${ENV_NAME}" --force 2>/dev/null || echo "Database already deleted or not found"
    rm -f ".preview-${ENV_NAME}.env"
    echo "Preview environment cleaned up"

# List active preview environments
preview-list:
    #!/usr/bin/env bash
    set -euo pipefail
    
    echo "Checking for preview D1 databases..."
    npx wrangler d1 list 2>/dev/null | grep "o11yfleet-pr-" || echo "No preview databases found"

