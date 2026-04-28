# O11yFleet Product Mental Model

This document defines the product language used by the portal, admin console, docs, and agent prompts.

## Core Entities

### Workspace

A workspace is the customer-facing tenant boundary. It owns users, configuration groups, enrollment tokens, collector identities, audit events, and plan limits. A collector enrolled into one workspace must not be able to read or mutate another workspace.

Use `workspace` in customer UI and `tenant` in backend/admin internals.

### Configuration Group

A configuration group is the assignment boundary for a set of collectors. It is the O11yFleet concept closest to:

- Bindplane fleet: grouped collector management and inherited config.
- Elastic agent policy: enrolled agents are attached to a policy-like target.
- Grafana Alloy Fleet Management collector group: collectors poll for remote configuration that matches their assignment.

Do not casually rename this concept to `fleet` or `policy` in UI copy. Use `configuration group` when assignment semantics matter and `configuration` only where the surrounding context is already clear.

### Collector And Agent

Use these terms consistently:

- `Collector`: the running OpenTelemetry Collector process on a host.
- `Agent`: the managed OpAMP identity for that collector inside O11yFleet, keyed by `instance_uid`.

Customer-facing pages may say `Collectors (agents)` while the product language settles, but avoid mixing the terms as if they are separate managed objects.

### Enrollment Token

An enrollment token is a bootstrap secret for first contact. It lets a collector enroll into one workspace and one configuration group. After enrollment, the control plane should rely on scoped assignment claims for hot-path connections.

An enrollment token is not an API key and should not grant general API write authority.

## Configuration State

### Version

A version is an immutable YAML snapshot, keyed by content hash and stored by the control plane. Versions are history and rollback candidates.

### Desired Config

Desired config is the version hash/content selected by the control plane for a configuration group. Rollout changes desired state.

### Current Config

Current config is what a collector reports through OpAMP, usually as `current_config_hash`.

### Effective Config

Effective config is the collector runtime configuration after remote config, local bootstrap config, and fallback behavior are applied.

This term must stay conservative until the backend contract is explicit. The UI may explain it as a planned diagnostic concept, but should not claim exact merge/fallback behavior that the worker and collector do not expose.

### Rollout

A rollout is an explicit promotion of a version to desired state for a configuration group. It should produce an audit event and eventually expose convergence data:

- selected version hash
- actor and reason
- start/end timestamps
- connected target count
- applied count
- drift count
- unhealthy count
- failures and timeout state

### Rollback

A rollback promotes an older version as desired state. It does not mutate a version in place.

## Operational States

### Status

Status answers whether the collector has an active management session:

- `connected`: active WebSocket/session
- `disconnected`: no active session
- `unknown`: state not reported or not yet observed

### Health

Health answers whether the collector reports healthy runtime state. A collector can be connected and unhealthy.

### Drift

Drift means the desired config hash differs from the collector's current reported hash. Drift is expected during rollout and suspicious when it persists.

### Last Seen

Last seen is the most recent heartbeat or state update from a collector.

### Connected At

Connected at is the timestamp for the current active session. It is not the same as first enrollment or last heartbeat.

## UI Rules

- Show status, health, and drift separately.
- Show first-run success only when a collector connects and reports, not merely when a token is generated.
- Label desired/current/effective config carefully.
- Mark prototype/sample surfaces clearly when backend data is not wired.
- Do not render large collector lists without pagination, load-more, or server-side query support.

## Docs To Keep Aligned

- `docs/governance-model.md`
- `docs/admin-ops-model.md`
- `docs/portal-design-prompt.md`
- `docs/architecture.md`
- `AGENTS.md`
