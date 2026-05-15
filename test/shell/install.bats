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

@test "detect_package_manager: defaults managed installs to tar.gz" {
  result=$(bash -c '
    source "$1"
    OS="linux"
    detect_package_manager
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")
  [ "$result" = "tar.gz" ]
}

@test "detect_package_manager: returns tar.gz on macOS" {
  result=$(bash -c '
    source "$1"
    OS="darwin"
    detect_package_manager
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")
  [ "$result" = "tar.gz" ]
}

@test "preflight_conflicting_collector_service: fails when upstream collector service exists" {
  run bash -c '
    source "$1"
    tmpdir="$(mktemp -d)"
    trap "rm -rf \"$tmpdir\"" EXIT
    printf "%s\n" "#!/usr/bin/env sh" "[ \"\$1\" = cat ] && [ \"\$2\" = otelcol-contrib.service ] && exit 0" "exit 1" > "$tmpdir/systemctl"
    chmod +x "$tmpdir/systemctl"
    PATH="$tmpdir:$PATH"
    OS="linux"
    preflight_conflicting_collector_service
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -ne 0 ]
  [[ "$output" == *"Existing OpenTelemetry Collector systemd service detected: otelcol-contrib.service"* ]]
}

@test "preflight_conflicting_collector_service: passes when no upstream collector service exists" {
  run bash -c '
    source "$1"
    tmpdir="$(mktemp -d)"
    trap "rm -rf \"$tmpdir\"" EXIT
    printf "%s\n" "#!/usr/bin/env sh" "exit 1" > "$tmpdir/systemctl"
    chmod +x "$tmpdir/systemctl"
    PATH="$tmpdir:$PATH"
    OS="linux"
    preflight_conflicting_collector_service
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -eq 0 ]
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
    parse_args --token fp_enroll_test123 --offline /path/to/file.tar.gz
    echo "$OFFLINE_FILE"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "/path/to/file.tar.gz" ]
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

@test "check_prereqs: offline mode does not require curl" {
  run bash -c '
    source "$1"
    configure_privilege() { :; }
    tmpdir="$(mktemp -d)"
    printf "%s\n" "#!/usr/bin/env sh" "exit 0" > "$tmpdir/tar"
    chmod +x "$tmpdir/tar"
    PATH="$tmpdir"
    OFFLINE_FILE="/tmp/otelcol-contrib.tar.gz"
    check_prereqs
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -eq 0 ]
}

@test "check_prereqs: online mode requires curl" {
  run bash -c '
    source "$1"
    configure_privilege() { :; }
    tmpdir="$(mktemp -d)"
    printf "%s\n" "#!/usr/bin/env sh" "exit 0" > "$tmpdir/tar"
    chmod +x "$tmpdir/tar"
    PATH="$tmpdir"
    OFFLINE_FILE=""
    check_prereqs
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -ne 0 ]
  [[ "$output" == *"Required command not found: curl"* ]]
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
    OFFLINE_FILE="/nonexistent/path/file.tar.gz"
    PKG_TYPE="tar.gz"
    PKG_EXT="tar.gz"
    install_binary 2>&1 || true
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh" 
  
  # The error message should contain "Offline file not found"
  [[ "$output" == *"Offline file not found"* ]]
}

@test "install_binary: rejects offline deb and rpm packages" {
  run bash -c '
    source "$1"
    tmpfile="$(mktemp).deb"
    trap "rm -f \"$tmpfile\"" EXIT
    printf "not a package" > "$tmpfile"
    OFFLINE_FILE="$tmpfile"
    PKG_TYPE="tar.gz"
    install_binary
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -ne 0 ]
  [[ "$output" == *"Unsupported offline file type"* ]]
  [[ "$output" == *"O11yFleet owns service setup"* ]]
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
