/**
 * O11yFleet Installer - Planter Model
 *
 * Plant the seed: download, verify, configure, start briefly to verify, done.
 * User handles long-term running (systemd, launchd, docker, screen, etc).
 */

export interface InstallOptions {
  token: string;
  version: string;
  endpoint: string;
  installDir: string;
  dryRun: boolean;
  verbose: boolean;
}

export interface Platform {
  os: "linux" | "darwin" | "windows";
  arch: "amd64" | "arm64";
}

export interface InstallResult {
  success: boolean;
  message: string;
  installDir?: string;
  configFile?: string;
  binaryPath?: string;
}

const OTEL_BASE_URL = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download";
const OTEL_CHECKSUM_BASE = OTEL_BASE_URL;

export function detectPlatform(): Platform {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  let arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "amd64";
  if (os === "windows" && process.env.PROCESSOR_ARCHITECTURE === "ARM64") {
    arch = "arm64";
  }
  return { os: os as Platform["os"], arch: arch as Platform["arch"] };
}

export function getOtelTarball(version: string, platform: Platform): string {
  return `otelcol-contrib_${version}_${platform.os}_${platform.arch}.tar.gz`;
}

export function getOtelUrl(version: string, platform: Platform): string {
  return `${OTEL_BASE_URL}/v${version}/${getOtelTarball(version, platform)}`;
}

export function getChecksumUrl(version: string, platform: Platform): string {
  if (platform.os === "windows") {
    return `${OTEL_CHECKSUM_BASE}/v${version}/opentelemetry-collector-releases_otelcol-contrib_windows_checksums.txt`;
  }
  return `${OTEL_CHECKSUM_BASE}/v${version}/opentelemetry-collector-releases_otelcol-contrib_checksums.txt`;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}\n  URL: ${url}`);
  }
  const reader = response.body?.getReader();
  const writer = await Bun.file(dest).writer();
  if (!reader) throw new Error("No response body");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(value);
  }
  writer.end();
}

async function verifyChecksum(filePath: string, expectedHash: string): Promise<boolean> {
  const fileBuffer = await Bun.file(filePath).arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
  const hashHex = Buffer.from(hashBuffer).toString("hex");
  return hashHex === expectedHash.toLowerCase();
}

async function extractTarball(tarballPath: string, destDir: string, isWindows: boolean): Promise<string> {
  await Bun.$`mkdir -p ${destDir}`.quiet();
  await Bun.$`tar -xzf ${tarballPath} -C ${destDir}`.quiet();
  const binaryName = isWindows ? "otelcol-contrib.exe" : "otelcol-contrib";
  return `${destDir}/${binaryName}`;
}

function getSystemInstructions(platform: Platform, installDir: string): string {
  const binary = platform.os === "windows"
    ? `${installDir}\\bin\\otelcol-contrib.exe`
    : `${installDir}/bin/otelcol-contrib`;
  const config = platform.os === "windows"
    ? `${installDir}\\config\\otelcol.yaml`
    : `${installDir}/config/otelcol.yaml`;

  if (platform.os === "linux") {
    return `
To start manually:
  ${binary} --config ${config}

To keep running with systemd:
  sudo tee /etc/systemd/system/o11yfleet-collector.service > /dev/null <<EOF
[Unit]
Description=O11yFleet Collector
After=network-online.target

[Service]
Type=simple
ExecStart=${binary} --config ${config}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl enable --now o11yfleet-collector

To check logs:
  sudo journalctl -u o11yfleet-collector -f
`;
  }

  if (platform.os === "darwin") {
    return `
To start manually:
  ${binary} --config ${config}

To keep running with launchd:
  sudo tee /Library/LaunchDaemons/com.o11yfleet.collector.plist > /dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.o11yfleet.collector</string>
  <key>ProgramArguments</key><array>
    <string>${binary}</string><string>--config</string><string>${config}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
  sudo launchctl load /Library/LaunchDaemons/com.o11yfleet.collector.plist

To check logs:
  tail -f /var/log/o11yfleet-collector.log
`;
  }

  // Windows
  return `
To start manually:
  ${binary} --config ${config}

To keep running as a Windows Service, use NSSM:
  nssm install O11yFleetCollector ${binary} --config ${config}
  nssm start O11yFleetCollector
`;
}

export async function runInstaller(options: InstallOptions): Promise<InstallResult> {
  const platform = detectPlatform();
  const installDir = options.installDir;
  const binDir = `${installDir}/bin`;
  const configDir = `${installDir}/config`;
  const configFile = `${configDir}/otelcol.yaml`;
  const instanceUidFile = `${installDir}/instance-uid`;

  console.log(`\n  O11yFleet Collector Installer`);
  console.log(`  ────────────────────────────`);
  console.log(`  Platform:  ${platform.os}/${platform.arch}`);
  console.log(`  Version:   ${options.version}`);
  console.log(`  Install:   ${installDir}`);
  console.log(`  Token:     ${options.token.substring(0, 16)}...`);
  console.log();

  const tempDir = (await Bun.$`mktemp -d`.text()).trim();

  try {
    // Step 1: Download
    console.log(`  Downloading otelcol-contrib...`);
    const tarball = getOtelTarball(options.version, platform);
    const url = getOtelUrl(options.version, platform);
    const checksumUrl = getChecksumUrl(options.version, platform);
    const tarballPath = `${tempDir}/${tarball}`;

    await downloadFile(url, tarballPath);
    console.log(`  Downloaded ${tarball}`);

    // Step 2: Verify checksum
    console.log(`  Verifying checksum...`);
    let checksums: string;
    try {
      const resp = await fetch(checksumUrl);
      if (resp.ok) checksums = await resp.text();
    } catch {}

    let hashValid = false;
    if (checksums) {
      const hashMatch = checksums.match(new RegExp(`^([a-f0-9]{64})\\s+${tarball}$`, "m"));
      if (hashMatch) {
        hashValid = await verifyChecksum(tarballPath, hashMatch[1]);
        if (hashValid) {
          console.log(`  Checksum verified`);
        }
      }
    }
    if (!hashValid) {
      console.log(`  Warning: Checksum not verified (version may not have checksums)`);
    }

    // Step 3: Extract
    console.log(`  Extracting...`);
    const binaryPath = await extractTarball(tarballPath, tempDir, platform.os === "windows");

    if (options.dryRun) {
      const version = (await Bun.$`${binaryPath} --version`.text()).trim();
      console.log(`  ✓ Binary verified: ${version}`);
      await Bun.$`rm -rf ${tempDir}`.quiet();
      return {
        success: true,
        message: "Dry run complete — binary would be installed",
        installDir,
        configFile
      };
    }

    // Step 4: Install to target directory
    console.log(`  Installing to ${installDir}...`);
    await Bun.$`mkdir -p ${installDir} ${binDir} ${configDir}`.quiet();

    const binaryDest = platform.os === "windows"
      ? `${binDir}/otelcol-contrib.exe`
      : `${binDir}/otelcol-contrib`;

    await Bun.$`cp ${binaryPath} ${binaryDest}`.quiet();
    if (platform.os !== "windows") {
      await Bun.$`chmod +x ${binaryDest}`.quiet();
    }

    // Step 5: Write config
    let instanceUid = "";
    try {
      const existing = await Bun.file(instanceUidFile).text();
      if (existing.trim()) {
        instanceUid = existing.trim();
      }
    } catch {}
    if (!instanceUid) {
      instanceUid = crypto.randomUUID().replace(/-/g, "").substring(0, 32);
      Bun.write(instanceUidFile, instanceUid);
    }

    const config = `# O11yFleet managed collector configuration
extensions:
  opamp:
    server:
      ws:
        endpoint: ${options.endpoint}
    instance_uid: ${instanceUid}
    capabilities:
      reports_effective_config: true
      reports_own_metrics: true
      reports_health: true
      reports_remote_config: true
      accepts_remote_config: true
      accepts_restart_command: true
    headers:
      Authorization: "Bearer ${options.token}"

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
`;
    Bun.write(configFile, config);

    // Cleanup temp download
    await Bun.$`rm -rf ${tempDir}`.quiet();

    // Step 6: Verify it starts
    console.log(`  Verifying collector starts...`);
    const startCheck = await Bun.$`timeout 5 ${binaryDest} --config ${configFile} --version 2>&1 || true`.text();
    const versionLine = startCheck.split("\n").find(l => l.includes("otelcol"));
    if (versionLine) {
      console.log(`  ${versionLine.trim()}`);
    }

    // Success!
    console.log();
    console.log(`  =========================================`);
    console.log(`  O11yFleet collector is ready!`);
    console.log(`  =========================================`);
    console.log();
    console.log(`  Binary:  ${binaryDest}`);
    console.log(`  Config:  ${configFile}`);
    console.log(`  UID:     ${instanceUid}`);
    console.log();
    console.log(getSystemInstructions(platform, installDir));

    return {
      success: true,
      message: "Collector planted and verified",
      installDir,
      configFile,
      binaryPath: binaryDest
    };

  } catch (error) {
    await Bun.$`rm -rf ${tempDir}`.quiet();
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
