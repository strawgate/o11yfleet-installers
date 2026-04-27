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
ci: lint typecheck test

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

# Terraform validate
tf-validate:
    cd infra/terraform && terraform validate

# Deploy to staging
deploy-staging:
    cd apps/worker && pnpm wrangler deploy --env staging

# Run benchmarks
bench:
    pnpm --filter @o11yfleet/experiments bench
