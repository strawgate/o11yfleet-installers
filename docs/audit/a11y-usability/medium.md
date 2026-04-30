# Medium findings

12 issues that are inconsistent or sub-optimal — fix on next pass.

---

## M1. Empty `<th />` columns in several tables

- **Symptom**: SR announces "blank, column header"; visually-empty header
  also breaks any future column-sort affordance.
- **Affected**: SR users; future contributors.
- **Where**:
  - `apps/site/src/pages/portal/OverviewPage.tsx:185`
  - `apps/site/src/pages/portal/ConfigurationsPage.tsx:66`
  - `apps/site/src/pages/portal/TokensPage.tsx:91`
- **Fix**: Use `<th><span className="sr-only">Open</span></th>` so the action
  column has a name.

---

## M2. Modal backdrop click can drop user input

- **Symptom**: Typing in the "Type the configuration name" confirm field,
  click the backdrop by accident → modal closes, draft input lost.
- **Affected**: All users, especially in destructive flows.
- **Where**: `apps/site/src/components/common/Modal.tsx:63-73`
- **Fix**: For destructive modals, only close on explicit Cancel / Esc.

---

## M3. Modal `previousFocusRef.current?.focus()` may fail silently

- **Symptom**: If the trigger element was removed from the DOM while the
  modal was open (e.g. row deleted), focus jumps to `<body>` and the user
  loses position.
- **Affected**: Keyboard users.
- **Where**: `apps/site/src/components/common/Modal.tsx:57-60`
- **Fix**: After restoring focus, verify it's still in document; otherwise
  focus a known anchor (page heading or main).

---

## M4. Focusable-element selector misses `[contenteditable]` & `<details>`

- **Symptom**: If a future modal contains a `<details>` element or a
  `contenteditable` div, those won't be considered for the focus trap.
- **Affected**: Keyboard users (latent).
- **Where**:
  - `Modal.tsx:11-12`
  - `Sheet.tsx:10-11`
- **Fix**: Extend selector with `details > summary, [contenteditable="true"], [contenteditable=""]`.

---

## M5. EnterprisePage emoji icons are not hidden from SR

- **Symptom**: VoiceOver reads "locked emoji, SSO & SAML" — extra noise.
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/marketing/EnterprisePage.tsx:58-65`
- **Evidence**: `<div style={{ fontSize: "2rem", marginBottom: 12 }}>{f.icon}</div>`
- **Fix**: Add `aria-hidden="true"` (PartnersPage already does this — pattern
  inconsistent).

---

## M6. PartnersPage tier "featured" only conveyed visually

- **Symptom**: Inline border-color style highlights the recommended tier; SR
  users don't get the recommendation.
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/marketing/PartnersPage.tsx:194-217`
- **Fix**: When `tier.featured`, render a visually hidden "Recommended"
  badge inside the card.

---

## M7. Plan tag "featured" / "Pro" indicator is color-only

- **Symptom**: PlanTag flips border color for premium plans; sighted users
  with low contrast settings or color blindness may miss it.
- **Affected**: Low-vision users.
- **Where**: `apps/site/src/components/common/PlanTag.tsx:5-11`
- **Fix**: Append a visually hidden " (premium)" string for premium plans.

---

## M8. Status / health tags rely on `var(--ok)` / `var(--warn)` / `var(--err)`

- **Symptom**: The text label is present (good), but the three semantic colors
  use `oklch` lightness ~0.7-0.82 against `--surface` `#0f1217` — measured
  contrast is borderline for some pairs (especially `--warn` on
  `--surface-2`).
- **Affected**: Low-vision users.
- **Where**: `apps/site/src/styles/styles.css:60-71`
- **Fix**: Audit with axe / Pa11y; aim for WCAG AA (4.5:1 for normal text,
  3:1 for non-text against adjacent surface).

---

## M9. Billing usage bar lacks `role="progressbar"`

- **Symptom**: The "Policies 0 / 1" usage indicator is a `<div className="bar"><i style={{width:…%}} /></div>` — SR users get no
  numeric reading.
- **Affected**: SR users.
- **Where**: `apps/site/src/pages/portal/BillingPage.tsx:64-66`
- **Fix**:

  ```tsx
  <div role="progressbar" aria-valuenow={configPct} aria-valuemin={0} aria-valuemax={100}
       aria-label={`${usedConfigs} of ${maxConfigsLabel} policies used`}>
  ```

---

## M10. DOViewer has no warnings before running heavy queries

- **Symptom**: Free-text SQL with no syntax help, no row-limit hint until the
  page paragraph; cancel button missing while a query runs.
- **Affected**: Operators.
- **Where**: `apps/site/src/pages/admin/DOViewerPage.tsx:91-120`
- **Fix**: Show the row limit (500) inline next to the textarea; add a
  Cancel button when `queryMutation.isPending`.

---

## M11. Auth pages don't restore credentials on browser back

- **Symptom**: Submit invalid password → server returns error → press Back →
  email field is empty; password is intentionally cleared but email isn't
  cached either.
- **Affected**: All users; mild friction.
- **Where**: `LoginPage.tsx`, `AdminLoginPage.tsx` — local state only.
- **Fix**: Add `autoComplete="username"` to the email input and
  `autoComplete="current-password"` to the password input so the browser's
  built-in autofill (and password managers) restore the credentials on Back
  without us persisting an identifier in app storage. Don't write the email
  to `sessionStorage` / `localStorage` — that's unnecessary identifier
  retention.

---

## M12. Pagination shows two disabled controls with no positional context

- **Symptom**: When the result set fits on one page, both `<button … disabled>First page</button>` and `<button … disabled>Next page</button>` render side-by-side with no indication of _why_ (no row count, no "Page 1 of 1"). Browsers correctly skip the disabled buttons in keyboard tab order, so there's no accessible explanation either — keyboard / SR users see only the (skipped) controls and no surrounding context.
- **Affected**: All users — especially SR users who never reach the disabled buttons but also never hear a "no more pages" status.
- **Where**: `AgentsPage.tsx:253-268`, `ConfigurationDetailPage.tsx:640-655`.
- **Fix**: Hide the pagination row entirely when both directions are unavailable, or render a "Page X of Y" / "Showing N rows" indicator next to the buttons so the disabled state has meaning.
