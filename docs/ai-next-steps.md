# AI UI Adoption: Fan-In Notes

This is the durable summary from the first AI insight fan-out. The main product direction is still browser-page context first: use what the user can see, allow only a few explicit light fetches, and prefer no insight over noisy commentary.

## What to Build Next

1. **Baseline-backed insights**
   - Add compact D1 history for rollout events and metric windows.
   - Keep Durable Objects on the hot path for live agent state only.
   - Generate insights like offline share versus recent median, disconnect bursts after rollout, and config reject-rate regressions only when the baseline exists.

2. **Configuration copilot**
   - Use the existing pipeline parser and renderer instead of ad hoc YAML edits.
   - Start with explain-current-config, latest-version-diff summary, rollout-risk check, and safe draft changes.
   - Block suggestions when YAML is truncated, unknown top-level sections are present, all exporters would be removed, or inline secrets are introduced.

3. **Insight quality harness**
   - Treat empty guidance as a passing result when evidence is weak.
   - Keep deterministic candidate rules for policy thresholds and correlated facts.
   - Require model output to target only slots supplied by the browser page.
   - Add UI and Playwright coverage that empty guidance stays invisible.

4. **Admin ops insights**
   - Avoid raw emails, tokens, IPs, and logs in model context.
   - Focus on onboarding gaps, tenant capacity pressure normalized by plan, and concentration risk.
   - Do not claim trend, anomaly, or unusual behavior without history or explicit thresholds.

## First Implementation Slice

The first post-fanout slice should stay small and enforce quality:

- candidate rule for visible offline clusters by configuration hash
- prompt regression test for candidate insights and no-insight constraints
- provider validation that model output cannot attach to unknown UI targets

The larger baseline schema and configuration copilot should be separate PRs because they touch storage, route contracts, and UI flows.
