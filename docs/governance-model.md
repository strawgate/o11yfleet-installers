# Governance Model

O11yFleet controls remote collector configuration. That makes permissions, plan limits, token boundaries, and auditability part of the core product model rather than billing-only UI.

## Trust Boundaries

### Workspace Boundary

The workspace owns all customer resources:

- configuration groups
- versions and rollouts
- enrollment tokens
- future API tokens
- users and roles
- audit events

Every customer API call must be scoped to one workspace.

### Enrollment Tokens

Enrollment tokens are bootstrap credentials for collectors. They should be:

- scoped to one workspace and one configuration group
- shown only once at creation
- revocable
- audited on create/revoke
- excluded from general API authority

Elastic Fleet's enrollment-token lifecycle is a useful reference: enrollment is separate from the post-enrollment communication credential.

### API Tokens

API tokens are future automation credentials for control-plane API access. They need a separate model from enrollment tokens:

- token prefix or display id
- scopes
- creator
- created timestamp
- last-used timestamp
- revocation state
- plan and role gates

## Roles

Target role model:

- `viewer`: read-only access to fleet state and history.
- `operator`: can create versions, roll out configs, create/revoke enrollment tokens, and inspect collectors.
- `admin`: operator permissions plus team, billing, API token, and destructive workspace controls.
- `owner`: admin plus ownership transfer and high-risk organization actions.

The UI should not rely only on hidden buttons. Mutation endpoints must enforce the same permissions server-side and return useful 403 reasons.

## Plans And Entitlements

Plans gate both limits and capabilities:

- monitor-only mode
- managed configuration count
- team size
- API token availability
- RBAC depth
- audit export
- SSO/SCIM
- approval workflows

Plan downgrade behavior must be explicit. A downgrade from managed config to monitor-only should preserve historical data but disable new config mutations and rollouts.

## Audit Events

Audit events should answer:

- who acted
- what action they took
- which resource changed
- before and after state where relevant
- request id / correlation id
- source IP/user agent where useful
- whether the action was user, API token, system, or staff support

Config changes should include version hash and rollout intent. Token actions should never log raw token values.

## Support Sessions

Staff support actions require a dedicated protocol before the admin UI exposes real tenant mutation:

- tenant id
- staff actor id
- reason code
- optional ticket URL
- TTL
- allowed scope: inspect, impersonate, mutate, break-glass
- audit event on start/end/action
- visible customer banner for impersonation or mutation scopes

No silent tenant mutation from the admin console.

## UI Rules

- Say `enrollment token` for collector bootstrap secrets.
- Say `API token` only for API automation credentials.
- Show plan/role-gated controls as disabled with a concrete reason when possible.
- Use prototype banners for governance surfaces that are not wired to backend enforcement.
- Keep destructive and remote-config-authority actions visibly auditable.
