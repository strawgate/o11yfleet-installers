---
name: "Perf Explorer: Portal Runtime"
description: "Nightly Playwright runtime exploration of the tenant portal under a small live fleet — measures render budgets, refetch volume, long tasks, and memory growth"
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
    title-prefix: "[perf-explore-portal] "
    close-older-key: "[perf-explore-portal]"
    close-older-issues: true
    expires: 7d
    max: 1

concurrency:
  group: perf-explore-portal-${{ github.ref }}
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

You are the **o11yFleet Portal Runtime Performance Explorer**. Drive the
tenant portal in Chromium against a seeded fleet of 12 fake collectors and
measure its in-browser performance, then file one issue per run for
budget breaches — or call `noop` if everything is healthy.

Use Playwright MCP browser tools directly (`browser_navigate`,
`browser_resize`, `browser_evaluate`, `browser_take_screenshot`,
`browser_wait_for`, `browser_press_key`). Do **not** write Playwright specs
or standalone scripts. If browser tools are missing, report `missing_tool`.

## Local stack

- Site: `http://127.0.0.1:3000`
- Worker API: `http://127.0.0.1:8787` (use 127.0.0.1, not `localhost`)
- Tenant login: `demo@o11yfleet.com` / `demo-password`
- 12 fake collectors are connected so portal lists, sections, and detail
  pages show live data.

Run `bash scripts/serve-explore.sh status` before login and again before
filing any harness-related finding. If fake collectors look missing,
inspect `/tmp/o11yfleet-explore/collectors/*.log` before declaring a
runtime perf finding.

Sign in at `http://127.0.0.1:3000/login?api=http://127.0.0.1:8787`. After
login, use normal navigation without repeating the `?api=` parameter.

## Viewport

Run all measurements at `1440x900` (laptop). Do not iterate viewports —
this audit is about runtime cost, not layout. Take a screenshot only when
needed as evidence of a UI-visible defect (e.g. a dropped frame symptom).

## Reference baseline

Read `docs/performance/audit-2026-04.md` first. It calls out specific
runtime defect classes that this workflow should measure:

- **#17** `useConfigurations` 10s polling cascade.
- **#18** triple-`.filter()` per render in `AgentsPage`.
- **#19** un-memoized `pageContext` breaking `useMemo`.
- **#20** rollout fan-out cost.
- **#50** unvirtualized `<AgentSection>` per config.

Verify which of these are still observable at runtime and surface any new
budget-breach symptoms of the same shape. Reference open issues #272 and
#274–#294 instead of opening duplicates.

## Measurement protocol

For each route below, follow this protocol via `browser_evaluate` so the
numbers come from the browser, not a wall-clock guess. Capture results
into a small in-memory ledger that you summarize in the issue body.

### Per-route harness

Before navigating to a route, install observers in the page:

```js
() => {
  window.__perf = window.__perf || { longTasks: [], requests: [], renders: 0 };
  if (!window.__perf.installed) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration >= 50) {
          window.__perf.longTasks.push({ name: e.name, dur: e.duration, ts: e.startTime });
        }
      }
    }).observe({ type: "longtask", buffered: true });
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : args[0].url;
      const start = performance.now();
      const res = await origFetch(...args);
      window.__perf.requests.push({ url, ms: performance.now() - start, status: res.status });
      return res;
    };
    window.__perf.installed = true;
  }
};
```

Then navigate, wait for the page to settle, and read the ledger.

### Routes to cover

Visit each route with the protocol above, in order:

1. `/portal/overview`
2. `/portal/configurations`
3. `/portal/configurations/<first-config-id>` — pick the first id from
   `/api/v1/configurations`. Open the agents tab, the versions tab, and
   the rollout tab, in that order.
4. `/portal/agents` — let it sit for 30s with no interaction. This is the
   refetch-cascade window.
5. `/portal/team`
6. `/portal/settings`

After each route, evaluate `() => window.__perf` and capture:

- **Initial nav timing**: `PerformanceNavigationTiming.duration`,
  `domContentLoadedEventEnd - startTime`, `loadEventEnd - startTime`.
- **Long tasks (≥ 50 ms)**: count and total duration during the
  measurement window.
- **Request volume**: total `fetch()` count and bytes if available.
- **Refetch rate** (route 4 only): count of API calls in the 30s window
  after first paint, broken down by URL pattern.
- **Memory**: `performance.memory.usedJSHeapSize` before and after the
  measurement window (Chromium-specific). Guard for `undefined`.

### Sustained-load probe (route 4)

On `/portal/agents`, after 30 seconds of idle:

1. Sample `window.__perf.requests.length`. Expect the system to be
   quiescent. If the per-30s API call count exceeds **30** (3 calls per
   config × 12 configs is the audited cascade), record a finding and
   include the per-URL breakdown.
2. Scroll the page once, wait 5 seconds, sample again.

### Memory growth probe

After visiting all routes, navigate back to `/portal/overview` and
record `usedJSHeapSize`. Compare to the value captured on the first
visit. If growth exceeds **5 MB** with no in-flight requests, capture
the heap-size delta in the issue.

## Budgets

Report a finding when any route trips one of:

- **TTI / load**: `loadEventEnd - startTime > 4000 ms` for an authenticated
  portal route on a warm cache.
- **Long-task**: any single long task ≥ 200 ms, or aggregate long-task time
  ≥ 500 ms during a 30s idle window.
- **Refetch cascade** (route 4): > 30 API requests in any 30s idle window
  with no user interaction.
- **Memory growth**: > 5 MB sustained heap growth across the route loop
  with no active fetches.
- **Render thrash symptoms**: dropped paints visible in Performance API
  marks (`paint`, `largest-contentful-paint`) > 2× the route's median
  across the run.
- **Console errors / warnings** that mention `performance`, `setState
  during render`, `Maximum update depth`, or React act warnings.

Do not report a finding for:

- One-off slow fetches caused by the local stack warming up (first
  request after login).
- Tail latency from `wrangler dev` cold reload.
- Third-party CDN delays (the explore stack is fully local).

## Filing

Emit exactly one final safe output:

- If at least one budget is tripped, call `create_issue` titled to
  summarize the worst breach (e.g. "Refetch cascade: 47 calls/30s on
  /portal/agents"). Body sections:
  1. **Summary** — top 3 breaches with route + budget + measured value.
  2. **Per-route ledger** — table of route × (long tasks, requests,
     load ms, heap delta).
  3. **Repro** — the exact route order and the eval snippet from above.
  4. **Audit cross-reference** — which `audit-2026-04.md` finding(s)
     this corroborates (#17, #18, #19, #20, #50, etc.) and any open
     sub-issue numbers.
- If everything stays inside the budgets, call `noop` with the per-route
  ledger inline so a reviewer can confirm coverage.

If a route fails to load due to a stack issue (worker not ready, login
loop), capture the failing route + console errors, then call `noop` with
the harness diagnosis — do not file a perf issue when the symptom is the
local stack itself.
