# Pricing Model

## Core Thesis

O11yFleet monetizes stateful operations and governance, not raw collector count.
The Cloudflare architecture makes connected collectors cheap enough that fleet
visibility can be generous by default. The paid boundary is production
seriousness: history retention, policy count, rollout safety, API/GitOps
automation, RBAC, audit, and SSO.

Positioning:

> Fleet management is free; production governance is paid.

## Launch Packaging

The pricing page has two tracks so individuals and organizations self-select at
signup.

- Individual track: UI-driven, 1 user, no API keys, no repo sync.
- Organization track: collaborative, API-capable, GitOps-enabled at Growth.

Automation is the hard boundary. Anyone wiring CI/CD, Terraform, GitHub, or other
pipeline automation against O11yFleet belongs on Growth or Enterprise, not Pro.

## Public Launch Tiers

| Tier       | Price                | Collectors    | Policies  | History  | Users     | API / repos | Track        |
| ---------- | -------------------- | ------------- | --------- | -------- | --------- | ----------- | ------------ |
| Hobby      | Free                 | 10            | 1         | 24h      | 1         | None        | Individual   |
| Pro        | $20/mo               | 25            | 3         | 7 days   | 1         | None        | Individual   |
| Starter    | Free                 | 1,000         | 1         | 24h      | 3         | None        | Organization |
| Growth     | $499/mo or $5,000/yr | 1,000 + packs | 10        | 30 days  | 10        | Unlimited   | Organization |
| Enterprise | Starts at $50k/yr    | Custom        | Unlimited | 90d-1yr+ | Unlimited | Unlimited   | Organization |

The deferred Max tier is not public at launch. Add it only if product analytics
show a real cluster of individual users around 40-100 collectors.

## Customer-Facing Vocabulary

The pricing page calls the paid management unit a policy. A policy contains
collector selection, rendered configuration, versioning, and rollout rules. This
is the customer-facing abstraction for a management shard.

Implementation note: the current backend still stores this as `max_configs` and
configuration groups. Keep internal code naming stable until there is a real
policy model.

## Paywall Axes

Policies are the primary capacity paywall:

- Hobby: 1
- Pro: 3
- Starter: 1
- Growth: 10
- Enterprise: unlimited/custom

History retention is the primary stateful operations paywall:

- Hobby and Starter: 24h state
- Pro: 7 days
- Growth: 30 days
- Enterprise: 90 days to 1 year or custom

API keys and repo sync are not available on the individual track. They start at
Growth to keep organizational automation out of Pro.

SSO and SCIM are Enterprise-only at launch. If sales data shows this blocks too
many Growth deals, introduce SSO as a paid Growth add-on instead of changing the
base package.

Heartbeat frequency is not a pricing lever.

## Growth Collector Packs

Growth includes 1,000 collectors. Additional collector packs are $499/month, or
$5,000/year, per additional 1,000 collectors. Self-serve Growth should route to
Enterprise around 5,000 collectors.
