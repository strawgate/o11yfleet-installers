# Low findings

7 polish / structural cleanup items.

---

## L1. No `prefers-reduced-motion` media query anywhere

- **Symptom**: Users with vestibular disorders see continuous spin
  (LoadingSpinner), pulse (`dot-pulse` in GettingStarted), and `motion`
  library transitions regardless of OS preference.
- **Affected**: Vestibular-sensitive users.
- **Where**: Searched all `apps/site/src/styles/*.css` — zero matches for
  `prefers-reduced-motion`.
- **Fix**: Add at the bottom of `styles.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```
  Plus a guard inside any `motion.div` usage.

---

## L2. NotFoundPage `<h1>` is "404" rather than descriptive

- **Symptom**: SR users hear "heading level one, 404"; useful to also have a
  descriptive title.
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/NotFoundPage.tsx:11-13`
- **Fix**: Use `<h1>Page not found</h1>` and render "404" as a styled `<p>`
  above it.

---

## L3. Auth notice / banner uses no semantic role

- **Symptom**: AdminLoginPage notice "This page is for O11yFleet employees…"
  is a plain `<div className="auth-notice">`; SR users may skip it.
- **Affected**: SR users (mild).
- **Where**: `apps/site/src/pages/auth/AdminLoginPage.tsx:43-46`
- **Fix**: Render as `<aside className="auth-notice" aria-label="Notice">…</aside>` or include in the form's `aria-describedby`.

---

## L4. PrototypeBanner has no role="note"

- **Symptom**: "Prototype — …" banner is informational but not semantically
  marked.
- **Affected**: SR users (mild).
- **Where**: `apps/site/src/components/common/PrototypeBanner.tsx:1-14`
- **Fix**: `<div role="note" className="prototype-banner">` plus
  `aria-label="Prototype notice"`.

---

## L5. Inline editable fields lose `:focus-visible`

- **Symptom**: `.inline-edit { outline: 0 }` removes the visible focus
  indicator (only `border-color` change inside `:focus`). Users can't see
  where focus is unless they look closely.
- **Affected**: Keyboard users.
- **Where**: `apps/site/src/styles/portal-shared.css:1663-1680`
- **Fix**: Add a `:focus-visible` rule with a real outline, or rely on the
  global `:focus-visible` outline (drop `outline: 0`).

---

## L6. CommandInput / .cmd-search input drops outline silently

- **Symptom**: `apps/site/src/styles/portal-shared.css:558` sets `outline: 0`
  on `.cmd-search input` — relying on parent border for focus indication is
  fragile.
- **Affected**: Keyboard users.
- **Fix**: Move the focus ring onto the search input, not its container.

---

## L7. SR-only / visually-hidden helper isn't widely used

- **Symptom**: `.sr-only` is defined in `portal-shared.css` but the marketing
  site doesn't import that stylesheet — so authoring a SR-only label on a
  marketing page (LoginPage's "Forgot?" link, NotFoundPage, etc.) doesn't
  work without copy-pasting the rule.
- **Affected**: Authors / future fixes.
- **Where**:
  - Defined: `apps/site/src/styles/portal-shared.css:1828-1839`
  - Marketing layout doesn't import portal-shared.
- **Fix**: Promote the `.sr-only` rule to `styles.css` (always loaded) so the
  whole app can use it.
