# O11yFleet Collector Installer for Windows
#
# Usage (download then run — required for param() to work):
#   irm https://o11yfleet.com/install.ps1 -OutFile install.ps1; .\install.ps1 -Token "fp_enroll_..."
#
# One-liner via scriptblock wrapper:
#   & ([scriptblock]::Create((irm https://o11yfleet.com/install.ps1))) -Token "fp_enroll_..."
#
# Uninstall:
#   .\install.ps1 -Uninstall
#
# Installs otelcol-contrib with OpAMP extension configured to connect to O11yFleet.
# Requires: Windows 10+ (amd64/arm64), Administrator privileges

param(
    [string]$Token,

    [string]$Version = "0.115.0",
    [string]$Endpoint = "wss://api.o11yfleet.com/v1/opamp",
    [string]$InstallDir = "C:\o11yfleet",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Fix #1: Enforce TLS 1.2+ — Windows PowerShell 5.1 defaults to TLS 1.0/1.1 which GitHub rejects
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Info  { Write-Host "  -> $args" -ForegroundColor Cyan }
function Write-Ok    { Write-Host "  OK $args" -ForegroundColor Green }
function Write-Warn  { Write-Host "  !  $args" -ForegroundColor Yellow }
function Write-Fail  { Write-Host "  X  $args" -ForegroundColor Red; exit 1 }

# ─── Check admin ───────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Fail "This script requires Administrator privileges. Right-click PowerShell → Run as Administrator."
}

# ─── Uninstall ─────────────────────────────────────────────────────────
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

# ─── Validate token (required for install, not for uninstall) ─────────
if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Fail ("Token is required for installation.`n" +
        "  Usage: .\install.ps1 -Token `"fp_enroll_...`"`n" +
        "  Or:    & ([scriptblock]::Create((irm https://o11yfleet.com/install.ps1))) -Token `"fp_enroll_...`"")
}
if (-not $Token.StartsWith("fp_enroll_")) {
    Write-Warn "Token doesn't start with fp_enroll_ — are you sure this is an enrollment token?"
}

Write-Host ""
Write-Host "  O11yFleet Collector Installer" -ForegroundColor Cyan
Write-Host "  ──────────────────────────────"
Write-Host ""

# ─── Detect architecture ──────────────────────────────────────────────
$osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
switch ($osArch) {
    "X64"   { $arch = "amd64" }
    "Arm64" { $arch = "arm64" }
    default {
        if ([Environment]::Is64BitOperatingSystem) { $arch = "amd64" }
        else { Write-Fail "32-bit Windows is not supported." }
    }
}

# ─── Check for existing install (idempotent upgrade) ──────────────────
$isUpgrade = Test-Path "$InstallDir\bin\otelcol-contrib.exe"
if ($isUpgrade) {
    Write-Info "Existing installation detected — upgrading binary, preserving config."
}

# ─── Download & install ───────────────────────────────────────────────
$url = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${Version}/otelcol-contrib_${Version}_windows_${arch}.tar.gz"
$tmpDir = Join-Path $env:TEMP "o11yfleet-install"

try {
    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
    $archive = Join-Path $tmpDir "otelcol-contrib.tar.gz"

    Write-Info "Downloading otelcol-contrib v${Version} for windows/${arch}..."
    try {
        Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
    } catch {
        Write-Fail "Download failed: $_"
    }

    Write-Info "Extracting..."
    tar -xzf $archive -C $tmpDir

    # ─── Install binary ───────────────────────────────────────────────
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

    Copy-Item "$tmpDir\otelcol-contrib.exe" "$InstallDir\bin\otelcol-contrib.exe" -Force
    Write-Ok "Installed otelcol-contrib to $InstallDir\bin\"

} finally {
    # ─── Cleanup temp dir regardless of success/failure ───────────────
    if (Test-Path $tmpDir) {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }
}

# ─── Instance UID (persist across re-installs) ────────────────────────
$uidPath = Join-Path $InstallDir "instance-uid"
if (Test-Path $uidPath) {
    $uid = (Get-Content $uidPath -Raw).Trim()
    Write-Info "Reusing existing instance UID."
} else {
    $uid = [guid]::NewGuid().ToString("N").Substring(0,32)
    [System.IO.File]::WriteAllText($uidPath, $uid)
    Write-Info "Generated new instance UID."
}

# ─── Config (only written on fresh install, preserved on upgrade) ─────
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
    instance_uid: ${uid}
    capabilities:
      reports_effective_config: true
      reports_own_metrics: true
      reports_health: true
      reports_remote_config: true
      accepts_remote_config: true
      accepts_restart_command: true
    headers:
      Authorization: "Bearer ${Token}"

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

    # Restrict config file ACL — contains enrollment token
    $acl = Get-Acl $configPath
    $acl.SetAccessRuleProtection($true, $false)
    $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")
    $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\SYSTEM", "FullControl", "Allow")
    $acl.AddAccessRule($adminRule)
    $acl.AddAccessRule($systemRule)
    Set-Acl $configPath $acl
    Write-Ok "Config file permissions restricted to Administrators and SYSTEM."
}

# ─── Windows Service ──────────────────────────────────────────────────
# NOTE: Service runs as LocalSystem. This is intentional — the collector needs
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
