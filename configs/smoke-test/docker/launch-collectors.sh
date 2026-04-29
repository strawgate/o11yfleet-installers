#!/bin/sh
# launch-collectors.sh — Start N real OTel Collectors via Docker Compose.
#
# Reads .local-state.json to get the enrollment token and config ID,
# generates a collector config with the token baked in, then launches
# Docker Compose with the right environment.
#
# The otelcol-contrib image is distroless (no shell/curl), so all
# enrollment and config generation happens here on the host.
#
# Usage:
#   ./configs/smoke-test/docker/launch-collectors.sh [count]
#
# Or via justfile:
#   just collectors-docker 5
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
STATE_FILE="$REPO_ROOT/.local-state.json"
COUNT="${1:-3}"

echo "🐳 o11yfleet — Real OTel Collector Fleet (Docker)"
echo ""

# Read state from .local-state.json
if [ ! -f "$STATE_FILE" ]; then
  echo "❌ No .local-state.json found. Run 'just setup' first."
  exit 1
fi

CONFIG_ID=$(grep '"config_id"' "$STATE_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')
TOKEN=$(grep '"enrollment_token"' "$STATE_FILE" | sed 's/.*: *"\([^"]*\)".*/\1/')

if [ -z "$CONFIG_ID" ] || [ -z "$TOKEN" ]; then
  echo "❌ Could not read config_id/enrollment_token from $STATE_FILE"
  exit 1
fi

SERVER_URL="${FP_URL:-http://host.docker.internal:8787}"
WS_URL=$(echo "$SERVER_URL" | sed 's|^http://|ws://|; s|^https://|wss://|')

echo "   Config ID:  $CONFIG_ID"
echo "   Token:      ${TOKEN:0:25}..."
echo "   Server:     $SERVER_URL"
echo "   WS:         $WS_URL/v1/opamp"
echo "   Collectors: $COUNT"
echo ""

# Generate collector config with token baked in
CONFIG_FILE="$SCRIPT_DIR/.generated-config.yaml"
cat > "$CONFIG_FILE" <<EOF
extensions:
  opamp:
    server:
      ws:
        endpoint: ${WS_URL}/v1/opamp
        headers:
          Authorization: "Bearer ${TOKEN}"
        tls:
          insecure: true
    instance_uid: ""
    capabilities:
      reports_effective_config: true
      reports_health: true

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"

processors:
  batch:
    timeout: 5s

exporters:
  debug:
    verbosity: basic

service:
  extensions: [opamp]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
EOF

echo "✓ Generated config at $CONFIG_FILE"
echo "🚀 Starting $COUNT collectors..."
echo ""

export FP_COLLECTORS="$COUNT"

cd "$SCRIPT_DIR"
docker compose -f compose.yaml up --scale collector="$COUNT" --remove-orphans

