# O11yFleet Collector Installer (Windows)
# Usage: iwr https://install.o11yfleet.com/install.ps1 -useb | iex
# Or:    powershell -ExecutionPolicy Bypass -File install.ps1 -Token <TOKEN>

param(
    [string]$Token = "",
    [string]$Version = "0.151.0",
    [string]$Endpoint = "wss://api.o11yfleet.com/v1/opamp",
    [string]$InstallDir = "$env:ProgramFiles\O11yFleet",
    [switch]$Uninstall,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Info { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-OK { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }

# Detect architecture
$Arch = $env:PROCESSOR_ARCHITECTURE
if ($Arch -eq "AMD64") { $Arch = "amd64" }
elseif ($Arch -eq "ARM64") { $Arch = "arm64" }
else { Write-Fail "Unsupported architecture: $Arch" }

$OS = "windows"
$Tarball = "otelcol-contrib_${Version}_${OS}_${Arch}.tar.gz"
$Url = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${Version}/${Tarball}"
$ChecksumUrl = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${Version}/opentelemetry-collector-releases_otelcol-contrib_checksums.txt"

Write-Host ""
Write-Host "  O11yFleet Collector Installer" -ForegroundColor Cyan
Write-Host "  ------------------------------"
Write-Host ""

Write-Info "Detected: windows/$Arch"

if ($Uninstall) {
    Write-Info "Uninstalling O11yFleet collector..."
    $Service = Get-Service -Name "O11yFleetCollector" -ErrorAction SilentlyContinue
    if ($Service) {
        Stop-Service -Name "O11yFleetCollector" -Force
        sc.exe delete "O11yFleetCollector" | Out-Null
    }
    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
    }
    Write-OK "O11yFleet collector uninstalled."
    exit 0
}

if ([string]::IsNullOrEmpty($Token) -and -not $DryRun) {
    Write-Fail "Enrollment token required. Usage: install.ps1 -Token fp_enroll_..."
}

if ($Token -and -not $Token.StartsWith("fp_enroll_")) {
    Write-Warn "Token doesn't start with fp_enroll_ -- are you sure this is an enrollment token?"
}

if ($DryRun) {
    Write-Info "Dry run mode -- downloading and verifying only"
}

# Download
Write-Info "Downloading otelcol-contrib v${Version} for windows/${Arch}..."

$TempDir = [System.IO.Path]::GetTempPath()
$TempFile = Join-Path $TempDir $Tarball
$TempExtractDir = Join-Path $TempDir "o11y-extract-$(Get-Random)"

try {
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $Url -OutFile $TempFile -UseBasicParsing

    # Checksum verification
    Write-Info "Verifying checksum..."
    $ChecksumFile = Invoke-WebRequest -Uri $ChecksumUrl -UseBasicParsing -OutFile "$TempDir.checksums.txt"
    $Checksums = Get-Content "$TempDir.checksums.txt" -Raw

    $ExpectedHash = ($Checksums -split "`n" | ForEach-Object {
        if ($_ -match "^\s*([a-f0-9]{64})\s+$([regex]::Escape($Tarball))$") {
            $matches[1]
        }
    }) | Select-Object -First 1

    if ([string]::IsNullOrEmpty($ExpectedHash)) {
        Write-Fail "Checksum for ${Tarball} not found in checksums.txt"
    }

    # Verify downloaded file hash
    $DownloadedHash = (Get-FileHash -Path $TempFile -Algorithm SHA256).Hash.ToLower()
    if ($DownloadedHash -ne $ExpectedHash) {
        Write-Fail "Checksum mismatch! Expected $ExpectedHash, got $DownloadedHash"
    }
    Write-OK "Checksum verified"

    # Extract
    Write-Info "Extracting..."
    New-Item -ItemType Directory -Path $TempExtractDir -Force | Out-Null
    tar -xzf $TempFile -C $TempExtractDir

    $Binary = Join-Path $TempExtractDir "otelcol-contrib.exe"
    if (-not (Test-Path $Binary)) {
        $Binary = Get-ChildItem $TempExtractDir -Filter "*.exe" | Select-Object -First 1 | ForEach-Object { $_.FullName }
    }

    if ($DryRun) {
        Write-Info "Dry run: binary would be installed to $InstallDir\bin\"
        & $Binary --version 2>&1 | ForEach-Object { Write-Host $_ }
        Write-OK "Dry run complete."
        return
    }

    # Install
    $BinDir = Join-Path $InstallDir "bin"
    $ConfigDir = Join-Path $InstallDir "config"
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

    Copy-Item $Binary "$BinDir\otelcol-contrib.exe" -Force
    Write-OK "Installed to $BinDir"

    # Write config
    $ConfigFile = Join-Path $ConfigDir "otelcol.yaml"
    $InstanceUidFile = Join-Path $InstallDir "instance-uid"

    if (Test-Path $InstanceUidFile) {
        $InstanceUid = Get-Content $InstanceUidFile -Raw
    } else {
        $InstanceUid = [guid]::NewGuid().ToString("N").Substring(0, 32)
        $InstanceUid | Set-Content $InstanceUidFile
    }

    $Config = @"
# O11yFleet managed collector configuration
extensions:
  opamp:
    server:
      ws:
        endpoint: ${Endpoint}
    instance_uid: ${InstanceUid}
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

    $Config | Set-Content $ConfigFile -Encoding UTF8
    Write-OK "Config written to $ConfigFile"

    Write-Host ""
    Write-OK "O11yFleet collector installed!"
    Write-Host ""
    Write-Info "Start the collector:"
    Write-Host "  $BinDir\otelcol-contrib.exe --config $ConfigFile"
    Write-Host ""
    Write-Info "Uninstall:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File $PSCommandPath -Uninstall"

}
finally {
    $ProgressPreference = "Continue"
    Remove-Item $TempFile -ErrorAction SilentlyContinue
    Remove-Item "$TempDir.checksums.txt" -ErrorAction SilentlyContinue
    Remove-Item $TempExtractDir -Recurse -ErrorAction SilentlyContinue
}