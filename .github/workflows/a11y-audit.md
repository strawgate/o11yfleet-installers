---
name: "Audit: Site A11y & Usability"
description: "Reviews apps/site for accessibility & usability defects (static source review plus live axe-core scans via Playwright) and reports findings as a PR comment or single issue"
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    branches: [main]
    paths:
      - ".github/workflows/a11y-audit.md"
      - ".github/workflows/a11y-audit.lock.yml"
      - "apps/site/**"
      - "packages/core/**"
      - "scripts/**"
      - "justfile"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
  workflow_dispatch:
    inputs:
      surfaces:
        description: "Surfaces to audit (comma-separated subset of: marketing,portal,admin,auth,common)"
        required: false
        default: "marketing,portal,admin,auth,common"
        type: string
      severity_floor:
        description: "Minimum severity to include in the report"
        required: false
        default: "high"
        type: choice
        options:
          - critical
          - high
          - medium
          - low
  # Fuzzy weekly schedule on Monday — gh-aw distributes the actual minute to
  # spread load across repos. Catches drift between explicit audits.
  schedule:
    - cron: "weekly on monday"
permissions:
  actions: read
  contents: read
  discussions: read
  issues: read
  pull-requests: read
engine:
  id: claude
  model: anthropic/claude-3-5-sonnet-20241022
  env:
    ANTHROPIC_BASE_URL: https://api.minimax.io/anthropic
  concurrency:
    group: "gh-aw-claude-${{ github.workflow }}-a11y-audit-${{ github.event.pull_request.number || github.ref }}"
network:
  allowed: [defaults, github, node, playwright]
tools:
  github:
    mode: remote
    toolsets: [default, actions]
    allowed: [create_issue, create_issue_comment, get_workflow_run, list_workflow_jobs, search_issues]
  bash: true
  playwright: null
safe-outputs:
  activation-comments: false
  create-issue:
    max: 1
    title-prefix: "[a11y-audit] "
    labels: [accessibility, usability, automated]
    close-older-key: "[a11y-audit]"
    close-older-issues: true
    expires: 7d
  add-comment:
    max: 1
    hide-older-comments: true
  noop:
    max: 1
    # gh-aw enables `noop` automatically as soon as any safe-output is
    # declared, with `report-as-issue: true` by default. That would open
    # a tracker issue every time a PR run, schedule run, or dispatch
    # finds nothing actionable — strictly noise. Override to `false` so
    # a clean run posts no comment and no issue; the workflow run
    # summary in the GitHub Actions UI is enough signal.
    report-as-issue: false
concurrency:
  group: a11y-audit-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
strict: false
timeout-minutes: 45
steps:
  # Pin Node before any pnpm / playwright / wrangler invocation. The user
  # steps block runs before gh-aw's own actions/setup-node call, so if we
  # don't pin here the bootstrap uses whatever Node ubuntu-latest happens
  # to ship — non-deterministic.
  - name: Setup Node.js
    uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
    with:
      node-version: "24"
  - name: Repo-specific setup
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: |
      npm install -g pnpm@9.15.4
      pnpm install --frozen-lockfile
      pnpm --filter @o11yfleet/ui-tests exec playwright install chromium
      bash scripts/serve-explore.sh 12
---

# o11yFleet A11y & Usability Auditor

Audit `apps/site/` (marketing site, tenant portal, admin console, auth pages)
for accessibility and usability defects, then report findings.

You combine **two passes**:

1. **Static source review** — read the React/TypeScript/CSS in `apps/site/`
   directly with `Read`/`Glob`/`Grep`/`Bash` and look for the defect classes
   listed below.
2. **Live axe-core scan** — drive the seeded local app with the Playwright
   MCP browser tools (`browser_navigate`, `browser_resize`,
   `browser_snapshot`, `browser_evaluate`, `browser_press_key`,
   `browser_take_screenshot`) and run `axe-core` in-page to verify the
   static findings against rendered markup and surface contrast,
   focus-order, and DOM-only issues a static pass cannot see.

You are **not** a deterministic E2E suite. Do not write Playwright specs,
do not run `playwright test`. Use the MCP browser tools interactively, one
action at a time, and inspect the page after each.

## Inputs

- `surfaces`: `${{ inputs.surfaces || 'marketing,portal,admin,auth,common' }}`
- `severity_floor`: `${{ inputs.severity_floor || 'high' }}`

GitHub Actions only populates the `inputs` context for `workflow_dispatch`
runs; on `pull_request` and `schedule` triggers `inputs.*` is empty. The
`||` defaults above ensure a non-empty value reaches the prompt at every
trigger. Always print the effective values you're using at the top of
your output (e.g. "Severity floor: high; surfaces: marketing,portal,admin,auth,common")
so a reviewer can confirm.

## Local app

The setup step starts a seeded local stack:

- Site: `http://127.0.0.1:3000`
- Worker API: `http://localhost:8787`
- Tenant login: `demo@o11yfleet.com` / `demo-password`
- Admin login: `admin@o11yfleet.com` / `admin-password`
- 12 fake collectors so agent-list filtering, pagination, and detail pages
  can be exercised.

Use `?api=http://localhost:8787` on login URLs if the UI does not auto-pick
up the local API.

## Reference baseline

A prior audit lives in `docs/audit/a11y-usability/`:

- `README.md` (severity scale + index)
- `critical.md`, `high.md`, `medium.md`, `low.md`

Read these first. Treat them as the prior baseline — your job is to verify
which findings are still present, surface any new ones, and skip those that
have been fixed.

## Audit protocol

The protocol intentionally **runs the audit first, then dedupes** — checking
for an existing `[a11y-audit]` issue before walking the source would
suppress a regression introduced inside the 7-day window.

### Phase 1: Static source review

Walk these surfaces (filter by `surfaces` input):

| Surface     | Globs                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| `marketing` | `apps/site/src/layouts/MarketingLayout.tsx`, `apps/site/src/pages/marketing/*.tsx`   |
| `portal`    | `apps/site/src/layouts/PortalLayout.tsx`, `apps/site/src/pages/portal/*.tsx`         |
| `admin`     | `apps/site/src/layouts/AdminLayout.tsx`, `apps/site/src/pages/admin/*.tsx`           |
| `auth`      | `apps/site/src/pages/auth/*.tsx`, `apps/site/src/pages/NotFoundPage.tsx`             |
| `common`    | `apps/site/src/components/common/*.tsx`, `apps/site/src/components/ai/*.tsx`         |

Also scan `apps/site/src/styles/*.css` for global rules that affect a11y
(focus indicators, `text-decoration: none` on `a`, missing
`prefers-reduced-motion`, low-contrast tokens).

For each file, read end-to-end and look for:

**ARIA & semantics**

- Missing `<main>` landmark in a layout.
- Tab UI as plain `<button>` without `role="tablist"` / `role="tab"` /
  `aria-selected`.
- Modals / Sheets with hardcoded `aria-labelledby` ids (id collisions when
  multiple instances mount).
- Modals / Sheets without focus traps OR focus traps that don't handle
  `document.activeElement === <body>` (focus can escape).
- Profile / dropdown menus that aren't real ARIA menus
  (`aria-haspopup` / `aria-expanded` / `role="menu"`).
- Breadcrumbs without `<nav aria-label="Breadcrumb">` + `<ol><li>`.
- Custom radiogroups without arrow-key navigation.
- Decorative SVGs without `aria-hidden="true"`.

**Live regions**

- Toast container without `aria-live` / `role="status"` / `role="alert"`.
- Async form errors rendered as inline `<div>` with no `role="alert"`.
- Loading spinners with no `role="status"` and no accessible name.
- State changes (e.g. waiting → connected) not announced.

**Forms**

- `<input>` / `<select>` / `<textarea>` with only a `placeholder` (no
  `<label>` and no `aria-label`).
- Disabled buttons that don't explain *why* via `aria-describedby`.
- Disabled "Coming soon" controls that rely on `title` attributes.
- Destructive single-click buttons with no confirmation.

**Interactive affordances**

- `onClick={() => {}}` no-op handlers feigning interactivity.
- Icon-only links / buttons without `aria-label` (e.g. `→`, `…`, `⋮`).
- Non-functional controls in production (notifications bell with no
  handler, org switcher chevron with no handler).

**Visual / motion**

- No `@media (prefers-reduced-motion: reduce)` rule anywhere in
  `apps/site/src/styles/`.
- Inline links inside paragraphs that rely on color alone (global
  `text-decoration: none`).
- Visually hidden helpers (`.sr-only`) defined in a stylesheet that the
  marketing surface doesn't import.

**Heading hierarchy**

- Footer / sidebar / page section headings that skip levels (e.g. `<h5>`
  after `<h2>`).

For every match, capture: file path, line range, ≤3-line code excerpt, the
affected user group (SR / keyboard / low-vision / all users), and a
minimal-diff fix.

### Phase 2: Live axe-core scan

For each surface in the input, drive Playwright through the canonical
routes below. **At each route**:

1. `browser_navigate` to the URL.
2. `browser_resize` once per viewport pass (do all routes at one viewport
   before moving to the next, to amortise login).
3. Inject and run `axe-core` via `browser_evaluate` (the Playwright MCP
   exposes `browser_evaluate`, not `browser_console_execute`). Fetch
   axe-core from `cdn.jsdelivr.net` — it is on the gh-aw default
   network allow-list; `cdnjs.cloudflare.com` is **not**:
   ```js
   const s = document.createElement('script');
   s.src = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';
   document.head.appendChild(s);
   await new Promise((r) => (s.onload = r));
   const result = await axe.run(document, {
     resultTypes: ['violations'],
     runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
   });
   return result.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes[0]?.target?.[0] ?? null }));
   ```
4. Capture `browser_snapshot` (DOM) for the focused interactive area on the
   page and verify focus order with the keyboard. Press `Tab` repeatedly
   with `browser_press_key` and read `document.activeElement` via
   `browser_evaluate` after each press — record the ordered selectors and
   flag any element that is reached but non-functional, or any
   visually-prominent control that is unreachable.

**Viewports** (all three required):

1. Mobile: `390x844`
2. Laptop: `1440x900`
3. 4K desktop: `3840x2160`

**Routes**

Public site (no auth needed):

- `/`
- `/about`
- `/pricing`
- `/enterprise`
- `/partners`
- `/product/configuration-management`
- `/solutions/gitops`
- `/login`
- `/admin/login`

Tenant portal (sign in via `/login?api=http://localhost:8787`):

- `/portal/overview`
- `/portal/configurations`
- a configuration detail (open the first row)
- `/portal/agents`
- an agent detail (open one)
- `/portal/tokens`
- `/portal/team`
- `/portal/billing`
- `/portal/settings`
- `/portal/getting-started`

Admin console (sign in via `/admin/login?api=http://localhost:8787`):

- `/admin/overview`
- `/admin/tenants`
- a tenant detail (open one) — exercise impersonation back to the portal
- `/admin/health`
- `/admin/usage`
- `/admin/support`
- `/admin/plans`
- `/admin/do-viewer`
- `/admin/api`

Also exercise `Cmd/Ctrl+K` to open the command palette and verify focus is
trapped while it is open and restored when it closes.

### Phase 3: Apply severity floor

Drop findings below `severity_floor`. Severity rules:

- **critical** — blocks a class of users entirely or is a confirmed UX
  defect (e.g. literal `\n` in a placeholder, focus-trap escape, missing
  `<main>` landmark).
- **high** — significantly degrades UX for users with disabilities or
  causes confusion / lost work (silent destructive action, missing
  arrow-key nav on a radiogroup, contrast below WCAG AA).
- **medium** — inconsistent or sub-optimal (empty `<th>`, missing
  `aria-pressed`).
- **low** — polish (heading levels, decorative SVGs).

Map axe-core impact to severity: `critical → critical`, `serious → high`,
`moderate → medium`, `minor → low`.

If no findings remain after the floor is applied, post no output (do not
call any safe-output) and exit cleanly. The default `noop` behaviour would
otherwise open a tracker issue, which is exactly what we want to avoid for
a clean run.

### Phase 4: Dedupe against the existing tracker

*Only after* you've assembled the post-floor finding set, search for an
open issue with title prefix `[a11y-audit]` via `search_issues`. If one
exists, was opened in the last 7 days, and **its findings cover yours at
the requested severity floor**, skip output entirely. If your set contains
anything new, post regardless — `close-older-key` will retire the
superseded issue when the new one is created.

This ordering matters: dedupe-before-audit would suppress regressions
introduced inside the 7-day window.

### Phase 5: Output

**On a pull request run**, post **one PR comment** via `add-comment` using
the schema below.

**On `workflow_dispatch` or `schedule`**, create **one issue** via
`create-issue` using the same schema. Title prefix `[a11y-audit] ` is
applied automatically; close-older-key dedupes with prior runs.

**Body schema**:

```
## A11y & Usability audit — apps/site

**Severity floor**: <severity_floor>
**Surfaces audited**: <list>
**Viewports scanned**: 390x844, 1440x900, 3840x2160
**Reference baseline**: docs/audit/a11y-usability/

### Verdict

<one paragraph: total findings, breakdown by severity, what looked healthy>

### Static findings

For each finding (severity-ordered):

#### F<n>. <one-line headline>

- **Severity**: critical | high | medium | low
- **Affected**: SR users | keyboard users | low-vision | all users
- **Where**: `path/to/file.tsx:line-range`
- **Evidence**:
  ```tsx
  <≤3 lines from source>
  ```
- **Fix**: <minimal-diff recommendation>

### Live axe-core findings

For each violation:

#### A<n>. <axe rule id> — <route> @ <viewport>

- **Severity**: critical | high | medium | low
- **WCAG**: <SC reference>
- **Nodes affected**: <count>
- **Sample target**: `<css selector>`
- **Help**: <axe `help` text>
- **Screenshot**: <attached if relevant>

### Healthy areas

- <bullet list of surfaces / patterns that scanned clean>

### Prompt Suggestions

If this workflow's prompt no longer matches the current UI (routes moved,
new auth flow, etc.), include a **Prompt Suggestions** section describing
which lines need to change. Do not file UI prompts as product bugs.

### How this report was generated

Posted by `.github/workflows/a11y-audit.md`. Re-run via
`Actions → Audit: Site A11y & Usability → Run workflow`, or wait for the
weekly schedule. If a finding is invalid, comment with the rationale and
the next run will skip it (the agent reads recent `[a11y-audit]` issues for
context).
```

Cap the report at 30 static findings + 30 live findings. If you find more,
prioritize by severity and append "Additional findings" with file:line or
axe rule id only.

## Skip-output criteria

Skip writing a comment or issue (do not call any safe-output) if any of
these hold:

- After applying the severity floor in Phase 3, zero static **and** zero
  live findings remain.
- The Phase 4 dedupe step found a recent `[a11y-audit]` issue that fully
  covers your post-floor finding set.

If the setup step failed, the seeded stack is unreachable, or a Playwright
tool returned a hard error, surface that via the `missing_tool` /
`missing_data` safe-output instead — do not post a misleading report.

## Output rules

- One report per run. Do not post both an issue and a PR comment.
- Cite line numbers from the **current** source, not the baseline doc.
- Do not duplicate the baseline doc verbatim — only include findings still
  present in source or in the rendered DOM.
- Quote at most 3 lines per static evidence excerpt.
- Findings outside `apps/site/` are out of scope; ignore them.
