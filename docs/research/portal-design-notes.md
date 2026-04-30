# Portal Design Notes

This is the condensed residue from the historical portal design prompt and static
prototype archive. It is not a product spec; keep current behavior in
`docs/product/` and current architecture in `docs/architecture/`.

## Useful Ideas To Keep

- One design language across marketing, portal, and admin, with admin surfaces
  visibly staff-only.
- Customer portal navigation should center on overview, configuration groups,
  collectors, versions/rollouts, enrollment tokens, usage, and workspace settings.
- Admin navigation should center on overview, tenants, health, usage/spend,
  Durable Object inspection, plans, and support/impersonation.
- Pipeline management should support Visual, YAML, and Split views over the same
  graph/YAML state.
- Agent detail can reuse pipeline visualization in read-only mode once reported
  config data is available.
- AI suggestions should be evidence-led and produce reviewable changes, not direct
  mutations.

## Prototype Sources

The external prototype archive included:

- `portal/builder.html`
- `portal/agent-detail.html`
- `portal/configuration-detail.html`
- `portal-pipeline.js`
- `portal-pipeline.css`

The repo has already absorbed the durable parts into:

- `@o11yfleet/core/pipeline`
- `apps/site/src/styles/portal-pipeline.css`
- [pipeline management](../product/pipeline-management.md)
- [product model](../product/model.md)

Do not copy the prototype DOM/runtime directly. Rebuild interactions in React and
keep backend-wired data separate from prototype/sample data.
