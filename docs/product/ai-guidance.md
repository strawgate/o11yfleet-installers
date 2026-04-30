# AI Guidance

AI guidance starts from what the user can already see in the browser. The UI
builds a normalized page context from loaded query data, visible metrics, rows,
tabs, filters, selections, YAML, and a few explicit light fetches. The Worker
validates that context, calls the provider, and validates structured output.

Prefer no insight over generic commentary.

## Contract

Shared types live in `packages/core/src/ai/guidance.ts`.

Important fields:

- `intent`: `explain_page`, `explain_metric`, `summarize_table`,
  `triage_state`, `suggest_next_action`, or `draft_config_change`
- `page_context.route`
- `page_context.metrics`
- `page_context.tables`
- `page_context.details`
- `page_context.yaml`
- `page_context.light_fetches`

Client helpers live in `apps/site/src/ai/page-context.ts`.

## Quality Bar

An insight needs at least one evidence level:

| Evidence           | Meaning                                                       |
| ------------------ | ------------------------------------------------------------- |
| `baseline`         | Current state is compared with historical or cohort behavior. |
| `correlated`       | Two or more visible facts point to the same explanation.      |
| `policy_threshold` | Current state crosses an explicit product threshold.          |

`count_only` evidence is not enough unless the product has declared a threshold.
For example, "7 collectors are offline" is noise; "7 of 9 collectors in this
configuration went offline after version 14 rolled out" is useful.

## Display Rules

- Every item needs local evidence from page context, target context, or an
  explicit light fetch.
- Do not claim `unusual`, `spike`, `regression`, or `anomaly` without baseline or
  rollout-timing evidence.
- Use `notice` for onboarding gaps, `warning` for likely operator attention, and
  `critical` only for severe impact or explicit thresholds.
- Omit actions when no safe in-app action is obvious.
- Empty output should render nothing.
- Model output may improve phrasing and prioritization, but must not invent
  missing facts or weaken caveats.

Candidate rules live in `packages/core/src/ai/insight-candidates.ts`.

## Current Product Direction

Near-term useful surfaces:

- explain current config
- summarize latest version diffs
- rollout-risk checks
- safe draft config changes through the pipeline parser/renderer
- visible offline clusters by configuration hash
- tenant onboarding/capacity signals in admin, without raw emails, tokens, IPs,
  or logs in model context

Separate storage-heavy baseline work from UI-only AI polish. Baselines, rollout
history, and metric windows touch route contracts and should land in their own PRs.

## Workstream Requirements

Future AI PRs should include:

- page-context additions with exact fields added
- candidate rules and evidence level
- at least one positive test and one "say nothing" test
- UI behavior for empty/low-value output
