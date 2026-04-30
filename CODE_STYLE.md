# Code Style

These are reviewer preferences that are not fully enforced by linting.

## General

- Prefer repo-local helpers, primitives, and `just` recipes over ad hoc commands.
- Keep docs dense: preserve decisions, commands, contracts, and caveats; remove
  fanout narration, speculative lists, and stale prototype prose.
- Name current behavior plainly. Mark planned behavior as planned.
- Keep comments for non-obvious control flow, not line-by-line narration.

## Frontend

- Use local UI primitives from `apps/site/src/components/ui/*` for new interactive
  surfaces.
- Keep existing page-level CSS stable unless the page is already being materially
  changed.
- Avoid a second design language: new primitives must use the existing O11yFleet
  CSS variables and dark/light mode behavior.
- Do not show prototype/sample data as if it is live backend data.

## Product Copy

- Customer UI says `workspace`; backend/admin internals may say `tenant`.
- Prefer `configuration group` when assignment semantics matter.
- Use `collector` for the running OpenTelemetry Collector and `agent` for the
  managed OpAMP identity.
- Say `enrollment token` for collector bootstrap secrets and reserve `API token`
  for future automation credentials.
