#!/usr/bin/env bash
# bats helper functions for testing the installer

# Setup before each test
setup() {
  # Reset global variables to defaults
  OTELCOL_VERSION="${OTELCOL_VERSION:-0.152.0}"
  SUPERVISOR_VERSION="${SUPERVISOR_VERSION:-$OTELCOL_VERSION}"
  OPAMP_ENDPOINT="${OPAMP_ENDPOINT:-wss://api.o11yfleet.com/v1/opamp}"
  INSTALL_DIR="${INSTALL_DIR:-/usr/local}"
  OFFLINE_FILE=""
  TOKEN=""
  UNINSTALL=false
  OS="linux"
  ARCH="amd64"
  PKG_TYPE="deb"
  COLLECTOR_BIN=""
  SUPERVISOR_CONFIG_DIR="${SUPERVISOR_CONFIG_DIR:-/etc/opampsupervisor}"
  SUPERVISOR_CONFIG_FILE="${SUPERVISOR_CONFIG_FILE:-$SUPERVISOR_CONFIG_DIR/config.yaml}"
  SUPERVISOR_COLLECTOR_CONFIG_FILE="${SUPERVISOR_COLLECTOR_CONFIG_FILE:-$SUPERVISOR_CONFIG_DIR/collector.yaml}"
  SUPERVISOR_STATE_DIR="${SUPERVISOR_STATE_DIR:-/var/lib/opampsupervisor}"
  SUPERVISOR_LOG_DIR="${SUPERVISOR_LOG_DIR:-/var/log/opampsupervisor}"
  SUPERVISOR_BIN_PATH="${SUPERVISOR_BIN_PATH:-$INSTALL_DIR/bin/opampsupervisor}"
  COLLECTOR_BIN_PATH="${COLLECTOR_BIN_PATH:-$INSTALL_DIR/bin/otelcol}"
  LEGACY_INSTALL_DIR="${LEGACY_INSTALL_DIR:-/opt/o11yfleet}"
  INSTALLER_TMPDIR=""
  SERVICE_STARTED=false
  SUDO=()
}

# Teardown after each test
teardown() {
  # Clean up any temp files
  true
}

# Mock functions for testing
mock_uname() {
  case "$1" in
    -s) echo "$OS" ;;
    -m)
      case "$ARCH" in
        amd64) echo "x86_64" ;;
        arm64) echo "aarch64" ;;
        *) echo "$ARCH" ;;
      esac
      ;;
  esac
}

# Source the install script functions for testing
# Note: This loads the functions into the test environment
load_source() {
  # Skip sourcing if already in test environment
  if [ -n "${BATS_TEST_FILENAME:-}" ]; then
    # We're in bats, source carefully
    return 0
  fi
}
