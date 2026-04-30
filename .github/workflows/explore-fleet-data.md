---
name: "UX Explorer: Fleet Data"
description: "Nightly Playwright exploration of tenant fleet workflows with fake collectors online"
on:
  schedule:
    - cron: "41 7 * * *"
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
    title-prefix: "[ux-explore-fleet-data] "
    close-older-key: "[ux-explore-fleet-data]"
    close-older-issues: true
    expires: 7d
    max: 1

concurrency:
  group: ux-explore-fleet-data-${{ github.ref }}
  cancel-in-progress: true

timeout-minutes: 60
strict: false

steps:
  - name: Checkout workflow ref for explore stack
    uses: actions/checkout@v6.0.2
    with:
      persist-credentials: false

  - name: Start seeded explore stack with collectors
    run: |
      timeout 2m npm install -g pnpm@9.15.4
      pnpm --version
      timeout 5m pnpm install --frozen-lockfile
      timeout 10m bash scripts/serve-explore.sh 12
---

You are the **o11yFleet Fleet Data UX Explorer**. Explore tenant workflows when a small fleet of fake collectors is online.

This is a scheduled or manual audit. Create one issue only for concrete, reproducible, user-facing defects. If the data-backed fleet experience is healthy, call `noop`.

Emit exactly one final safe output. If you call `create_issue`, stop after that and do not call `noop`. Call `noop` only when you are not filing an issue.

Use Playwright MCP browser tools directly. Do not write Playwright specs or standalone browser scripts. If browser tools are unavailable, report `missing_tool`. Treat Playwright box coordinates carefully: an element is horizontally visible only when its bounding box intersects the viewport (`right > 0 && left < viewportWidth`); `right <= 0` is fully off-screen left, `left >= viewportWidth` is fully off-screen right, and `right > viewportWidth` is partial overflow that may still be visible. File layout or occlusion defects only when a screenshot or `browser_run_code` viewport-intersection check proves the element is visible to the user.

## Local Stack

- Site: `http://127.0.0.1:3000`
- Worker API: `http://127.0.0.1:8787`
- Tenant login: `demo@o11yfleet.com` / `demo-password`
- The workflow starts 12 fake collectors.

Run `bash scripts/serve-explore.sh status` before login, before fleet table checks, and before reporting any connectivity failure. If fake collectors appear missing, inspect `/tmp/o11yfleet-explore/collectors/*.log` before filing a UI issue.

Sign in at `http://127.0.0.1:3000/login?api=http://127.0.0.1:8787`. After login, use normal navigation without repeating `?api=` unless the app loses local API context.

## Viewports

Cover:

1. Mobile: `390x844`
2. Laptop: `1440x900`
3. 4K desktop: `3840x2160`

## Flows

Explore:

- Overview metrics with online/offline fleet data.
- Configurations list and configuration detail.
- Agents table, row actions, agent detail pages if present, filtering/search/sort, pagination or overflow behavior.
- Fleet status language: only call something an insight if the page provides enough evidence. Do not invent historical comparisons.
- Command/search bar if present, especially whether it can find agents and configuration pages.
- Refresh, reconnect-looking states, loading skeletons, and direct route loads.

## Finding Bar

File issues for data tables that become unreadable, broken row/detail navigation, filters that do not filter, stale loading states, misleading metrics with available table evidence, UI crashes, or console/network failures visible to users.

Do not file issues for the absence of historical insight. If a metric is plain but accurate, treat it as healthy. If there are no actionable defects, call `noop` with coverage and any prompt suggestions.
