#!/usr/bin/env bash
# O11yFleet Collector Installer Library
# Functions for installation - can be sourced for testing

# ─── Colors ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$*"; }
fail()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# ─── Detect OS & arch ────────────────────────────────────────────────
detect_platform() {
  local os_arch
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

# ─── Detect package manager (Linux only) ──────────────────────────────
# Returns: "deb" for apt/dpkg, "rpm" for yum/dnf/rpm, "tar.gz" for fallback
detect_package_manager() {
  if [ "$OS" != "linux" ]; then
    echo "tar.gz"
    return
  fi

  # Check for dpkg (Debian/Ubuntu)
  if command -v dpkg >/dev/null 2>&1; then
    echo "deb"
    return
  fi

  # Check for rpm (RHEL/CentOS/Fedora)
  if command -v rpm >/dev/null 2>&1; then
    echo "rpm"
    return
  fi

  # Default to tar.gz if neither package manager is available
  echo "tar.gz"
}

# ─── Prerequisites ────────────────────────────────────────────────────
check_prereqs() {
  for cmd in curl tar; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
  done
  if [ "$(id -u)" -ne 0 ]; then
    if ! command -v sudo >/dev/null 2>&1; then
      fail "This script requires root or sudo. Run with: sudo bash -s -- --token ..."
    fi
  fi
}

# ─── Download & install binary ────────────────────────────────────────
install_binary() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  local tarball_name filename url

  # If offline file specified, use it directly
  if [ -n "$OFFLINE_FILE" ]; then
    info "Using offline file: $OFFLINE_FILE"
    if [ ! -f "$OFFLINE_FILE" ]; then
      fail "Offline file not found: $OFFLINE_FILE"
    fi
    cp "$OFFLINE_FILE" "$tmpdir/otelcol-contrib.$PKG_EXT"
  else
    download_binary "$tmpdir"
  fi

  # Extract or install based on package type
  case "$PKG_TYPE" in
    deb)
      install_deb "$tmpdir"
      ;;
    rpm)
      install_rpm "$tmpdir"
      ;;
    tar.gz)
      install_tarball "$tmpdir"
      ;;
  esac
}

# ─── Download binary ─────────────────────────────────────────────────
download_binary() {
  local tmpdir="$1"
  local tarball_name filename url

  case "$PKG_TYPE" in
    deb)
      tarball_name="otelcol-contrib_${OTELCOL_VERSION}_linux_${ARCH}.deb"
      filename="$tarball_name"
      ;;
    rpm)
      tarball_name="otelcol-contrib_${OTELCOL_VERSION}_linux_${ARCH}.rpm"
      filename="$tarball_name"
      ;;
    tar.gz)
      tarball_name="otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"
      filename="$tarball_name"
      ;;
  esac

  url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/${filename}"

  info "Downloading $tarball_name (package type: $PKG_TYPE)..."
  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmpdir/$tarball_name" \
    || {
      # If preferred package fails, fall back to tar.gz
      if [ "$PKG_TYPE" != "tar.gz" ]; then
        warn "Failed to download $PKG_TYPE package, falling back to tar.gz..."
        PKG_TYPE="tar.gz"
        tarball_name="otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"
        url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/${tarball_name}"
        curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmpdir/$tarball_name" \
          || fail "Download failed. Check version $OTELCOL_VERSION exists at:\n  $url"
      else
        fail "Download failed. Check version $OTELCOL_VERSION exists at:\n  $url"
      fi
    }

  # Verify checksum
  verify_checksum "$tmpdir" "$tarball_name"
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

# ─── Install DEB package ─────────────────────────────────────────────
install_deb() {
  local tmpdir="$1"
  local pkg_file="$tmpdir/otelcol-contrib_${OTELCOL_VERSION}_linux_${ARCH}.deb"

  info "Installing DEB package..."
  sudo dpkg -i "$pkg_file" \
    || {
      warn "dpkg failed, trying to fix dependencies..."
      sudo apt-get install -f -y
    }
  ok "Installed otelcol-contrib via DEB package"
}

# ─── Install RPM package ─────────────────────────────────────────────
install_rpm() {
  local tmpdir="$1"
  local pkg_file="$tmpdir/otelcol-contrib_${OTELCOL_VERSION}_linux_${ARCH}.rpm"

  info "Installing RPM package..."
  sudo rpm -ivh "$pkg_file" \
    || fail "RPM installation failed"
  ok "Installed otelcol-contrib via RPM package"
}

# ─── Install tarball ────────────────────────────────────────────────
install_tarball() {
  local tmpdir="$1"
  local tarball="$tmpdir/otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"

  info "Extracting tarball..."
  tar -xzf "$tarball" -C "$tmpdir"

  sudo mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/config"
  sudo cp "$tmpdir/otelcol-contrib" "$INSTALL_DIR/bin/otelcol-contrib"
  sudo chmod 755 "$INSTALL_DIR/bin/otelcol-contrib"
  ok "Installed otelcol-contrib to $INSTALL_DIR/bin/"
}

# ─── Write config ──────────────────────────────────────────────────
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

# ─── Linux systemd service ──────────────────────────────────────────
install_linux_service() {
  # If installed via package manager, it may have set up its own service
  # Check if otelcol-contrib is in PATH and has systemd service
  if command -v otelcol-contrib >/dev/null 2>&1; then
    if systemctl is-active otelcol-contrib >/dev/null 2>&1; then
      ok "otelcol-contrib service is already running"
      return
    fi
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemd not found — skipping service setup. Start manually:"
    echo "  sudo $INSTALL_DIR/bin/otelcol-contrib --config $INSTALL_DIR/config/otelcol.yaml"
    return
  fi

  info "Installing systemd service..."

  # Create system user if not exists
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

# ─── macOS launchd service ─────────────────────────────────────────
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

# ─── Uninstall ──────────────────────────────────────────────────────
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
      # Try to remove package (will fail if not installed via package manager, that's OK)
      sudo dpkg -r otelcol-contrib 2>/dev/null || true
      sudo rpm -e otelcol-contrib 2>/dev/null || true
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

# ─── Parse arguments ────────────────────────────────────────────────
# Returns token on stdout if successful
parse_args() {
  local TOKEN=""
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
  --offline FILE      Use local OTel contrib file instead of downloading
  --uninstall         Remove O11yFleet collector and config
  -h, --help          Show this help

Offline Installation:
  Download the OTel contrib file for your platform, then:
  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token <TOKEN> --offline /path/to/otelcol-contrib.deb

Supported offline file types:
  - .deb (Debian/Ubuntu)
  - .rpm (RHEL/CentOS/Fedora)
  - .tar.gz (all platforms)
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
    fp_enroll_*) ;;
    *) warn "Token doesn't start with fp_enroll_ — are you sure this is an enrollment token?" ;;
  esac

  echo "$TOKEN"
}
