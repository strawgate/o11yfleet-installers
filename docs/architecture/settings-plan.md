# Settings Architecture Plan

o11yFleet will need many settings: deployment defaults, workspace preferences,
collector management defaults, rollout behavior, AI behavior, notification
targets, support access, and future account-level governance. This plan defines
where those settings should live so the product can grow without duplicating
configuration state across D1, Durable Objects, R2, and Worker bindings.

The core rule is simple: every setting has exactly one authoritative owner.
Other copies are either immutable artifacts, cached effective settings, or
read-model materializations with an explicit refresh path.

## Goals

- Avoid settings sprawl across Terraform variables, Worker environment
  variables, D1 columns, Durable Object SQLite tables, and frontend-only
  assumptions.
- Keep the OpAMP/WebSocket hot path free of account/workspace settings reads.
- Preserve Durable Objects for per-configuration coordination, not global
  settings storage.
- Make tenant/workspace settings auditable and schema-validated.
- Leave a clean path for account-level settings and future BYOK without moving
  secrets into plain D1 rows.

## Non-Goals

- This is not a policy/RBAC model. Policy, permissions, and approval workflows
  should be designed separately.
- This is not a full BYOK design. BYOK needs a secret-management plan before it
  becomes a user-facing setting.
- This does not make Cloudflare Secrets Store a tenant-secret database.
- This does not replace immutable configuration versions in R2.
- This does not move live agent state out of the Config Durable Object.

## Setting Scopes

| Scope               | Owner                                                           | Examples                                                                                        | Notes                                                                                                       |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Deployment          | Terraform + Worker bindings/secrets                             | Cloudflare resource bindings, managed LLM provider defaults, required secrets, environment name | Bootstrap contract. Not customer-editable.                                                                  |
| Account             | D1 settings tables                                              | Default AI mode, default collector channel, support access defaults, audit retention defaults   | Future parent of workspaces. Do not create account-scoped rows until an `accounts` table exists.            |
| Workspace           | D1 settings tables                                              | AI enabled, notification preferences, redaction defaults, enrollment UX defaults                | Customer-visible tenant settings. Use `workspace` in UI and `tenant` in backend internals.                  |
| Configuration group | D1 settings tables + explicit DO sync for live-impacting fields | Rollout defaults, collector package channel, validation mode                                    | D1 owns declared settings. DO may receive a materialized effective value only when it affects live control. |
| Library resource    | D1 metadata + R2 content where large/immutable                  | Shared source/destination snippets, reusable secret refs, templates                             | Reusable resources should not be copied into every configuration except as immutable rendered versions.     |
| Policy/governance   | Dedicated future policy model                                   | Roles, scopes, approvals, SSO/SCIM controls                                                     | Do not hide policy inside generic settings.                                                                 |

## Account And Workspace Model

The current backend uses `tenants` as the customer/workspace boundary. That is
enough for near-term workspace settings, but the settings model should leave
room for a future parent account or organization:

```text
account
  -> workspace/tenant
  -> configuration group
  -> collector/agent runtime state
```

Near-term implementation rules:

- `tenant` settings are the only customer-scoped settings to persist now.
- Descriptor code may mention `account` as a future scope, but D1 writes should
  reject `account` until an `accounts` table exists.
- Do not overload `tenants` with account-level settings just because the UI
  eventually says "organization".
- Plan and hard entitlement columns may stay on `tenants` while the product is
  single-workspace-per-customer. Promote them later only when account ownership
  exists.

Use `workspace` in customer copy and `tenant` in backend code until the data
model changes.

## Storage Ownership

### D1

D1 should be the source of truth for account, workspace, configuration-group,
rollout intent, and library metadata settings because they are relational,
auditable, queryable by admin/customer surfaces, and need transactional mutation
behavior.

Use D1 for:

- values for code-owned setting descriptors,
- workspace/configuration setting values, and account setting values after an
  `accounts` table exists,
- audit events for setting changes,
- references to secret material, not secret values,
- references to immutable R2 artifacts,
- rollout generations and declared target config hashes,
- cross-tenant/admin read models.

Do not use one-off nullable columns for every new preference unless the setting
is core identity or core entitlement data that most queries need directly.
Settings should be validated through a central descriptor registry.

Promotion rule: start low-frequency preferences in `settings`; promote a key to
a first-class column only when it is needed for frequent filtering, joins,
entitlement checks, or operational reporting.

### Durable Objects

Durable Objects should remain scoped to the atom of coordination. In this app
that atom is currently one `(tenant_id, config_id)` Config DO. Cloudflare's DO
guidance is aligned with this: use DOs for coordination, strong consistency,
per-entity storage, persistent WebSockets, and scheduled work per entity; avoid
single global DOs that serialize unrelated traffic.

Use the Config DO for:

- connected collector sessions,
- live agent state,
- applied desired-config snapshot for live delivery,
- immediate rollout/remote-config broadcast,
- short-lived per-configuration coordination,
- materialized effective settings needed while handling active collectors.

Do not use DO SQLite as the source of truth for workspace/account settings.
Avoid a global Settings DO.
Keep configuration metadata out of the DO as a second authoritative copy.
Live-impacting settings must be written to D1 before notifying the DO.

Allowed duplication:

- D1 has configuration metadata and version references.
- R2 has immutable YAML content.
- Config DO has the applied desired version hash/content and generation needed
  for active control-plane broadcast.
- Config DO has live agent state; Analytics Engine has aggregate snapshots.

That duplication is acceptable because each copy has a different purpose and a
clear owner: D1 for management queries, R2 for immutable artifacts, DO for live
coordination, and Analytics Engine for metrics snapshots.

Rollout state needs an explicit generation boundary:

```text
D1 configuration_rollouts
  -> target config hash + rollout generation + declared status
  -> command to Config DO
  -> DO applies generation/hash/content for connected agents
  -> DO records live applied/observed status
  -> Analytics Engine records aggregate rollout metrics
```

If a DO restarts, loses derived state, or detects a generation mismatch, D1/R2
must be able to rehydrate the live delivery snapshot.

### R2

R2 should store large or immutable blobs, not mutable settings.

Use R2 for:

- immutable config YAML by content hash,
- rendered/exported artifacts,
- large library/template bodies if they outgrow D1 rows.

Avoid using R2 for frequently mutated setting values or small preference records.

### Worker Bindings And Secrets

Worker bindings and secrets should remain the deployment bootstrap contract.
Cloudflare bindings are both permission and API surface, and are preferable to
calling Cloudflare REST APIs from Workers for bound resources. Secrets are
appropriate for sensitive deployment values and should not be replaced by D1
settings.

Use bindings/secrets for:

- D1, R2, Durable Object, Analytics Engine, and service bindings,
- deployment-level non-secret defaults,
- managed-provider secret keys,
- values required before D1 is reachable.

Do not put customer-editable product settings in Worker env vars. Changing a
product setting should not require a Worker deployment.

Cloudflare Secrets Store is useful for account-level platform secrets that are
bound to a Worker deployment. It is not the first BYOK storage path because a
Worker accesses Secrets Store values through configured bindings. Tenant-specific
provider keys need a separate app-level secret-reference design before they
become customer-editable settings.

### Secret References

Settings rows may reference secrets, but they must not contain secret values.

Supported paths should be explicit:

| Secret path                      | Where value lives                                 | Who can read it         | Product use                                        |
| -------------------------------- | ------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| Managed platform secret          | Worker secret or Cloudflare Secrets Store binding | Worker runtime          | O11yFleet-managed LLM/provider defaults            |
| Customer environment reference   | Collector host/runtime environment                | Collector only          | Pipeline credentials the platform should never see |
| Future app-managed tenant secret | Dedicated encrypted secret store, not plain D1    | Narrow Worker code path | BYOK/provider keys after a separate design         |

The customer environment reference path should be first-class for collector
configuration. Bindplane's environment-variable approach keeps secrets out of
the platform database and collector YAML, at the cost of customer-side runtime
setup. That tradeoff is appropriate for many pipeline credentials.

The future app-managed tenant secret path needs a separate design covering
encryption keys, rotation, audit, access scopes, local development, and whether
the secret ever needs to be transmitted to collectors.

### KV

KV is useful only as an optional cache/materialized read path for global or
workspace configuration that is read very frequently and can tolerate eventual
consistency. Cloudflare documents KV as high-read and eventually consistent;
changes can take 60 seconds or more to become visible in other locations.

Do not start with KV as the source of truth. If we add it later, D1 remains
authoritative and KV entries must include a `settings_version` and TTL strategy.

Avoid storing "effective settings" as a second D1 source of truth. Effective
settings are derived at read time from descriptors, deployment defaults, and
scoped overrides. They may be cached or materialized only after there is
measured need and an explicit version/invalidation strategy.

## Proposed D1 Shape

Start with generic typed rows plus a code-owned descriptor registry.

The initial implementation should enable `tenant` and `configuration` scopes.
The `account` scope is included in the target shape so descriptors and
resolution order do not need to be renamed later, but account-scoped rows should
wait until we introduce an `accounts` table and ownership model.

```sql
CREATE TABLE settings (
  scope_type TEXT NOT NULL CHECK(scope_type IN ('account', 'tenant', 'configuration')),
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_type, scope_id, key)
);

CREATE INDEX idx_settings_scope ON settings(scope_type, scope_id);

CREATE TABLE setting_scope_versions (
  scope_type TEXT NOT NULL CHECK(scope_type IN ('account', 'tenant', 'configuration')),
  scope_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE setting_audit_events (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  actor_user_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE configuration_rollouts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  config_id TEXT NOT NULL,
  target_config_hash TEXT NOT NULL,
  rollout_generation INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, config_id, rollout_generation)
);

CREATE TABLE rollout_events (
  event_id TEXT PRIMARY KEY,
  rollout_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  config_id TEXT NOT NULL,
  rollout_generation INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('declared', 'pushed', 'applied', 'rejected', 'completed', 'cancelled')),
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, config_id, rollout_generation, event_type, event_id)
);
```

Notes on the rollout DDL above:

- `status` and `event_type` are constrained by `CHECK` so different code paths
  cannot drift on enum values. The canonical list is mirrored in a TypeScript
  union exported from `packages/core` so the database and the application code
  share one source of truth.
- `scope_id` references are validated by `SettingsService` against the
  corresponding `tenants` or `configurations` row before write. Foreign keys
  are intentionally omitted on the `settings` table because the `account`
  scope has no target table yet; once the `accounts` table exists, FK
  constraints should be added per scope (see Phase 1 / Phase 6).
- `schema_version` is monotonic per descriptor key. When a descriptor's
  `schemaVersion` is bumped, `SettingsService.read()` runs the descriptor's
  registered upgrader (or its `defaultValue`) for any row whose
  `schema_version` is older. Old versions are not rewritten in place — they
  are upgraded on read and rewritten only on the next mutation, so reads
  never block on a migration job.

Keep descriptors in code so setting keys are discoverable, typed, and testable:

```ts
type SettingDescriptor = {
  key: string;
  scopes: Array<"account" | "tenant" | "configuration">;
  schemaVersion: number;
  defaultValue: unknown;
  secret: boolean;
  mutableBy: "staff" | "workspace-admin" | "system";
};
```

Examples:

- `ai.enabled`
- `ai.default_mode`
- `ai.redaction_level`
- `collector.default_channel`
- `rollout.default_strategy`
- `support.access_default`
- `notifications.digest_frequency`

Do not add descriptor keys ad hoc from route handlers. New keys should be added
through the descriptor registry with tests for default value, allowed scopes,
mutation permissions, JSON validation, and inheritance behavior.

## Effective Settings Resolution

Resolution should be deterministic and cheap:

```text
code defaults
  -> deployment bindings/defaults
  -> account settings
  -> workspace/tenant settings
  -> configuration-group settings
```

Rules:

- Only routes that need settings should resolve them.
- OpAMP reconnect and heartbeat should not read D1 for account/workspace
  settings.
- AI routes may resolve AI settings because they already perform higher-latency
  work and are not in the collector hot path.
- Configuration mutation and rollout routes may resolve configuration settings.
- Config DO methods should receive explicit effective settings when a mutation
  changes live behavior.
- Rollout commands should carry the target hash, generation, and either content
  or enough information for the DO to fetch/cache content once.

## Caching And Invalidation

Start with isolate-local caching inside the Worker:

- cache key: `{scope_type}:{scope_id}:{setting_family}`,
- TTL: 30-60 seconds for non-critical UI/AI settings,
- no cache for mutation responses,
- response includes `settings_version`,
- generation/version checks invalidate stale values before TTL when correctness
  matters.
- every successful settings mutation must atomically upsert the setting value,
  append the audit event, and increment `setting_scope_versions.version` in one
  D1 batch write.

Do not use global in-memory clients or derived settings that can outlive binding
changes in surprising ways. Cloudflare notes that changing bindings may reuse
existing isolates, so request-scoped clients are safer for secrets and provider
configuration.

Add KV only when we have evidence that repeated D1 settings reads are a real
latency/cost issue. If KV is added:

- D1 remains authoritative.
- KV stores only public/non-secret effective settings.
- KV values include a version and generated timestamp.
- Admin mutations update D1 first, then refresh/purge materialized KV.
- The UI tolerates short propagation delays.

Do not use KV for enrollment token validity, revocation, rollout state, plan
enforcement, or auth policy. Those need stronger consistency than KV provides.

If D1 read replication is enabled later, settings reads that must observe a
recent write need a D1 session/bookmark strategy rather than assuming replicas
are immediately current.

## AI Settings Slice

The AI case should be the first consumer because it is useful but not hot-path:

- Deployment bindings/secrets keep the managed MiniMax provider bootstrap.
- D1 settings control whether AI is enabled for account/workspace/surface.
- Tenant settings can select `o11yfleet_managed` or `disabled`.
- BYOK remains hidden until secret storage is designed.
- The browser sees only effective non-secret settings.

Initial setting descriptors:

- `ai.enabled`: boolean, tenant/account, default `true`.
- `ai.default_mode`: enum `o11yfleet_managed | disabled`, tenant/account,
  default `o11yfleet_managed`.
- `ai.redaction_level`: enum `standard | strict`, tenant/account, default
  `standard`.

Do not store provider model, base URL, or managed-provider API key as
customer-editable settings yet. Those remain deployment defaults until we have a
multi-provider product model and tenant-secret design.

## Library Resources

Library resources should follow Bindplane's useful distinction between reusable
resources and rolled-out configuration artifacts:

- Library metadata belongs in D1.
- Large immutable bodies may live in R2 by content hash.
- Configurations should reference library resources until render/export time.
- A library edit can affect many configurations, but it should not update live
  collectors directly.
- A configuration that uses a changed library resource still needs a new version
  and rollout before collectors receive the change.

This avoids copying shared source/destination settings into every configuration
while preserving rollout safety and auditability.

## Duplication Rules

Use these rules before adding any new table, DO table, R2 object, KV key, or env
var:

1. Name the source of truth.
2. Name every materialized copy and why it exists.
3. Define how the copy is refreshed.
4. Define how stale data is tolerated or detected.
5. Add a test that proves the source of truth wins.

Examples:

- Configuration metadata: D1 owns it. DO may cache the applied desired-config
  snapshot only after a rollout command with a generation.
- Config YAML: R2 immutable object owns content by hash. D1 owns metadata and
  references.
- Agent live state: Config DO owns it. D1 agent summaries are read models fed by
  events.
- AI provider secret: Worker secret owns it. D1 may store a non-secret mode or
  provider policy, never the key.
- Rollout target: D1 owns the target hash and generation. Config DO owns only
  the latest applied live-delivery snapshot for connected collectors.

## Implementation Plan

### Phase 1: Foundations

- Add this architecture plan and review it with a Cloudflare-focused reviewer.
- Add a descriptor registry in `packages/core` for setting keys, defaults, scope
  validity, and JSON validation.
- Add D1 migrations for `settings`, `setting_scope_versions`, and
  `setting_audit_events`. These are added as a new numbered migration after the
  current head (`packages/db/migrations/0002_auth.sql` at time of writing), so
  existing tenants/configurations migrations stay frozen and the new tables
  are layered on top.
- Add unit tests for descriptor validation and deterministic resolution.
- Add a short design test or invariant check that account-scoped writes are
  rejected until an `accounts` table exists.

### Phase 2: Worker Settings Service

- Add `SettingsService` in the Worker with request-scoped resolution and short
  isolate-local caching.
- Expose internal helpers:
  - `resolveEffectiveSettings(scope, family)`
  - `updateSetting(scope, key, value, actor)`
  - `listSettings(scope)`
- `updateSetting` must enforce the write contract: setting value, audit event,
  and scope-version bump are one atomic D1 batch. Cache invalidation depends on
  this monotonic version.
- Add route tests proving tenant isolation and source-of-truth precedence.

### Phase 3: AI Product Settings

- Move AI enablement/mode/redaction through `SettingsService`.
- Keep provider keys and managed provider defaults in Worker bindings/secrets.
- Add portal/admin read surfaces that show effective non-secret AI settings.
- Add tests showing disabled AI returns a deliberate non-noisy empty state.
- Keep provider/model/base URL deployment-managed for this phase.

### Phase 4: Configuration-Group Settings

- Add rollout/default collector settings only after descriptor registry and
  audit events are in place.
- For live-impacting changes, write D1 first, then send a small explicit update
  to the Config DO.
- Add tests that the DO does not become authoritative for settings.

### Phase 4.5: Rollout Generation Cleanup

- Introduce `configuration_rollouts` or equivalent generation tracking before
  adding more rollout settings.
- Coordinate this with existing rollout tracking issues:
  [#234](https://github.com/strawgate/o11yfleet/issues/234) for phase 1 rollout
  records and [#235](https://github.com/strawgate/o11yfleet/issues/235) for
  paced executor/progress work.
- Make rollout writes D1-first, then send `applyRollout(hash, generation, ...)`
  to the Config DO.
- Make DO rollout observations idempotent by rollout generation before updating
  derived rollout status.
- Add a reconciliation helper that can compare D1 declared rollout generation
  with the DO applied generation for targeted admin/debug views.

### Phase 5: Optional Materialized Cache

- Add KV only if production traces show D1 settings reads are material on
  latency/cost.
- Keep this behind a feature flag and measure before/after.

### Phase 6: Secret References And BYOK Design

- Add a dedicated design for tenant secret references before exposing BYOK.
- Support collector environment-variable references for pipeline credentials
  without storing customer secrets.
- Decide whether future app-managed tenant secrets use a Cloudflare-native
  mechanism, envelope encryption, or an external KMS-backed store.
- Add audit and rotation requirements before building UI.

## Cloudflare Architect Review Questions

Ask the reviewer to validate:

- Is D1 the right authoritative store for account/workspace/configuration
  settings?
- Are we avoiding inappropriate global Durable Object usage?
- Is the Config DO materialization boundary reasonable for live rollout state?
- Should rollout intent be separated from `configurations.current_config_hash`
  before more rollout settings are added?
- Should any settings family start in KV, or should KV remain a later cache?
- Are Worker binding/secrets boundaries correct for managed LLM configuration?
- What are the main hot-path cost risks for OpAMP reconnects, rollout, stats,
  and AI routes?
- What Cloudflare limits should become explicit tests or operational gates?

## Source Notes

- Cloudflare Workers bindings: <https://developers.cloudflare.com/workers/runtime-apis/bindings/>
- Cloudflare Workers secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- Cloudflare Secrets Store Workers integration: <https://developers.cloudflare.com/secrets-store/integrations/workers/>
- Cloudflare D1 Worker API: <https://developers.cloudflare.com/d1/worker-api/d1-database/>
- Cloudflare Durable Objects rules: <https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/>
- Cloudflare Durable Object storage: <https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/>
- Cloudflare D1 limits: <https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare D1 read replication: <https://developers.cloudflare.com/d1/best-practices/read-replication/>
- Cloudflare KV consistency: <https://developers.cloudflare.com/kv/concepts/how-kv-works/>
- Cloudflare R2 consistency: <https://developers.cloudflare.com/r2/reference/consistency/>
- Cloudflare Cache API: <https://developers.cloudflare.com/workers/runtime-apis/cache/>
- Bindplane library resources: <https://docs.bindplane.com/feature-guides/library>
- Bindplane rollouts: <https://docs.bindplane.com/feature-guides/rollouts>
- Bindplane secrets management: <https://docs.bindplane.com/production-checklist/bindplane/secrets-management>
