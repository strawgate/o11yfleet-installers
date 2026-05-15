#!/usr/bin/env bash
# O11yFleet Collector Installer
# Usage: curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>
#
# Installs otelcol-contrib with OpAMP extension configured to connect to O11yFleet.
# Supports: Linux (amd64/arm64), macOS (amd64/arm64)
#
# Options:
#   --token TOKEN       Enrollment token (required, starts with fp_enroll_)
#   --version VERSION   otelcol-contrib version (default: 0.152.0)
#   --endpoint URL      OpAMP server endpoint (default: wss://api.o11yfleet.com/v1/opamp)
#   --dir PATH           Install directory (default: /opt/o11yfleet)
#   --offline FILE       Use local OTel contrib tarball instead of downloading
#   --uninstall          Remove O11yFleet collector and config
#   -h, --help           Show this help

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────
OTELCOL_VERSION="${OTELCOL_VERSION:-0.152.0}"
OPAMP_ENDPOINT="${OPAMP_ENDPOINT:-wss://api.o11yfleet.com/v1/opamp}"
INSTALL_DIR="${INSTALL_DIR:-/opt/o11yfleet}"
OFFLINE_FILE=""
TOKEN=""
COLLECTOR_BIN=""
INSTALLER_TMPDIR=""
SERVICE_STARTED=false
SUDO=()

# ─── Colors ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$*" >&2; }
fail()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

configure_privilege() {
  if [ "$(id -u)" -eq 0 ]; then
    SUDO=()
    return
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    fail "This script requires root or sudo. Run with: sudo bash -s -- --token ..."
  fi
  SUDO=(sudo)
}

run_root() {
  "${SUDO[@]}" "$@"
}

root_command_prefix() {
  if [ "${#SUDO[@]}" -eq 0 ]; then
    printf ""
  else
    printf "sudo "
  fi
}

cleanup_tmpdir() {
  if [ -n "${INSTALLER_TMPDIR:-}" ] && [ -d "$INSTALLER_TMPDIR" ]; then
    rm -rf "$INSTALLER_TMPDIR"
  fi
}

ensure_install_dirs() {
  run_root mkdir -p "$INSTALL_DIR" "$INSTALL_DIR/config"
}

resolve_collector_bin() {
  if [ -x "$INSTALL_DIR/bin/otelcol-contrib" ]; then
    COLLECTOR_BIN="$INSTALL_DIR/bin/otelcol-contrib"
  elif command -v otelcol-contrib >/dev/null 2>&1; then
    COLLECTOR_BIN="$(command -v otelcol-contrib)"
  else
    COLLECTOR_BIN="$INSTALL_DIR/bin/otelcol-contrib"
  fi
}

# ─── Detect OS & arch ────────────────────────────────────────────────
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
  info "Detected platform: $OS/$ARCH"
}

# ─── Select install artifact ──────────────────────────────────────────
detect_package_manager() {
  # O11yFleet owns the collector service and config. The upstream deb/rpm
  # packages also install their own service units, so the managed path uses
  # tarballs on every platform.
  echo "tar.gz"
}

collector_service_unit_exists() {
  local service="$1"

  if command -v systemctl >/dev/null 2>&1 && systemctl cat "$service" >/dev/null 2>&1; then
    return 0
  fi

  local unit_dir
  for unit_dir in /etc/systemd/system /run/systemd/system /lib/systemd/system /usr/lib/systemd/system; do
    if [ -e "$unit_dir/$service" ]; then
      return 0
    fi
  done

  return 1
}

preflight_conflicting_collector_service() {
  [ "$OS" = "linux" ] || return 0

  local service
  for service in otelcol-contrib.service otelcol.service; do
    if collector_service_unit_exists "$service"; then
      fail "Existing OpenTelemetry Collector systemd service detected: $service. Refusing to install O11yFleet alongside another collector service. Stop and uninstall that service first, then rerun this installer."
    fi
  done
}

# ─── Uninstall ──────────────────────────────────────────────────────
do_uninstall() {
  configure_privilege
  info "Uninstalling O11yFleet collector..."
  case "$OS" in
    linux)
      if command -v systemctl >/dev/null 2>&1; then
        run_root systemctl stop o11yfleet-collector 2>/dev/null || true
        run_root systemctl disable o11yfleet-collector 2>/dev/null || true
        run_root rm -f /etc/systemd/system/o11yfleet-collector.service
        run_root systemctl daemon-reload 2>/dev/null || true
      fi
      # Try to remove package (will fail if not installed via package manager, that's OK)
      run_root dpkg -r otelcol-contrib 2>/dev/null || true
      run_root rpm -e otelcol-contrib 2>/dev/null || true
      ;;
    darwin)
      run_root launchctl bootout system/com.o11yfleet.collector 2>/dev/null || true
      run_root rm -f /Library/LaunchDaemons/com.o11yfleet.collector.plist
      ;;
  esac
  run_root rm -rf "$INSTALL_DIR"
  ok "O11yFleet collector uninstalled."
  exit 0
}

# ─── Prerequisites ────────────────────────────────────────────────────
check_prereqs() {
  command -v tar >/dev/null 2>&1 || fail "Required command not found: tar"
  if [ -z "$OFFLINE_FILE" ]; then
    command -v curl >/dev/null 2>&1 || fail "Required command not found: curl"
  fi
  configure_privilege
}

# ─── Download & install binary ────────────────────────────────────────
install_binary() {
  INSTALLER_TMPDIR="$(mktemp -d)"
  local tmpdir="$INSTALLER_TMPDIR"
  trap cleanup_tmpdir EXIT

  # If offline file specified, use it directly
  if [ -n "$OFFLINE_FILE" ]; then
    info "Using offline file: $OFFLINE_FILE"
    if [ ! -f "$OFFLINE_FILE" ]; then
      fail "Offline file not found: $OFFLINE_FILE"
    fi
    local offline_name
    case "$OFFLINE_FILE" in
      *.tar.gz)
        PKG_TYPE="tar.gz"
        offline_name="otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"
        ;;
      *)
        fail "Unsupported offline file type: $OFFLINE_FILE. Use the upstream .tar.gz artifact so O11yFleet owns service setup."
        ;;
    esac
    cp "$OFFLINE_FILE" "$tmpdir/$offline_name"
  else
    download_binary "$tmpdir"
  fi

  # Extract or install based on package type
  case "$PKG_TYPE" in
    tar.gz)
      install_tarball "$tmpdir"
      ;;
  esac
}

# ─── Download binary ─────────────────────────────────────────────────
download_binary() {
  local tarball_name filename url

  case "$PKG_TYPE" in
    tar.gz)
      tarball_name="otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"
      filename="$tarball_name"
      ;;
  esac

  url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/${filename}"

  info "Downloading $tarball_name (package type: $PKG_TYPE)..."
  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$1/$tarball_name" \
    || {
      # If preferred package fails, fall back to tar.gz
      fail "Download failed. Check version $OTELCOL_VERSION exists at:\n  $url"
    }

  # Verify checksum
  verify_checksum "$1" "$tarball_name"
}

# ─── Verify checksum ─────────────────────────────────────────────────
verify_checksum() {
  local tmpdir="$1"
  local filename="$2"
  local checksums_url expected_hash

  info "Verifying checksum..."

  # Try checksums.txt first (newer format)
  checksums_url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/opentelemetry-collector-releases_otelcol-contrib_checksums.txt"

  if curl --proto '=https' --tlsv1.2 -fsSL "$checksums_url" -o "$tmpdir/checksums.txt" 2>/dev/null; then
    expected_hash="$(grep " ${filename}$" "$tmpdir/checksums.txt" | cut -d' ' -f1)" \
      || fail "Checksum for ${filename} not found in checksums.txt for version $OTELCOL_VERSION"

    # Verify using sha256sum or shasum
    echo "$expected_hash  $filename" > "$tmpdir/${filename}.sha256"
    if command -v sha256sum >/dev/null 2>&1; then
      (cd "$tmpdir" && sha256sum -c "${filename}.sha256") \
        || fail "Checksum verification failed — download may be corrupted"
    elif command -v shasum >/dev/null 2>&1; then
      (cd "$tmpdir" && shasum -a 256 -c "${filename}.sha256") \
        || fail "Checksum verification failed — download may be corrupted"
    else
      warn "No checksum utility found, skipping verification"
    fi
    ok "Checksum verified"
  else
    warn "Could not download checksums.txt, skipping verification"
  fi
}

# ─── Install tarball ────────────────────────────────────────────────
install_tarball() {
  local tmpdir="$1"
  local tarball="$tmpdir/otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"

  info "Extracting tarball..."
  tar -xzf "$tarball" -C "$tmpdir"

  run_root mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/config"
  run_root cp "$tmpdir/otelcol-contrib" "$INSTALL_DIR/bin/otelcol-contrib"
  run_root chmod 755 "$INSTALL_DIR/bin/otelcol-contrib"
  ok "Installed otelcol-contrib to $INSTALL_DIR/bin/"
}

# ─── Write config ──────────────────────────────────────────────────
write_config() {
  local config_file="$INSTALL_DIR/config/otelcol.yaml"

  info "Writing collector config..."
  ensure_install_dirs
  run_root tee "$config_file" >/dev/null <<YAML
# O11yFleet managed collector configuration
# This collector connects to O11yFleet via OpAMP for remote management.
# The server will push pipeline configuration updates automatically.

extensions:
  opamp:
    server:
      ws:
        endpoint: ${OPAMP_ENDPOINT}
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
  run_root chmod 640 "$config_file"
  run_root chown o11yfleet:o11yfleet "$config_file" 2>/dev/null || true
  ok "Config written to $config_file"
}

# ─── Linux systemd service ──────────────────────────────────────────
install_linux_service() {
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemd not found — skipping service setup. Start manually:"
    echo "  $(root_command_prefix)${COLLECTOR_BIN} --config $INSTALL_DIR/config/otelcol.yaml"
    return
  fi

  info "Installing systemd service..."

  # Create system user if not exists
  if ! id -u o11yfleet >/dev/null 2>&1; then
    run_root useradd --system --no-create-home --shell /sbin/nologin o11yfleet 2>/dev/null || true
  fi
  run_root chown -R o11yfleet:o11yfleet "$INSTALL_DIR" 2>/dev/null || true

  run_root tee /etc/systemd/system/o11yfleet-collector.service >/dev/null <<UNIT
[Unit]
Description=O11yFleet Collector (otelcol-contrib + OpAMP)
Documentation=https://o11yfleet.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=o11yfleet
Group=o11yfleet
ExecStart=${COLLECTOR_BIN} --config ${INSTALL_DIR}/config/otelcol.yaml
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

  run_root systemctl daemon-reload
  run_root systemctl enable o11yfleet-collector
  run_root systemctl restart o11yfleet-collector
  SERVICE_STARTED=true
  ok "Service started: o11yfleet-collector"
}

# ─── macOS launchd service ─────────────────────────────────────────
install_macos_service() {
  info "Installing launchd service..."

  local plist="/Library/LaunchDaemons/com.o11yfleet.collector.plist"
  run_root tee "$plist" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.o11yfleet.collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>${COLLECTOR_BIN}</string>
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

  run_root launchctl bootout system/com.o11yfleet.collector 2>/dev/null || true
  run_root launchctl bootstrap system "$plist"
  SERVICE_STARTED=true
  ok "Service started: com.o11yfleet.collector"
}

# ─── Parse arguments ────────────────────────────────────────────────
parse_args() {
  local UNINSTALL=false

  while [ $# -gt 0 ]; do
    case "$1" in
      --token)
        [ -z "${2:-}" ] || [ "${2#-}" != "$2" ] && fail "Missing value for --token"
        TOKEN="$2"; shift 2 ;;
      --token=*)    TOKEN="${1#*=}"; shift ;;
      --version)
        [ -z "${2:-}" ] || [ "${2#-}" != "$2" ] && fail "Missing value for --version"
        OTELCOL_VERSION="$2"; shift 2 ;;
      --version=*)  OTELCOL_VERSION="${1#*=}"; shift ;;
      --endpoint)
        [ -z "${2:-}" ] || [ "${2#-}" != "$2" ] && fail "Missing value for --endpoint"
        OPAMP_ENDPOINT="$2"; shift 2 ;;
      --endpoint=*) OPAMP_ENDPOINT="${1#*=}"; shift ;;
      --dir)
        [ -z "${2:-}" ] || [ "${2#-}" != "$2" ] && fail "Missing value for --dir"
        INSTALL_DIR="$2"; shift 2 ;;
      --dir=*)      INSTALL_DIR="${1#*=}"; shift ;;
      --offline)
        [ -z "${2:-}" ] || [ "${2#-}" != "$2" ] && fail "Missing value for --offline"
        OFFLINE_FILE="$2"; shift 2 ;;
      --offline=*) OFFLINE_FILE="${1#*=}"; shift ;;
      --uninstall)  UNINSTALL=true; shift ;;
      --help|-h)
        cat <<EOF
O11yFleet Collector Installer

Usage:
  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>

Options:
  --token TOKEN       Enrollment token (required, starts with fp_enroll_)
  --version VERSION   otelcol-contrib version (default: $OTELCOL_VERSION)
  --endpoint URL      OpAMP server endpoint (default: $OPAMP_ENDPOINT)
  --dir PATH          Install directory (default: $INSTALL_DIR)
  --offline FILE      Use local OTel contrib tarball instead of downloading
  --uninstall         Remove O11yFleet collector and config
  -h, --help          Show this help

Offline Installation:
  Download the OTel contrib file for your platform, then:
  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token <TOKEN> --offline /path/to/otelcol-contrib.tar.gz

Supported offline file types:
  - .tar.gz
EOF
        exit 0 ;;
      *) fail "Unknown option: $1. Use --help for usage." ;;
    esac
  done

  if [ "$UNINSTALL" = true ]; then
    do_uninstall
  fi

  if [ -z "$TOKEN" ]; then
    fail "Enrollment token required.\n  Usage: curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token fp_enroll_..."
  fi

  case "$TOKEN" in
    fp_enroll_*|fp_opamp_*) ;;
    *) warn "Token doesn't start with fp_enroll_ or fp_opamp_ — are you sure this is an enrollment token?" ;;
  esac

  return 0
}

# ─── Main ─────────────────────────────────────────────────────────
main() {
  echo ""
  printf "%s\n" "${CYAN}  O11yFleet Collector Installer${NC}"
  echo "  ──────────────────────────────"
  echo ""

  detect_platform

  # Select install artifact
  PKG_TYPE=$(detect_package_manager)
  info "Install package type: $PKG_TYPE"

  # Parse args (exits if --uninstall)
  parse_args "$@"

  # Check prerequisites
  check_prereqs
  preflight_conflicting_collector_service

  # Upgrade detection is scoped to O11yFleet-managed state. An unrelated
  # otelcol-contrib binary on PATH should not suppress writing our config.
  if [ -f "$INSTALL_DIR/bin/otelcol-contrib" ] || [ -f "$INSTALL_DIR/config/otelcol.yaml" ]; then
    info "Existing installation detected — upgrading..."
  fi

  # Install binary
  install_binary
  ensure_install_dirs
  resolve_collector_bin

  if [ -f "$INSTALL_DIR/config/otelcol.yaml" ]; then
    ok "Preserving existing config at $INSTALL_DIR/config/otelcol.yaml"
  else
    write_config
  fi

  case "$OS" in
    linux)  install_linux_service ;;
    darwin) install_macos_service ;;
  esac

  echo ""
  if [ "$SERVICE_STARTED" = true ]; then
    ok "O11yFleet collector is running!"
  else
    ok "O11yFleet collector installed."
    warn "Service was not started automatically."
  fi
  echo ""
  if [ "$SERVICE_STARTED" = true ]; then
    info "The collector will appear in your dashboard within a few seconds."
    info "View logs:"
    case "$OS" in
      linux)  echo "  sudo journalctl -u o11yfleet-collector -f" ;;
      darwin) echo "  tail -f /var/log/o11yfleet-collector.log" ;;
    esac
  fi
  info "Uninstall:"
  echo "  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --uninstall"
  echo ""
}

main "$@"
