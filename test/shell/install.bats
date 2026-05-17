#!/usr/bin/env bats
# bats-core tests for O11yFleet installer library
# Usage: bats test/shell/install.bats

# Load the install library functions
SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
load "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
load "$SCRIPT_DIR/test/shell/test_helper.bash"

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

@test "detect_package_manager: prefers deb packages on dpkg systems" {
  result=$(bash -c '
    source "$1"
    tmpdir="$(mktemp -d)"
    trap "rm -rf \"$tmpdir\"" EXIT
    printf "%s\n" "#!/usr/bin/env sh" "exit 0" > "$tmpdir/dpkg"
    chmod +x "$tmpdir/dpkg"
    PATH="$tmpdir"
    OS="linux"
    detect_package_manager
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")
  [ "$result" = "deb" ]
}

@test "detect_package_manager: falls back to rpm packages on rpm systems" {
  result=$(bash -c '
    source "$1"
    tmpdir="$(mktemp -d)"
    trap "rm -rf \"$tmpdir\"" EXIT
    printf "%s\n" "#!/usr/bin/env sh" "exit 0" > "$tmpdir/rpm"
    chmod +x "$tmpdir/rpm"
    PATH="$tmpdir"
    OS="linux"
    detect_package_manager
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")
  [ "$result" = "rpm" ]
}

@test "detect_package_manager: uses binary fallback without dpkg or rpm" {
  result=$(bash -c '
    source "$1"
    tmpdir="$(mktemp -d)"
    trap "rm -rf \"$tmpdir\"" EXIT
    PATH="$tmpdir"
    OS="linux"
    detect_package_manager
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")
  [ "$result" = "binary" ]
}

@test "detect_package_manager: returns binary on macOS" {
  result=$(bash -c '
    source "$1"
    OS="darwin"
    detect_package_manager
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")
  [ "$result" = "binary" ]
}

@test "supervisor_artifact_name: builds upstream package asset names" {
  result=$(bash -c '
    source "$1"
    SUPERVISOR_VERSION=0.152.0
    OS=linux
    ARCH=amd64
    PKG_TYPE=deb
    supervisor_artifact_name
    PKG_TYPE=rpm
    supervisor_artifact_name
    OS=darwin
    PKG_TYPE=binary
    supervisor_artifact_name
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh")

  [[ "$result" == *"opampsupervisor_0.152.0_linux_amd64.deb"* ]]
  [[ "$result" == *"opampsupervisor_0.152.0_linux_amd64.rpm"* ]]
  [[ "$result" == *"opampsupervisor_0.152.0_darwin_amd64"* ]]
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
    printf "%s\n" "#!/usr/bin/env sh" "exit 0" > "$tmpdir/opampsupervisor"
    chmod +x "$tmpdir/tar"
    chmod +x "$tmpdir/opampsupervisor"
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

@test "stage_install_artifacts: stages both artifacts before installing either" {
  run bash -c '
    source "$1"
    stage_supervisor_artifact() { echo stage-supervisor; }
    stage_collector_artifact() { echo stage-collector; }
    cleanup_tmpdir() { :; }
    stage_install_artifacts
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -eq 0 ]
  [ "$output" = $'stage-supervisor\nstage-collector' ]
}

@test "hosted installer main flow installs collector and config before supervisor" {
  run bash -c '
    set -euo pipefail
    for script in "$1/apps/site/install.sh" "$1/apps/site/public/install.sh"; do
      stage=$(grep -n "^  stage_install_artifacts$" "$script" | tail -1 | cut -d: -f1)
      dirs=$(grep -n "^  ensure_install_dirs$" "$script" | tail -1 | cut -d: -f1)
      collector=$(grep -n "^  install_staged_collector$" "$script" | tail -1 | cut -d: -f1)
      config=$(grep -n "^  write_config$" "$script" | tail -1 | cut -d: -f1)
      supervisor=$(grep -n "^  install_staged_supervisor$" "$script" | tail -1 | cut -d: -f1)
      harden=$(grep -n "^  harden_config_permissions$" "$script" | tail -1 | cut -d: -f1)
      service=$(grep -n "linux)  install_linux_service" "$script" | tail -1 | cut -d: -f1)
      [ -n "$stage$dirs$collector$config$supervisor$harden$service" ]
      [ "$stage" -lt "$dirs" ]
      [ "$dirs" -lt "$collector" ]
      [ "$collector" -lt "$config" ]
      [ "$config" -lt "$supervisor" ]
      [ "$supervisor" -lt "$harden" ]
      [ "$harden" -lt "$service" ]
    done
  ' _ "$SCRIPT_DIR"

  [ "$status" -eq 0 ]
}

@test "stage_collector_artifact: fails if offline file doesn't exist" {
  # Set OFFLINE_FILE to a non-existent path
  run bash -c '
    source "$1"
    OFFLINE_FILE="/nonexistent/path/file.tar.gz"
    tmpdir="$(mktemp -d)"
    trap "rm -rf \"$tmpdir\"" EXIT
    stage_collector_artifact "$tmpdir" 2>&1 || true
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh" 
  
  # The error message should contain "Offline file not found"
  [[ "$output" == *"Offline file not found"* ]]
}

@test "stage_collector_artifact: rejects offline deb and rpm packages" {
  run bash -c '
    source "$1"
    tmpfile="$(mktemp).deb"
    trap "rm -f \"$tmpfile\"" EXIT
    printf "not a package" > "$tmpfile"
    OFFLINE_FILE="$tmpfile"
    tmpdir="$(mktemp -d)"
    stage_collector_artifact "$tmpdir"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -ne 0 ]
  [[ "$output" == *"Unsupported offline file type"* ]]
  [[ "$output" == *"otelcol-contrib .tar.gz"* ]]
}

@test "stage_collector_artifact: stages offline tarball without mutating package type" {
  run bash -c '
    source "$1"
    tmpfile="$(mktemp).tar.gz"
    tmpdir="$(mktemp -d)"
    trap "rm -f \"$tmpfile\"; rm -rf \"$tmpdir\"" EXIT
    printf "not a real tarball" > "$tmpfile"
    OFFLINE_FILE="$tmpfile"
    OS=linux
    ARCH=amd64
    OTELCOL_VERSION=0.152.0
    PKG_TYPE=deb
    stage_collector_artifact "$tmpdir" >/dev/null
    echo "pkg=$PKG_TYPE"
    echo "staged=${STAGED_COLLECTOR_TARBALL#$tmpdir/}"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -eq 0 ]
  [[ "$output" == *"pkg=deb"* ]]
  [[ "$output" == *"staged=otelcol-contrib_0.152.0_linux_amd64.tar.gz"* ]]
}

@test "write_config: writes supervisor config and token-free collector bootstrap" {
  run bash -c '
    source "$1"
    tmpdir="$(mktemp -d)"
    trap "rm -rf \"$tmpdir\"" EXIT
    OS=linux
    TOKEN=fp_opamp_test
    OPAMP_ENDPOINT=wss://example.test/v1/opamp
    COLLECTOR_BIN_PATH="$tmpdir/bin/otelcol"
    SUPERVISOR_CONFIG_DIR="$tmpdir/etc/opampsupervisor"
    SUPERVISOR_CONFIG_FILE="$SUPERVISOR_CONFIG_DIR/config.yaml"
    SUPERVISOR_COLLECTOR_CONFIG_FILE="$SUPERVISOR_CONFIG_DIR/collector.yaml"
    SUPERVISOR_STATE_DIR="$tmpdir/var/lib/opampsupervisor"
    SUPERVISOR_LOG_DIR="$tmpdir/var/log/opampsupervisor"
    SUDO=()
    write_config >/dev/null
    printf "%s\n" "--- supervisor ---"
    cat "$SUPERVISOR_CONFIG_FILE"
    printf "%s\n" "--- collector ---"
    cat "$SUPERVISOR_COLLECTOR_CONFIG_FILE"
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"

  [ "$status" -eq 0 ]
  [[ "$output" == *"endpoint: wss://example.test/v1/opamp"* ]]
  [[ "$output" == *"Bearer fp_opamp_test"* ]]
  [[ "$output" == *"executable:"*"bin/otelcol"* ]]
  [[ "$output" == *"config_files:"* ]]
  [[ "$output" == *"receivers:"* ]]
  [[ "$output" != *"extensions:"* ]]
}

# ─── Help Text Test ────────────────────────────────────────────────────

@test "parse_args: shows help with --help" {
  run bash -c '
    source "$1"
    parse_args --help
  ' _ "$SCRIPT_DIR/apps/installer/src/install-lib.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"O11yFleet OpenTelemetry Supervisor Installer"* ]]
  [[ "$output" == *"--token"* ]]
  [[ "$output" == *"--offline"* ]]
}
