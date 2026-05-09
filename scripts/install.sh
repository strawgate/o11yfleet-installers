#!/usr/bin/env bash
# O11yFleet Collector Installer
# Usage: curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>
#
# Downloads and runs the portable O11yFleet installer binary.
# Supports: Linux (amd64/arm64), macOS (amd64/arm64), Windows

set -euo pipefail

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
    aarch64|arm64)  ARCH="arm64" ;;
    *)               fail "Unsupported architecture: $ARCH" ;;
  esac
  case "$OS" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    mingw*|msys*) OS="windows" ;;
    *)      fail "Unsupported OS: $OS. Use Linux or macOS." ;;
  esac
  info "Detected: ${OS}/${ARCH}"
}

# ─── Detect Windows ───────────────────────────────────────────────────
is_windows() {
  [ "$OS" = "windows" ]
}

# ─── Download portable binary ─────────────────────────────────────────
download_binary() {
  local version="${1:-latest}"
  local ext=""
  if is_windows; then ext=".exe"; fi
  local binary_name="o11yinstaller-${OS}-${ARCH}${ext}"
  local url="https://github.com/strawgate/o11yfleet-installers/releases/${version}/download/${binary_name}"

  info "Downloading O11yFleet installer ${version} for ${OS}/${ARCH}..."

  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "o11yinstaller${ext}" \
    || fail "Failed to download installer from:\n  $url\n\nThe installer binary may not be available for your platform yet."

  chmod +x "o11yinstaller${ext}"
  ok "Downloaded successfully"

  # Store for later use
  BINARY_NAME="o11yinstaller${ext}"
}

# ─── Main ──────────────────────────────────────────────────────────────
main() {
  local token=""
  local command="install"
  local extra_args=()

  # ─── Parse args ────────────────────────────────────────────────────────
  while [ $# -gt 0 ]; do
    case "$1" in
      --token)
        token="$2"; shift 2 ;;
      --token=*)    token="${1#*=}"; shift ;;
      --uninstall)  command="uninstall"; shift ;;
      --scan)       command="scan"; shift ;;
      --enroll)     command="enroll"; shift ;;
      --help|-h)
        cat <<EOF
O11yFleet Collector Installer

Usage:
  curl --proto '=https' --tlsv1.2 -fsSL https://downloads.o11yfleet.com/install.sh | bash -s -- --token <TOKEN>

Options:
  --token TOKEN       Enrollment token (required for install/enroll)
  --uninstall          Uninstall O11yFleet collector
  --scan              Scan for existing collectors
  --enroll            Enroll an existing collector
  -h, --help          Show this help

Examples:
  # Install with enrollment token
  curl ... | bash -s -- --token fp_enroll_...

  # Scan for existing collectors
  curl ... | bash -s -- --scan

  # Uninstall
  curl ... | bash -s -- --uninstall
EOF
        exit 0 ;;
      *) fail "Unknown option: $1" ;;
    esac
  done

  echo ""
  printf "%s\n" "${CYAN}  O11yFleet Collector Installer${NC}"
  echo "  ──────────────────────────────"
  echo ""

  detect_platform

  # ─── Download the binary ───────────────────────────────────────────────
  download_binary "latest"

  # ─── Run the installer ────────────────────────────────────────────────
  info "Running installer..."
  echo ""

  ./"${BINARY_NAME}" "$command" --token "$token" "${extra_args[@]+"${extra_args[@]}"}"
}

main "$@"