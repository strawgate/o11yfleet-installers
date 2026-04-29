# Browser-Context AI

o11yFleet AI starts from what the user can already see in the browser. React pages build a normalized `page_context` packet from loaded query data, visible metrics, visible rows, active tabs, filters, selections, and small optional `+1/+2` fetches. The Worker validates the packet, sends it through the AI SDK provider, and validates the structured response.

This keeps the first AI wave simple:

- The UI owns page-local context assembly.
- The Worker owns provider execution, guardrails, and response validation.
- The model should treat `page_context` as the primary source of truth.
- Empty or low-value model output should render as no insight, not a noisy placeholder.

## Context Packet

The shared contract lives in `packages/core/src/ai/guidance.ts`.

Core fields:

- `intent`: `explain_page`, `explain_metric`, `summarize_table`, `triage_state`, `suggest_next_action`, or `draft_config_change`
- `page_context.route`: current route
- `page_context.metrics`: visible stat cards and counters
- `page_context.tables`: visible rows, capped before submission
- `page_context.details`: selected resource metadata
- `page_context.yaml`: current YAML when the page already loaded it
- `page_context.light_fetches`: optional extra browser API calls the UI intentionally included

Client helpers live in `apps/site/src/ai/page-context.ts`.

## Fan-Out Ideas

- Configuration copilot: explain YAML, summarize version diffs, draft safe config changes.
- Agent triage: group offline, unhealthy, and drifted collectors by visible symptoms.
- Table summarizers: turn visible tenant/config/agent tables into concise operational summaries.
- Selection insights: let users highlight YAML, rows, or metrics and ask for scoped explanations.
- Light fetch tools: add explicit helpers for full YAML, version diff, or related agents when a page needs one or two extra calls.
- Command palette AI: route natural language over the current page context into safe app actions.
