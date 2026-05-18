# O11yFleet Collector Installer for Windows
#
# Usage (download then run - required for param() to work):
#   irm https://downloads.prod.o11yfleet.com/install.ps1 -OutFile install.ps1; .\install.ps1 -Token "fp_opamp_..."
#
# One-liner via scriptblock wrapper:
#   & ([scriptblock]::Create((irm https://downloads.prod.o11yfleet.com/install.ps1))) -Token "fp_opamp_..."
#
# The enrollment token may also be supplied via the O11Y_TOKEN environment
# variable instead of -Token (keeps it out of shell history).
#
# Uninstall:
#   .\install.ps1 -Uninstall
#
# Installs otelcol-contrib with OpAMP extension configured to connect to O11yFleet.
# Requires: Windows 10+ (amd64/arm64), Administrator privileges

param(
    [string]$Token,

    [string]$Version = "0.152.0",
    [string]$Endpoint = "wss://opamp.prod.o11yfleet.com/v1/opamp",
    [string]$InstallDir = "C:\o11yfleet",
    [switch]$Uninstall,
    [switch]$SkipChecksum
)

$ErrorActionPreference = "Stop"

# Fix #1: Enforce TLS 1.2+ - Windows PowerShell 5.1 defaults to TLS 1.0/1.1 which GitHub rejects
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$UseColor = [string]::IsNullOrEmpty($env:NO_COLOR)
function Write-Color { param($Prefix, $Color)
    if ($UseColor) { Write-Host "$Prefix $args" -ForegroundColor $Color }
    else { Write-Host "$Prefix $args" }
}
function Write-Info  { Write-Color "  ->" Cyan @args }
function Write-Ok    { Write-Color "  OK" Green @args }
function Write-Warn  { Write-Color "  ! " Yellow @args }
function Write-Fail  { Write-Color "  X " Red @args; exit 1 }

# Hardened download: enforce a timeout and retry transient failures with
# backoff. Windows PowerShell 5.1 lacks Invoke-WebRequest -MaximumRetryCount,
# so the retry loop is explicit for 5.1/7 compatibility.
function Invoke-Download {
    param([string]$Uri, [string]$OutFile)
    $max = 3
    for ($i = 1; $i -le $max; $i++) {
        try {
            Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec 60
            return
        } catch {
            if ($i -eq $max) { throw }
            Write-Warn "Download attempt $i/$max failed: $($_.Exception.Message). Retrying..."
            Start-Sleep -Seconds ([math]::Min(2 * $i, 10))
        }
    }
}

# Fail-closed SHA-256 verification against the upstream checksums file.
# Refuses to install an unverified binary unless -SkipChecksum is given.
function Test-Checksum {
    param([string]$File, [string]$ChecksumsUrl, [string]$AssetName)
    if ($SkipChecksum) {
        Write-Warn "Checksum verification disabled via -SkipChecksum (NOT recommended)"
        return
    }
    $checksumsFile = "$File.checksums.txt"
    try {
        Invoke-Download $ChecksumsUrl $checksumsFile
    } catch {
        Write-Fail "Could not download checksums.txt from $ChecksumsUrl - refusing to install an unverified binary. Re-run with -SkipChecksum to override (NOT recommended)."
    }
    $expected = $null
    foreach ($line in Get-Content $checksumsFile) {
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -ge 2 -and $parts[-1] -eq $AssetName) { $expected = $parts[0]; break }
    }
    if (-not $expected) {
        Write-Fail "Checksum for $AssetName not found in checksums.txt"
    }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $File).Hash
    if ($actual.ToLower() -ne $expected.ToLower()) {
        Write-Fail ("Checksum mismatch for $AssetName - refusing to install a corrupted or tampered download.`n" +
            "  expected: $expected`n  actual:   $actual")
    }
    Write-Ok "Checksum verified"
}

# --- Check admin -------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Fail "This script requires Administrator privileges. Right-click PowerShell -> Run as Administrator."
}

# --- Uninstall ---------------------------------------------------------
if ($Uninstall) {
    Write-Info "Uninstalling O11yFleet collector..."
    $svc = Get-Service -Name "o11yfleet-collector" -ErrorAction SilentlyContinue
    if ($svc) {
        Stop-Service "o11yfleet-collector" -Force -ErrorAction SilentlyContinue
        sc.exe delete "o11yfleet-collector" | Out-Null
    }
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    Write-Ok "O11yFleet collector uninstalled."
    exit 0
}

# --- Validate token (required for install, not for uninstall) ---------
# Fall back to the O11Y_TOKEN env var so the token need not be on the
# command line; an explicit -Token still takes precedence.
if ([string]::IsNullOrWhiteSpace($Token) -and -not [string]::IsNullOrWhiteSpace($env:O11Y_TOKEN)) {
    $Token = $env:O11Y_TOKEN
}
if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Fail ("Token is required for installation.`n" +
        "  Usage: .\install.ps1 -Token `"fp_opamp_...`"`n" +
        "  Or:    `$env:O11Y_TOKEN = `"fp_opamp_...`"; .\install.ps1`n" +
        "  Or:    & ([scriptblock]::Create((irm https://downloads.prod.o11yfleet.com/install.ps1))) -Token `"fp_opamp_...`"")
}
if (-not $Token.StartsWith("fp_enroll_")) {
    if (-not $Token.StartsWith("fp_opamp_")) {
        Write-Warn "Token doesn't start with fp_enroll_ or fp_opamp_ - are you sure this is an enrollment token?"
    }
}

foreach ($serviceName in @("otelcol-contrib", "otelcol")) {
    $conflictingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($conflictingService) {
        Write-Fail "Existing OpenTelemetry Collector service detected: $serviceName. Refusing to install O11yFleet alongside another collector service. Stop and uninstall that service first, then rerun this installer."
    }
}

Write-Host ""
Write-Host "  O11yFleet Collector Installer" -ForegroundColor Cyan
Write-Host "  ------------------------------"
Write-Host ""

# --- Detect architecture ----------------------------------------------
$osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
switch ($osArch) {
    "X64"   { $arch = "amd64" }
    "Arm64" { $arch = "arm64" }
    default {
        if ([Environment]::Is64BitOperatingSystem) { $arch = "amd64" }
        else { Write-Fail "32-bit Windows is not supported." }
    }
}

# --- Check for existing install (idempotent upgrade) ------------------
$isUpgrade = Test-Path "$InstallDir\bin\otelcol-contrib.exe"
if ($isUpgrade) {
    Write-Info "Existing installation detected - upgrading binary, preserving config."
}

# --- Validate version -------------------------------------------------
# $Version is interpolated into the upstream download/checksum URLs; reject
# anything that isn't a bare semver so a typo fails clearly, not with a 404.
$Version = $Version -replace '^v', ''
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Fail "Invalid -Version '$Version' - expected semver X.Y.Z (e.g. 0.152.0)"
}

# --- Download & install -----------------------------------------------
$assetName = "otelcol-contrib_${Version}_windows_${arch}.tar.gz"
$url = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${Version}/${assetName}"
$checksumsUrl = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${Version}/opentelemetry-collector-releases_otelcol-contrib_checksums.txt"
$tmpDir = Join-Path $env:TEMP "o11yfleet-install"

try {
    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
    $archive = Join-Path $tmpDir "otelcol-contrib.tar.gz"

    Write-Info "Downloading otelcol-contrib v${Version} for windows/${arch}..."
    try {
        Invoke-Download $url $archive
    } catch {
        Write-Fail "Download failed for otelcol-contrib v${Version} (windows/${arch}). That version or platform may not exist:`n  $url"
    }

    Write-Info "Verifying checksum..."
    Test-Checksum -File $archive -ChecksumsUrl $checksumsUrl -AssetName $assetName

    Write-Info "Extracting..."
    tar -xzf $archive -C $tmpDir

    # --- Install binary -----------------------------------------------
    New-Item -ItemType Directory -Force -Path "$InstallDir\bin" | Out-Null
    New-Item -ItemType Directory -Force -Path "$InstallDir\config" | Out-Null

    # Stop service before replacing binary if upgrading
    if ($isUpgrade) {
        $svc = Get-Service -Name "o11yfleet-collector" -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq "Running") {
            Write-Info "Stopping service for upgrade..."
            Stop-Service "o11yfleet-collector" -Force -ErrorAction SilentlyContinue
        }
    }

    # Atomic install: stage beside the destination then rename into place
    # so an interrupted copy can't leave a half-written executable.
    $binDest = "$InstallDir\bin\otelcol-contrib.exe"
    $binTmp = "$binDest.new"
    Copy-Item "$tmpDir\otelcol-contrib.exe" $binTmp -Force
    Move-Item $binTmp $binDest -Force
    if (-not (Test-Path $binDest)) { Write-Fail "Installed binary missing: $binDest" }
    Write-Ok "Installed otelcol-contrib to $InstallDir\bin\"

} finally {
    # --- Cleanup temp dir regardless of success/failure ---------------
    if (Test-Path $tmpDir) {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }
}

# --- Config (only written on fresh install, preserved on upgrade) -----
$configPath = "$InstallDir\config\otelcol.yaml"
if ($isUpgrade -and (Test-Path $configPath)) {
    Write-Info "Preserving existing config at $configPath"
} else {
    $config = @"
# O11yFleet managed collector configuration
extensions:
  opamp:
    server:
      ws:
        endpoint: ${Endpoint}
        headers:
          Authorization: "Bearer ${Token}"
    capabilities:
      reports_effective_config: true
      reports_health: true

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
  extensions: [opamp]
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
"@
    # Write UTF-8 without BOM (Out-File -Encoding UTF8 adds a BOM on Windows PowerShell)
    [System.IO.File]::WriteAllText($configPath, $config)
    Write-Ok "Config written to $configPath"

    # Restrict config file ACL - contains enrollment token
    $acl = Get-Acl $configPath
    $acl.SetAccessRuleProtection($true, $false)
    $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")
    $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\SYSTEM", "FullControl", "Allow")
    $acl.AddAccessRule($adminRule)
    $acl.AddAccessRule($systemRule)
    Set-Acl $configPath $acl
    Write-Ok "Config file permissions restricted to Administrators and SYSTEM."
}

# --- Windows Service --------------------------------------------------
# NOTE: Service runs as LocalSystem. This is intentional - the collector needs
# system-level access for metrics collection. Could be hardened with a dedicated
# service account (e.g., NT SERVICE\o11yfleet-collector) in a future iteration.
$svcExists = Get-Service -Name "o11yfleet-collector" -ErrorAction SilentlyContinue
$binPath = "`"$InstallDir\bin\otelcol-contrib.exe`" --config `"$InstallDir\config\otelcol.yaml`""

if (-not $svcExists) {
    Write-Info "Installing Windows service..."
    sc.exe create "o11yfleet-collector" binPath= $binPath start= delayed-auto DisplayName= "O11yFleet Collector" | Out-Null
    sc.exe description "o11yfleet-collector" "O11yFleet Collector (otelcol-contrib + OpAMP)" | Out-Null
    sc.exe failure "o11yfleet-collector" reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
} else {
    Write-Info "Updating existing service configuration..."
    sc.exe config "o11yfleet-collector" binPath= $binPath start= delayed-auto | Out-Null
    sc.exe failure "o11yfleet-collector" reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
}

Start-Service "o11yfleet-collector"
Write-Ok "Service started: o11yfleet-collector"

Write-Host ""
Write-Ok "O11yFleet collector is running!"
Write-Host ""
Write-Info "The collector will appear in your dashboard within a few seconds."
Write-Info "View service status: Get-Service o11yfleet-collector"
Write-Info "View logs: Get-WinEvent -LogName Application -FilterXPath '*[System[Provider[@Name=""o11yfleet-collector""]]]' -MaxEvents 50"
Write-Info "Uninstall: .\install.ps1 -Uninstall"
Write-Host ""
