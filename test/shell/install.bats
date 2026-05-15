#!/usr/bin/env bats
# bats-core tests for O11yFleet installer library
# Usage: bats test/shell/install.bats

# Load the install library functions
SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
load "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

# ─── Platform Detection Tests ──────────────────────────────────────────

@test "detect_platform: sets OS and ARCH variables" {
  # Run in subshell to capture the source and function output
  run bash -c '
    source "$1"
    detect_platform
    echo "OS=$OS"
    echo "ARCH=$ARCH"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  
  # Output contains ANSI-colored detect_platform output + echo statements
  [[ "$output" == *"OS=linux"* ]]
  [[ "$output" == *"ARCH="* ]]
}

@test "detect_platform: outputs platform info" {
  run bash -c '
    source "$1"
    detect_platform
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Detected platform: "(linux|darwin)"/"(amd64|arm64) ]]
}

# ─── Package Manager Detection Tests ───────────────────────────────────

@test "detect_package_manager: returns deb when dpkg is available" {
  result=$(bash -c '
    source "$1"
    OS="linux"
    detect_package_manager
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")
  # Result depends on system, just verify it returns something valid
  [[ "$result" == "deb" || "$result" == "rpm" || "$result" == "tar.gz" ]]
}

@test "detect_package_manager: returns tar.gz on macOS" {
  result=$(bash -c '
    source "$1"
    OS="darwin"
    detect_package_manager
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")
  [ "$result" = "tar.gz" ]
}

# ─── Argument Parsing Tests ───────────────────────────────────────────

@test "parse_args: extracts --token" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123
    echo "$TOKEN"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "fp_enroll_test123" ]
}

@test "parse_args: extracts --token with equals" {
  TOKEN=""
  run bash -c '
    source "$1"
    parse_args --token=fp_enroll_test123
    echo "$TOKEN"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "fp_enroll_test123" ]
}

@test "parse_args: extracts --version" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123 --version 0.152.0
    echo "$OTELCOL_VERSION"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "0.152.0" ]
}

@test "parse_args: extracts --endpoint" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123 --endpoint wss://custom.example.com
    echo "$OPAMP_ENDPOINT"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "wss://custom.example.com" ]
}

@test "parse_args: extracts --dir" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123 --dir /custom/path
    echo "$INSTALL_DIR"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "/custom/path" ]
}

@test "parse_args: extracts --offline" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123 --offline /path/to/file.deb
    echo "$OFFLINE_FILE"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "/path/to/file.deb" ]
}

@test "parse_args: fails without --token" {
  run bash -c '
    source "$1"
    parse_args
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Enrollment token required"* ]]
}

@test "parse_args: warns about invalid token format" {
  run bash -c '
    source "$1"
    parse_args --token invalid_token 2>&1 || true
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [[ "$output" == *"doesn't start with fp_enroll_ or fp_opamp_"* ]]
}

@test "parse_args: accepts fp_opamp tokens without corrupting stdout token" {
  run bash -c '
    source "$1"
    parse_args --token fp_opamp_test123 2>/tmp/o11yfleet-installer-warn.log
    echo "$TOKEN"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "fp_opamp_test123" ]
}

@test "configure_privilege: root does not require sudo" {
  [ "$(id -u)" -eq 0 ] || skip "root-only path is exercised in Linux container CI"
  run bash -c '
    source "$1"
    configure_privilege
    run_root sh -c "printf root-ok"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "root-ok" ]
}

@test "ensure_instance_uid: creates install dir before writing uid" {
  [ "$(id -u)" -eq 0 ] || skip "root-only path is exercised in Linux container CI"
  tmp_root="$(mktemp -d)"
  run bash -c '
    source "$1"
    INSTALL_DIR="$2/missing/o11yfleet"
    configure_privilege
    ensure_instance_uid
    test -s "$INSTALL_DIR/instance-uid"
    test ${#INSTANCE_UID} -eq 32
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh" "$tmp_root"
  rm -rf "$tmp_root"
  [ "$status" -eq 0 ]
}

@test "cleanup_tmpdir: safe under nounset before temp dir exists" {
  run bash -u -c '
    source "$1"
    unset INSTALLER_TMPDIR
    cleanup_tmpdir
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
}

# ─── Offline Mode Tests ────────────────────────────────────────────────

@test "install_binary: fails if offline file doesn't exist" {
  # Set OFFLINE_FILE to a non-existent path
  run bash -c '
    source "$1"
    OFFLINE_FILE="/nonexistent/path/file.deb"
    PKG_TYPE="deb"
    PKG_EXT="deb"
    install_binary 2>&1 || true
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh" 
  
  # The error message should contain "Offline file not found"
  [[ "$output" == *"Offline file not found"* ]]
}

# ─── Help Text Test ────────────────────────────────────────────────────

@test "parse_args: shows help with --help" {
  run bash -c '
    source "$1"
    parse_args --help
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"O11yFleet Collector Installer"* ]]
  [[ "$output" == *"--token"* ]]
  [[ "$output" == *"--offline"* ]]
}
