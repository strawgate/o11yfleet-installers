# AI Insight Quality

o11yFleet should be conservative about where AI appears. An insight must help the user
understand why something may matter or what to do next. Restating a number already on
the page is not enough.

## Quality Bar

An AI insight is eligible when it has at least one of these evidence levels:

- `baseline`: current state is compared with historical or cohort behavior.
- `correlated`: two or more visible facts point to the same operational explanation.
- `policy_threshold`: current state crosses an explicit product threshold and says so.

`count_only` evidence is not enough unless the product has declared a threshold for that
count. For example, "7 collectors are offline" is not useful by itself. It becomes useful
when paired with evidence such as:

- "7 of 9 collectors in this configuration went offline after version 14 rolled out."
- "Offline share is 78%, above the configured triage threshold."
- "Offline collectors share the same desired config hash and last-seen window."
- "Offline count is 4x the 7-day median."

## Display Rules

- Prefer no insight over a generic observation.
- Every item needs local evidence from `page_context`, target context, or an explicit
  light fetch.
- Do not claim "unusual", "spike", "regression", or "anomaly" without baseline or
  rollout-timing evidence.
- Use `notice` for setup or onboarding gaps, `warning` for likely operator attention,
  and `critical` only for severe impact or an explicit threshold crossing.
- Actions must stay inside the app and should be omitted when no safe action is obvious.
- Empty model output should not produce a noisy empty AI card.

## Candidate Layer

The Worker should treat app-owned candidate analysis as the first gate. Candidate analysis
turns normalized page context into grounded candidate insights, including the evidence
level and rationale. The LLM may improve phrasing and prioritization, but it should not
weaken caveats or invent missing data.

Current candidate sources live in `packages/core/src/ai/insight-candidates.ts`.

## Fan-Out Contract

Future AI workstreams should leave behind:

- Page context additions: exact metrics, details, tables, selections, YAML, or light
  fetches added.
- Candidate rules: what evidence level makes each insight eligible.
- Tests: at least one "say nothing" case and one positive case with evidence.
- UI behavior: where the insight renders and how empty/low-value output is hidden.
