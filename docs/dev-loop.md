# Developer Loop

The shortest local loop is:

```bash
just check
```

`just check` runs `scripts/dev-check.ts`, which compares the current worktree to
`origin/main`, includes staged and untracked files, and runs only the checks
affected by those files. Use `just check-staged` for the pre-commit gate and
`just check-json` when an editor or agent needs the plan without executing it.

## Local App Loop

```bash
just dev-up
```

`dev-up` starts the Worker and apps/site, waits for `/healthz`, applies local D1
migrations, seeds local data, and then keeps both dev servers attached to the
terminal. Use `just dev-up-reset` to force a fresh seed.

If the servers are already running:

```bash
just dev-reset
just smoke-local
```

`smoke-local` runs the API + OpAMP lifecycle smoke test with secrets loaded from
`apps/worker/.dev.vars`.

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

## Changed-File Check Options

```bash
pnpm tsx scripts/dev-check.ts --since origin/main
pnpm tsx scripts/dev-check.ts --staged
pnpm tsx scripts/dev-check.ts --all
pnpm tsx scripts/dev-check.ts --json
```

The normal text output explains which checks are skipped or run and prints
per-step timings. The JSON output is plan-only and does not run commands.
