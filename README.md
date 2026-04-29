# O11yFleet Installers

Official installer scripts for the O11yFleet collector agent.

## Usage

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://install.o11yfleet.com/install.sh | bash -s -- --token <ENROLLMENT_TOKEN>
```

## Supported Platforms

- Linux (amd64, arm64)
- macOS (amd64, arm64)
- Windows (amd64, arm64)

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--token` | Enrollment token (required) | - |
| `--version` | otelcol-contrib version | 0.151.0 |
| `--endpoint` | OpAMP server endpoint | wss://api.o11yfleet.com/v1/opamp |
| `--dir` | Install directory | /opt/o11yfleet |
| `--uninstall` | Remove collector and config | - |
| `--dry-run` | Download and verify only | - |
| `--help` | Show help | - |

## Development

```bash
# Test locally (dry-run mode)
./installers/install.sh --dry-run --version 0.151.0

# Test full install to temp directory
sudo ./installers/install.sh --version 0.151.0 --token fp_enroll_test --dir /tmp/o11y-test
```

## CI

CI runs on every push and PR (path-filtered to installers/ and workflow changes) to test the installer on:
- Ubuntu 24.04 (amd64)
- macOS 15 (Apple Silicon M4)
- macOS 14 (Apple Silicon M3)
- Windows 2022 (amd64)

Linux ARM64 binaries are validated via checksum verification since no standard GitHub ARM64 runner is available.

## Architecture

The install script downloads the OpenTelemetry Collector Contrib binary,
configures it with OpAMP for remote management, and sets up a systemd
service (Linux) or launchd service (macOS).