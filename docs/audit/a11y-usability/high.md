# High findings

20 issues that significantly degrade the experience or cause confusion.

---

## H1. PricingPage radio toggle has no arrow-key navigation

- **Symptom**: Per WAI-ARIA, a `role="radiogroup"` should expose Left/Right
  (or Up/Down) arrows to move selection. Tab should enter only the selected
  option, then Tab should exit.
- **Affected**: Keyboard users, SR users following ARIA conventions.
- **Where**: `apps/site/src/pages/marketing/PricingPage.tsx:100-128`
- **Evidence**: Both Monthly and Annual buttons receive default Tab order; no
  keydown handler.
- **Fix**: Track focus index, intercept ArrowLeft/Right, set `tabIndex={-1}`
  on the inactive radio. Or use `radix-ui/radio-group`.

---

## H2. SupportPage selectable cards lack `aria-pressed`

- **Symptom**: SR users can't tell which tenant or symptom card is currently
  selected; only visual affordance (`.selected` class).
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/admin/SupportPage.tsx:97-113, 127-138`
- **Evidence**:
  ```tsx
  <button className={`support-tenant-item${selectedTenant?.id === tenant.id ? " selected" : ""}`}
          onClick={() => setSelectedTenantId(tenant.id)}>
  ```
- **Fix**: `aria-pressed={selectedTenant?.id === tenant.id}` (toggle button
  pattern), or restructure as a `radiogroup` if mutually exclusive selection.

---

## H3. GettingStarted step indicator has no `aria-current="step"`

- **Symptom**: SR users get no indication of which step they're on.
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/portal/GettingStartedPage.tsx:103-117`
- **Evidence**:
  ```tsx
  <div key={s} className={`step${s < step ? " done" : ""}${s === step ? " active" : ""}`}>
  ```
- **Fix**: `aria-current={s === step ? "step" : undefined}`. Wrap in `<ol
aria-label="Onboarding progress">` rather than `<div>`.

---

## H4. Connection status change in GettingStarted is not announced

- **Symptom**: User waits for "Waiting for first collector heartbeat…"; when
  it flips to "Collector connected and reporting", SR users miss the
  transition.
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/portal/GettingStartedPage.tsx:289-330`
- **Fix**: Wrap the connected/waiting block in an `aria-live="polite"`
  region, or render the status text inside `role="status"`.

---

## H5. Token revoke is destructive without confirmation

- **Symptom**: Single click on "Revoke" instantly invalidates an enrollment
  token — no undo, no confirmation. Easy to mis-click.
- **Affected**: All users.
- **Where**: `apps/site/src/pages/portal/TokensPage.tsx:121-130`
- **Evidence**:
  ```tsx
  <button
    className="btn btn-danger btn-sm"
    onClick={() => void handleDelete(t.id)}
    disabled={deleteToken.isPending}
  >
    Revoke
  </button>
  ```
- **Fix**: Wire through the existing Modal pattern (used for Configuration
  delete) or at least a `window.confirm`. Show the token label in the prompt.

---

## H6. ConfigurationDetailPage delete-confirm input has no label

- **Symptom**: SR announces "edit, blank" for the typed-confirmation input.
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/portal/ConfigurationDetailPage.tsx:990-996`
- **Evidence**:
  ```tsx
  <input
    className="input mt-2"
    value={confirmName}
    onChange={(e) => setConfirmName(e.target.value)}
    placeholder={c.name}
    autoFocus
  />
  ```
  No `<label>` (TenantDetailPage uses an `sr-only` label — pattern
  inconsistent).
- **Fix**: Add `<label className="sr-only" htmlFor="config-confirm-name">Type the configuration name to confirm</label>` and `id="config-confirm-name"`.

---

## H7. GettingStarted Step 1 select has no label

- **Symptom**: SR announces "combobox, blank" for the configuration picker.
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/portal/GettingStartedPage.tsx:139-149`
- **Evidence**: `<select className="select mt-6" value={…}>` with no
  preceding `<label>` and no `aria-label`.
- **Fix**: Add a `<label htmlFor="getting-started-config">Configuration
group</label>`.

---

## H8. Disabled SSO button uses `title` for explanation

- **Symptom**: `title="Coming soon"` is invisible to keyboard users (no
  hover), unreliable on touch, and not consistently read by SR.
- **Affected**: Keyboard, touch, SR users.
- **Where**: `apps/site/src/pages/auth/LoginPage.tsx:36-38`
- **Evidence**: `<button className="sso-btn" disabled title="Coming soon">`
- **Fix**: Render visible adjacent text ("Coming soon") and remove `title`,
  or use `aria-describedby` pointing at a visible help text.

---

## H9. Disabled "Save changes" gives no reason

- **Symptom**: User edits nothing, button stays disabled — SR users are not
  told _why_ (no `aria-describedby`).
- **Affected**: SR users; also new users.
- **Where**: Multiple — `SettingsPage.tsx:90`,
  `TenantDetailPage.tsx:380-388`,
  `ConfigurationsPage.tsx:114-118`,
  `GettingStartedPage.tsx:150-157`.
- **Fix**: When disabled, render `<span id="save-help" className="sr-only">No
changes to save</span>` and set `aria-describedby="save-help"`.

---

## H10. Toast auto-dismisses with no pause / dismiss

- **Symptom**: Toasts disappear after 3.2 s with no way to pause, dismiss
  manually, or recall the message. WCAG SC 2.2.1 (Timing Adjustable) requires
  user control over time-limited notices longer than informational glance.
- **Affected**: Cognitively impaired users, low-vision users with magnifiers,
  anyone interrupted.
- **Where**: `apps/site/src/components/common/Toast.tsx:43-59`
- **Fix**: Add a close button per toast; pause auto-dismiss while the toast
  has hover or focus.

---

## H11. Filter / search inputs have no debounce announcement

- **Symptom**: Pages like AgentsPage, TenantsPage, SupportPage filter live —
  but the result count change isn't surfaced to SR users.
- **Affected**: SR users.
- **Where**: AgentsPage, TenantsPage, SupportPage filter inputs.
- **Fix**: Add a visually hidden `aria-live="polite"` region that announces
  e.g. "12 tenants match" after each filter change settles.

---

## H12. Marketing nav links rely on color only at hover/active

- **Symptom**: `a { color: inherit; text-decoration: none }` is global. In
  body copy paragraphs (FooterColumn, PricingPage description, AboutPage
  cards) inline links are visually indistinguishable from surrounding text
  unless the user happens to hover.
- **Affected**: All users; specifically WCAG SC 1.4.1 (Use of Color).
- **Where**: `apps/site/src/styles/styles.css:166-169`
- **Evidence**:
  ```css
  a {
    color: inherit;
    text-decoration: none;
  }
  ```
- **Fix**: Either reset the rule and underline inline links inside `<p>` /
  `<li>`, or add a content-region selector (`.prose a, p a { text-decoration:
underline; }`).

---

## H13. Sidebar SVG icons may be read aloud

- **Symptom**: Decorative icon SVGs lack `aria-hidden="true"` — VoiceOver
  rotor can navigate them.
- **Affected**: SR users.
- **Where**: `apps/site/src/layouts/PortalLayout.tsx:90-102` and
  `AdminLayout.tsx:84-96`
- **Evidence**: `<svg viewBox="0 0 16 16" … dangerouslySetInnerHTML={{ __html: ICONS[name] }} />` — no `aria-hidden`, no `<title>`.
- **Fix**: Add `aria-hidden="true"` (label is on the parent NavLink/button).

---

## H14. Notifications button is a non-functional control

- **Symptom**: A bell-icon button in the topbar appears interactive but does
  nothing on click. SR users encounter a button with no operation; sighted
  users learn the UI lies.
- **Affected**: All users.
- **Where**:
  - `apps/site/src/layouts/PortalLayout.tsx:233-242`
  - `apps/site/src/layouts/AdminLayout.tsx:217-226`
- **Evidence**: `<button className="icon-btn" aria-label="Notifications"><svg … /></button>` — no `onClick` and no `disabled`.
- **Fix**: Best — implement notifications. Acceptable interim — render the
  bell as `disabled aria-disabled="true"` paired with a **visible** "Coming
  soon" badge / helper text, and bind the helper id to the button via
  `aria-describedby` (do **not** use the `title` attribute — see H8).
  Worst case, hide the bell entirely until the feature is ready.

---

## H15. Org switcher pretends to be interactive

- **Symptom**: PortalLayout's `.org-switcher` shows a chevron and is styled
  like a dropdown trigger, but the wrapper is a `<div>` with no handler.
- **Affected**: All users.
- **Where**: `apps/site/src/layouts/PortalLayout.tsx:407-424`
- **Fix**: Either implement a real switcher (`<button aria-haspopup="listbox" aria-expanded={…}>`) or remove the chevron and the
  hover affordance until ready.

---

## H16. UsagePage daily bars are focusable but have no semantics

- **Symptom**: Each day's `<span tabIndex={0}>` puts up to 30 stops in the
  Tab order with only a `title` attribute as context. The element has no
  role, isn't a button, and has no actionable behaviour.
- **Affected**: Keyboard users (excessive tabs), SR users (no role).
- **Where**: `apps/site/src/pages/admin/UsagePage.tsx:46-61`
- **Fix**: Render a real `<table>` (date row, value row) for SR; keep the
  visual bars purely presentational with `aria-hidden="true"` and surface
  the data through the table.

---

## H17. Marketing footer heading uses `<h5>` after `<h2>` / `<h3>`

- **Symptom**: Heading hierarchy skips H4 — SR rotor users see broken
  outline.
- **Affected**: SR users; SEO.
- **Where**: `apps/site/src/layouts/MarketingLayout.tsx:42-53`
- **Evidence**:
  ```tsx
  function FooterColumn({ title, links }) {
    return (
      <div className="footer-col">
        <h5>{title}</h5>
        …
  ```
- **Fix**: Use `<h3>` (footer is a top-level page section), or render a
  `<p>` + restyle visually.

---

## H18. Breadcrumbs are not marked up as a navigation list

- **Symptom**: SR users don't know they're in a breadcrumb. No
  `<nav aria-label="Breadcrumb">`, no `<ol><li>`.
- **Affected**: SR users.
- **Where**: `apps/site/src/layouts/PortalLayout.tsx:276-306` and
  `AdminLayout.tsx:260-293`
- **Fix**: `<nav aria-label="Breadcrumb"><ol className="crumbs">…</ol></nav>`
  with `aria-current="page"` on the last item.

---

## H19. Theme toggle label doesn't reflect state

- **Symptom**: `aria-label="Theme"` says nothing about what the button does
  _now_. SR users press it and have to guess whether it switched.
- **Affected**: SR users.
- **Where**: `PortalLayout.tsx:222-231`, `AdminLayout.tsx:206-215`.
- **Evidence**: `<button className="icon-btn" aria-label="Theme" onClick={toggle}>`
- **Fix**: `aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}`.

---

## H20. SearchBar `⌘K` shortcut is not exposed semantically

- **Symptom**: SR users hear "Open command menu, button" but don't learn
  about the keyboard shortcut.
- **Affected**: Keyboard SR users.
- **Where**: `PortalLayout.tsx:259-270`, `AdminLayout.tsx:243-254`
- **Fix**: Add `aria-keyshortcuts="Meta+K Control+K"` to the button (also
  picked up by some user-shortcut managers).
