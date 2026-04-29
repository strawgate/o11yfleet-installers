# O11yFleet Site Feedback Follow-up

**Date:** 2026-04-28
**Scope:** public site, docs, installer references, and first-run copy

## Summary

This pass focused on whether the site sets the right expectation for a new user
today. The main issue was not broken rendering; it was that several pages
described a more self-service and feature-complete product than the current app
supports.

## Fixed in This Pass

- Replaced public "free signup" language with request-access copy. The signup
  page still exists, but it now explains that self-service registration is not
  enabled yet.
- Standardized installer docs and scripts on `https://o11yfleet.com/install.sh`
  and `https://o11yfleet.com/install.ps1`. The older
  `https://get.o11yfleet.com/install.sh` endpoint did not resolve during this
  audit, while `https://o11yfleet.com/install.sh` returned HTTP 200.
- Softened marketing claims that were ahead of the MVP, including automatic
  rollback, label-targeted rollout, hosted Git sync, and UI drift detection.
- Updated smoke-test guidance to use local setup or explicit hosted tokens
  instead of unauthenticated API examples.
- Removed public footer dead links and replaced static status text with neutral
  preview copy.
- Fixed product navigation so `/product`, the header link, footer link, docs
  header links, and GitOps CTA all land on the real configuration-management
  page.
- Fixed React Router docs links so public marketing navigation performs a real
  document navigation to the static docs HTML instead of falling through to the
  SPA 404 route.

## New User Feedback

The site now gives a clearer answer to "how do I start?" There are two honest
paths:

1. Request hosted access.
2. Run the local worker and seed data with `just dev` plus `just setup`.

The docs should keep this split visible until self-service signup is real. New
users should not have to infer that the signup form is request-only after they
have already tried to create a workspace.

## Remaining Recommendations

- Add real privacy, terms, and status pages before restoring those public footer
  links.
- Choose one canonical portal code path between `apps/site` and `apps/web`, or
  document why both are intentionally maintained.
- Generate or manually maintain an API reference from the worker routes so docs
  stay aligned with implementation.
- Add Playwright assertions for the homepage CTA, signup expectation, docs
  installer URL, and absence of placeholder `#` links in public marketing nav.
- Decide whether pricing should stay public while hosted access is manually
  provisioned. The current copy is now careful, but a request-access product can
  also point pricing CTA directly at contact/sales.

## Verification Notes

- `https://o11yfleet.com/install.sh` returned HTTP 200.
- `https://get.o11yfleet.com/install.sh` failed DNS resolution.
- Source scan found no remaining public marketing references to the broken
  installer host, "Start free", or placeholder footer links.
- Playwright verified 12 public marketing/docs pages on the local site,
  including the `/product` redirect, request-access CTAs, signup expectation,
  docs install guidance, and absence of placeholder `#` anchors.
- Playwright verified the public header "Docs" link and homepage "Read the docs"
  CTA both load `/docs/index.html` as static docs pages.
- Playwright mobile smoke verified six representative public pages.
