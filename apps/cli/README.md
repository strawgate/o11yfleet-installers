# ofleet CLI

Command-line interface for o11yfleet.

## Installation

```bash
# Using npm (once published)
npm install -g @o11yfleet/cli

# Using pnpm
pnpm add -g @o11yfleet/cli
```

## Authentication

```bash
# Login with email/password
ofleet login --email demo@o11yfleet.com --password secret

# Login with API token (for CI)
ofleet login --token <your-api-token>

# Check current auth status
ofleet me

# Logout
ofleet logout
```

## Configuration

The CLI stores config in `~/.config/ofleet/`:

- `auth.json` - Session credentials (0600 permissions)
- `config.json` - Global settings

You can override the API URL:

```bash
ofleet --api-url https://api.example.com config:list
# or
export O11YFLEET_API_URL=https://api.example.com
```

## Commands

### Config Management

```bash
# Create a new configuration
ofleet config:create --name "My Config"

# List all configurations
ofleet config:list

# Show configuration details
ofleet config:show --config-id <id>

# Upload a config version
ofleet config:upload --config-id <id> --file config.yaml

# Rollout config to all agents
ofleet config:rollout --config-id <id>
```

### Enrollment Tokens

```bash
# Create an enrollment token
ofleet token:create --config-id <id> --label "production"

# List enrollment tokens
ofleet token:list --config-id <id>
```

### Agents

```bash
# List agents
ofleet agents:list --config-id <id>

# Show aggregate stats
ofleet agents:list --config-id <id> --stats
```

### Tenant Management

```bash
# Create a new tenant (requires admin API key)
ofleet tenant:create --name "New Tenant" --api-key <admin-key>
```

### Benchmarks

```bash
# Benchmark provisioning (tenant + config + token creation)
ofleet bench:provisioning --api-key <admin-key>

# Benchmark config push
ofleet bench:config-push --config-id <id>

# Benchmark enrollment
ofleet bench:enrollment --config-id <id> --collectors 50
```

Benchmarks output in [benchkit](https://github.com/strawgate/o11ykit) format.

## Scripting

Use `--json` for machine-readable output:

```bash
# Get JSON output
ofleet config:list --json

# In scripts
CONFIG_ID=$(ofleet config:list --json | jq -r '.[0].id')
```

## Options

| Option            | Description                                |
| ----------------- | ------------------------------------------ |
| `--api-url <url>` | o11yfleet API URL                          |
| `--json`          | Output JSON instead of human-readable text |
| `--help, -h`      | Show help                                  |
| `--version, -v`   | Show version                               |

## Examples

```bash
# Full workflow: create config, upload, rollout
CONFIG_ID=$(ofleet config:create --name "My Config" --json | jq -r '.id')
ofleet config:upload --config-id $CONFIG_ID --file config.yaml
ofleet config:rollout --config-id $CONFIG_ID

# Check agent stats
ofleet agents:list --config-id $CONFIG_ID --stats
```

## Development

```bash
# Install dependencies
pnpm install

# Run locally
pnpm --filter @o11yfleet/cli dev -- help

# Run tests
pnpm --filter @o11yfleet/cli test

# Build for production
pnpm --filter @o11yfleet/cli build
```
