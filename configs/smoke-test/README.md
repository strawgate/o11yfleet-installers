# Smoke Test Configs for Real OTel Collectors

These configs connect real OpenTelemetry Collector Contrib instances to the
o11yfleet OpAMP server. Three approaches are provided:

## 1. Docker Compose Fleet (recommended for testing)

Spin up N real OTel Collectors with fully automated enrollment:

```bash
# Terminal 1 — start the local worker
just dev

# Terminal 2 — seed tenant + config + enrollment token
just setup

# Terminal 3 — launch 5 real collectors
just collectors-docker 5

# Check fleet status
just fleet

# View collector logs
just collectors-docker-logs

# Tear down
just collectors-docker-down
```

Each container auto-enrolls via the API using the config ID from `.local-state.json`.
Scale to any count — they use the real OTel Collector protobuf OpAMP wire protocol.

See [`docker/`](docker/) for the compose file and entrypoint.

## 2. opampextension (built-in)

The simplest approach — the collector has a built-in OpAMP extension.

```bash
# Install
brew install open-telemetry/opentelemetry-collector/opentelemetry-collector-contrib

# Run (after setting your enrollment token in the YAML)
otelcol-contrib --config configs/smoke-test/otelcol-opampext.yaml
```

Config: [`otelcol-opampext.yaml`](otelcol-opampext.yaml)

## 3. OpAMP Supervisor (external manager)

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

Both manual approaches need an enrollment token. For local smoke testing, start the local worker and seed
state first:

```bash
just dev

# In another terminal:
just setup
```

`just setup` prints the demo configuration ID and enrollment token. Paste that token into the
`Authorization` header in either YAML file. For hosted access, create the token in the portal or
with `ofleet token:create --config-id <config-id> --label smoke-test`.
