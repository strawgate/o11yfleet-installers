# Frontend Architecture Direction

## Decision

Keep the current Vite + React stack, and finish standardizing the product UI on
Tailwind v4, shadcn-style owned components, Radix primitives, TanStack Query, AI
SDK, and AI Elements. Do not move the app to Next.js, TanStack Start, Astro, or a
new router as the next step.

The app is not on the wrong foundation. It is halfway through a migration:

- `apps/site` already uses Vite, React 19, React Router 7, TanStack Query,
  Tailwind v4, shadcn-style component files, Radix, lucide, AI SDK, and AI
  Elements.
- The product surface still mostly renders older global classes such as `btn`,
  `card`, `dt-card`, `stat`, `tag`, and page-specific CSS.
- Large page files mix routing, server-state hooks, response normalization,
  page-specific calculations, AI context assembly, and rendering.

That split makes the UI feel stapled together even though the dependency stack is
mostly the one we would choose today.

## Evidence In This Repo

The current site package already has the modern pieces:

- `apps/site/package.json` includes `@tanstack/react-query`, `react-router`,
  `tailwindcss`, `@tailwindcss/vite`, `class-variance-authority`, `cmdk`,
  `lucide-react`, `radix-ui`, `ai`, `@ai-sdk/react`, and `streamdown`.
- `apps/site/components.json` is configured for shadcn-style local components
  under `src/components/ui`.
- `apps/site/src/components/ui/` already has owned primitives such as `button`,
  `command`, `dialog`, `dropdown-menu`, `input`, `select`, `tooltip`, and
  `spinner`.
- `apps/site/src/components/ai-elements/` already has AI Elements primitives used
  by `PageCopilotDrawer`.

The pain points are structural:

- `apps/site/src/styles/portal-shared.css` is about 1,900 lines, and
  `apps/site/src/styles/styles.css` is about 1,300 lines.
- Several pages are too large for the amount of product behavior they own:
  `ConfigurationDetailPage.tsx` is about 1,000 lines, `AgentsPage.tsx` about 450
  lines, and `BuilderPage.tsx` about 435 lines.
- `App.tsx` uses declarative `<Routes>` with manual lazy imports, global
  provider setup, chunk-load fallback, and auth redirect behavior in one file.
- `api/hooks/portal.ts` and `api/hooks/admin.ts` expose backend-shaped DTOs
  directly to pages, including transitional names like `total_agents`,
  `connected_agents`, `metrics_source`, and index signatures.
- Many pages still use legacy CSS classes and inline styles instead of
  consistent owned components.

## Options Considered

### Option A: Keep Vite, Finish The Design System

This is the recommended path.

Use the stack we already have:

- Vite for build and dev server.
- React Router in data-router style where it helps, but not as a full framework
  migration yet.
- TanStack Query for authenticated API server state.
- Tailwind v4 for tokens, layout utilities, container queries, and responsive
  behavior.
- shadcn-style owned components for reusable UI primitives.
- TanStack Table for dense admin and portal tables.
- AI SDK and AI Elements for streaming AI interactions.

Why this is best:

- It avoids a framework migration while we are still reshaping the product API
  and UI information architecture.
- This approach aligns with Cloudflare Workers static asset deployment.
- Marketing, portal, and admin remain in one app until there is a real reason
  to split deployment units.
- Page-by-page improvements can proceed without freezing product work.

### Option B: Move To React Router Framework Mode

This is plausible later, but not the next move.

React Router's data mode supports route objects, layout routes, loaders, and
nested routes. Framework mode adds server/static data loading and route module
conventions. That can help if we want route-level data, pre-rendered marketing
pages, or a server-rendering story.

Why not now:

- Our API is already a Cloudflare Worker API, and the app relies on authenticated
  browser requests with cookies.
- The immediate pain is component and data-shape inconsistency, not a missing SSR
  framework.
- Migrating before we standardize UI and domain models would move the clutter
  into route modules instead of removing it.

### Option C: Move To TanStack Router Or TanStack Start

This is attractive for type-safe route params and search params, especially once
the admin console has many filterable tables.

Why not now:

- It would replace working React Router usage without addressing the largest
  sources of complexity: global CSS, large page components, and backend-shaped
  DTOs leaking into UI.
- TanStack Router type safety pays off most after route modules and search-param
  contracts are stable. Our product routes are still changing quickly.

### Option D: Split Marketing Into A Separate Framework

Astro or a separate React Router/Next app could make sense if marketing becomes a
content-heavy, SEO-heavy site with a publishing workflow.

Why not now:

- The marketing pages are not the main complexity source.
- Splitting now creates another app, another deployment target, and shared design
  system packaging before the shared design system is stable.
- We can still lazy-load product routes and keep marketing fast in the current
  Vite app.

## Target Shape

### App Structure

Move toward feature modules while preserving the current app entrypoint:

```text
apps/site/src/
  app/
    App.tsx
    providers.tsx
    routes.tsx
  components/
    ui/
    app/
      PageHeader.tsx
      PageShell.tsx
      EmptyState.tsx
      MetricCard.tsx
      ObservationBadge.tsx
      DataTable.tsx
      Toolbar.tsx
  features/
    ai/
    fleet/
    configurations/
    agents/
    admin/
    marketing/
  api/
    client.ts
    hooks/
    models/
```

The important boundary is not the exact folder names. The important boundary is:

- `api/client.ts` handles HTTP, auth errors, and response parsing.
- `api/hooks/*` owns TanStack Query keys and request lifetimes.
- `api/models/*` normalizes API DTOs into UI/domain models.
- `features/*` owns feature-specific components and selectors.
- `components/app/*` owns reusable product UI building blocks.
- `components/ui/*` stays low-level shadcn/Radix primitives.

### Data Shape

Use nested domain objects in product-facing APIs and UI models:

```ts
type Observed<T> = {
  value: T | null;
  observation: {
    status: "ok" | "partial" | "missing" | "unavailable" | "error";
    observed_at: string | null;
    coverage?: {
      expected?: number;
      observed?: number;
    };
    warnings?: string[];
  };
};

type FleetOverview = {
  agents: {
    total: Observed<number>;
    connected: Observed<number>;
    healthy: Observed<number>;
  };
  configurations: {
    total: Observed<number>;
  };
};
```

Prefer `agents.total` over `total_agents`. The UI should not know whether a
number came from Analytics Engine, D1, or a Durable Object. It should know
whether the value is usable, missing, partial, or old enough to visually qualify.

### UI System

Make Tailwind + owned components the product standard:

- New UI should use `components/ui` primitives and `components/app` composites.
- Avoid new global classes like `btn`, `card`, `dt-card`, `stat`, and `tag`.
- Avoid inline layout styles except for dynamic values that are truly data-driven
  such as chart bar height.
- Use lucide icons through reusable components for empty states, status, and
  actions.
- Keep marketing more expressive, but portal/admin should be dense, calm, and
  operational.

The legacy CSS can remain while pages migrate. The rule is that new or touched
screens should move toward owned components instead of adding new selectors to
large shared CSS files.

### Tables

Adopt TanStack Table for admin and portal tables when a table needs more than
static rendering:

- sorting
- filtering
- pagination
- column visibility
- row selection
- virtualized large result sets

Do not introduce AG Grid yet. We do not need enterprise spreadsheet behavior, and
TanStack Table is headless enough to match our owned component system.

### AI UX

Keep AI SDK and AI Elements as the AI interaction foundation.

Use AI in three UI patterns:

- `InsightSlot`: inline, optional, only visible when we have a useful result.
- `PageCopilot`: command-menu launched drawer/chat over the current page context.
- `ActionDraft`: AI creates a concrete draft action, config diff, support brief,
  or query explanation that the user must review before execution.

Do not make every metric card an AI card. AI should appear where it can explain
evidence, connect page state to product knowledge, or draft the next action. If
the only insight is "7 offline agents is a lot", omit it unless the page context
has a baseline proving that it is unusual.

## Migration Plan

### Phase 1: Foundation

- Add `components/app` primitives for `PageShell`, `PageHeader`, `MetricCard`,
  `ObservationBadge`, `EmptyState`, `Toolbar`, and `DataTable`.
- Add `api/models` normalization for observed fleet metrics and configuration
  stats.
- Move `App.tsx` provider setup into `app/providers.tsx` and route definitions
  into `app/routes.tsx`.
- Add tests for observed metric normalization and route/provider behavior.

### Phase 2: Portal Pages

- Migrate `OverviewPage`, `ConfigurationsPage`, `AgentsPage`, and
  `ConfigurationDetailPage` to the new app components.
- Make metrics cheap by default and visually qualify missing/stale observations.
- Keep full agent-list queries behind explicit table/detail interactions.
- Use `InsightSlot` only where the browser context contains enough evidence.

### Phase 3: Admin Pages

- Migrate tenant, usage, health, and DO viewer tables to a shared `DataTable`
  backed by TanStack Table.
- Keep admin API-source details in admin/debug contexts, not portal product UI.
- Make table filters URL-addressable once the route/search-param conventions are
  stable.

### Phase 4: Marketing

- Migrate marketing pages to the shared token system and owned primitives where
  appropriate.
- Only split marketing into a separate app if we add a content workflow,
  pre-rendering requirement, or independent deployment cadence.

### Phase 5: Routing Reassessment

After phases 1-3, reassess router needs:

- If route-level loaders and static marketing pre-rendering matter, move to React
  Router data/framework mode incrementally.
- If type-safe route params/search params become the dominant pain, consider
  TanStack Router.
- If neither is a bottleneck, keep the current router and avoid churn.

## Cloud Agent Workstreams

This can fan out cleanly:

- Design system foundation: create `components/app` primitives and tests.
- Portal migration: convert overview/configuration pages to observed domain
  models and shared components.
- Admin table system: introduce TanStack Table and migrate one admin table.
- API model layer: normalize current DTOs into nested domain objects, with tests.
- AI UX slots: define `InsightSlot` and page context eligibility rules.
- Marketing cleanup: remove inline styles and legacy classes from one marketing
  page using the same token/component language.

Each workstream should have a small write scope and should not perform a router
or framework migration.

## External References

- Vite is the build foundation for multiple modern frameworks, including React
  Router, and is a reasonable long-term build layer:
  <https://vite.dev/guide/why.html>
- React Router data routers support route objects, layout routes, loaders, and
  nested routes if we want to move that direction:
  <https://reactrouter.com/start/data/routing>
- React Router framework mode supports server, client, and static data loading,
  but that should be adopted for a specific deployment/data-loading reason:
  <https://reactrouter.com/start/framework/data-loading>
- shadcn/ui is explicitly an owned-code component system, not a traditional
  black-box component library:
  <https://ui.shadcn.com/docs>
- Tailwind v4 has a first-party Vite plugin, CSS-first configuration, and built-in
  container queries that fit our current setup:
  <https://tailwindcss.com/blog/tailwindcss-v4>
- TanStack Table is headless and TypeScript-oriented, which matches an owned
  admin/product component system:
  <https://tanstack.com/table/v8/docs/overview>
- AI SDK `useChat` and transports are the right frontend integration point for
  streaming chat/copilot surfaces:
  <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>
- AI Elements is built on shadcn/ui and intended for composable AI interfaces:
  <https://vercel.com/blog/introducing-ai-elements>
