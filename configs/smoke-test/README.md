# Smoke Test Configs for Real OTel Collectors

These configs connect real OpenTelemetry Collector Contrib instances to the
o11yfleet OpAMP server. Two approaches are provided:

## 1. opampextension (built-in)

The simplest approach — the collector has a built-in OpAMP extension.

```bash
# Install
brew install open-telemetry/opentelemetry-collector/opentelemetry-collector-contrib

# Run (after setting your enrollment token in the YAML)
otelcol-contrib --config configs/smoke-test/otelcol-opampext.yaml
```

Config: [`otelcol-opampext.yaml`](otelcol-opampext.yaml)

## 2. OpAMP Supervisor (external manager)

A separate binary that manages the collector process. Can restart the collector
when a new config is pushed via OpAMP.

```bash
# Build from source
git clone https://github.com/open-telemetry/opentelemetry-collector-contrib.git
cd opentelemetry-collector-contrib/cmd/opampsupervisor
go build -o opampsupervisor .

# Run
./opampsupervisor --config configs/smoke-test/supervisor.yaml
```

Config: [`supervisor.yaml`](supervisor.yaml)

## Setup

Both approaches need an enrollment token. Create one via the o11yfleet API:

```bash
# Create a tenant
TENANT=$(curl -s -X POST https://api.o11yfleet.com/api/tenants \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke-test"}' | jq -r .id)

# Create a config
CONFIG=$(curl -s -X POST https://api.o11yfleet.com/api/configurations \
  -H 'Content-Type: application/json' \
  -d "{\"tenant_id\":\"$TENANT\",\"name\":\"smoke-config\"}" | jq -r .id)

# Create an enrollment token
TOKEN=$(curl -s -X POST "https://api.o11yfleet.com/api/configurations/$CONFIG/enrollment-token" \
  -H 'Content-Type: application/json' \
  -d '{"label":"smoke-test"}' | jq -r .token)

echo "Token: $TOKEN"
```

Then paste the token into the `Authorization` header in either YAML file.
