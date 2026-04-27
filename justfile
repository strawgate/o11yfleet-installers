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

# Generate protobuf types
proto-gen:
    cd packages/core && pnpm buf generate

# Database migrations (local)
db-migrate:
    cd apps/worker && pnpm wrangler d1 migrations apply fp-db --local

# Database seed (local)
db-seed:
    cd packages/db && pnpm tsx src/seed.ts

# Terraform validate
tf-validate:
    cd infra/terraform && terraform validate

# Deploy to staging
deploy-staging:
    cd apps/worker && pnpm wrangler deploy --env staging

# Health check
healthz:
    curl -s http://localhost:8787/healthz | jq .
