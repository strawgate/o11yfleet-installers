#!/usr/bin/env bash
# O11yFleet OpenTelemetry Supervisor Installer
# Usage: curl --proto '=https' --tlsv1.2 -fsSL https://downloads.prod.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>
#
# Installs the upstream OpenTelemetry OpAMP Supervisor service and runs
# OpenTelemetry Collector Contrib as the supervised agent binary.
# Supports: Linux (amd64/arm64), macOS (amd64/arm64)
#
# Options:
#   --token TOKEN       Enrollment token (required, starts with fp_enroll_ or fp_opamp_)
#   --version VERSION   OpenTelemetry Collector/Supervisor version (default: 0.152.0)
#   --endpoint URL      OpAMP server endpoint (default: wss://opamp.prod.o11yfleet.com/v1/opamp)
#   --dir PATH          Binary install prefix (default: /usr/local)
#   --offline FILE      Use local OTel Collector Contrib tarball instead of downloading it
#   --uninstall         Remove supervisor, collector binary, and config
#   --insecure-skip-checksum  Skip download integrity verification (NOT recommended)
#   -h, --help          Show this help

# Strict mode is set inside main() rather than globally so this file can be
# sourced (e.g. by the bats tests) without aborting the caller's shell.

# ─── Configuration ────────────────────────────────────────────────────
OTELCOL_VERSION="${OTELCOL_VERSION:-0.152.0}"
SUPERVISOR_VERSION="${SUPERVISOR_VERSION:-$OTELCOL_VERSION}"
OPAMP_ENDPOINT="${OPAMP_ENDPOINT:-wss://opamp.prod.o11yfleet.com/v1/opamp}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local}"
OFFLINE_FILE=""
SKIP_CHECKSUM="${SKIP_CHECKSUM:-false}"
TOKEN=""
COLLECTOR_BIN=""
INSTALLER_TMPDIR=""
SERVICE_STARTED=false
STAGED_SUPERVISOR_ARTIFACT=""
STAGED_COLLECTOR_TARBALL=""
SUDO=()

# ─── Colors ─────────────────────────────────────────────────────────
# Only emit ANSI when stdout is a TTY and NO_COLOR is unset, so piped or
# journald-captured output (curl | sudo bash logs) stays escape-free.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; NC=''
fi
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
# Prefer the O11Y_TOKEN environment variable so the enrollment token need
# not appear on the command line (where it is visible in `ps`/shell history).
# An explicit --token still overrides this.
TOKEN="${O11Y_TOKEN:-${TOKEN:-}}"
SERVICE_STARTED="${SERVICE_STARTED:-false}"
STAGED_SUPERVISOR_ARTIFACT=""
STAGED_COLLECTOR_TARBALL=""
SUDO=()

info()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$*" >&2; }
fail()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

on_error() {
  local rc="$1" line="$2"
  printf "${RED}✗${NC} Install failed (exit %s, line %s). No service changes are applied until the final step; re-running the same command is safe.\n" "$rc" "$line" >&2
}

# Hardened downloader: HTTPS-only, TLS 1.2+, bounded retries with backoff,
# connect/transfer timeouts, and resume (-C -) so a dropped connection is
# retried/resumed instead of failing the whole install. Returns curl's exit
# code so callers can distinguish 404 (22) from transport errors.
download() {
  local url="$1" out="$2"
  curl --proto '=https' --tlsv1.2 -fsSL \
    --retry 3 --retry-connrefused --retry-delay 2 \
    --connect-timeout 10 --max-time 600 \
    -C - "$url" -o "$out"
}

# Atomic binary install: stage next to the destination (same filesystem),
# set mode, then rename into place. rename(2) is atomic and safe even when
# the target binary is currently running (the live process keeps the old
# inode), so an interrupted install can't leave a half-written executable.
install_binary_atomic() {
  local src="$1" dest="$2" tmp
  tmp="${dest}.tmp.$$"
  run_root mkdir -p "$(dirname "$dest")"
  run_root cp "$src" "$tmp"
  run_root chmod 755 "$tmp"
  run_root mv -f "$tmp" "$dest"
  [ -x "$dest" ] || fail "Installed binary is not executable: $dest"
}

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

  # Under Rosetta 2 a translated x86_64 shell reports uname -m as x86_64 even
  # on Apple Silicon, which would fetch the wrong (amd64) binary. sysctl does
  # not lie, so prefer the native arm64 artifact when translation is detected.
  if [ "$OS" = "darwin" ] && [ "$ARCH" = "amd64" ]; then
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ] \
      || [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
      ARCH="arm64"
    fi
  fi

  # Note: upstream OpenTelemetry collector/supervisor releases are static Go
  # binaries with no separate musl build, so glibc-vs-musl detection would not
  # change artifact selection on Alpine and is intentionally omitted.

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
  need_cmd tar
  if [ -z "$OFFLINE_FILE" ] || ! command -v opampsupervisor >/dev/null 2>&1; then
    need_cmd curl
  fi
  configure_privilege
}

# ─── Download supervisor and collector before mutating installation ─────
stage_install_artifacts() {
  INSTALLER_TMPDIR="$(mktemp -d)"
  local tmpdir="$INSTALLER_TMPDIR"
  trap cleanup_tmpdir EXIT

  stage_supervisor_artifact "$tmpdir"
  stage_collector_artifact "$tmpdir"
}

stage_supervisor_artifact() {
  local tmpdir="$1"
  local filename url rc=0

  if command -v opampsupervisor >/dev/null 2>&1; then
    ok "Using existing opampsupervisor at $(command -v opampsupervisor)"
    return
  fi

  filename="$(supervisor_artifact_name)"
  url="$(supervisor_download_url "$filename")"

  info "Downloading OpenTelemetry OpAMP Supervisor $SUPERVISOR_VERSION ($PKG_TYPE)..."
  download "$url" "$tmpdir/$filename" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 22 ]; then
      fail "Supervisor $SUPERVISOR_VERSION not found for $OS/$ARCH (HTTP 404) — that version or platform may be unsupported:\n  $url"
    fi
    fail "Network error downloading the OpAMP Supervisor (curl exit $rc):\n  $url"
  fi

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
      install_binary_atomic "$STAGED_SUPERVISOR_ARTIFACT" "$SUPERVISOR_BIN_PATH"
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
  local tarball_name filename url rc=0

  tarball_name="otelcol-contrib_${OTELCOL_VERSION}_${OS}_${ARCH}.tar.gz"
  filename="$tarball_name"

  url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/${filename}"

  info "Downloading OpenTelemetry Collector Contrib $OTELCOL_VERSION..."
  download "$url" "$tmpdir/$tarball_name" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 22 ]; then
      fail "Collector $OTELCOL_VERSION not found for $OS/$ARCH (HTTP 404) — that version or platform may be unsupported:\n  $url"
    fi
    fail "Network error downloading the OpenTelemetry Collector (curl exit $rc):\n  $url"
  fi

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
  local expected_hash actual_hash=""

  if [ "$SKIP_CHECKSUM" = true ]; then
    warn "Checksum verification disabled via --insecure-skip-checksum (NOT recommended)"
    return
  fi

  if ! download "$checksums_url" "$tmpdir/checksums.txt" 2>/dev/null; then
    fail "Could not download checksums.txt from ${checksums_url} — refusing to install an unverified binary. Re-run with --insecure-skip-checksum to override (NOT recommended)."
  fi

  expected_hash="$(grep " ${filename}$" "$tmpdir/checksums.txt" | cut -d' ' -f1)"
  [ -n "$expected_hash" ] || fail "Checksum for ${filename} not found in checksums.txt (expected an entry matching '${filename}')"

  if command -v sha256sum >/dev/null 2>&1; then
    actual_hash="$(sha256sum "$tmpdir/$filename" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual_hash="$(shasum -a 256 "$tmpdir/$filename" | cut -d' ' -f1)"
  else
    fail "No sha256 utility (sha256sum or shasum) found — cannot verify download integrity. Install one or re-run with --insecure-skip-checksum (NOT recommended)."
  fi
  if [ "$actual_hash" != "$expected_hash" ]; then
    fail "Checksum mismatch for ${filename} — refusing to install a corrupted or tampered download.\n  expected: ${expected_hash}\n  actual:   ${actual_hash}"
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

  install_binary_atomic "$tmpdir/otelcol-contrib" "$COLLECTOR_BIN_PATH"
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

  harden_config_permissions
  ok "Supervisor config written to $SUPERVISOR_CONFIG_FILE"
}

harden_config_permissions() {
  if [ "$OS" = "linux" ] && command -v getent >/dev/null 2>&1 && getent group opampsupervisor >/dev/null 2>&1; then
    run_root chown root:opampsupervisor "$SUPERVISOR_CONFIG_FILE" "$SUPERVISOR_COLLECTOR_CONFIG_FILE" 2>/dev/null || true
    run_root chmod 640 "$SUPERVISOR_CONFIG_FILE"
  else
    run_root chmod 600 "$SUPERVISOR_CONFIG_FILE"
  fi
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
    harden_config_permissions
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
      --insecure-skip-checksum) SKIP_CHECKSUM=true; shift ;;
      --uninstall)  UNINSTALL=true; shift ;;
      --help|-h)
        cat <<EOF
O11yFleet OpenTelemetry Supervisor Installer

Usage:
  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.prod.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>

Options:
  --token TOKEN       Enrollment token (required, starts with fp_opamp_ or legacy fp_enroll_)
  --version VERSION   OpenTelemetry Collector/Supervisor version (default: $OTELCOL_VERSION)
  --endpoint URL      OpAMP server endpoint (default: $OPAMP_ENDPOINT)
  --dir PATH          Binary install prefix (default: $INSTALL_DIR)
  --offline FILE      Use local OTel Collector Contrib tarball instead of downloading it
  --uninstall         Remove supervisor, collector binary, and config
  --insecure-skip-checksum  Skip download integrity verification (NOT recommended)
  -h, --help          Show this help

Offline Installation:
  Download the OpenTelemetry Collector Contrib tarball for your platform, then:
  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.prod.o11yfleet.com/install.sh | bash -s -- --token <TOKEN> --offline /path/to/otelcol-contrib.tar.gz

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
    fail "Enrollment token required.\n  Usage: curl --proto '=https' --tlsv1.2 -fsSL https://downloads.prod.o11yfleet.com/install.sh | bash -s -- --token fp_opamp_..."
  fi

  case "$TOKEN" in
    fp_enroll_*|fp_opamp_*) ;;
    *) warn "Token doesn't start with fp_enroll_ or fp_opamp_ — are you sure this is an enrollment token?" ;;
  esac

  # Versions are interpolated into upstream download/checksum URLs — reject
  # anything that isn't a bare semver so a typo fails clearly rather than
  # producing a confusing 404 (or a surprising URL).
  OTELCOL_VERSION="${OTELCOL_VERSION#v}"
  SUPERVISOR_VERSION="${SUPERVISOR_VERSION#v}"
  if ! [[ "$OTELCOL_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "Invalid collector version '${OTELCOL_VERSION}' — expected semver X.Y.Z (e.g. 0.152.0)"
  fi
  if ! [[ "$SUPERVISOR_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "Invalid supervisor version '${SUPERVISOR_VERSION}' — expected semver X.Y.Z (e.g. 0.152.0)"
  fi

  return 0
}


# ─── Main ─────────────────────────────────────────────────────────
main() {
  # -E so the ERR trap is inherited by functions/subshells; on_error only
  # adds a diagnostic line — set -e still performs the actual abort.
  set -Eeuo pipefail
  trap 'on_error "$?" "$LINENO"' ERR
  echo ""
  printf "%s
" "${CYAN}  O11yFleet OpenTelemetry Supervisor Installer${NC}"
  echo "  ─────────────────────────────────────────────"
  echo ""

  detect_platform

  # Parse args (exits if --uninstall)
  parse_args "$@"

  # Select supervisor install artifact after arguments are known.
  PKG_TYPE=$(detect_package_manager)
  info "Supervisor package type: $PKG_TYPE"

  check_prereqs
  preflight_conflicting_collector_service

  if [ -f "$SUPERVISOR_CONFIG_FILE" ] || [ -f "$COLLECTOR_BIN_PATH" ] || [ -d "$LEGACY_INSTALL_DIR" ]; then
    info "Existing installation detected — updating supervisor and collector config..."
  fi

  stage_install_artifacts
  ensure_install_dirs
  install_staged_collector
  resolve_collector_bin
  write_config
  install_staged_supervisor
  harden_config_permissions

  case "$OS" in
    linux)  install_linux_service ;;
    darwin) install_macos_service ;;
  esac

  echo ""
  if [ "$SERVICE_STARTED" = true ]; then
    ok "OpenTelemetry OpAMP Supervisor is running."
  else
    ok "OpenTelemetry OpAMP Supervisor and Collector Contrib installed."
    warn "Service was not started automatically."
  fi
  echo ""
  if [ "$SERVICE_STARTED" = true ]; then
    info "The collector will appear in your O11yFleet dashboard within a few seconds."
    info "View logs:"
    case "$OS" in
      linux)  echo "  sudo journalctl -u opampsupervisor -f" ;;
      darwin) echo "  tail -f ${SUPERVISOR_LOG_DIR}/opampsupervisor.log" ;;
    esac
  fi
  info "Uninstall:"
  echo "  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.prod.o11yfleet.com/install.sh | bash -s -- --uninstall"
  echo ""
}

# Run main only when executed, not when sourced (bats sources this file to
# unit-test individual functions). Handles `curl ... | bash` where
# BASH_SOURCE[0] is empty, direct execution where it equals $0, and being
# sourced where it is a non-empty path different from $0.
if [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
