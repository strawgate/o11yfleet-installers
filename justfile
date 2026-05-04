# o11yFleet - OpAMP fleet management on Cloudflare Workers

set shell := ["bash", "-eu", "-c"]
set dotenv-load := true

DEPLOY_ENVS := "prod staging dev"

TF_TARGETS := "-target=cloudflare_d1_database.fleet -target=cloudflare_r2_bucket.configs -target=cloudflare_dns_record.api -target=cloudflare_dns_record.site -target=cloudflare_worker.fleet -target=cloudflare_worker.site"
TF_WORKER_TARGETS := "-target=cloudflare_r2_bucket.configs -target=cloudflare_dns_record.api -target=cloudflare_worker.fleet -target=cloudflare_worker_version.fleet -target=cloudflare_workers_deployment.fleet -target=cloudflare_workers_cron_trigger.fleet -target=cloudflare_workers_route.api"
TF_SITE_TARGETS := "-target=cloudflare_worker.site -target=cloudflare_dns_record.site -target=cloudflare_worker_version.site -target=cloudflare_workers_deployment.site -target=cloudflare_workers_route.site"
TF_DO_MIGRATION_TARGETS := "-target=cloudflare_r2_bucket.configs -target=cloudflare_worker.fleet -target=cloudflare_worker_version.fleet -target=cloudflare_workers_deployment.fleet"

[group: 'meta']
default:
    @just --list

# ─── Setup ─────────────────────────────────────────────────────────────────────

[group: 'setup']
install:
    pnpm install

[group: 'setup']
doctor:
    #!/usr/bin/env bash
    set -euo pipefail
    FAIL=0
    echo "=== o11yFleet Environment Check ==="
    node --version | grep -qE "^v(2[2-9]|[3-9][0-9])\." && echo "✓ Node.js 22+" || { echo "✗ Node.js 22+ required"; FAIL=1; }
    pnpm --version | grep -qE "^(9|[1-9][0-9])\." && echo "✓ pnpm 9+" || { echo "✗ pnpm 9+ required"; FAIL=1; }
    just --version | grep -qE "[0-9]+\.[0-9]+" && echo "✓ just" || { echo "✗ just required"; FAIL=1; }
    npx wrangler --version | grep -qE "^[0-9]+\." && echo "✓ wrangler" || { echo "✗ wrangler required"; FAIL=1; }
    if [ -f apps/worker/.dev.vars ]; then echo "✓ .dev.vars exists"; else echo "✗ .dev.vars missing"; FAIL=1; fi
    if npx wrangler whoami &>/dev/null; then echo "✓ Cloudflare authenticated"; else echo "✗ Cloudflare not authenticated"; FAIL=1; fi
    if [ "$FAIL" -eq 0 ]; then echo "✓ Environment ready!"; else echo "✗ Fix issues above"; exit 1; fi

[group: 'setup']
playwright-install:
    cd tests/ui && npx playwright install --with-deps chromium

# ─── Dev ─────────────────────────────────────────────────────────────────────────

[group: 'dev']
dev:
    cd apps/worker && pnpm wrangler dev --var ENVIRONMENT:dev

[group: 'dev']
ui:
    cd apps/site && pnpm dev

[group: 'dev']
dev-up:
    pnpm tsx scripts/dev-up.ts

[group: 'dev']
dev-reset: db-migrate seed
    @echo "Local dev reset complete."

[group: 'dev']
db-migrate:
    cd apps/worker && CI=1 pnpm wrangler d1 migrations apply fp-db --local

[group: 'dev']
seed:
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/seed-local.ts

[group: 'dev']
admin-login *args:
    @pnpm tsx scripts/admin-login.ts {{args}}

[group: 'dev']
healthz:
    curl -s http://localhost:8787/healthz | jq .

[group: 'dev']
fleet:
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/show-fleet.ts

# ─── CI ──────────────────────────────────────────────────────────────────────────

[group: 'ci']
check *args:
    pnpm tsx scripts/dev-check.ts {{args}}

[group: 'ci']
check-staged:
    pnpm tsx scripts/dev-check.ts --staged

[group: 'ci']
precommit:
    pnpm tsx scripts/dev-check.ts --staged --quiet

[group: 'ci']
fmt:
    pnpm prettier --write .

[group: 'ci']
lint:
    pnpm turbo lint

[group: 'ci']
lint-prose:
    pnpm lint:prose

[group: 'ci']
typecheck:
    pnpm turbo typecheck

[group: 'ci']
test:
    pnpm turbo test

[group: 'ci']
test-core:
    pnpm --filter @o11yfleet/core test

[group: 'ci']
test-worker:
    pnpm --filter @o11yfleet/worker test

[group: 'ci']
test-runtime:
    pnpm --filter @o11yfleet/worker test:runtime

[group: 'ci']
test-ui:
    cd tests/ui && pnpm run test:e2e

[group: 'ci']
test-ui-smoke:
    # Run smoke tests only (page loads, fast)
    cd tests/ui && pnpm run test:e2e --grep "smoke"

[group: 'ci']
test-ui-flows:
    # Run interaction/flow tests
    cd tests/ui && pnpm run test:e2e --grep "flows|error states|navigation|form|table|responsive"

[group: 'ci']
test-ui-screenshots:
    # Capture screenshots for smoke tests only
    cd tests/ui && PLAYWRIGHT_CAPTURE_ALL_SCREENSHOTS=1 pnpm run test:e2e --grep "smoke"

[group: 'ci']
test-ui-ai-screenshots:
    # Capture AI-optimized screenshots (with content waits)
    cd tests/ui && PLAYWRIGHT_CAPTURE_ALL_SCREENSHOTS=1 pnpm run test:e2e --grep "screenshots for AI"

[group: 'ci']
test-ui-ai-audit:
    # Capture full AI audit: screenshots + DOM snapshots + a11y trees
    cd tests/ui && pnpm run test:e2e --grep "AI audit"

[group: 'ci']
test-ui-ui:
    # Open Playwright debug UI
    cd tests/ui && pnpm exec playwright test --ui

[group: 'ci']
typegen-check:
    pnpm --filter @o11yfleet/worker typegen:check

[group: 'ci']
sql-audit:
    pnpm tsx scripts/audit-sql-bindings.ts

[group: 'ci']
docs-api-check:
    pnpm tsx scripts/check-api-docs.ts

[group: 'ci']
ci: typegen-check lint lint-prose typecheck test

[group: 'ci']
ci-full: ci test-runtime test-ui

[group: 'ci']
ci-check name:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{name}}" in
      lint-typecheck) pnpm turbo lint && pnpm turbo typecheck ;;
      test-fast) pnpm turbo test ;;
      test-slow) pnpm --filter @o11yfleet/worker test:runtime ;;
      deploy-validate) just bundle tf-validate ;;
      *) echo "Unknown check: {{name}}" >&2; exit 1 ;;
    esac

# ─── Build ──────────────────────────────────────────────────────────────────────

[group: 'build']
bundle:
    just worker-bundle

[group: 'build']
worker-bundle env="prod" out="apps/worker/dist":
    #!/usr/bin/env bash
    set -euo pipefail
    WRANGLER_ENV=""
    case "{{env}}" in prod|production) WRANGLER_ENV="staging" ;; staging|dev) WRANGLER_ENV="{{env}}" ;; local|"") WRANGLER_ENV="" ;; *) echo "unknown env: {{env}}" >&2; exit 1 ;; esac
    OUT_DIR="$(cd "{{justfile_directory()}}" && echo "$(pwd)/{{out}}")"
    rm -rf "$OUT_DIR" && mkdir -p "$OUT_DIR"
    cd apps/worker
    # Use --dry-run --outdir to build without deploying (works without Cloudflare credentials)
    if [ -n "$WRANGLER_ENV" ]; then pnpm exec wrangler deploy --dry-run --env "$WRANGLER_ENV" --outdir "$OUT_DIR"; else pnpm exec wrangler deploy --dry-run --env="" --outdir "$OUT_DIR"; fi
    # Fallback: esbuild direct (if wrangler fails)
    if [ ! -f "$OUT_DIR/index.js" ]; then
        pnpm exec esbuild src/instrumented.ts --bundle --outfile="$OUT_DIR/instrumented.js" --format=esm --platform=browser --target=es2022 2>/dev/null || true
    fi
    BUNDLES=($(find "$OUT_DIR" -type f \( -name '*.js' -o -name '*.mjs' \) | sort))
    if [ ${#BUNDLES[@]} -eq 0 ]; then echo "No bundle found"; exit 1; fi
    if [ ${#BUNDLES[@]} -ne 1 ]; then echo "Expected 1 bundle, found ${#BUNDLES[@]}"; exit 1; fi
    echo "${BUNDLES[0]}"

[group: 'build']
site-build env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    API_URL="$(just --quiet env-url {{env}})"
    VITE_O11YFLEET_API_URL="$API_URL" pnpm --filter @o11yfleet/site run build

# ─── Deploy ─────────────────────────────────────────────────────────────────────

[group: 'deploy']
deploy env="staging":
    #!/usr/bin/env bash
    set -euo pipefail
    TARGET="{{env}}"
    just site-build "$TARGET"
    just tf-init-remote "$TARGET"
    just tf-import "$TARGET"
    just tf-apply "$TARGET"
    just secrets-check "$TARGET"
    just d1-migrate "$TARGET"
    just deploy-worker "$TARGET"
    just deploy-site "$TARGET"

[group: 'deploy']
deploy-worker env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    BUNDLE_PATH="$(just --quiet worker-bundle {{env}})"
    [ -f "$BUNDLE_PATH" ] || { echo "Bundle not found: $BUNDLE_PATH"; exit 1; }
    just tf-init-remote {{env}}
    cd infra/terraform
    terraform apply {{TF_WORKER_TARGETS}} -var-file=envs/{{env}}.tfvars -var=manage_worker_deployment=true -var=worker_include_durable_object_binding=true -var=worker_include_durable_object_migration=false -var="worker_bundle_path=$BUNDLE_PATH" -auto-approve

[group: 'deploy']
deploy-site env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    SITE_ASSETS_DIR="$(pwd)/apps/site/dist"
    SITE_WORKER_MODULE_PATH="$(pwd)/apps/site/public/_worker.js"
    SITE_HEADERS_PATH="$(pwd)/apps/site/public/_headers"
    [ -d "$SITE_ASSETS_DIR" ] || { echo "Run just site-build first"; exit 1; }
    [ -f "$SITE_WORKER_MODULE_PATH" ] || { echo "Missing: $SITE_WORKER_MODULE_PATH"; exit 1; }
    [ -f "$SITE_HEADERS_PATH" ] || { echo "Missing: $SITE_HEADERS_PATH"; exit 1; }
    cd infra/terraform
    terraform apply {{TF_SITE_TARGETS}} -var-file=envs/{{env}}.tfvars -var=manage_site_deployment=true -var="site_assets_directory=$SITE_ASSETS_DIR" -var="site_worker_module_path=$SITE_WORKER_MODULE_PATH" -var="site_headers_path=$SITE_HEADERS_PATH" -auto-approve

# ─── Terraform ─────────────────────────────────────────────────────────────────

[group: 'tf']
tf-init:
    cd infra/terraform && TF_DATA_DIR=.terraform/validate terraform init -backend=false

[group: 'tf']
tf-validate: tf-init
    cd infra/terraform && TF_DATA_DIR=.terraform/validate terraform validate

[group: 'tf']
tf-init-remote env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    : "${TFSTATE_WORKER_URL:?Set TFSTATE_WORKER_URL}"
    : "${TFSTATE_USERNAME:?Set TFSTATE_USERNAME}"
    : "${TFSTATE_PASSWORD:?Set TFSTATE_PASSWORD}"
    cd infra/terraform
    terraform init -reconfigure \
        -backend-config="address=${TFSTATE_WORKER_URL%/}/states/{{env}}" \
        -backend-config="lock_address=${TFSTATE_WORKER_URL%/}/states/{{env}}/lock" \
        -backend-config="unlock_address=${TFSTATE_WORKER_URL%/}/states/{{env}}/lock" \
        -backend-config="lock_method=LOCK" \
        -backend-config="unlock_method=UNLOCK" \
        -backend-config="username=${TFSTATE_USERNAME}" \
        -backend-config="password=${TFSTATE_PASSWORD}"

[group: 'tf']
tf-plan env="staging": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    cd infra/terraform
    terraform plan {{TF_TARGETS}} -var-file=envs/{{env}}.tfvars

[group: 'tf']
tf-apply env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    cd infra/terraform
    terraform apply {{TF_TARGETS}} -var-file=envs/{{env}}.tfvars -auto-approve

[group: 'tf']
tf-import env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    just tf-init-remote {{env}}
    : "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"
    cd infra/terraform
    for spec in "cloudflare_worker.fleet:o11yfleet-worker" "cloudflare_worker.site:o11yfleet-site-worker"; do
        addr="${spec%%:*}"
        name="${spec#*:}"
        if ! terraform state show "$addr" >/dev/null 2>&1; then
            terraform import -var-file=envs/{{env}}.tfvars "$addr" "${CLOUDFLARE_ACCOUNT_ID}/${name}" 2>&1 || true
        fi
    done

# ─── Smoke ──────────────────────────────────────────────────────────────────────

[group: 'smoke']
smoke:
    pnpm tsx scripts/with-local-env.ts -- pnpm --filter @o11yfleet/load-test smoke

[group: 'smoke']
smoke-collector:
    pnpm tsx scripts/with-local-env.ts -- pnpm tsx scripts/smoke-collector/run.ts

[group: 'smoke']
smoke-aliases env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    api_url="$(just --quiet env-url {{env}})"
    curl -sf "$api_url/healthz" >/dev/null && echo "api ok" || { echo "api failed"; exit 1; }

# CI aliases
[group: 'ci']
deploy-staging:
    just deploy staging

[group: 'ci']
smoke-aliases-ci env="prod":
    just smoke-aliases {{env}}

[group: 'ci']
env-site-smoke-targets env="prod":
    just env-url {{env}}

[group: 'ci']
tf-check-staging-readiness env="prod":
    just tf-import {{env}}

# ─── Load ────────────────────────────────────────────────────────────────────────

[group: 'load']
load-test agents="50" ramp="10" steady="30":
    pnpm --filter @o11yfleet/load-test load -- --agents={{agents}} --ramp={{ramp}} --steady={{steady}}

# ─── Infra Helpers ───────────────────────────────────────────────────────────────

[group: 'infra']
env-url env="prod":
    #!/usr/bin/env bash
    case "{{env}}" in
      prod|production) printf '%s\n' "https://api.o11yfleet.com" ;;
      staging) printf '%s\n' "https://staging-api.o11yfleet.com" ;;
      dev) printf '%s\n' "https://dev-api.o11yfleet.com" ;;
      *) echo "unknown env: {{env}}" >&2; exit 1 ;;
    esac

[group: 'infra']
d1-migrate env="prod": (tf-init-remote env)
    #!/usr/bin/env bash
    set -euo pipefail
    DB_NAME="fp-db"
    [ "{{env}}" != "prod" ] && DB_NAME="o11yfleet-{{env}}-db"
    cd infra/terraform
    D1_DATABASE_ID="$(terraform output -raw d1_database_id)"
    TMP_CONFIG="$(mktemp)"
    trap 'rm -f "$TMP_CONFIG"' EXIT
    node -e 'const fs=require("node:fs");const[c,n,i]=process.argv.slice(1);fs.writeFileSync(c,JSON.stringify({name:"o11yfleet-d1-migrations",main:"src/index.ts",compatibility_date:"2026-04-29",d1_databases:[{binding:"FP_DB",database_name:n,database_id:i,migrations_dir:"../../packages/db/migrations"}]},null,2));' "$TMP_CONFIG" "$DB_NAME" "$D1_DATABASE_ID"
    pnpm --filter @o11yfleet/worker exec wrangler d1 migrations apply "$DB_NAME" --remote --config "$TMP_CONFIG"

[group: 'infra']
secrets-check env="prod":
    #!/usr/bin/env bash
    set -euo pipefail
    REQUIRED="O11YFLEET_API_BEARER_SECRET O11YFLEET_CLAIM_HMAC_SECRET O11YFLEET_SEED_ADMIN_EMAIL O11YFLEET_SEED_ADMIN_PASSWORD"
    for name in $REQUIRED; do
        if [ -z "${!name:-}" ]; then echo "Missing env: $name"; exit 1; fi
    done
    echo "All required secrets present"
