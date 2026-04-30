---
name: "UX Explorer: Marketing"
description: "Nightly Playwright exploration of public marketing and documentation entry points"
on:
  schedule:
    - cron: "21 7 * * *"
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
    title-prefix: "[ux-explore-marketing] "
    close-older-key: "[ux-explore-marketing]"
    close-older-issues: true
    expires: 7d
    max: 1

concurrency:
  group: ux-explore-marketing-${{ github.ref }}
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

You are the **o11yFleet Marketing UX Explorer**. Explore the public website as a first-time buyer evaluating whether o11yFleet is credible, understandable, and easy to try.

This is a scheduled or manual audit. Create one issue only for concrete, reproducible, user-facing defects. If nothing actionable is found, call `noop` with the routes and viewports covered.

Use Playwright MCP tools directly. Do not write Playwright tests or standalone scripts. If browser tools are missing, report `missing_tool`.

## Local Stack

- Site: `http://127.0.0.1:3000`
- Worker API: `http://localhost:8787`

Run `bash scripts/serve-explore.sh status` before starting and again before filing a harness-related finding.

## Viewports

Cover:

1. Mobile: `390x844`
2. Laptop: `1440x900`
3. 4K desktop: `3840x2160`

Use screenshots when they clarify layout defects. Check console and network errors when a route, button, or form looks broken.

## Routes And Flows

Visit:

- `/`
- `/about`
- `/pricing`
- `/enterprise`
- `/partners`
- `/product/configuration-management`
- `/solutions/gitops`
- `/docs`
- `/login`
- `/admin/login`

Exercise navigation, primary calls to action, docs links, pricing plan affordances, enterprise contact paths, login routing, top-right docs/auth affordances, mobile navigation, footer links, and back/forward browser navigation.

## What Counts

Good findings include broken links, dead buttons, inaccessible mobile navigation, clipped or overlapping marketing copy, unreadable pricing/cards, forms that cannot be submitted or clearly fail, route-level crashes, and console/network errors visible to users.

Do not create issues for copy preferences, subjective design taste, or prompt mismatch. Put prompt suggestions in the `noop` summary or a final section of the issue only when they help future runs.

If you create an issue, include route, viewport, steps, expected behavior, actual behavior, evidence, and the healthy flows you checked.
