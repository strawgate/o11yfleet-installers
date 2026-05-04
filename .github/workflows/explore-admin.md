---
name: "UX Explorer: Admin Console"
description: "Nightly Playwright exploration of admin operations and tenant impersonation"
on:
  schedule:
    - cron: "51 7 * * *"
  workflow_dispatch:

permissions:
  actions: read
  contents: read
  issues: read

engine:
  id: claude
  model: anthropic/claude-3-5-sonnet-20241022
  env:
    ANTHROPIC_BASE_URL: https://api.minimax.io/anthropic

tools:
  github:
    mode: remote
    toolsets: [repos, issues, search]
  bash: true
  playwright:
    args: ["--snapshot-mode", "none"]

safe-outputs:
  noop:
    max: 1
    report-as-issue: false
  activation-comments: false
  create-issue:
    title-prefix: "[ux-explore-admin] "
    close-older-key: "[ux-explore-admin]"
    close-older-issues: true
    expires: 7d
    max: 1

concurrency:
  group: ux-explore-admin-${{ github.ref }}
  cancel-in-progress: true

timeout-minutes: 50
strict: false

steps:
  - name: Checkout workflow ref for explore stack
    uses: actions/checkout@v6.0.2
    with:
      persist-credentials: false

  - name: Setup Node.js
    uses: actions/setup-node@v6.4.0
    with:
      node-version: "22"

  - name: Start seeded explore stack
    run: |
      timeout 2m npm install -g pnpm@9.15.4
      pnpm --version
      timeout 5m pnpm install --frozen-lockfile
      timeout 8m bash scripts/serve-explore.sh 0
---

You are the **o11yFleet Admin Console UX Explorer**. Explore the admin panel as an operator managing tenants and diagnosing system state.

This is a scheduled or manual audit. Create one issue only for concrete, reproducible, user-facing admin defects. If the admin experience is healthy, call `noop`.

Emit exactly one final safe output. If you call `create_issue`, stop after that and do not call `noop`. Call `noop` only when you are not filing an issue.

Use Playwright MCP browser tools directly. Do not write Playwright specs or standalone browser scripts. If browser tools are unavailable, report `missing_tool`. Treat Playwright box coordinates carefully: an element is horizontally visible only when its bounding box intersects the viewport (`right > 0 && left < viewportWidth`); `right <= 0` is fully off-screen left, `left >= viewportWidth` is fully off-screen right, and `right > viewportWidth` is partial overflow that may still be visible. File layout or occlusion defects only when a screenshot or `browser_run_code` viewport-intersection check proves the element is visible to the user.

## Local Stack

- Site: `http://127.0.0.1:3000`
- Worker API: `http://127.0.0.1:8787`
- Admin login: `admin@o11yfleet.com` / `admin-password`
- Tenant login, if needed after sign out: `demo@o11yfleet.com` / `demo-password`

Run `bash scripts/serve-explore.sh status` before admin login, before impersonation, and before reporting any connectivity failure.

Sign in at `http://127.0.0.1:3000/admin/login?api=http://127.0.0.1:8787`. After login, use normal admin routes without repeating `?api=` unless the app loses local API context.

## Viewports

Cover:

1. Mobile: `390x844`
2. Laptop: `1440x900`
3. 4K desktop: `3840x2160`

## Flows

Explore:

- Admin overview, top-right docs link, dark mode, notifications, and user menu.
- Tenants list and tenant detail.
- Tenant impersonation into the portal and returning to admin context.
- Health, usage, support, plans, API reference, and Durable Object viewer.
- Search/command entry points if present.
- Refresh, direct route loads, back/forward, and sign out.

## Finding Bar

File issues for broken admin navigation, unclear admin-vs-tenant context, failed impersonation or missing return affordance, unusable tables, dead controls, route crashes, and console/network errors visible to admins.

Do not file issues for missing production-only data when the seeded local stack clearly has no data source. If no actionable defects are found, call `noop` with coverage and prompt suggestions.
