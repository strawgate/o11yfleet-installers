# O11yFleet Full Site Audit Report

> Historical snapshot: this audit describes the site before the request-access,
> canonical installer URL, and footer-link cleanup in the follow-up site docs
> pass. Treat route coverage as useful context, but do not use the marketing copy
> and placeholder-link notes as current site truth.

**Date:** 2026-04-28
**Audited URL:** https://o11yfleet-site.pages.dev
**Method:** Playwright-driven + HTTP verification

## Summary

| Category        | Pages  | Status       |
| --------------- | ------ | ------------ |
| Marketing pages | 6      | ✅ All 200   |
| Auth pages      | 4      | ✅ All 200   |
| Portal pages    | 11     | ✅ All 200   |
| Admin pages     | 7      | ✅ All 200   |
| **Total**       | **28** | **✅ 28/28** |

## Marketing Pages

| Page                                     | HTTP         | Title                                         | Issues                                                        |
| ---------------------------------------- | ------------ | --------------------------------------------- | ------------------------------------------------------------- |
| `/`                                      | 200 (49.5KB) | O11yFleet — The hosted OpAMP control plane... | Superseded: follow-up pass removed public footer placeholders |
| `/about.html`                            | 200 (7.8KB)  | About — O11yFleet                             | None                                                          |
| `/enterprise.html`                       | 200 (13.1KB) | Enterprise — O11yFleet                        | None                                                          |
| `/pricing.html`                          | 200 (16.9KB) | Pricing — O11yFleet                           | None                                                          |
| `/product-configuration-management.html` | 200 (19.3KB) | Configuration Management — O11yFleet          | None                                                          |
| `/solutions-gitops.html`                 | 200 (17.6KB) | GitOps Solutions — O11yFleet                  | None                                                          |

### Fixed Links

- ✅ "Sign in" → `/login.html`
- ✅ Primary access CTA → `/signup.html`
- ✅ "Talk to sales" → `mailto:sales@o11yfleet.com`
- ✅ "Read the docs" → `github.com/strawgate/o11yfleet`
- ✅ "Read the changelog" → `github.com/strawgate/o11yfleet/releases`
- ✅ "Read the OpAMP guide" → `github.com/strawgate/o11yfleet`
- ✅ "Request security packet" → `mailto:security@o11yfleet.com`

### Superseded Placeholder Notes

- Footer: Docs, OpAMP guide, Collector guide, Contact, Security, Status, Privacy, Terms
- Demo illustration: Audit log, Revert to monitor-only, Resolve

## Auth Pages

| Page                | HTTP | Title                             | Flow Test                      |
| ------------------- | ---- | --------------------------------- | ------------------------------ |
| `/login.html`       | 200  | Sign in — O11yFleet               | ✅ Form → `/portal/overview`   |
| `/signup.html`      | 200  | Create your workspace — O11yFleet | ✅ Form → `/portal/onboarding` |
| `/forgot.html`      | 200  | Forgot password — O11yFleet       | Renders OK                     |
| `/admin-login.html` | 200  | Admin sign in — O11yFleet         | ✅ Form → `/admin/overview`    |

### Auth Flow Verification

1. **Login:** Fill email/password → Click "Sign in" → Redirects to `/portal/overview` ✅
2. **Signup:** Fill name/email/password/workspace → Click "Create workspace" → Redirects to `/portal/onboarding` ✅
3. **Admin Login:** Fill email/password/2FA → Click "Sign in" → Redirects to `/admin/overview` ✅

### Auth Notes

- SSO and GitHub buttons are non-functional (expected — no OAuth integration yet)
- No real authentication — forms just redirect

## Portal Pages

| Page                                | HTTP | Banner                               | SOON Badges                         |
| ----------------------------------- | ---- | ------------------------------------ | ----------------------------------- |
| `/portal/overview.html`             | 200  | ✅ "AI insights, rollout metrics..." | Rollouts, Flow, Audit, Integrations |
| `/portal/configurations.html`       | 200  | None (API-backed)                    | Same sidebar                        |
| `/portal/configuration-detail.html` | 200  | None (API-backed)                    | Same sidebar                        |
| `/portal/agents.html`               | 200  | ✅ "Sample collector data..."        | Same sidebar                        |
| `/portal/agent-detail.html`         | 200  | ✅ "Hardcoded agent data..."         | Same sidebar                        |
| `/portal/billing.html`              | 200  | ✅ "Billing data hardcoded..."       | Same sidebar                        |
| `/portal/builder.html`              | 200  | ✅ "Pipeline builder sample data..." | Same sidebar                        |
| `/portal/team.html`                 | 200  | ✅ "Team members hardcoded..."       | Same sidebar                        |
| `/portal/tokens.html`               | 200  | ✅ "Tokens hardcoded..."             | Same sidebar                        |
| `/portal/getting-started.html`      | 200  | ✅ "Sample workspace IDs..."         | Same sidebar                        |
| `/portal/settings.html`             | 200  | None (partially API-backed)          | Same sidebar                        |
| `/portal/onboarding.html`           | 200  | None (standalone wizard)             | N/A                                 |

### Sidebar Nav

- 4 items marked with "SOON" badge: Rollouts, Flow & metrics, Audit log, Integrations
- These link to non-existent pages (intentional — grayed out with pointer-events:none)

## Admin Pages

| Page                        | HTTP | Banner                               | SOON Badges               |
| --------------------------- | ---- | ------------------------------------ | ------------------------- |
| `/admin/overview.html`      | 200  | ✅ "Dashboard KPIs hardcoded..."     | Users, Releases, Settings |
| `/admin/tenants.html`       | 200  | None (API-backed)                    | Same sidebar              |
| `/admin/tenant-detail.html` | 200  | ✅ "Stats and activity hardcoded..." | Same sidebar              |
| `/admin/events.html`        | 200  | ✅ "Audit events hardcoded..."       | Same sidebar              |
| `/admin/health.html`        | 200  | ✅ "Health data hardcoded..."        | Same sidebar              |
| `/admin/plans.html`         | 200  | ✅ "Plan data hardcoded..."          | Same sidebar              |
| `/admin/flags.html`         | 200  | ✅ "Feature flags hardcoded..."      | Same sidebar              |

### Admin Sidebar Nav

- 3 items marked with "SOON" badge: Users, Releases, Settings

## Subdomain Routing

| Domain                     | Behavior                      | Status              |
| -------------------------- | ----------------------------- | ------------------- |
| `o11yfleet-site.pages.dev` | Marketing site                | ✅ Working          |
| `app.o11yfleet.com/`       | Redirect → `/portal/overview` | ⏳ Pending DNS      |
| `admin.o11yfleet.com/`     | Redirect → `/admin/overview`  | ⏳ Pending DNS      |
| `api.o11yfleet.com`        | Worker API                    | ✅ Route configured |

## API Connectivity

- Worker at `o11yfleet-worker.o11yfleet.workers.dev` ✅
- Portal auto-detects API base from hostname ✅
- Configurations page loads real data when connected ✅
- Connect bar appears when API is unreachable ✅

## Prototype Banner Design

Orange striped banner at top of content area with text:

```text
⚠ Prototype — [description of what's mock and what's needed]
```

## Recommendations

1. **DNS Setup:** Add custom domain records per `infra/CLOUDFLARE_SETUP.md`
2. **Authentication:** Implement real auth (OAuth/email) to replace form redirects
3. **Footer Links:** Create Privacy, Terms, Status pages or link externally
4. **Analytics Engine:** Enable in Cloudflare dashboard and uncomment wrangler binding
5. **SSO/GitHub Auth Buttons:** Wire up OAuth providers or remove buttons
