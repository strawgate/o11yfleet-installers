# o11y CLI

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
o11y login --email demo@o11yfleet.com --password secret

# Login with API token (for CI)
o11y login --token <your-api-token>

# Check current auth status
o11y me

# Logout
o11y logout
```

## Configuration

The CLI stores config in `~/.config/o11y/`:

- `auth.json` - Session credentials (0600 permissions)
- `config.json` - Global settings

You can override the API URL:

```bash
o11y --api-url https://api.example.com config:list
# or
export O11YFLEET_API_URL=https://api.example.com
```

## Commands

### Config Management

```bash
# Create a new configuration
o11y config:create --name "My Config"

# List all configurations
o11y config:list

# Show configuration details
o11y config:show --config-id <id>

# Upload a config version
o11y config:upload --config-id <id> --file config.yaml

# Rollout config to all agents
o11y config:rollout --config-id <id>
```

### Enrollment Tokens

```bash
# Create an enrollment token
o11y token:create --config-id <id> --label "production"

# List enrollment tokens
o11y token:list --config-id <id>
```

### Agents

```bash
# List agents
o11y agents:list --config-id <id>

# Show aggregate stats
o11y agents:list --config-id <id> --stats
```

### Tenant Management

```bash
# Create a new tenant (requires admin API key)
o11y tenant:create --name "New Tenant" --api-key <admin-key>
```

### Benchmarks

```bash
# Benchmark provisioning (tenant + config + token creation)
o11y bench:provisioning --api-key <admin-key>

# Benchmark config push
o11y bench:config-push --config-id <id>

# Benchmark enrollment
o11y bench:enrollment --config-id <id> --collectors 50
```

Benchmarks output in [benchkit](https://github.com/strawgate/o11ykit) format.

## Scripting

Use `--json` for machine-readable output:

```bash
# Get JSON output
o11y config:list --json

# In scripts
CONFIG_ID=$(o11y config:list --json | jq -r '.[0].id')
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
CONFIG_ID=$(o11y config:create --name "My Config" --json | jq -r '.id')
o11y config:upload --config-id $CONFIG_ID --file config.yaml
o11y config:rollout --config-id $CONFIG_ID

# Check agent stats
o11y agents:list --config-id $CONFIG_ID --stats
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
