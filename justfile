# FleetPlane — o11yfleet

# Default recipe
default:
    @just --list

# Install dependencies
install:
    pnpm install

# Lint all packages
lint:
    pnpm turbo lint

# Type check all packages
typecheck:
    pnpm turbo typecheck

# Run all tests
test:
    pnpm turbo test

# Run all CI checks
ci: lint typecheck test fmt-check

# Format code
fmt:
    pnpm prettier --write .

# Check formatting
fmt-check:
    pnpm prettier --check .

# Dev mode — start worker locally
dev:
    cd apps/worker && pnpm wrangler dev

# Dev mode — start management UI
ui:
    cd apps/web && npx serve public -l 3000 -s

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

# Load test (default: 50 agents, 60s)
load-test agents="50" duration="60":
    pnpm tsx scripts/load-test.ts --agents {{agents}} --duration {{duration}}

# Quick smoke load test (10 agents, 15s)
load-test-smoke:
    pnpm tsx scripts/load-test.ts --agents 10 --duration 15 --ramp 10

# Heavy load test (200 agents, 120s)
load-test-heavy:
    ulimit -n 4096 && pnpm tsx scripts/load-test.ts --agents 200 --duration 120 --ramp 20

# Scale load test (500 agents, 180s)
load-test-scale:
    ulimit -n 8192 && pnpm tsx scripts/load-test.ts --agents 500 --duration 180 --ramp 25

# Run benchmark suite
bench:
    pnpm tsx experiments/src/benchmark.ts

# Run benchmark and save results to file
bench-save:
    pnpm tsx experiments/src/benchmark.ts 2>&1 | tee experiments/benchmark-results.txt

# Check worker bundle size (dry-run deploy)
bundle-size:
    #!/usr/bin/env bash
    cd apps/worker
    npx wrangler deploy --dry-run --outdir dist 2>&1 | tail -5 || true
    BUNDLE=$(find dist -name '*.js' -o -name '*.mjs' 2>/dev/null | head -1)
    if [ -z "$BUNDLE" ]; then echo "⚠ No bundle found"; exit 0; fi
    RAW=$(wc -c < "$BUNDLE" | tr -d ' ')
    GZ=$(gzip -c "$BUNDLE" | wc -c | tr -d ' ')
    echo "Raw: $((RAW / 1024)) KB  |  Gzip: $((GZ / 1024)) KB"

# Run property-based tests only
test-properties:
    pnpm --filter @o11yfleet/core vitest run test/state-machine-properties.test.ts

# Run core tests only (fast, no workerd)
test-core:
    pnpm --filter @o11yfleet/core test

# Run worker tests only (workerd runtime)
test-worker:
    pnpm --filter @o11yfleet/worker test

# CI load test with pass/fail criteria (25 agents, 30s)
load-test-ci:
    pnpm tsx scripts/load-test.ts --agents 25 --duration 30 --ramp 10 --ci

# CPU profile load test (200 agents, 60s, generates .cpuprofile)
load-test-profile:
    ulimit -n 4096 && node --cpu-prof --cpu-prof-dir=./profiles --import tsx/esm scripts/load-test.ts --agents 200 --duration 60 --ramp 20

# ─── E2E & UI Testing ───────────────────────────────────────────────

# Full-stack E2E tests (requires `just dev` running)
test-e2e:
    cd tests/e2e && pnpm run test:e2e

# UI tests with Playwright (requires `just dev` + `just ui` running)
test-ui:
    cd tests/ui && pnpm run test:e2e

# Install Playwright browsers (one-time setup)
playwright-install:
    cd tests/ui && npx playwright install --with-deps chromium

# ─── Infrastructure ──────────────────────────────────────────────────

# Terraform validate
tf-validate:
    cd infra/terraform && terraform validate

# Deploy to staging
deploy-staging:
    cd apps/worker && pnpm wrangler deploy --env staging

# Run benchmarks
bench:
    pnpm --filter @o11yfleet/experiments bench

# ─── Full CI Pipeline ────────────────────────────────────────────────

# Run the full CI pipeline locally (lint + typecheck + unit tests)
ci-full: lint typecheck test
    @echo "✓ CI pipeline passed"
