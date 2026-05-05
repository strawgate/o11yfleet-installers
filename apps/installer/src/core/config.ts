/**
 * Pure config generation and validation utilities.
 * No side effects - all inputs and outputs are deterministic.
 */

import type { OTelConfig, ServiceConfig, OS } from "./types.js";

const OTEL_VERSION = "0.114.0";

/**
 * Generate the OTel collector YAML configuration.
 */
export function generateOtelConfig(config: OTelConfig): string {
  // OTel 0.151.0+ format with headers under server.ws
  return `# O11yFleet managed collector configuration
# This collector connects to O11yFleet via OpAMP for remote management.
# The server will push pipeline configuration updates automatically.

extensions:
  opamp:
    server:
      ws:
        endpoint: ${config.endpoint}
        headers:
          Authorization: "Bearer ${config.token}"
    instance_uid: ${config.instanceUid}
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

processors:
  batch:
    timeout: 10s

exporters:
  debug:
    verbosity: basic

service:
  extensions: [opamp]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
`;
}

/**
 * Validate enrollment token format.
 * Tokens should start with 'fp_enroll_'.
 */
export function validateToken(token: string | undefined): boolean {
  if (!token || typeof token !== "string") {
    return false;
  }
  return token.startsWith("fp_enroll_");
}

/**
 * Generate a warning message for invalid token format.
 */
export function getTokenWarning(token: string | undefined): string | null {
  if (!token) {
    return null;
  }
  if (!token.startsWith("fp_enroll_")) {
    return "Token doesn't start with 'fp_enroll_' — are you sure this is an enrollment token?";
  }
  return null;
}

/**
 * Generate systemd service unit content for Linux.
 */
export function generateSystemdUnit(config: ServiceConfig): string {
  return `[Unit]
Description=${config.displayName}
Documentation=https://o11yfleet.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${config.user}
Group=${config.group}
Environment=INSTANCE_UID=${config.installDir}
ExecStart=${config.execStart}
Restart=always
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${config.installDir}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Generate launchd plist content for macOS.
 */
export function generateLaunchdPlist(config: ServiceConfig): string {
  const installDirEscaped = config.installDir.replace(/\//g, "\\/");
  const execStartEscaped = config.execStart.replace(/\//g, "\\/");
  const configFileEscaped = config.configFile.replace(/\//g, "\\/");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${config.name}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execStartEscaped}</string>
    <string>--config</string>
    <string>${configFileEscaped}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${config.logFile}</string>
  <key>StandardErrorPath</key>
  <string>${config.logFile}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>INSTANCE_UID</key>
    <string>${installDirEscaped}</string>
  </dict>
</dict>
</plist>
`;
}

/**
 * Generate Windows service configuration.
 */
export function generateWindowsServiceConfig(config: ServiceConfig): string {
  return `[Service]
Description=${config.displayName}
Executable=${config.execStart}
Args=--config "${config.configFile}"
DisplayName=${config.displayName}
StartType=auto
`;
}

/**
 * Build service configuration for the current platform.
 */
export function buildServiceConfig(
  installDir: string,
  configFile: string,
  logFile: string,
  os: OS,
): ServiceConfig {
  const binPath =
    os === "windows"
      ? `${installDir}\\bin\\otelcol-contrib.exe`
      : `${installDir}/bin/otelcol-contrib`;

  const serviceName =
    os === "windows"
      ? "o11yfleet-collector"
      : os === "darwin"
        ? "com.o11yfleet.collector"
        : "o11yfleet-collector";

  return {
    name: serviceName,
    displayName: "O11yFleet Collector",
    description: "O11yFleet Collector (otelcol-contrib + OpAMP)",
    execStart: binPath,
    user: "o11yfleet",
    group: "o11yfleet",
    installDir,
    configFile,
    logFile,
  };
}

/**
 * Get the OTel version constant.
 */
export function getOtelVersion(): string {
  return OTEL_VERSION;
}

/**
 * Generate default config for enrollment.
 */
export function createDefaultConfig(
  token: string,
  endpoint: string,
  instanceUid: string,
): OTelConfig {
  return {
    token,
    endpoint,
    instanceUid,
    version: OTEL_VERSION,
  };
}

/**
 * Check if we should preserve existing config during upgrade.
 */
export function shouldPreserveConfig(isUpgrade: boolean, force?: boolean): boolean {
  return isUpgrade && !force;
}
