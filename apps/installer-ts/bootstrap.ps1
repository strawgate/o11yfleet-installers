#!/usr/bin/env pwsh
# O11yFleet Installer Bootstrap (Windows)
# Downloads and runs the TypeScript installer

param(
    [string]$Token,
    [string]$Version,
    [string]$Endpoint,
    [string]$InstallDir,
    [switch]$DryRun,
    [switch]$SkipService,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$BunVersion = "1.1.0"
$InstallerVersion = "1.0.0"
$InstallerUrl = "https://releases.o11yfleet.com/installer"

# Colors
function info { Write-Host "▸ $_" -ForegroundColor Cyan }
function ok { Write-Host "✓ $_" -ForegroundColor Green }
function warn { Write-Host "! $_" -ForegroundColor Yellow }
function fail { Write-Host "✗ $_" -ForegroundColor Red; exit 1 }

# Detect platform
$OS = "windows"
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64" } else { "x64" }
info "Detected: $OS/$Arch"

# Find or install Bun
$Bun = $null
if (Get-Command bun -ErrorAction SilentlyContinue) {
    $Bun = (Get-Command bun).Source
    info "Using existing Bun: $Bun"
    & $Bun --version
} else {
    # Check common paths
    $Paths = @(
        "$env:LOCALAPPDATA\bin\bun\bun.exe",
        "$env:ProgramFiles\bun\bin\bun.exe",
        "$env:USERPROFILE\.bun\bin\bun.exe"
    )
    
    foreach ($Path in $Paths) {
        if (Test-Path $Path) {
            $Bun = $Path
            info "Found Bun: $Bun"
            & $Bun --version
            break
        }
    }
}

if (-not $Bun) {
    info "Installing Bun v$BunVersion..."
    
    $TmpDir = Join-Path $env:TEMP "o11y-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null
    
    try {
        $ZipUrl = "https://github.com/oven-sh/bun/releases/download/bun-$BunVersion/bun-windows-$Arch.zip"
        $ZipPath = Join-Path $TmpDir "bun.zip"
        
        info "Downloading Bun from $ZipUrl..."
        Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
        
        info "Extracting Bun..."
        Expand-Archive -Path $ZipPath -DestinationPath $TmpDir -Force
        
        $Bun = Get-ChildItem -Path $TmpDir -Filter "bun.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName
        
        if (-not $Bun) {
            fail "Bun executable not found after extraction"
        }
        
        # Install to local app data
        $InstallDir = Join-Path $env:LOCALAPPDATA "bin\bun"
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Copy-Item $Bun -Destination $InstallDir -Force
        $Bun = Join-Path $InstallDir "bun.exe"
        
        ok "Installed Bun to $Bun"
    }
    finally {
        Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Download installer bundle
info "Downloading installer bundle..."

$BundleUrl = "$InstallerUrl/bundle-$InstallerVersion.js"
$BundlePath = Join-Path $env:TEMP "o11y-bundle-$(Get-Random).js"

try {
    Invoke-WebRequest -Uri $BundleUrl -OutFile $BundlePath -UseBasicParsing
    
    info "Running installer..."
    Write-Host ""
    
    # Build arguments
    $Args = @()
    if ($Token) { $Args += "--token"; $Args += $Token }
    if ($Version) { $Args += "--version"; $Args += $Version }
    if ($Endpoint) { $Args += "--endpoint"; $Args += $Endpoint }
    if ($InstallDir) { $Args += "--dir"; $Args += $InstallDir }
    if ($DryRun) { $Args += "--dry-run" }
    if ($SkipService) { $Args += "--skip-service" }
    if ($Uninstall) { $Args += "--uninstall" }
    
    & $Bun $BundlePath install @Args
}
finally {
    Remove-Item $BundlePath -ErrorAction SilentlyContinue
}
