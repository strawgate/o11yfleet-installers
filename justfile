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

        API_SECRET=$(read_dev_var API_SECRET)
        if [ -z "$API_SECRET" ] || [[ "$API_SECRET" == dev-local* ]]; then
            echo "✗ API_SECRET missing or placeholder — update .dev.vars with a real value"
            FAIL=1
        else
            echo "✓ API_SECRET set in .dev.vars"
        fi
        CLAIM_SECRET=$(read_dev_var CLAIM_SECRET)
        if [ -z "$CLAIM_SECRET" ] || [[ "$CLAIM_SECRET" == dev-local* ]]; then
            echo "✗ CLAIM_SECRET missing or placeholder — update .dev.vars with a real value"
            FAIL=1
        else
            echo "✓ CLAIM_SECRET set in .dev.vars"
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
check:
    pnpm tsx scripts/dev-check.ts

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

# Lint all packages
lint:
    pnpm turbo lint

# Type check all packages
typecheck:
    pnpm turbo typecheck

# Run fast unit tests
test:
    pnpm turbo test

# Run all fast CI checks
ci: typegen-check check-all lint-scripts test-dev-check docs-api-check fmt-check

# Format code
fmt:
    pnpm prettier --write .

# Check formatting
fmt-check:
    pnpm prettier --cache --cache-location node_modules/.cache/prettier/.prettier-cache --check .

# Check API docs against current worker routes
docs-api-check:
    pnpm tsx scripts/check-api-docs.ts

# Dev mode — start worker locally
dev:
    cd apps/worker && pnpm wrangler dev

# Dev mode — start management UI
ui:
    cd apps/site && pnpm dev

# Generate protobuf types
proto-gen:
    cd packages/core && pnpm buf generate

# Database migrations (local)
db-migrate:
    cd apps/worker && pnpm wrangler d1 migrations apply fp-db --local

# Seed local dev environment (creates tenant, config, enrollment token)
seed:
    npx tsx scripts/seed-local.ts

# Re-seed (destroys and recreates local dev state)
seed-reset:
    npx tsx scripts/seed-local.ts --reset

# Start a fake OTel Collector (connects to local worker via OpAMP)
collector name="fake-collector":
    npx tsx scripts/fake-collector.ts --name {{name}}

# Start multiple fake collectors
collectors count="3":
    #!/usr/bin/env bash
    for i in $(seq 1 {{count}}); do
        npx tsx scripts/fake-collector.ts --name "collector-$i" &
    done
    echo "Started {{count}} collectors. Press Ctrl+C to stop all."
    wait

# Upload a YAML config and roll it out to connected agents
push-config file="configs/basic-otlp.yaml":
    npx tsx scripts/push-config.ts {{file}}

# Show fleet status (agents, configs, stats)
fleet:
    npx tsx scripts/show-fleet.ts

# Health check
healthz:
    curl -s http://localhost:8787/healthz | jq .

# Full local dev setup: migrate, seed, show status
setup: db-migrate seed fleet

# Run benchmark suite
bench:
    pnpm tsx experiments/src/benchmark.ts

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
worker-bundle out="apps/worker/dist":
    #!/usr/bin/env bash
    set -euo pipefail
    REPO_ROOT="$(pwd)"
    OUT_DIR="$(node -e 'const path = require("node:path"); const root = path.resolve(process.argv[1]); const out = path.resolve(root, process.argv[2]); if (out === root || !out.startsWith(root + path.sep)) process.exit(1); process.stdout.write(out)' "$REPO_ROOT" "{{out}}")" || {
        printf 'worker-bundle out must stay under %s: %s\n' "$REPO_ROOT" "{{out}}" >&2
        exit 1
    }
    rm -rf "$OUT_DIR"
    mkdir -p "$OUT_DIR"
    cd apps/worker
    pnpm exec wrangler deploy --env="" --dry-run --outdir "$OUT_DIR" >&2
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
    pnpm --filter @o11yfleet/load-test smoke

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

# UI tests with Playwright (starts the site dev server automatically)
test-ui:
    cd tests/ui && pnpm run test:e2e

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

# Terraform init against the shared remote state backend.
tf-init-remote env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    : "${TF_STATE_BUCKET:?Set TF_STATE_BUCKET to the R2 state bucket name}"
    : "${TF_STATE_ENDPOINT:?Set TF_STATE_ENDPOINT to the R2 S3 endpoint URL}"
    : "${AWS_ACCESS_KEY_ID:?Set AWS_ACCESS_KEY_ID to the R2 access key ID}"
    : "${AWS_SECRET_ACCESS_KEY:?Set AWS_SECRET_ACCESS_KEY to the R2 secret access key}"
    cd infra/terraform
    shared_backend_args=(
        -backend-config="bucket=${TF_STATE_BUCKET}"
        -backend-config="key=o11yfleet/{{env}}/terraform.tfstate"
        -backend-config="region=${TF_STATE_REGION:-auto}"
        -backend-config="skip_credentials_validation=true"
        -backend-config="skip_metadata_api_check=true"
        -backend-config="skip_region_validation=true"
    )
    modern_backend_args=(
        -backend-config="endpoints={s3=\"${TF_STATE_ENDPOINT}\"}"
        -backend-config="skip_requesting_account_id=true"
        -backend-config="skip_s3_checksum=true"
        -backend-config="use_path_style=true"
    )
    legacy_backend_args=(
        -backend-config="endpoint=${TF_STATE_ENDPOINT}"
        -backend-config="force_path_style=true"
    )
    set +e
    init_output=$(terraform init -reconfigure "${shared_backend_args[@]}" "${modern_backend_args[@]}" 2>&1)
    init_status=$?
    set -e
    printf '%s\n' "$init_output"
    if [ "$init_status" -eq 0 ]; then
        exit 0
    fi
    if grep -q "not expected for the selected backend type" <<< "$init_output"; then
        terraform init -reconfigure "${shared_backend_args[@]}" "${legacy_backend_args[@]}"
        exit 0
    fi
    exit "$init_status"

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
    cd infra/terraform
    terraform plan "${refresh_arg[@]}" -var-file=envs/{{env}}.tfvars

# Terraform plan for PR validation while remote state is still provider-v4 shaped.
tf-plan-empty-state env="staging":
    #!/usr/bin/env bash
    set -euo pipefail
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    cp -R infra/terraform/. "$tmp/"
    perl -0pi -e 's/\n\s*backend\s+"s3"\s*\{[^{}]*\}\s*/\n/s or die "backend block not found\n"' "$tmp/main.tf"
    cd "$tmp"
    terraform init -backend=false
    terraform plan -refresh=false -var-file=envs/{{env}}.tfvars

# Verify production imports are in remote state before enabling v5 apply paths.
tf-check-prod-imports env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    cd infra/terraform
    # These production resources must be adopted before cutover; split Pages
    # projects/domains may still be created by Terraform during rollout.
    required=(
        cloudflare_d1_database.fleet
        cloudflare_r2_bucket.configs
        cloudflare_queue.events
        cloudflare_dns_record.api
        cloudflare_worker.fleet
        cloudflare_workers_route.api
        cloudflare_queue_consumer.events
    )
    missing=()
    for resource in "${required[@]}"; do
        if ! terraform state show "$resource" >/dev/null 2>&1; then
            missing+=("$resource")
        fi
    done
    if [ "${#missing[@]}" -ne 0 ]; then
        printf 'Missing required imported resources in %s remote state:\n' "{{env}}" >&2
        printf ' - %s\n' "${missing[@]}" >&2
        printf 'Import these before setting TERRAFORM_PROVIDER_V5_STATE_READY=true.\n' >&2
        exit 1
    fi

# Terraform apply for an environment tfvars file against remote state.
tf-apply env="prod": (tf-init-remote env)
    cd infra/terraform && terraform apply -var-file=envs/{{env}}.tfvars -auto-approve

# Terraform plan that includes the Worker code bundle and deployment rollout.
tf-plan-worker env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    BUNDLE_PATH="$(just --quiet worker-bundle)"
    if [ -z "$BUNDLE_PATH" ]; then
        echo "worker-bundle did not emit a bundle path" >&2
        exit 1
    fi
    if [ ! -f "$BUNDLE_PATH" ]; then
        printf 'Worker bundle path does not exist: %s\n' "$BUNDLE_PATH" >&2
        exit 1
    fi
    cd infra/terraform
    terraform plan \
        -var-file=envs/{{env}}.tfvars \
        -var=manage_worker_deployment=true \
        -var="worker_bundle_path=$BUNDLE_PATH"

# Terraform apply that includes the Worker code bundle and deployment rollout.
tf-apply-worker env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    BUNDLE_PATH="$(just --quiet worker-bundle)"
    if [ -z "$BUNDLE_PATH" ]; then
        echo "worker-bundle did not emit a bundle path" >&2
        exit 1
    fi
    if [ ! -f "$BUNDLE_PATH" ]; then
        printf 'Worker bundle path does not exist: %s\n' "$BUNDLE_PATH" >&2
        exit 1
    fi
    cd infra/terraform
    terraform apply \
        -var-file=envs/{{env}}.tfvars \
        -var=manage_worker_deployment=true \
        -var="worker_bundle_path=$BUNDLE_PATH" \
        -auto-approve

# Legacy staging deploy path. Move this to tf-apply-worker staging after staging
# remote state imports mirror the production Terraform-managed Worker rollout.
deploy-staging:
    cd apps/worker && pnpm wrangler deploy --env staging
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
