# UI Data Sources

The portal should show fleet counts from aggregate read models, not by loading
agent rows and counting them in React. Loading agent rows is for asset tables and
drill-downs only.

## Cost Labels

These labels are intentionally conservative for UI information architecture.

| Cost label     | Meaning                                                                                | Examples                                            |
| -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Very cheap     | Purpose-built aggregate read path. Use freely for dashboard numbers and AI context.    | Metrics snapshots from Analytics Engine.            |
| Cheap          | One targeted Durable Object read. Use for active drill-downs and visible detail views. | One config `/stats`, one agent row, one agent page. |
| Appropriate    | Bounded system-of-record query. Fine for entity workflows and admin activity.          | Users, tenants, plans, tokens, config metadata.     |
| Avoid hot path | Fan-out or scheduled fleet-state rollup. Do not use for normal page render.            | DO fan-out, D1 tables populated from DO rollups.    |

D1 is the right place for administrative entities and durable product metadata:
users, tenants, plans, membership, configuration metadata, enrollment tokens,
and other workflow records. Querying those tables during explicit admin,
settings, bootstrap, or picker flows is acceptable.

The anti-pattern is using D1 as a periodically refreshed fleet-state rollup
store. Rolling data out of Durable Objects into D1 on an interval creates a
fixed recurring cost whether or not anyone is viewing the UI, then leaves the
UI querying a second aggregate store. Fleet state rollups, dashboard counts,
and AI metric context should come from metrics snapshots. Likewise, a single
Durable Object query is usually fine for the current object, but querying many
Durable Objects to build one page is very expensive and should be treated as a
degraded or temporary path.

## Source Classes

| Source class                  | Endpoint or hook                                                  | Cost label     | Use for                                                | Do not use for                                |
| ----------------------------- | ----------------------------------------------------------------- | -------------- | ------------------------------------------------------ | --------------------------------------------- |
| Metrics snapshot              | `GET /api/v1/overview`, `useOverview`                             | Very cheap     | Portal fleet totals and per-configuration summary rows | Individual agent rows                         |
| D1 entity query               | `GET /api/v1/configurations`, `useConfigurations`                 | Appropriate    | Config pickers, token sections, create flows           | Collector counts                              |
| D1 admin/entity query         | `/api/admin/*`, `useAdmin*`                                       | Appropriate    | Explicit admin workflows                               | Hot fleet-state dashboards                    |
| D1 fleet-state rollup         | Tables periodically populated from Config DO state                | Avoid hot path | Avoid adding                                           | Counts, badges, dashboards, AI metric context |
| Config DO aggregate           | `GET /api/v1/configurations/:id/stats`, `useConfigurationStats`   | Cheap          | Active configuration detail, first-connection polling  | Cross-config dashboards or repeated fan-out   |
| Config DO asset page          | `GET /api/v1/configurations/:id/agents`, `useConfigurationAgents` | Cheap          | Visible agent tables for one active configuration      | Totals, badges, AI metrics, or rollout counts |
| Config DO single asset        | `GET /api/v1/configurations/:id/agents/:uid`                      | Cheap          | Agent detail                                           | Summary counts                                |
| Config DO fan-out             | Many config DO `/stats` or `/agents` calls                        | Avoid hot path | Avoid adding                                           | Normal product page rendering                 |
| Rollout aggregate light fetch | `GET /api/v1/configurations/:id/rollout-cohort-summary`           | Cheap          | Explicit rollout copilot checks                        | Passive page load                             |
| Admin DO debug                | `/api/admin/configurations/:id/do/*`                              | Cheap          | Manual troubleshooting of one DO                       | Product UI, dashboards, or AI context         |

`GET /api/v1/overview` reads the latest per-config snapshot from Analytics
Engine when `CLOUDFLARE_USAGE_ACCOUNT_ID` and `CLOUDFLARE_USAGE_API_TOKEN` are
configured. It does not fan out to per-config DO `/stats` when metrics are
missing. Missing or failing metrics are surfaced as unavailable snapshot data so
the UI can show an explicit empty or stale state without turning a dashboard
render into one DO request per configuration.

Current fleet summaries use only recent Analytics Engine snapshots. Stale
historical snapshots age out of "current" counters after the bounded freshness
window so deleted or silent configurations do not remain counted forever.

## Page Cost Map

| Page                  | Current data source                                                  | Current cost                               | Target cost                                              | Notes                                                                                    |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Portal overview       | `useOverview`                                                        | Very cheap                                 | Very cheap                                               | Metrics path is correct; missing metrics are explicit unavailable data.                  |
| Portal configurations | `useOverview`                                                        | Very cheap                                 | Very cheap                                               | Config summary counts come from metrics snapshots.                                       |
| Portal billing        | `useOverview`, `useTenant`                                           | Very cheap plus appropriate D1 entity read | Very cheap for counts, appropriate for plan metadata     | Collector usage comes from metrics; tenant billing metadata belongs in D1.               |
| Portal agents         | `useOverview`; selected `useConfigurationAgents` drill-down          | Very cheap initial page, cheap drill-down  | Very cheap initial page, cheap drill-down                | Summary rows use metrics snapshots; collector rows load for one expanded config.         |
| Configuration detail  | `useConfigurationStats`; `useConfigurationAgents` only on agents tab | Cheap                                      | Cheap                                                    | Single active config DO reads are acceptable; rows load only for the visible agents tab. |
| Agent detail          | `useConfigurationAgent`, `useConfiguration`                          | Cheap plus appropriate D1 entity read      | Cheap, or cheap plus appropriate metadata                | Single agent row is fine; config metadata in D1 is acceptable if it stays entity-only.   |
| Getting started       | `useConfigurations`; `useConfigurationStats` in step 4               | Appropriate D1 entity read, then cheap     | Appropriate, then cheap                                  | Config picker metadata belongs in D1; first-success polling uses one config DO.          |
| Enrollment tokens     | `useConfigurations`, `useConfigurationTokens`                        | Appropriate D1 entity read plus cheap      | Appropriate plus cheap                                   | Config picker and tokens are entity workflows; per-config token reads are targeted.      |
| Team/settings         | D1 tenant/team endpoints                                             | Appropriate D1 entity reads                | Appropriate                                              | Low-frequency settings workflow, not a hot fleet-state dashboard.                        |
| Admin overview        | `useAdminOverview`, `useAdminTenantsPage`, `useAdminHealth`          | Appropriate admin D1 reads plus metrics    | Appropriate admin reads, metrics for fleet-state rollups | Admin entity summaries are fine; fleet-state counters come from Analytics Engine.        |
| Admin tenants         | `useAdminTenantsPage`                                                | Appropriate admin D1 reads plus metrics    | Appropriate plus metrics                                 | Explicit admin list/search workflow; tenant collector counts come from Analytics Engine. |
| Admin tenant detail   | D1 tenant/config/user endpoints                                      | Appropriate admin D1 reads                 | Appropriate                                              | Explicit support workflow over entity data.                                              |
| Admin DO viewer       | Admin DO debug endpoints                                             | Cheap per query                            | Cheap                                                    | Operator-triggered single DO inspection only.                                            |

## Live DO Aggregations Still Present

- `GET /api/v1/configurations/:id/stats`
  - Used by configuration detail cards and the getting-started connection
    poller.
  - It is a bounded aggregate over one Config DO's SQLite state plus live
    WebSocket count.
- `GET /api/v1/configurations/:id/rollout-cohort-summary`
  - Used only as an explicit AI light fetch for rollout copilot actions.
  - It reuses the live `/stats` aggregate shape.
- Config DO metric emission
  - The DO alarm scans local agent state to emit an aggregate snapshot to
    Analytics Engine.
  - This is background snapshot generation, not a UI request path.

## Guardrails

- If the UI needs a fleet or cross-config number, prefer metrics snapshots.
- If the UI needs one current configuration number, a single config DO
  aggregate is acceptable.
- If the UI needs rows, use paginated single-DO asset endpoints and keep the row count
  explicitly labeled as visible rows.
- D1-backed entity queries are fine for users, tenants, plans, membership,
  tokens, configuration metadata, admin lists, and settings workflows.
- Do not add scheduled DO-to-D1 rollups for fleet state. Use metrics snapshots
  for dashboard cards, insight context, badges, and auto-refreshing UI.
- Do not fan out across Durable Objects during normal page render.
- Do not add `.filter(...).length` over agent arrays for fleet metrics. The
  visible agent array can be paginated, filtered, or stale relative to live
  WebSocket state.
- Do not make passive page loads call rollout or debug endpoints. Those are
  explicit operator actions.

## Pages To Make Cheap

1. Portal agents
   - Current state: initial render uses metrics snapshots only. The page fetches
     a single config's agent page when the user expands or selects that config.
   - Keep it this way: do not add passive per-config `useConfigurationAgents`
     calls back to the page-level render.
2. Portal overview, configurations, and billing
   - Current state: they use metrics snapshots and surface missing metrics
     explicitly instead of silently fanning out across DOs.
   - Keep it this way: do not add a local/dev fallback that queries every
     configuration DO to reconstruct dashboard counts.
3. Agent detail
   - Current state: it loads one agent row plus configuration entity metadata.
   - Desired shape: this is acceptable if the configuration read remains
     metadata-only. Do not add fleet-state counts or drift rollups through D1.
4. Getting started and enrollment tokens
   - Current state: both use the D1 configuration list as a picker.
   - Desired shape: this is acceptable because configuration metadata and tokens
     are entity workflows. Keep collector counts and live fleet state out of
     these D1-backed picker reads.
