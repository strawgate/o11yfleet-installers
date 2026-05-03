/**
 * Accessibility & usability audit — pending failures.
 *
 * Each test in this file asserts an a11y/usability fix described in
 * `docs/audit/a11y-usability/`. They are expected to FAIL today and PASS
 * once the underlying issue is resolved (with no test-side change required).
 *
 * This file is intentionally NOT named `*.test.tsx` so the default
 * `npm test` glob (`test/*.test.{mjs,ts,tsx}`) does not pick it up. Run it
 * manually with:
 *
 *   cd apps/site && npx tsx --test test/a11y-audit-pending.tsx
 *
 * Reference: docs/audit/a11y-usability/README.md
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import MarketingLayout from "../src/layouts/MarketingLayout";
import { LoadingSpinner } from "../src/components/common/LoadingSpinner";

void React;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => join(__dirname, "..", "src", rel);

function readSource(rel: string): string {
  return readFileSync(SRC(rel), "utf8");
}

/* ------------------------------------------------------------------ */
/* C1 — MarketingLayout has a <main> landmark                         */
/* ------------------------------------------------------------------ */
test("[C1] MarketingLayout wraps the outlet in a <main> landmark", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<div>home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  assert.match(html, /<main\b/, "MarketingLayout must render a <main> landmark");
});

/* ------------------------------------------------------------------ */
/* C2 — Skip-to-content link in every layout                          */
/* ------------------------------------------------------------------ */
test("[C2] MarketingLayout exposes a skip-to-content link", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<div>home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  // Require an <a> targeting a fragment id (typically #main…) with visible
  // text starting "Skip", AND require it to appear in markup before the brand
  // logo and the main <nav>. That ordering is what makes it the first
  // focusable element on the page — a skip link rendered after the nav
  // defeats the purpose.
  const skipIdx = html.search(/<a[^>]+href="#[^"]+"[^>]*>\s*Skip/i);
  const firstFocusableIdx = html.search(/class="logo"|<nav\b/i);
  assert.ok(
    skipIdx !== -1 && (firstFocusableIdx === -1 || skipIdx < firstFocusableIdx),
    "MarketingLayout must render a 'Skip to content' link as the first focusable element (before the brand logo and main nav)",
  );
});

/* ------------------------------------------------------------------ */
/* C3 — Tabs use the ARIA tab pattern                                 */
/* ------------------------------------------------------------------ */
test("[C3] ConfigurationDetailPage tabs declare role=tablist / role=tab", () => {
  const src = readSource("pages/portal/ConfigurationDetailPage.tsx");
  // The tabs block currently renders <div className="tabs"> with bare
  // <button className="tab">. Once fixed, we expect role="tablist" on a
  // wrapper and role="tab" + aria-selected on each button.
  assert.match(src, /role=["']tablist["']/, "tabs container must have role=tablist");
  assert.match(src, /role=["']tab["']/, "each tab must have role=tab");
  assert.match(src, /aria-selected=/, "active tab must announce selection state");
});

/* ------------------------------------------------------------------ */
/* C4 — Toast container is announced via aria-live                    */
/* ------------------------------------------------------------------ */
test("[C4] Notifications container declares aria-live", () => {
  // After the toast → @mantine/notifications migration, screen-reader
  // announcement of new toasts depends on the aria-live attribute on the
  // <Notifications> container element. Mantine's <Notifications> renders a
  // div with no built-in aria-live, but it spreads element props through, so
  // we set role/aria-live/aria-atomic explicitly. Dropping these silently
  // regresses C4 — the legacy ToastProvider provided this guarantee via its
  // .toaster div.
  const src = readSource("app/providers.tsx");
  const block = src.match(/<Notifications\b[\s\S]*?\/>/);
  assert.ok(block, "AppProviders must render <Notifications>");
  assert.match(block![0], /aria-live="polite"/, "Notifications must declare aria-live='polite'");
  assert.match(
    block![0],
    /role="region"|role="status"/,
    "Notifications must declare a region/status role",
  );
});

/* ------------------------------------------------------------------ */
/* C6 — BuilderPage textarea placeholder uses real newlines           */
/* ------------------------------------------------------------------ */
test("[C6] BuilderPage textarea placeholder does not contain literal '\\n'", () => {
  const src = readSource("pages/portal/BuilderPage.tsx");
  // The placeholder currently contains the substring `\n` (backslash-n) as a
  // double-quoted JSX string literal — which renders verbatim. The fix can be
  // either a template literal with real newlines or `&#10;`-encoded content.
  // We assert directly against the source so any of those rewrites passes:
  //   - bad:  placeholder="receivers:\n  …"
  //   - good: placeholder={`receivers:\n  …`}        (template literal)
  //   - good: placeholder="receivers:&#10;  …"        (HTML entity)
  assert.match(src, /placeholder=/, "could not locate the YAML placeholder");
  // Match either quote style — placeholder='receivers:\n…' would have the
  // same bug. JSX/TSX practically uses double-quoted attribute literals,
  // but we don't want a single-quoted variant to bypass the test.
  assert.doesNotMatch(
    src,
    /placeholder\s*=\s*["']receivers:[^"']*\\n/,
    "BuilderPage textarea placeholder must use real newlines, not the literal '\\n'",
  );
});

/* ------------------------------------------------------------------ */
/* C7 — Agents filter input has an accessible name                    */
/* ------------------------------------------------------------------ */
test("[C7] AgentsPage filter input has aria-label or <label>", () => {
  const src = readSource("pages/portal/AgentsPage.tsx");
  // The <input> with placeholder="Filter agents…" must be programmatically
  // labelled. Accept any of:
  //   - aria-label / aria-labelledby on the same element
  //   - a sibling <label> whose visible text or htmlFor associates it (we
  //     accept any <label> that contains the text "Filter agents", since
  //     that's the only label such an element would have in this file).
  const inputBlock = src.match(/<(?:input|Input)\b[^>]*placeholder="Filter agents…"[^>]*\/>/s);
  assert.ok(inputBlock, "could not locate the agents filter input");
  const inputMarkup = inputBlock![0];
  // Reject empty / whitespace-only programmatic names: aria-label="" and
  // <aria-labelledby> pointing at no ids both leave the input effectively
  // unnamed. For aria-labelledby, also confirm at least one referenced id
  // actually appears as `id="..."` somewhere in the file.
  const hasNonEmptyAriaLabel = /aria-label=["'][^"']*\S[^"']*["']/.test(inputMarkup);
  const labelledByRaw = inputMarkup.match(/aria-labelledby=["']([^"']+)["']/)?.[1]?.trim();
  const labelledByIds = labelledByRaw ? labelledByRaw.split(/\s+/).filter(Boolean) : [];
  const hasValidAriaLabelledBy =
    labelledByIds.length > 0 &&
    labelledByIds.every((labelId) => {
      const escaped = labelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\bid=["']${escaped}["']`).test(src);
    });
  const hasProgrammaticName = hasNonEmptyAriaLabel || hasValidAriaLabelledBy;
  // Real <label> association: either the input has an id and a sibling
  // <label htmlFor={...}> with that id, or the input is wrapped inside a
  // <label>…</label> directly (so clicking the label focuses the input).
  // Free-floating <label> text elsewhere in the file does NOT count.
  const inputId = inputMarkup.match(/\bid=["']([^"']+)["']/)?.[1];
  const escapedId = inputId?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // For the htmlFor path, the <label> must also contain readable text — a
  // linked but empty <label htmlFor="..."></label> provides no accessible
  // name. We accept "Filter agents" anywhere inside the label body (case
  // insensitive). The wrapping path is similarly required to enclose the
  // input next to readable label text.
  const hasHtmlForLabel = escapedId
    ? new RegExp(
        `<label\\b[^>]*\\bhtmlFor=["']${escapedId}["'][^>]*>[\\s\\S]*?Filter agents`,
        "i",
      ).test(src)
    : false;
  const hasWrappingLabel =
    /<label\b[^>]*>[\s\S]{0,400}?Filter agents[\s\S]{0,400}?<(?:input|Input)\b[^>]*placeholder="Filter agents…"/i.test(
      src,
    ) ||
    /<label\b[^>]*>[\s\S]{0,400}?<(?:input|Input)\b[^>]*placeholder="Filter agents…"[\s\S]{0,200}?Filter agents/i.test(
      src,
    );
  assert.ok(
    hasProgrammaticName || hasHtmlForLabel || hasWrappingLabel,
    "AgentsPage filter <input> must have aria-label/aria-labelledby or a real <label> association (htmlFor or wrapping)",
  );
});

/* ------------------------------------------------------------------ */
/* C8 — No noop onClick handlers feigning interactivity               */
/* ------------------------------------------------------------------ */
test("[C8] Tables do not use empty noop onClick handlers", () => {
  const files = [
    "pages/portal/OverviewPage.tsx",
    "pages/portal/ConfigurationsPage.tsx",
    "pages/portal/AgentsPage.tsx",
    "pages/portal/ConfigurationDetailPage.tsx",
  ];
  for (const rel of files) {
    const src = readSource(rel);
    assert.doesNotMatch(
      src,
      /onClick=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/,
      `${rel} must not contain empty noop onClick handlers`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* C10 — Sheet uses a unique title id per instance                    */
/* ------------------------------------------------------------------ */
test("[C10] Sheet does not hardcode the aria-labelledby id", () => {
  const src = readSource("components/common/Sheet.tsx");
  // Three claims, in order:
  //   1. Sheet calls useId() (or otherwise derives an id at runtime).
  //   2. The Sheet's <div role="dialog"> binds aria-labelledby to a JSX
  //      expression, not a string literal.
  //   3. No string-literal aria-labelledby remains anywhere in the file —
  //      not just `"sheet-title"`. A rename to `"sheet-heading"` would
  //      still violate the unique-id requirement.
  // Scope every aria-labelledby check to the Sheet's dialog element so
  // unrelated bindings or string literals elsewhere in the file (e.g. a
  // helper button, a JSX comment, an example) cannot influence the
  // verdict — both directions, positive and negative, must look at the
  // dialog tag and only the dialog tag.
  assert.match(src, /\buseId\s*\(/, "Sheet should derive ids via useId()");
  const dialogTag = src.match(/<div\b[^>]*role=["']dialog["'][^>]*>/)?.[0];
  assert.ok(dialogTag, "could not locate Sheet dialog element");
  assert.match(
    dialogTag!,
    /aria-labelledby=\{[^}]+\}/,
    "Sheet dialog must bind aria-labelledby to a dynamic id expression",
  );
  assert.doesNotMatch(
    dialogTag!,
    /aria-labelledby=["'][^"']+["']/,
    "Sheet dialog must not hardcode aria-labelledby to a string literal id",
  );
});

/* ------------------------------------------------------------------ */
/* C12 — LoadingSpinner exposes a status role + accessible name       */
/* ------------------------------------------------------------------ */
test("[C12] LoadingSpinner has role=status and an accessible name", () => {
  const html = renderToStaticMarkup(<LoadingSpinner />);
  assert.match(html, /role="status"/, "LoadingSpinner must declare role=status");
  // Either an aria-label on the wrapper, or visible/SR-only text such as
  // "Loading".
  assert.match(
    html,
    /aria-label="[^"]*[Ll]oad[^"]*"|>\s*[Ll]oading/,
    "LoadingSpinner must announce a loading message to screen readers",
  );
});

/* ------------------------------------------------------------------ */
/* C13 — CopyButton declares type=button                              */
/* ------------------------------------------------------------------ */
test("[C13] CopyButton declares type=button", () => {
  const src = readSource("components/common/CopyButton.tsx");
  assert.match(
    src,
    /<button\b[^>]*type=["']button["']/,
    "CopyButton must include type='button' to avoid accidental form submission",
  );
});

/* ------------------------------------------------------------------ */
/* H17 — Footer column heading must not skip levels                   */
/* ------------------------------------------------------------------ */
test("[H17] Footer columns must not use <h5> after page <h2>/<h3>", () => {
  const src = readSource("layouts/MarketingLayout.tsx");
  // Inside FooterColumn the heading is currently <h5>. After fix, it should
  // be <h3> (or rendered without a heading tag).
  // Allow attributes on the tag (className, id, …) so a rewrite like
  // <h5 className="footer-col-title">{title}</h5> is still flagged.
  assert.doesNotMatch(
    src,
    /<h5\b[^>]*>\s*\{title\}\s*<\/h5>/,
    "FooterColumn must not skip heading levels (use <h3> after page <h2>)",
  );
});

/* ------------------------------------------------------------------ */
/* H18 — Breadcrumbs are wrapped in a <nav aria-label="Breadcrumb">   */
/* ------------------------------------------------------------------ */
test("[H18] PortalLayout Breadcrumbs use a nav landmark", () => {
  const src = readSource("layouts/PortalLayout.tsx");
  assert.match(
    src,
    /<nav[^>]+aria-label=["']Breadcrumb["']/i,
    "Breadcrumbs must be inside <nav aria-label='Breadcrumb'>",
  );
});

/* ------------------------------------------------------------------ */
/* L1 — prefers-reduced-motion support                                */
/* ------------------------------------------------------------------ */
test("[L1] Stylesheets honor prefers-reduced-motion", () => {
  const css = [
    readFileSync(join(__dirname, "..", "src", "styles", "styles.css"), "utf8"),
    readFileSync(join(__dirname, "..", "src", "styles", "portal-shared.css"), "utf8"),
  ].join("\n");
  assert.match(
    css,
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/,
    "stylesheets must include a prefers-reduced-motion: reduce media query",
  );
});
