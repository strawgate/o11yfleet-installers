# Developer Loop

## Quick Start

```bash
just dev-up          # Starts BOTH Worker + Site with migrations and seed data
```

That's it. `just dev-up` starts everything you need:

- Worker at http://localhost:8787 (API + OpAMP)
- Site at http://127.0.0.1:3000 (Portal + Admin UI)
- Applies D1 migrations automatically
- Seeds local data (tenant, config, enrollment token)

Then run tests in another terminal:

```bash
just test-ui          # Playwright browser tests
```

## The Dev Loop

```bash
just dev-up          # Start everything (do this once)
just check           # Run checks affected by your changes
just dev-reset      # Reset seed data if things get weird
```

`just check` runs `scripts/dev-check.ts`, which compares the current worktree to
`origin/main`, includes staged and untracked files, and runs only the checks
affected by those files. Use `just check-staged` for the pre-commit gate and
`just check-json` when an editor or agent needs the plan without executing it.

## Common Commands

### Starting the dev stack

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `just dev-up`       | Start Worker + Site, run migrations, seed data |
| `just dev-up-reset` | Fresh seed (destroys local data)               |
| `just dev`          | Worker only (port 8787)                        |
| `just ui`           | Site only (port 3000) — frontend only, no API  |

> **Important:** `pnpm dev` or `pnpm dev -r` is frontend-only. Use `just dev-up` for full-stack development.

### Testing

| Command            | What it does                    | Needs running server?     |
| ------------------ | ------------------------------- | ------------------------- |
| `just test`        | Fast unit tests (Core + Worker) | No                        |
| `just test-ui`     | Playwright browser tests        | No (starts its own)       |
| `just smoke-local` | API + OpAMP smoke test          | Yes (`just dev-up` first) |

One-time Playwright setup:

Dependencies must be installed (`just install` or `pnpm install`) before running local app loop commands.

```bash
just playwright-install
```

### Pre-commit / Pre-push

```bash
just check-staged    # Run checks on staged files (pre-commit hook)
just ci-fast         # Full lint + typecheck + test (before pushing)
```

## GitHub Check Mapping

Use `just reproduce-check <name>` to run one GitHub check locally.

| GitHub check         | Local command                             |
| -------------------- | ----------------------------------------- |
| `lint-typecheck`     | `just reproduce-check lint-typecheck`     |
| `test-fast`          | `just reproduce-check test-fast`          |
| `test-slow`          | `just reproduce-check test-slow`          |
| `deploy-validate`    | `just reproduce-check deploy-validate`    |
| Terraform `validate` | `just reproduce-check terraform-validate` |
| Terraform `plan`     | `just reproduce-check terraform-plan`     |

For a full pre-PR pass:

```bash
just ci-pr
```

For a faster non-browser gate:

```bash
just ci-fast
```

## UI Testing

```bash
just test-ui
```

UI tests run in Playwright. First-time setup requires `just playwright-install`.
Because UI tests interact with the site which proxies to the API backend, **the API worker must be running** (`just dev` or `just dev-up`) in a separate terminal before starting `just test-ui`. Playwright will automatically start the Vite site frontend, but not the API worker.

## Changed-File Check Options

```bash
pnpm tsx scripts/dev-check.ts --since origin/main
pnpm tsx scripts/dev-check.ts --staged
pnpm tsx scripts/dev-check.ts --all
pnpm tsx scripts/dev-check.ts --json
```

The normal text output explains which checks are skipped or run and prints
per-step timings. The JSON output is plan-only and does not run commands.

## Troubleshooting

### Environment setup

```bash
just doctor          # Check if your environment is ready
```

If `just doctor` fails:

- Missing `.dev.vars`: `cp apps/worker/.dev.vars.example apps/worker/.dev.vars`
- Cloudflare not authenticated: `npx wrangler login`
- Missing secrets: `just ensure-dev-secrets`

### Common issues

| Problem                 | Solution                               |
| ----------------------- | -------------------------------------- |
| `just dev-up` hangs     | Check if ports 8787 or 3000 are in use |
| Tests fail after pull   | `just dev-reset` to re-seed data       |
| `just test-ui` fails    | Run `just playwright-install` first    |
| Formatting errors in CI | Run `just fmt` before committing       |
| Type errors in CI       | Run `just typecheck` locally           |

### Formatting

Always run before committing:

```bash
just fmt              # Format all files
just check-staged     # Check what will be committed
```

This runs `prettier --write` on all files. For CI, formatting is checked automatically.
