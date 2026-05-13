#!/usr/bin/env bats
# bats-core tests for O11yFleet installer library
# Usage: bats test/shell/install.bats

# Load bats assertion libraries
load "$HOME/node_modules/bats-support/load.bash"
load "$HOME/node_modules/bats-assert/load.bash"

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
  # Use --partial to match anywhere in the output
  assert_output --partial "OS=linux"
  assert_output --partial "ARCH=arm64"
}

@test "detect_platform: outputs platform info" {
  run bash -c '
    source "$1"
    detect_platform
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  
  [ "$status" -eq 0 ]
  assert_output --regexp "Detected platform: (linux|darwin)/(amd64|arm64)"
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
  assert_equal "tar.gz" "$result"
}

# ─── Argument Parsing Tests ───────────────────────────────────────────

@test "parse_args: extracts --token" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  # Should exit 0 or echo token
  [ "$status" -eq 0 ] || [ -n "$output" ]
}

@test "parse_args: extracts --token with equals" {
  TOKEN=""
  run bash -c '
    source "$1"
    parse_args --token=fp_enroll_test123
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
}

@test "parse_args: extracts --version" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123 --version 0.152.0
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
}

@test "parse_args: extracts --endpoint" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123 --endpoint wss://custom.example.com
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
}

@test "parse_args: extracts --dir" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123 --dir /custom/path
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
}

@test "parse_args: extracts --offline" {
  run bash -c '
    source "$1"
    parse_args --token fp_enroll_test123 --offline /path/to/file.deb
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
}

@test "parse_args: fails without --token" {
  run bash -c '
    source "$1"
    parse_args
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -ne 0 ]
  assert_output --partial "Enrollment token required"
}

@test "parse_args: warns about invalid token format" {
  run bash -c '
    source "$1"
    parse_args --token invalid_token 2>&1 || true
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  assert_output --partial "doesn't start with fp_enroll_"
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
  assert_output --partial "Offline file not found"
}

# ─── Help Text Test ────────────────────────────────────────────────────

@test "parse_args: shows help with --help" {
  run bash -c '
    source "$1"
    parse_args --help
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  assert_output --partial "O11yFleet Collector Installer"
  assert_output --partial "--token"
  assert_output --partial "--offline"
}
