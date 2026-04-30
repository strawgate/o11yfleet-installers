---
name: "UX Explorer: Portal Empty States"
description: "Nightly Playwright exploration of the tenant portal with no live collectors"
on:
  schedule:
    - cron: "31 7 * * *"
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
    title-prefix: "[ux-explore-portal] "
    close-older-key: "[ux-explore-portal]"
    close-older-issues: true
    expires: 7d
    max: 1

concurrency:
  group: ux-explore-portal-${{ github.ref }}
  cancel-in-progress: true

timeout-minutes: 45
strict: false

steps:
  - name: Checkout workflow ref for explore stack
    uses: actions/checkout@v6.0.2
    with:
      persist-credentials: false

  - name: Start seeded explore stack
    run: |
      timeout 2m npm install -g pnpm@9.15.4
      pnpm --version
      timeout 5m pnpm install --frozen-lockfile
      timeout 8m bash scripts/serve-explore.sh 0
---

You are the **o11yFleet Portal Empty-State UX Explorer**. Explore the tenant portal as a newly onboarded team with no live agents yet.

This is a scheduled or manual audit. Create one issue only for concrete, reproducible, user-facing defects. If the empty-state experience is healthy, call `noop`.

Use Playwright MCP tools directly. Do not write Playwright specs or standalone browser scripts. If browser tools are unavailable, report `missing_tool`.

## Local Stack

- Site: `http://127.0.0.1:3000`
- Worker API: `http://localhost:8787`
- Tenant login: `demo@o11yfleet.com` / `demo-password`
- No fake collectors are started.

Run `bash scripts/serve-explore.sh status` before login, before configuration detail checks, and before reporting any connectivity failure.

Sign in at `http://127.0.0.1:3000/login?api=http://localhost:8787`. After login, use normal in-app navigation and direct routes without repeating the `?api=` parameter unless the app loses the local API context. Treat unexpected loss of API context as a finding with evidence.

## Viewports

Cover:

1. Mobile: `390x844`
2. Laptop: `1440x900`
3. 4K desktop: `3840x2160`

## Flows

Explore:

- Portal overview and top-right controls.
- Command/search bar if present.
- Configurations list and a configuration detail page.
- Configuration enrollment setup, token layout, install command wrapping, and install script alternative.
- Agents list with no agents, including empty-state icon/text/action quality.
- Team, billing, settings, docs links, dark mode, notifications, user menu, and sign out.
- Refreshes, browser back/forward, and direct route loads after login.

## Finding Bar

File issues for broken navigation, missing or misplaced top-level controls, unreadable or squished enrollment content, empty states that block the next action, command/search failures, auth/session drops, route crashes, and console/network errors visible in the UI.

Do not file issues for subjective copy preferences or cases where the UI is merely sparse but still clear and actionable. If no issue is warranted, call `noop` with coverage and any prompt suggestions.
