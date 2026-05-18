#!/usr/bin/env bash
# O11yFleet Installer Bootstrap
# Downloads and runs the TypeScript installer
#
# Usage: curl ... | bash
#    or: curl ... -o install.sh && chmod +x install.sh && ./install.sh

set -euo pipefail

# Configuration
BUN_VERSION="${BUN_VERSION:-1.1.0}"
INSTALLER_VERSION="${INSTALLER_VERSION:-1.0.0}"
INSTALLER_URL="${INSTALLER_URL:-https://releases.o11yfleet.com/installer}"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$*"; }
fail()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# Detect OS & arch
detect_platform() {
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64)   ARCH="x64" ;;
    aarch64|arm64)   ARCH="aarch64" ;;
    *)               fail "Unsupported architecture: $ARCH" ;;
  esac
  case "$OS" in
    linux|darwin) ;;
    *)      fail "Unsupported OS: $OS. Use Linux or macOS." ;;
  esac
  info "Detected: ${OS}/${ARCH}"
}

# Find or install Bun
find_bun() {
  if command -v bun >/dev/null 2>&1; then
    BUN="$(command -v bun)"
    info "Using existing Bun: $BUN"
    bun --version
    return 0
  fi

  # Check common installation paths
  local paths=(
    "$HOME/.local/bin/bun"
    "$HOME/.bun/bin/bun"
    "/usr/local/bin/bun"
    "/opt/bun/bin/bun"
  )
  
  for path in "${paths[@]}"; do
    if [ -x "$path" ]; then
      BUN="$path"
      info "Found Bun: $BUN"
      "$BUN" --version
      return 0
    fi
  done
  
  return 1
}

# Install Bun
install_bun() {
  local os="$1"
  local arch="$2"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  
  info "Installing Bun v${BUN_VERSION}..."
  
  local bun_zip="bun-${os}-${arch}.zip"
  local url="https://github.com/oven-sh/bun/releases/download/bun-${BUN_VERSION}/${bun_zip}"
  
  if ! curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "${tmpdir}/${bun_zip}"; then
    fail "Failed to download Bun from $url"
  fi
  
  unzip -o "${tmpdir}/${bun_zip}" -d "${tmpdir}"
  
  # Find the extracted bun executable
  local bun_exe
  bun_exe="$(find "${tmpdir}" -name "bun-${os}-${arch}" -type f -executable 2>/dev/null | head -1)"
  
  if [ -z "$bun_exe" ]; then
    fail "Bun executable not found after extraction"
  fi
  
  # Install to ~/.local/bin
  local install_dir="$HOME/.local/bin"
  mkdir -p "$install_dir"
  cp "$bun_exe" "${install_dir}/bun"
  chmod +x "${install_dir}/bun"
  
  BUN="${install_dir}/bun"
  ok "Installed Bun to $BUN"
}

# Download installer bundle
download_bundle() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  
  info "Downloading installer bundle..."
  
  local bundle_url="${INSTALLER_URL}/bundle-${INSTALLER_VERSION}.js"
  
  if ! curl --proto '=https' --tlsv1.2 -fsSL "$bundle_url" -o "${tmpdir}/bundle.js"; then
    fail "Failed to download installer bundle from $bundle_url"
  fi
  
  echo "${tmpdir}/bundle.js"
}

# Main
main() {
  echo ""
  printf "%s\n" "${CYAN}  O11yFleet Installer${NC}"
  echo "  ─────────────────────"
  echo ""
  
  detect_platform
  
  if ! find_bun; then
    install_bun "$OS" "$ARCH"
  fi
  
  local bundle
  bundle="$(download_bundle)"
  
  info "Running installer..."
  echo ""
  
  exec "$BUN" "$bundle" "$@"
}

main "$@"
