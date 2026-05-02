#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "${O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY:-}" ]; then
  echo "O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY is required for the live AI guidance audit." >&2
  exit 2
fi

COLLECTORS="${1:-20}"
ARTIFACT_DIR="${AI_GUIDANCE_AUDIT_DIR:-$REPO_ROOT/test-results/ai-guidance-audit}"
mkdir -p "$ARTIFACT_DIR"

cleanup() {
  bash scripts/serve-explore.sh down >/dev/null 2>&1 || true
}
trap cleanup EXIT

bash scripts/serve-explore.sh "$COLLECTORS"

LIVE_AI_GUIDANCE=1 \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
AI_GUIDANCE_AUDIT_DIR="$ARTIFACT_DIR" \
pnpm --filter @o11yfleet/ui-tests exec playwright test src/ai-guidance-live.test.ts

echo "AI guidance audit artifacts: $ARTIFACT_DIR"
