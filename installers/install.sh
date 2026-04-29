#!/usr/bin/env bash
# O11yFleet Collector Installer
# Usage: curl --proto '=https' --tlsv1.2 -fsSL https://install.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>
#
# Installs otelcol-contrib with OpAMP extension configured to connect to O11yFleet.
# Supports: Linux (amd64/arm64), macOS (amd64/arm64)

set -euo pipefail

# ─── Defaults ──────────────────────────────────────────────────────────
OTELCOL_VERSION="${OTELCOL_VERSION:-0.151.0}"
OPAMP_ENDPOINT="${OPAMP_ENDPOINT:-wss://api.o11yfleet.com/v1/opamp}"
INSTALL_DIR="${INSTALL_DIR:-/opt/o11yfleet}"
TOKEN=""
UNINSTALL=false
UPGRADE=false
DRY_RUN=false

# ─── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$*"; }
fail()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# ─── Detect OS & arch ──────────────────────────────────────────────────
detect_platform() {
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64)   ARCH="amd64" ;;
    aarch64|arm64)   ARCH="arm64" ;;
    *)               fail "Unsupported architecture: $ARCH" ;;
  esac
  case "$OS" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)      fail "Unsupported OS: $OS. Use Linux or macOS." ;;
  esac
  info "Detected: ${OS}/${ARCH}"
}

# ─── Uninstall ─────────────────────────────────────────────────────────
do_uninstall() {
  info "Uninstalling O11yFleet collector..."
  case "$OS" in
    linux)
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl stop o11yfleet-collector 2>/dev/null || true
        sudo systemctl disable o11yfleet-collector 2>/dev/null || true
        sudo rm -f /etc/systemd/system/o11yfleet-collector.service
        sudo systemctl daemon-reload 2>/dev/null || true
      fi
      ;;
    darwin)
      sudo launchctl bootout system/com.o11yfleet.collector 2>/dev/null || true
      sudo rm -f /Library/LaunchDaemons/com.o11yfleet.collector.plist
      ;;
  esac
  sudo rm -rf "$INSTALL_DIR"
  ok "O11yFleet collector uninstalled."
  exit 0
}

# ─── Prerequisites ─────────────────────────────────────────────────────
check_prereqs() {
  for cmd in curl tar; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
  done
  if [ "$DRY_RUN" = false ] && [ "$(id -u)" -ne 0 ]; then
    if ! command -v sudo >/dev/null 2>&1; then
      fail "This script requires root or sudo. Run with: sudo bash -s -- --token ..."
    fi
  fi
}

# ─── Download & install binary ─────────────────────────────────────────
install_binary() {
  local tarball_name="otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"
  local url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/${tarball_name}"

  info "Downloading otelcol-contrib v${OTELCOL_VERSION} for ${OS}/${ARCH}..."
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmpdir/$tarball_name" \
    || fail "Download failed. Check version $OTELCOL_VERSION exists at:\n  $url"

  info "Verifying checksum..."
  local checksums_url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/opentelemetry-collector-releases_otelcol-contrib_checksums.txt"
  local sha256_url="${url}.sha256"
  local expected_hash=""
  if curl --proto '=https' --tlsv1.2 -fsSL "$checksums_url" -o "$tmpdir/checksums.txt"; then
    expected_hash="$(grep " ${tarball_name}$" "$tmpdir/checksums.txt" | cut -d' ' -f1)" \
      || fail "Checksum for ${tarball_name} not found in checksums.txt for version $OTELCOL_VERSION"
  elif curl --proto '=https' --tlsv1.2 -fsSL "$sha256_url" -o "$tmpdir/${tarball_name}.sha256"; then
    info "Using legacy SHA file (checksums.txt not available for v${OTELCOL_VERSION})"
  else
    fail "Checksum download failed.\n  Tried checksums.txt: $checksums_url\n  Tried SHA file: $sha256_url\n  Either the version $OTELCOL_VERSION is too old, or the release assets are missing."
  fi
  if [ -n "$expected_hash" ]; then
    echo "$expected_hash  $tarball_name" > "$tmpdir/${tarball_name}.sha256"
  fi
  (cd "$tmpdir" && (sha256sum -c "${tarball_name}.sha256" 2>/dev/null || shasum -a 256 -c "${tarball_name}.sha256")) \
    || fail "Checksum verification failed — download may be corrupted"
  ok "Checksum verified"

  info "Extracting..."
  tar -xzf "$tmpdir/$tarball_name" -C "$tmpdir"

  if [ "$DRY_RUN" = true ]; then
    if [ -f "$tmpdir/otelcol-contrib" ]; then
      ok "Dry run: binary would be installed to $INSTALL_DIR/bin/"
      "$tmpdir/otelcol-contrib" --version 2>/dev/null || true
      return 0
    fi
  fi

  sudo mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/config"
  sudo cp "$tmpdir/otelcol-contrib" "$INSTALL_DIR/bin/otelcol-contrib"
  sudo chmod 755 "$INSTALL_DIR/bin/otelcol-contrib"
  ok "Installed otelcol-contrib to $INSTALL_DIR/bin/"
}

# ─── Write config ──────────────────────────────────────────────────────
write_config() {
  local config_file="$INSTALL_DIR/config/otelcol.yaml"

  info "Writing collector config..."
  sudo tee "$config_file" >/dev/null <<YAML
# O11yFleet managed collector configuration
# This collector connects to O11yFleet via OpAMP for remote management.
# The server will push pipeline configuration updates automatically.

extensions:
  opamp:
    server:
      ws:
        endpoint: ${OPAMP_ENDPOINT}
    instance_uid: ${INSTANCE_UID}
    capabilities:
      reports_effective_config: true
      reports_own_metrics: true
      reports_health: true
      reports_remote_config: true
      accepts_remote_config: true
      accepts_restart_command: true
    headers:
      Authorization: "Bearer ${TOKEN}"

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: localhost:4317
      http:
        endpoint: localhost:4318

exporters:
  debug:
    verbosity: basic

service:
  extensions: [opamp]
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      exporters: [debug]
    logs:
      receivers: [otlp]
      exporters: [debug]
YAML
  sudo chmod 640 "$config_file"
  sudo chown o11yfleet:o11yfleet "$config_file" 2>/dev/null || true
  ok "Config written to $config_file"
}

# ─── Linux systemd service ────────────────────────────────────────────
install_linux_service() {
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemd not found — skipping service setup. Start manually:"
    echo "  sudo $INSTALL_DIR/bin/otelcol-contrib --config $INSTALL_DIR/config/otelcol.yaml"
    return
  fi

  info "Installing systemd service..."

  if ! id -u o11yfleet >/dev/null 2>&1; then
    sudo useradd --system --no-create-home --shell /sbin/nologin o11yfleet 2>/dev/null || true
  fi
  sudo chown -R o11yfleet:o11yfleet "$INSTALL_DIR" 2>/dev/null || true

  sudo tee /etc/systemd/system/o11yfleet-collector.service >/dev/null <<UNIT
[Unit]
Description=O11yFleet Collector (otelcol-contrib + OpAMP)
Documentation=https://o11yfleet.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=o11yfleet
Group=o11yfleet
ExecStart=${INSTALL_DIR}/bin/otelcol-contrib --config ${INSTALL_DIR}/config/otelcol.yaml
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

  sudo systemctl daemon-reload
  sudo systemctl enable o11yfleet-collector
  sudo systemctl restart o11yfleet-collector
  ok "Service started: o11yfleet-collector"
}

# ─── macOS launchd service ─────────────────────────────────────────────
install_macos_service() {
  info "Installing launchd service..."

  local plist="/Library/LaunchDaemons/com.o11yfleet.collector.plist"
  sudo tee "$plist" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.o11yfleet.collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/bin/otelcol-contrib</string>
    <string>--config</string>
    <string>${INSTALL_DIR}/config/otelcol.yaml</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/o11yfleet-collector.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/o11yfleet-collector.log</string>
</dict>
</plist>
PLIST

  sudo launchctl bootout system/com.o11yfleet.collector 2>/dev/null || true
  sudo launchctl bootstrap system "$plist"
  ok "Service started: com.o11yfleet.collector"
}

# ─── Main ──────────────────────────────────────────────────────────────
main() {
  # ─── Parse args ───────────────────────────────────────────────────────
  while [ $# -gt 0 ]; do
    case "$1" in
      --token)
        if [ -z "${2:-}" ] || [ "${2#-}" != "$2" ]; then
          fail "Missing value for --token. Usage: --token fp_enroll_..."
        fi
        TOKEN="$2"; shift 2 ;;
      --token=*)    TOKEN="${1#*=}"; shift ;;
      --version)
        if [ -z "${2:-}" ] || [ "${2#-}" != "$2" ]; then
          fail "Missing value for --version. Usage: --version 0.151.0"
        fi
        OTELCOL_VERSION="$2"; shift 2 ;;
      --version=*)  OTELCOL_VERSION="${1#*=}"; shift ;;
      --endpoint)
        if [ -z "${2:-}" ] || [ "${2#-}" != "$2" ]; then
          fail "Missing value for --endpoint. Usage: --endpoint wss://..."
        fi
        OPAMP_ENDPOINT="$2"; shift 2 ;;
      --endpoint=*) OPAMP_ENDPOINT="${1#*=}"; shift ;;
      --dir)
        if [ -z "${2:-}" ] || [ "${2#-}" != "$2" ]; then
          fail "Missing value for --dir. Usage: --dir /opt/o11yfleet"
        fi
        INSTALL_DIR="$2"; shift 2 ;;
      --dir=*)      INSTALL_DIR="${1#*=}"; shift ;;
      --uninstall)  UNINSTALL=true; shift ;;
      --dry-run)    DRY_RUN=true; shift ;;
      --help|-h)
        cat <<EOF
O11yFleet Collector Installer

Usage:
  curl --proto '=https' --tlsv1.2 -fsSL https://install.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>

Options:
  --token TOKEN       Enrollment token (required, starts with fp_enroll_)
  --version VERSION   otelcol-contrib version (default: $OTELCOL_VERSION)
  --endpoint URL      OpAMP server endpoint (default: $OPAMP_ENDPOINT)
  --dir PATH          Install directory (default: $INSTALL_DIR)
  --uninstall         Remove O11yFleet collector and config
  --dry-run           Download and verify only, don't install service
  -h, --help          Show this help
EOF
        exit 0 ;;
      *) fail "Unknown option: $1. Use --help for usage." ;;
    esac
  done

  echo ""
  printf "%s\n" "${CYAN}  O11yFleet Collector Installer${NC}"
  echo "  ──────────────────────────────"
  echo ""

  detect_platform

  if [ "$UNINSTALL" = true ]; then
    do_uninstall
  fi

  if [ -z "$TOKEN" ] && [ "$DRY_RUN" = false ]; then
    fail "Enrollment token required. Usage:\n  curl --proto '=https' --tlsv1.2 -fsSL https://install.o11yfleet.com/install.sh | bash -s -- --token fp_enroll_..."
  fi

  if [ -n "$TOKEN" ]; then
    case "$TOKEN" in
      fp_enroll_*) ;;
      *) warn "Token doesn't start with fp_enroll_ — are you sure this is an enrollment token?" ;;
    esac
  fi

  if [ "$DRY_RUN" = true ]; then
    info "Dry run mode — downloading and verifying only"
  fi

  # ─── Upgrade detection ─────────────────────────────────────────────────
  if [ -f "$INSTALL_DIR/bin/otelcol-contrib" ] && [ "$DRY_RUN" = false ]; then
    UPGRADE=true
    info "Existing installation detected at $INSTALL_DIR"
    info "Upgrading existing installation..."
  fi

  check_prereqs
  install_binary

  if [ "$DRY_RUN" = true ]; then
    ok "Dry run complete."
    exit 0
  fi

  # ─── Instance UID persistence ──────────────────────────────────────────
  local uid_file="$INSTALL_DIR/instance-uid"
  if [ -f "$uid_file" ]; then
    INSTANCE_UID="$(cat "$uid_file")"
  else
    INSTANCE_UID="$( (cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen) | tr -d '-' | head -c 32)"
    echo "$INSTANCE_UID" | sudo tee "$uid_file" >/dev/null
  fi

  if [ "$UPGRADE" = false ]; then
    write_config
  else
    ok "Preserving existing config at $INSTALL_DIR/config/otelcol.yaml"
  fi

  case "$OS" in
    linux)  install_linux_service ;;
    darwin) install_macos_service ;;
  esac

  echo ""
  ok "O11yFleet collector is running!"
  echo ""
  info "The collector will appear in your dashboard within a few seconds."
  info "View logs:"
  case "$OS" in
    linux)  echo "  sudo journalctl -u o11yfleet-collector -f" ;;
    darwin) echo "  tail -f /var/log/o11yfleet-collector.log" ;;
  esac
  info "Uninstall:"
  echo "  curl --proto '=https' --tlsv1.2 -fsSL https://install.o11yfleet.com/install.sh | bash -s -- --uninstall"
  echo ""
}

main "$@"