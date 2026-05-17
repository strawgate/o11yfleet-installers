#!/usr/bin/env bash
# O11yFleet Collector Installer Library
# Functions for installation - can be sourced for testing

# ─── Colors ─────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
COLLECTOR_BIN="${COLLECTOR_BIN:-}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local}"
SUPERVISOR_VERSION="${SUPERVISOR_VERSION:-${OTELCOL_VERSION:-0.152.0}}"
SUPERVISOR_CONFIG_DIR="${SUPERVISOR_CONFIG_DIR:-/etc/opampsupervisor}"
SUPERVISOR_CONFIG_FILE="${SUPERVISOR_CONFIG_FILE:-$SUPERVISOR_CONFIG_DIR/config.yaml}"
SUPERVISOR_COLLECTOR_CONFIG_FILE="${SUPERVISOR_COLLECTOR_CONFIG_FILE:-$SUPERVISOR_CONFIG_DIR/collector.yaml}"
SUPERVISOR_STATE_DIR="${SUPERVISOR_STATE_DIR:-/var/lib/opampsupervisor}"
SUPERVISOR_LOG_DIR="${SUPERVISOR_LOG_DIR:-/var/log/opampsupervisor}"
SUPERVISOR_BIN_PATH="${SUPERVISOR_BIN_PATH:-$INSTALL_DIR/bin/opampsupervisor}"
COLLECTOR_BIN_PATH="${COLLECTOR_BIN_PATH:-$INSTALL_DIR/bin/otelcol}"
LEGACY_INSTALL_DIR="${LEGACY_INSTALL_DIR:-/opt/o11yfleet}"
INSTALLER_TMPDIR="${INSTALLER_TMPDIR:-}"
TOKEN="${TOKEN:-}"
SERVICE_STARTED="${SERVICE_STARTED:-false}"
STAGED_SUPERVISOR_ARTIFACT=""
STAGED_COLLECTOR_TARBALL=""
SUDO=()

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
  run_root mkdir -p \
    "$(dirname "$COLLECTOR_BIN_PATH")" \
    "$SUPERVISOR_CONFIG_DIR" \
    "$SUPERVISOR_STATE_DIR" \
    "$SUPERVISOR_LOG_DIR"
}

resolve_collector_bin() {
  COLLECTOR_BIN="$COLLECTOR_BIN_PATH"
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
  case "$OS" in
    linux)
      if command -v dpkg >/dev/null 2>&1; then
        echo "deb"
      elif command -v rpm >/dev/null 2>&1; then
        echo "rpm"
      else
        echo "binary"
      fi
      ;;
    darwin) echo "binary" ;;
    *)      echo "binary" ;;
  esac
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

# ─── Prerequisites ────────────────────────────────────────────────────
check_prereqs() {
  command -v tar >/dev/null 2>&1 || fail "Required command not found: tar"
  if [ -z "$OFFLINE_FILE" ] || ! command -v opampsupervisor >/dev/null 2>&1; then
    command -v curl >/dev/null 2>&1 || fail "Required command not found: curl"
  fi
  configure_privilege
}

# ─── Download & install supervisor and collector ───────────────────────
install_binary() {
  INSTALLER_TMPDIR="$(mktemp -d)"
  local tmpdir="$INSTALLER_TMPDIR"
  trap cleanup_tmpdir EXIT

  stage_supervisor_artifact "$tmpdir"
  stage_collector_artifact "$tmpdir"
  install_staged_supervisor
  install_staged_collector
}

stage_supervisor_artifact() {
  local tmpdir="$1"
  local filename url

  if command -v opampsupervisor >/dev/null 2>&1; then
    ok "Using existing opampsupervisor at $(command -v opampsupervisor)"
    return
  fi

  filename="$(supervisor_artifact_name)"
  url="$(supervisor_download_url "$filename")"

  info "Downloading OpenTelemetry OpAMP Supervisor $SUPERVISOR_VERSION ($PKG_TYPE)..."
  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmpdir/$filename" \
    || fail "Download failed. Check supervisor version $SUPERVISOR_VERSION exists at:\n  $url"

  verify_checksum_url "$tmpdir" "$filename" "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/cmd%2Fopampsupervisor%2Fv${SUPERVISOR_VERSION}/checksums.txt"

  STAGED_SUPERVISOR_ARTIFACT="$tmpdir/$filename"
}

install_staged_supervisor() {
  if [ -z "$STAGED_SUPERVISOR_ARTIFACT" ]; then
    return
  fi

  case "$PKG_TYPE" in
    deb)
      info "Installing OpAMP Supervisor DEB package..."
      run_root dpkg -i "$STAGED_SUPERVISOR_ARTIFACT"
      ;;
    rpm)
      info "Installing OpAMP Supervisor RPM package..."
      run_root rpm -Uvh "$STAGED_SUPERVISOR_ARTIFACT"
      ;;
    binary)
      info "Installing opampsupervisor binary..."
      run_root mkdir -p "$(dirname "$SUPERVISOR_BIN_PATH")"
      run_root cp "$STAGED_SUPERVISOR_ARTIFACT" "$SUPERVISOR_BIN_PATH"
      run_root chmod 755 "$SUPERVISOR_BIN_PATH"
      ;;
    *) fail "Unsupported supervisor package type: $PKG_TYPE" ;;
  esac

  ok "Installed OpenTelemetry OpAMP Supervisor"
}

supervisor_artifact_name() {
  case "$PKG_TYPE" in
    deb|rpm) echo "opampsupervisor_${SUPERVISOR_VERSION}_linux_${ARCH}.${PKG_TYPE}" ;;
    binary)  echo "opampsupervisor_${SUPERVISOR_VERSION}_${OS}_${ARCH}" ;;
    *)       fail "Unsupported supervisor package type: $PKG_TYPE" ;;
  esac
}

supervisor_download_url() {
  local filename="$1"
  echo "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/cmd%2Fopampsupervisor%2Fv${SUPERVISOR_VERSION}/${filename}"
}

stage_collector_artifact() {
  local tmpdir="$1"
  local tarball_name="otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"

  if [ -n "$OFFLINE_FILE" ]; then
    info "Using offline file: $OFFLINE_FILE"
    if [ ! -f "$OFFLINE_FILE" ]; then
      fail "Offline file not found: $OFFLINE_FILE"
    fi
    case "$OFFLINE_FILE" in
      *.tar.gz) ;;
      *)
        fail "Unsupported offline file type: $OFFLINE_FILE. Use the upstream otelcol-contrib .tar.gz artifact."
        ;;
    esac
    cp "$OFFLINE_FILE" "$tmpdir/$tarball_name"
  else
    download_collector_binary "$tmpdir"
  fi

  STAGED_COLLECTOR_TARBALL="$tmpdir/$tarball_name"
}

install_staged_collector() {
  [ -n "$STAGED_COLLECTOR_TARBALL" ] || fail "Collector artifact was not staged"
  install_tarball "$STAGED_COLLECTOR_TARBALL"
}

# ─── Download collector binary ───────────────────────────────────────
download_collector_binary() {
  local tmpdir="$1"
  local tarball_name filename url

  tarball_name="otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"
  filename="$tarball_name"

  url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/${filename}"

  info "Downloading OpenTelemetry Collector Contrib $OTELCOL_VERSION..."
  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmpdir/$tarball_name" \
    || fail "Download failed. Check collector version $OTELCOL_VERSION exists at:\n  $url"

  verify_checksum "$tmpdir" "$tarball_name"
}

# ─── Verify checksum ─────────────────────────────────────────────────
verify_checksum() {
  local tmpdir="$1"
  local filename="$2"
  local checksums_url

  info "Verifying checksum..."

  checksums_url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/opentelemetry-collector-releases_otelcol-contrib_checksums.txt"

  verify_checksum_url "$tmpdir" "$filename" "$checksums_url"
}

verify_checksum_url() {
  local tmpdir="$1"
  local filename="$2"
  local checksums_url="$3"
  local expected_hash

  if ! curl --proto '=https' --tlsv1.2 -fsSL "$checksums_url" -o "$tmpdir/checksums.txt" 2>/dev/null; then
    warn "Could not download checksums.txt, skipping verification"
    return
  fi

  expected_hash="$(grep " ${filename}$" "$tmpdir/checksums.txt" | cut -d' ' -f1)"
  [ -n "$expected_hash" ] || fail "Checksum for ${filename} not found in checksums.txt"

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
}

# ─── Install tarball ────────────────────────────────────────────────
install_tarball() {
  local tarball="$1"
  local tmpdir
  tmpdir="$(dirname "$tarball")"

  info "Extracting tarball..."
  tar -xzf "$tarball" -C "$tmpdir"

  run_root mkdir -p "$(dirname "$COLLECTOR_BIN_PATH")"
  run_root cp "$tmpdir/otelcol-contrib" "$COLLECTOR_BIN_PATH"
  run_root chmod 755 "$COLLECTOR_BIN_PATH"
  ok "Installed OpenTelemetry Collector Contrib as $COLLECTOR_BIN_PATH"
}

# ─── Write config ──────────────────────────────────────────────────
write_config() {
  info "Writing OpAMP Supervisor config..."
  ensure_install_dirs

  run_root tee "$SUPERVISOR_COLLECTOR_CONFIG_FILE" >/dev/null <<YAML
# Bootstrap OpenTelemetry Collector Contrib config.
# O11yFleet sends managed configuration through the OpAMP Supervisor.
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
  run_root chmod 644 "$SUPERVISOR_COLLECTOR_CONFIG_FILE"

  run_root tee "$SUPERVISOR_CONFIG_FILE" >/dev/null <<YAML
# OpenTelemetry OpAMP Supervisor configuration managed by O11yFleet.
server:
  endpoint: ${OPAMP_ENDPOINT}
  headers:
    Authorization:
      - "Bearer ${TOKEN}"
  tls:
    insecure_skip_verify: false

capabilities:
  accepts_remote_config: true
  accepts_restart_command: true
  accepts_opamp_connection_settings: false
  reports_effective_config: true
  reports_own_metrics: false
  reports_own_logs: true
  reports_own_traces: false
  reports_health: true
  reports_remote_config: true
  reports_available_components: true
  reports_heartbeat: true

agent:
  executable: ${COLLECTOR_BIN_PATH}
  passthrough_logs: true
  config_files:
    - ${SUPERVISOR_COLLECTOR_CONFIG_FILE}

storage:
  directory: ${SUPERVISOR_STATE_DIR}

telemetry:
  logs:
    level: info
    output_paths:
      - ${SUPERVISOR_LOG_DIR}/opampsupervisor.log
YAML

  if [ "$OS" = "linux" ] && command -v getent >/dev/null 2>&1 && getent group opampsupervisor >/dev/null 2>&1; then
    run_root chown root:opampsupervisor "$SUPERVISOR_CONFIG_FILE" "$SUPERVISOR_COLLECTOR_CONFIG_FILE" 2>/dev/null || true
    run_root chmod 640 "$SUPERVISOR_CONFIG_FILE"
  else
    run_root chmod 600 "$SUPERVISOR_CONFIG_FILE"
  fi
  ok "Supervisor config written to $SUPERVISOR_CONFIG_FILE"
}

# ─── Linux systemd service ──────────────────────────────────────────
install_linux_service() {
  remove_legacy_linux_service

  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemd not found — skipping service setup. Start manually:"
    echo "  $(root_command_prefix)$(resolve_supervisor_command) --config=${SUPERVISOR_CONFIG_FILE}"
    return
  fi

  if ! collector_service_unit_exists opampsupervisor.service; then
    install_fallback_supervisor_unit
  fi

  info "Starting opampsupervisor systemd service..."
  run_root systemctl daemon-reload
  run_root systemctl enable opampsupervisor
  run_root systemctl restart opampsupervisor
  SERVICE_STARTED=true
  ok "Service started: opampsupervisor"
}

resolve_supervisor_command() {
  if command -v opampsupervisor >/dev/null 2>&1; then
    command -v opampsupervisor
  else
    printf "%s" "$SUPERVISOR_BIN_PATH"
  fi
}

remove_legacy_linux_service() {
  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl stop o11yfleet-collector 2>/dev/null || true
    run_root systemctl disable o11yfleet-collector 2>/dev/null || true
    run_root rm -f /etc/systemd/system/o11yfleet-collector.service
  fi
}

ensure_opampsupervisor_user() {
  if ! id -u opampsupervisor >/dev/null 2>&1; then
    run_root useradd --system --no-create-home --shell /sbin/nologin opampsupervisor 2>/dev/null || true
  fi
}

install_fallback_supervisor_unit() {
  ensure_opampsupervisor_user
  run_root chown -R opampsupervisor:opampsupervisor "$SUPERVISOR_STATE_DIR" "$SUPERVISOR_LOG_DIR" 2>/dev/null || true
  if command -v getent >/dev/null 2>&1 && getent group opampsupervisor >/dev/null 2>&1; then
    run_root chown root:opampsupervisor "$SUPERVISOR_CONFIG_FILE" 2>/dev/null || true
    run_root chmod 640 "$SUPERVISOR_CONFIG_FILE"
  fi

  info "Installing opampsupervisor systemd service..."
  run_root tee /etc/systemd/system/opampsupervisor.service >/dev/null <<UNIT
[Unit]
Description=OpenTelemetry Collector OpAMP Supervisor
Documentation=https://opentelemetry.io/docs/collector/management/
After=network-online.target
Wants=network-online.target
AssertPathExists=${SUPERVISOR_CONFIG_FILE}

[Service]
Type=simple
User=opampsupervisor
Group=opampsupervisor
ExecStart=$(resolve_supervisor_command) --config=${SUPERVISOR_CONFIG_FILE}
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
}

# ─── macOS launchd service ─────────────────────────────────────────
install_macos_service() {
  info "Installing launchd service..."

  local plist="/Library/LaunchDaemons/io.opentelemetry.opampsupervisor.plist"
  run_root tee "$plist" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.opentelemetry.opampsupervisor</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(resolve_supervisor_command)</string>
    <string>--config=${SUPERVISOR_CONFIG_FILE}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${SUPERVISOR_LOG_DIR}/opampsupervisor.log</string>
  <key>StandardErrorPath</key>
  <string>${SUPERVISOR_LOG_DIR}/opampsupervisor.log</string>
</dict>
</plist>
PLIST

  run_root launchctl bootout system/com.o11yfleet.collector 2>/dev/null || true
  run_root launchctl bootout system/io.opentelemetry.opampsupervisor 2>/dev/null || true
  run_root launchctl bootstrap system "$plist"
  SERVICE_STARTED=true
  ok "Service started: io.opentelemetry.opampsupervisor"
}

# ─── Uninstall ──────────────────────────────────────────────────────
do_uninstall() {
  configure_privilege
  info "Uninstalling OpenTelemetry supervisor and collector config..."
  case "$OS" in
    linux)
      if command -v systemctl >/dev/null 2>&1; then
        run_root systemctl stop opampsupervisor 2>/dev/null || true
        run_root systemctl disable opampsupervisor 2>/dev/null || true
        run_root systemctl stop o11yfleet-collector 2>/dev/null || true
        run_root systemctl disable o11yfleet-collector 2>/dev/null || true
        run_root rm -f /etc/systemd/system/opampsupervisor.service
        run_root rm -f /etc/systemd/system/o11yfleet-collector.service
        run_root systemctl daemon-reload 2>/dev/null || true
      fi
      run_root dpkg -r opampsupervisor 2>/dev/null || true
      run_root rpm -e opampsupervisor 2>/dev/null || true
      ;;
    darwin)
      run_root launchctl bootout system/io.opentelemetry.opampsupervisor 2>/dev/null || true
      run_root launchctl bootout system/com.o11yfleet.collector 2>/dev/null || true
      run_root rm -f /Library/LaunchDaemons/io.opentelemetry.opampsupervisor.plist
      run_root rm -f /Library/LaunchDaemons/com.o11yfleet.collector.plist
      ;;
  esac
  run_root rm -f "$COLLECTOR_BIN_PATH" "$SUPERVISOR_BIN_PATH"
  run_root rm -rf "$SUPERVISOR_CONFIG_DIR" "$SUPERVISOR_STATE_DIR" "$SUPERVISOR_LOG_DIR" "$LEGACY_INSTALL_DIR"
  ok "OpenTelemetry supervisor and collector config removed."
  exit 0
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
        OTELCOL_VERSION="$2"; SUPERVISOR_VERSION="$2"; shift 2 ;;
      --version=*)  OTELCOL_VERSION="${1#*=}"; SUPERVISOR_VERSION="$OTELCOL_VERSION"; shift ;;
      --endpoint)
        [ -z "${2:-}" ] || [ "${2#-}" != "$2" ] && fail "Missing value for --endpoint"
        OPAMP_ENDPOINT="$2"; shift 2 ;;
      --endpoint=*) OPAMP_ENDPOINT="${1#*=}"; shift ;;
      --dir)
        [ -z "${2:-}" ] || [ "${2#-}" != "$2" ] && fail "Missing value for --dir"
        INSTALL_DIR="$2"; COLLECTOR_BIN_PATH="$INSTALL_DIR/bin/otelcol"; SUPERVISOR_BIN_PATH="$INSTALL_DIR/bin/opampsupervisor"; shift 2 ;;
      --dir=*)      INSTALL_DIR="${1#*=}"; COLLECTOR_BIN_PATH="$INSTALL_DIR/bin/otelcol"; SUPERVISOR_BIN_PATH="$INSTALL_DIR/bin/opampsupervisor"; shift ;;
      --offline)
        [ -z "${2:-}" ] || [ "${2#-}" != "$2" ] && fail "Missing value for --offline"
        OFFLINE_FILE="$2"; shift 2 ;;
      --offline=*) OFFLINE_FILE="${1#*=}"; shift ;;
      --uninstall)  UNINSTALL=true; shift ;;
      --help|-h)
        cat <<EOF
O11yFleet OpenTelemetry Supervisor Installer

Usage:
  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>

Options:
  --token TOKEN       Enrollment token (required, starts with fp_opamp_ or legacy fp_enroll_)
  --version VERSION   OpenTelemetry Collector/Supervisor version (default: $OTELCOL_VERSION)
  --endpoint URL      OpAMP server endpoint (default: $OPAMP_ENDPOINT)
  --dir PATH          Binary install prefix (default: $INSTALL_DIR)
  --offline FILE      Use local OTel Collector Contrib tarball instead of downloading it
  --uninstall         Remove supervisor, collector binary, and config
  -h, --help          Show this help

Offline Installation:
  Download the OpenTelemetry Collector Contrib tarball for your platform, then:
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
    fail "Enrollment token required.\n  Usage: curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token fp_opamp_..."
  fi

  case "$TOKEN" in
    fp_enroll_*|fp_opamp_*) ;;
    *) warn "Token doesn't start with fp_enroll_ or fp_opamp_ — are you sure this is an enrollment token?" ;;
  esac

  return 0
}
