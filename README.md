# O11yFleet Install

One-command installer for the O11yFleet OpenTelemetry collector.

## Quick Start

```bash
# Mac/Linux (most common)
curl https://install.o11yfleet.com | bash -s -- --token fp_enroll_xxx

# Windows (PowerShell)
irm https://install.o11yfleet.com/install.ps1 | iex -Token "fp_enroll_xxx"

# Node users
npx o11yfleet-install --token fp_enroll_xxx
```

## All Installation Methods

### curl (Mac/Linux)
```bash
curl https://install.o11yfleet.com | bash -s -- --token fp_enroll_xxx
```

### PowerShell (Windows)
```powershell
irm https://install.o11yfleet.com/install.ps1 | iex -Token "fp_enroll_xxx"
```

### npx (Node.js)
```bash
npx o11yfleet-install --token fp_enroll_xxx
```

### npm global install
```bash
npm i -g o11yfleet-install
o11yfleet-install --token fp_enroll_xxx
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--token TOKEN` | Enrollment token (required) | - |
| `--dry-run` | Download and verify only, don't install | false |
| `--dir PATH` | Installation directory | `/opt/o11yfleet` (Mac/Linux), `%ProgramFiles%\O11yFleet` (Windows) |
| `--version VER` | otelcol-contrib version | `0.151.0` |
| `--endpoint URL` | OpAMP server endpoint | `wss://api.o11yfleet.com/v1/opamp` |
| `--verbose` | Verbose output | false |
| `--help`, `-h` | Show help | - |

## Uninstall

### Mac/Linux
```bash
curl https://install.o11yfleet.com | bash -s -- --uninstall
```

### Windows
```powershell
irm https://install.o11yfleet.com/install.ps1 | iex -Uninstall
```

### Manual
```bash
sudo systemctl stop o11yfleet-collector  # Linux
sudo launchctl bootout system/com.o11yfleet.collector  # macOS
sudo rm -rf /opt/o11yfleet
```

## Architecture

This installer is built from a single TypeScript codebase:

```
o11yfleet-install/
├── src/
│   ├── index.ts      # Core install logic (download, verify, extract, config)
│   └── cli.ts        # CLI argument parsing
├── installers/
│   ├── install.sh    # Unix bootstrap (downloads + runs binary)
│   └── install.ps1   # Windows bootstrap (downloads + runs binary)
├── bin/
│   └── npm-wrapper.cjs  # npx entry point
├── build.ts          # Bun build script → native binaries
└── package.json
```

The shell scripts and npm wrapper are **thin bootstrap layers** that download and execute a pre-built native binary. The actual install logic is shared across all entry points.

## Building from Source

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Build for current platform
bun run build

# Build for all platforms
bun run build:all

# Or build specific platforms
bun run build.ts --linux
bun run build.ts --darwin
bun run build.ts --windows
```

## For O11yFleet Developers

Releases are built automatically via CI. To manually release:

1. Update version in `package.json`
2. Run `bun run build:all`
3. Upload binaries from `bin/` to GitHub Releases
4. Update `install.o11yfleet.com` to point to new release

## Troubleshooting

### "curl: command not found"
Use a different method: `npx o11yfleet-install` or download the binary directly from GitHub Releases.

### "Download failed"
Check your network connection and that `https://install.o11yfleet.com` is accessible.

### "Checksum verification failed"
The downloaded file may be corrupted. Try again or report an issue.

### "Permission denied"
The script needs to write to `/opt/o11yfleet`. Use `sudo` or run as administrator.

## License

MIT
