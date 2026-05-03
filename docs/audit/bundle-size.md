# `apps/site` bundle size

Snapshot of the production Vite build to track regressions over time and
to document the actual delivery cost of the Mantine migration.

## How to refresh

```bash
pnpm --filter @o11yfleet/site build
cd apps/site
for f in dist/assets/index-*.js dist/assets/BuilderPage-*.js dist/assets/mermaid-*.js dist/assets/useClickOutside-*.js dist/assets/SparklineCell-*.js dist/assets/public-api-*.js; do
  raw=$(wc -c < "$f")
  gz=$(gzip -c "$f" | wc -c)
  printf "%6d KB raw / %5d KB gzip  %s\n" $((raw/1024)) $((gz/1024)) "$(basename $f)"
done
```

The chunk hashes in filenames change every build; match by prefix.

## Current snapshot (post-Mantine migration, 2026-05-03)

| Chunk                | Raw                               | Gzip   | Notes                                                    |
| -------------------- | --------------------------------- | ------ | -------------------------------------------------------- |
| `index`              | 548 KB                            | 166 KB | App shell, routing, common Mantine primitives            |
| `BuilderPage`        | 684 KB                            | 225 KB | Pipeline Builder + xyflow + dagre — largest route        |
| `mermaid`            | 470 KB                            | 143 KB | Lazy-loaded; only fetched when an answer renders one     |
| `useClickOutside`    | 150 KB                            | 42 KB  | Mantine's @mantine/hooks tree, lazy on first interaction |
| `SparklineCell`      | 145 KB                            | 49 KB  | uPlot-based time-series chart                            |
| `public-api`         | 95 KB                             | 29 KB  | Marketing/public API documentation page                  |
| Total `dist/assets/` | 14 MB total raw across all chunks |        | Many lazy-loaded; not all delivered per page             |

Vite's >500 kB chunk warning fires for `index`, `BuilderPage`, and
`mermaid`. `BuilderPage` and `mermaid` are route-lazy and not on any
critical path; `index` is the app shell and is currently the
prime candidate for further code-splitting.

## Migration impact (qualitative, see PR descriptions for line-level)

The Mantine migration (PRs #552, #572, #574, #580) removed:

- 7 npm packages: `radix-ui`, `cmdk`, `class-variance-authority`,
  `clsx`, `tailwind-merge`, `@radix-ui/react-use-controllable-state`,
  `tw-animate-css` (devDep)
- ~6,500 lines of vendored shadcn/ai-elements primitive code
  (entire `apps/site/src/components/ai-elements/` and
  `apps/site/src/components/ui/` directories deleted)
- The legacy `Toast`, `Modal`, `Sheet` wrappers in `components/common/`
- The `@/lib/utils` `cn()` helper

Mantine and its peer packages (`@mantine/core`, `hooks`, `form`,
`modals`, `notifications`, `spotlight`, `dates`) were already in the
tree pre-migration; the cleanup pulled out parallel-installed shadcn
deps without adding new runtime weight.

Net effect on tree-shaken chunks is hard to attribute precisely
without a before/after build at the same commit, but the deleted
imports are real (verified by `pnpm-lock.yaml` shrinking by ~4,800
lines across the migration chain).

## Watch list

These are growing fastest and worth attention if any one tips ~250 KB
gzip:

- `index` — 166 KB gzip. Code-splitting candidates: `@codemirror/*`
  (only used by Builder + DiffViewer), `streamdown` + `@streamdown/*`
  (only used by AI copilot drawer).
- `BuilderPage` — 225 KB gzip. Already lazy. xyflow + dagre are
  heavy; consolidating node components (issue #529) would help.

## Followups to consider

1. Add a CI bundle-size check that fails if `index.js` gzip exceeds a
   budget (e.g., 200 KB). The Worker bundle has one; the site doesn't.
2. Lazy-import `streamdown` + its plugins from `PageCopilotDrawer`
   so they only fetch when the drawer opens.
3. Lazy-import `@codemirror/*` from `BuilderPage` and `DiffViewer`
   route bundles (likely already happens via Vite's automatic
   splitting; verify with `pnpm build --debug`).
