# Accessibility & Usability Audit — apps/site

A line-by-line review of the React/TypeScript front-end at `apps/site/` (marketing
site, user portal, admin console, auth pages). 54 issues catalogued; severity
follows the WCAG-aligned scale below.

## Severity scale

| Level    | Definition                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------- |
| critical | Blocks a class of users entirely (screen reader, keyboard-only, low-vision) or is a confirmed UX defect |
| high     | Significantly degrades the experience for users with disabilities or causes confusion / lost work       |
| medium   | Inconsistent or sub-optimal, fix on next pass                                                           |
| low      | Polish — semantic / structural cleanup                                                                  |

## Indexes

- [Critical (15)](./critical.md)
- [High (20)](./high.md)
- [Medium (12)](./medium.md)
- [Low (7)](./low.md)

## Methodology

For each finding:

1. **Symptom** — what a user sees / hears.
2. **Affected** — primary group impacted.
3. **Where** — file path + line range.
4. **Evidence** — short code excerpt or behavior description.
5. **Fix** — minimal-diff recommendation.

A subset of issues is also encoded as a runnable failing-test suite under
`apps/site/test/a11y-audit-pending.tsx`. That file is intentionally excluded
from the default `npm test` glob (no `.test.` infix) so CI stays green; run
it manually with:

```bash
cd apps/site && npx tsx --test test/a11y-audit-pending.tsx
```

Each test is asserted against the current source and **fails today**; once the
underlying issue is resolved, the corresponding test should pass without
modification.

## Quick wins (one-liners)

These are high-impact, low-risk and could ship as a single follow-up PR:

- Add `<main>` landmark to `MarketingLayout` (Critical #1).
- Add a "Skip to content" link in all three layouts (Critical #2).
- Add `role="status"` + visually-hidden text to `LoadingSpinner` (Critical #12).
- Wrap `Toaster` in `aria-live="polite"` / errors in `role="alert"` (Critical #4).
- Replace `placeholder="Filter agents…"` with a real `<label>` (Critical #7).
- Fix the `\n` literal in `BuilderPage` textarea placeholder (Critical #6).
