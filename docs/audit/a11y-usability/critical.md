# Critical findings

15 issues that block whole classes of users or cause confirmed UX defects.

---

## C1. MarketingLayout has no `<main>` landmark

- **Symptom**: Screen reader users cannot jump to "main content" — the entire
  page is one undifferentiated region between `<header>` and `<footer>`.
- **Affected**: SR users (NVDA, VoiceOver, JAWS), low-vision users with
  navigation assistance, anyone using rotor / landmarks navigation.
- **Where**: `apps/site/src/layouts/MarketingLayout.tsx:60-117`
- **Evidence**:
  ```tsx
  <header className="site-header">…</header>
  <Outlet />            {/* no <main> wrapper */}
  <footer className="site-footer">…</footer>
  ```
  PortalLayout and AdminLayout both wrap `<Outlet />` in `<main>`; only the
  marketing site (the public-facing surface) is missing it.
- **Fix**: Wrap the outlet in `<main id="main-content" tabIndex={-1}>`, add a
  matching skip link (see C2). WCAG SC 1.3.1, SC 2.4.1.
- **Test**: `marketing-layout has main landmark` in `a11y-audit-pending.tsx`.

---

## C2. No skip-to-content link in any layout

- **Symptom**: Keyboard users must Tab through the full nav (7+ items) on every
  page load before reaching the page content.
- **Affected**: Keyboard-only users, motor-impaired users, switch users.
- **Where**: `MarketingLayout.tsx`, `PortalLayout.tsx`, `AdminLayout.tsx` —
  none of them render a skip link.
- **Evidence**: Grep for `skip` / `Skip` returns zero matches in `src/`.
- **Fix**: Add `<a href="#main-content" className="skip-link">Skip to
content</a>` as the first focusable element of each layout, with CSS that
  visually hides until focused. WCAG SC 2.4.1.
- **Test**: `layouts expose skip-to-content link` in `a11y-audit-pending.tsx`.

---

## C3. Tabs in ConfigurationDetailPage / GettingStartedPage / TenantDetailPage are plain `<button>`s

- **Symptom**: Screen readers don't recognise the tab pattern; arrow-key
  navigation between tabs doesn't work; activated tab isn't announced as
  selected.
- **Affected**: SR users, keyboard users.
- **Where**:
  - `apps/site/src/pages/portal/ConfigurationDetailPage.tsx:545-555`
  - `apps/site/src/pages/portal/GettingStartedPage.tsx:201-232`
  - `apps/site/src/pages/admin/TenantDetailPage.tsx:182-192`
- **Evidence**:
  ```tsx
  <div className="tabs mt-6">
    {tabs.map((t) => (
      <button
        key={t.key}
        className={`tab${activeTab === t.key ? " active" : ""}`}
        onClick={() => setActiveTab(t.key)}
      >
        {t.label}
      </button>
    ))}
  </div>
  ```
  No `role="tablist"` / `role="tab"` / `aria-selected`. The tab panels also
  lack `role="tabpanel"` and `aria-labelledby`.
- **Fix**: Adopt the ARIA Authoring Practices tabs pattern, or switch to
  Radix/`@radix-ui/react-tabs` which is already in dependencies.
- **Test**: `configuration tabs use ARIA tab pattern` in
  `a11y-audit-pending.tsx`.

---

## C4. Toast notifications aren't announced to screen readers

- **Symptom**: After "Configuration created", "Token revoked", "Delete
  failed", etc., a SR user receives no feedback at all — the toast is
  visual-only.
- **Affected**: SR users.
- **Where**: `apps/site/src/components/common/Toast.tsx:64-91`
- **Evidence**:
  ```tsx
  <div className="toaster">
    {toasts.map((t) => (
      <div key={t.id} className={`toast${t.kind === "err" ? " err" : ""}`}>
  ```
  No `role="status"`, `role="alert"`, or `aria-live` on the container or items.
- **Fix**: `<div className="toaster" aria-live="polite" aria-atomic="false">`
  for default toasts; render error-kind toasts with `role="alert"`.
  WCAG SC 4.1.3.
- **Test**: `toast container exposes aria-live` in `a11y-audit-pending.tsx`.

---

## C5. Login / AdminLogin error banners are silent

- **Symptom**: If the user submits invalid credentials, the inline error
  banner appears but isn't announced — SR users may believe nothing happened
  and re-submit.
- **Affected**: SR users.
- **Where**:
  - `apps/site/src/pages/auth/LoginPage.tsx:42-55`
  - `apps/site/src/pages/auth/AdminLoginPage.tsx:48-61`
- **Evidence**:
  ```tsx
  {error && (
    <div style={{ background: "var(--err-soft, #fef2f2)", … }}>
      {error}
    </div>
  )}
  ```
  No `role="alert"`, no `aria-live`.
- **Fix**: `<div role="alert">{error}</div>` (and ideally render the message
  inside a `<p>` with the styling on the wrapper).

---

## C6. BuilderPage textarea placeholder shows literal `\n` characters

- **Symptom**: The example YAML rendered as the placeholder of the "Paste
  Collector YAML" textarea is one long line containing `\n` strings instead of
  newlines.
- **Affected**: All users — first-impression UX defect.
- **Where**: `apps/site/src/pages/portal/BuilderPage.tsx:223-228`
- **Evidence**:
  ```tsx
  placeholder = "receivers:\n  otlp:\n    protocols:\n      grpc: {}\n…";
  ```
  In a JSX string literal, `\n` is _not_ an escape sequence — it's the
  characters backslash + n. The placeholder renders verbatim.
- **Fix**: Use a template literal with real newlines, or `&#10;`:
  ```tsx
  placeholder={`receivers:
    otlp:
      protocols:
        grpc: {}
  …`}
  ```
- **Test**: `builder textarea placeholder uses real newlines` in
  `a11y-audit-pending.tsx`.

---

## C7. Agent filter input has no label

- **Symptom**: SR announces "edit, blank" when focused; user has no idea what
  the field does once `placeholder` is cleared.
- **Affected**: SR users, voice-control users.
- **Where**: `apps/site/src/pages/portal/AgentsPage.tsx:165-170`
- **Evidence**:
  ```tsx
  <input
    className="input"
    placeholder="Filter agents…"
    value={filter}
    onChange={(e) => setFilterAndResetCursor(e.target.value)}
  />
  ```
  No `<label>`, no `aria-label`. (TenantsPage _does_ set `aria-label` on its
  filter — pattern is inconsistent.)
- **Fix**: Add `aria-label="Filter agents"` (or wrap in `<label>` for
  consistency with the form fields elsewhere). WCAG SC 1.3.1, SC 4.1.2.

---

## C8. Misleading "clickable" rows that aren't clickable

- **Symptom**: Rows in OverviewPage, ConfigurationsPage, AgentsPage, and
  ConfigurationDetailPage's agent table get the `clickable` class (with hover
  styling) but only the `<Link>` inside the first cell is actually
  navigable. Users hovering anywhere on the row are misled into thinking
  the whole row is interactive.
- **Affected**: All users.
- **Where**:
  - `apps/site/src/pages/portal/OverviewPage.tsx:208` (`<tr className="clickable" onClick={() => {}}>` — the
    handler is _literally a no-op_)
  - `apps/site/src/pages/portal/ConfigurationsPage.tsx:86`
  - `apps/site/src/pages/portal/AgentsPage.tsx:213`
  - `apps/site/src/pages/portal/ConfigurationDetailPage.tsx:598`
- **Evidence**: `onClick={() => {}}` — noop, in production code.
- **Fix**: Either delete the noop and the `clickable` class, or wire each row
  to navigate (using `useNavigate`) and ensure the inner `<Link>` doesn't
  double-fire. Prefer the former; full-row clicks are inaccessible to
  keyboard users without a `role="button"` + `tabIndex` pattern.
- **Test**: `tables do not have empty noop onClick handlers` in
  `a11y-audit-pending.tsx`.

---

## C9. Icon-only chevron links lack accessible names

- **Symptom**: SR announces "link" with no destination context.
- **Affected**: SR users.
- **Where**:
  - `apps/site/src/pages/portal/OverviewPage.tsx:225` — `<Link to=…>→</Link>`
  - `apps/site/src/pages/portal/ConfigurationsPage.tsx:96` — same.
- **Evidence**:
  ```tsx
  <td style={{ width: 32 }}>
    <Link to={`/portal/configurations/${c.id}`}>→</Link>
  </td>
  ```
- **Fix**: `<Link aria-label={`Open ${c.name}`}>→</Link>` and either a `<span aria-hidden>` around the arrow or remove it
  entirely (the row's first-cell Link already provides navigation).

---

## C10. Sheet uses a hardcoded `aria-labelledby` id

- **Symptom**: Two Sheets mounted simultaneously (e.g. CommandPalette opens a
  PageCopilotDrawer Sheet from another Sheet) collide on `id="sheet-title"` —
  the second sheet's accessible name is wrong or missing.
- **Affected**: SR users.
- **Where**: `apps/site/src/components/common/Sheet.tsx:69-74`
- **Evidence**:
  ```tsx
  <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    …
    <h3 id="sheet-title">{title}</h3>
  ```
- **Fix**: `const titleId = useId();` (Modal already does this), bind both
  ends to it.
- **Test**: `Sheet uses unique title id per instance` in
  `a11y-audit-pending.tsx`.

---

## C11. Modal/Sheet focus trap can leak when `activeElement` is `<body>`

- **Symptom**: User clicks the backdrop (which only fires close on Modal but
  not Sheet), then presses Tab. Because `document.activeElement === <body>`,
  the trap condition never matches and Tab exits the dialog into the
  underlying page.
- **Affected**: Keyboard users.
- **Where**:
  - `apps/site/src/components/common/Modal.tsx:18-41`
  - `apps/site/src/components/common/Sheet.tsx:17-40`
- **Evidence**:
  ```tsx
  if (e.shiftKey) {
    if (document.activeElement === first) { … }
  } else {
    if (document.activeElement === last) { … }
  }
  ```
  No `else` branch — if active element is neither first nor last (including
  the body), default Tab behaviour escapes the dialog.
- **Fix**: Add `if (!modalRef.current.contains(document.activeElement)) {
e.preventDefault(); first.focus(); return; }` at the top of the Tab path.
  Better still: switch to `radix-ui` Dialog, already a dependency.

---

## C12. LoadingSpinner has no role / accessible name

- **Symptom**: When pages load, SR users hear nothing — no "loading" status
  is announced.
- **Affected**: SR users.
- **Where**: `apps/site/src/components/common/LoadingSpinner.tsx:1-26`
- **Evidence**:
  ```tsx
  <div style={…}>
    <svg … style={{ animation: "spin …" }}>…</svg>
  </div>
  ```
- **Fix**:
  ```tsx
  <div role="status" aria-live="polite" …>
    <svg aria-hidden="true" …/>
    <span className="sr-only">Loading…</span>
  </div>
  ```
  WCAG SC 4.1.3.
- **Test**: `LoadingSpinner exposes a status role` in
  `a11y-audit-pending.tsx`.

---

## C13. CopyButton change is silent and isn't `type="button"`

- **Symptom**: SR user copies token / install command — no audible
  confirmation. If the button is ever placed inside a `<form>` (e.g. inside a
  modal whose footer contains a form), it submits the form instead of
  copying.
- **Affected**: SR users; latent bug for all users.
- **Where**: `apps/site/src/components/common/CopyButton.tsx:23-42`
- **Evidence**:
  ```tsx
  <button className={`copy${copied ? " copied" : ""}`} onClick={handleCopy}>
  ```
  No `type="button"`; the "copied" affordance is purely visual.
- **Fix**: Add `type="button"`. Render an off-screen `<span aria-live="polite">{copied ? "Copied" : ""}</span>` so SR users hear
  the change.
- **Test**: `CopyButton declares type=button` in `a11y-audit-pending.tsx`.

---

## C14. Profile dropdown is not a real menu

- **Symptom**: SR doesn't announce the dropdown as a menu; Escape does not
  close it; arrow keys don't move focus between options; clicking outside is
  the only way to dismiss.
- **Affected**: SR users, keyboard users.
- **Where**:
  - `apps/site/src/layouts/PortalLayout.tsx:152-220`
  - `apps/site/src/layouts/AdminLayout.tsx:146-204`
- **Evidence**: `<button className="profile" onClick={() => setOpen(o => !o)}>` — no `aria-expanded`, no `aria-haspopup`, no
  `aria-controls`. The menu is a `<div>` with raw `<NavLink>` and `<button>`
  children.
- **Fix**: Switch to the `radix-ui/dropdown-menu` component (already imported
  for the command palette area in `components/ui/dropdown-menu.tsx`). At
  minimum: `aria-expanded={open}`, `aria-haspopup="menu"`, an Escape handler
  on `keydown`, and `role="menu"` / `role="menuitem"` on children.

---

## C15. Sidebar backdrop is a focusable transparent button covering content

- **Symptom**: When the mobile sidebar is open, keyboard Tab focuses the
  invisible full-screen `<button className="sidebar-backdrop">` first. SR
  users hear "Close navigation, button" with no visible affordance, and there
  is nothing visually focused.
- **Affected**: Keyboard users, SR users.
- **Where**:
  - `apps/site/src/layouts/PortalLayout.tsx:427-436`
  - `apps/site/src/layouts/AdminLayout.tsx:377-386`
- **Evidence**:
  ```tsx
  <button
    className="sidebar-backdrop"
    aria-label="Close navigation"
    onClick={() => setSidebarOpen(false)}
    onKeyDown={(event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    }}
  />
  ```
- **Fix**: Render as `<div role="presentation" onClick={…} />` and trap focus
  inside the sidebar instead. Escape handling belongs on the sidebar itself
  while open.
