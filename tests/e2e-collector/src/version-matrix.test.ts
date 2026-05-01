/**
 * Multi-version OTel Collector E2E compatibility test.
 *
 * Starts each collector version in Docker, connects to the local worker via
 * OpAMP WebSocket, and validates enrollment, status reporting, heartbeats,
 * and message contents by version.
 *
 * Design goals:
 *   - Detect wire format regressions across collector versions
 *   - Validate our protobuf codec handles all opamp-go variants
 *   - Produce a version compatibility matrix artifact for docs
 *   - Run nightly in CI (matrix strategy, one job per version)
 *
 * Prerequisites:
 *   - Docker daemon running
 *   - Worker running on port 8787 (or set FP_URL)
 *
 * Run:
 *   pnpm vitest run src/version-matrix.test.ts
 *   COLLECTOR_VERSION=0.151.0 pnpm vitest run src/version-matrix.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTOR_VERSIONS, COLLECTOR_IMAGE, type CollectorVersion } from "./versions.js";
import { AgentCapabilities } from "@o11yfleet/core";
import {
  waitForServer,
  createTenant,
  createConfig,
  createEnrollmentToken,
  getConfigStats,
  getAgents,
  settle,
  isDockerAvailable,
  BASE_URL,
} from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MATRIX_DIR = resolve(__dirname, "../docker/matrix");

// Allow running a single version via env var (for CI matrix strategy)
const SINGLE_VERSION = process.env.COLLECTOR_VERSION
  ? validateVersion(process.env.COLLECTOR_VERSION)
  : undefined;

const versionsToTest = SINGLE_VERSION
  ? COLLECTOR_VERSIONS.filter((v) => v.tag === SINGLE_VERSION)
  : COLLECTOR_VERSIONS;

if (versionsToTest.length === 0 && SINGLE_VERSION) {
  throw new Error(
    `Unknown COLLECTOR_VERSION=${SINGLE_VERSION}. ` +
      `Known: ${COLLECTOR_VERSIONS.map((v) => v.tag).join(", ")}`,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Validate a semver-like version string before shell interpolation. */
function validateVersion(v: string): string {
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(v)) {
    throw new Error(`Invalid collector version: ${v}`);
  }
  return v;
}

// Track started containers for global cleanup
const startedContainers: string[] = [];

function containerName(version: CollectorVersion): string {
  return `otelcol-matrix-${version.tag.replace(/\./g, "-")}`;
}

function generateCollectorConfig(token: string, version: CollectorVersion): string {
  const wsEndpoint =
    BASE_URL.replace(/^http/, "ws")
      .replace("localhost", "host.docker.internal")
      .replace("127.0.0.1", "host.docker.internal") + "/v1/opamp";

  // Older opamp extensions (opamp-go < v0.15) have simpler config schema
  const isOlderExtension = ["0.100.0", "0.110.0"].includes(version.tag);

  const capabilitiesBlock = isOlderExtension
    ? ""
    : `    capabilities:
      reports_effective_config: true
      reports_health: true
`;

  return `extensions:
  opamp:
    server:
      ws:
        endpoint: "${wsEndpoint}"
        headers:
          Authorization: "Bearer ${token}"
        tls:
          insecure: true
    instance_uid: ""
${capabilitiesBlock}

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"

processors:
  batch:
    timeout: 1s

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

function startCollector(version: CollectorVersion, configPath: string): void {
  const tag = validateVersion(version.tag);
  const name = containerName(version);
  const image = `${COLLECTOR_IMAGE}:${tag}`;

  // Remove if already exists
  try {
    execSync(`docker rm -f ${name}`, { stdio: "pipe" });
  } catch {
    // ignore
  }

  execSync(
    `docker run -d --name ${name} ` +
      `--add-host host.docker.internal:host-gateway ` +
      `-v ${configPath}:/etc/otelcol/config.yaml:ro ` +
      `${image} --config /etc/otelcol/config.yaml`,
    { stdio: "pipe" },
  );
  startedContainers.push(name);
}

function stopCollector(version: CollectorVersion): void {
  const name = containerName(version);
  try {
    execSync(`docker rm -f ${name}`, { stdio: "pipe" });
  } catch {
    // ignore
  }
  const idx = startedContainers.indexOf(name);
  if (idx >= 0) startedContainers.splice(idx, 1);
}

function getCollectorLogs(version: CollectorVersion): string {
  const name = containerName(version);
  try {
    return execSync(`docker logs ${name} 2>&1`, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return "(no logs)";
  }
}

// ─── Results Collection ─────────────────────────────────────────────────────

interface VersionResult {
  version: string;
  opampGo: string;
  connected: boolean;
  enrolled: boolean;
  healthy: boolean | null;
  hasAgentDescription: boolean;
  hasEffectiveConfig: boolean;
  identifyingAttrsCount: number;
  capabilities: number;
  firstMessageSize: number | null;
  errors: string[];
}

const results: VersionResult[] = [];

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("OTel Collector Version Matrix", () => {
  beforeAll(async () => {
    if (!isDockerAvailable()) {
      throw new Error("Docker is not available. Start Docker Desktop first.");
    }
    await waitForServer();
    mkdirSync(MATRIX_DIR, { recursive: true });
  });

  afterAll(() => {
    // Write results artifact (ensure directory exists even if beforeAll partially failed)
    mkdirSync(MATRIX_DIR, { recursive: true });
    const artifactPath = resolve(MATRIX_DIR, "results.json");
    writeFileSync(artifactPath, JSON.stringify(results, null, 2));

    // Print summary table
    console.log("\n┌─────────────────────────────────────────────────────────┐");
    console.log("│         OTel Collector Version Compatibility Matrix      │");
    console.log("├──────────┬──────────┬────────┬──────────┬───────────────┤");
    console.log("│ Version  │ opamp-go │ Enroll │ Healthy  │ Eff. Config   │");
    console.log("├──────────┼──────────┼────────┼──────────┼───────────────┤");
    for (const r of results) {
      const v = r.version.padEnd(8);
      const og = r.opampGo.padEnd(8);
      const en = r.enrolled ? "  ✅  " : "  ❌  ";
      const he = r.healthy === true ? "   ✅   " : r.healthy === null ? "   ⏳   " : "   ❌   ";
      const ec = r.hasEffectiveConfig ? "     ✅      " : "     ❌      ";
      console.log(`│ ${v} │ ${og} │${en}│${he}│${ec}│`);
    }
    console.log("└──────────┴──────────┴────────┴──────────┴───────────────┘\n");

    // Cleanup matrix dir
    if (existsSync(MATRIX_DIR)) {
      rmSync(MATRIX_DIR, { recursive: true, force: true });
    }

    // Safety net: remove any containers that weren't cleaned up by per-version afterAll
    for (const name of [...startedContainers]) {
      try {
        execSync(`docker rm -f ${name}`, { stdio: "pipe" });
      } catch {
        /* ignore */
      }
    }
    startedContainers.length = 0;
  });

  for (const version of versionsToTest) {
    describe(`v${version.tag} (opamp-go ${version.opampGo})`, () => {
      let configId: string;
      let tenantId: string;

      beforeAll(async () => {
        // Provision isolated tenant + config for this version
        const tenant = await createTenant(`matrix-${version.tag}-${Date.now()}`);
        tenantId = tenant.id;

        const config = await createConfig(tenantId, `collector-${version.tag}`);
        configId = config.id;

        const { token } = await createEnrollmentToken(configId);

        // Write config file for this version
        const configContent = generateCollectorConfig(token, version);
        const configPath = resolve(MATRIX_DIR, `config-${version.tag}.yaml`);
        writeFileSync(configPath, configContent);

        // Start collector container
        startCollector(version, configPath);

        // Wait for connection — older versions may take longer
        await settle(20_000);
      }, 90_000);

      afterAll(() => {
        stopCollector(version);
      });

      it("connects and enrolls", async () => {
        const stats = await getConfigStats(configId);
        const enrolled = stats.total_agents >= 1;

        if (!enrolled) {
          const logs = getCollectorLogs(version);
          console.error(
            `[v${version.tag}] Failed to enroll. Container logs:\n${logs.slice(0, 2000)}`,
          );
        }

        results.push({
          version: version.tag,
          opampGo: version.opampGo,
          connected: stats.active_websockets >= 1,
          enrolled,
          healthy: null,
          hasAgentDescription: false,
          hasEffectiveConfig: false,
          identifyingAttrsCount: 0,
          capabilities: 0,
          firstMessageSize: null,
          errors: enrolled ? [] : ["enrollment_failed"],
        });

        expect(enrolled, "Agent should be enrolled in config DO").toBe(true);
        expect(stats.active_websockets, "WebSocket should be active").toBeGreaterThanOrEqual(1);
      });

      it("reports healthy status with component health tree", async () => {
        const { agents } = await getAgents(configId);
        const agent = agents[0];
        expect(agent, "Agent must exist after enrollment").toBeDefined();

        // Verify top-level healthy flag
        expect(agent?.healthy, "Agent must report healthy=true").toBe(true);

        // Component health map is only available in newer opamp-go versions (v0.18.0+)
        const healthMap = agent?.component_health_map;
        if (version.hasStatusTime) {
          // Newer versions should have a full component health tree
          expect(
            healthMap,
            "component_health_map must be present for opamp-go >= v0.18",
          ).not.toBeNull();
          expect(typeof healthMap, "component_health_map must be an object").toBe("object");

          const mapKeys = Object.keys(healthMap as object);
          const pipelineKeys = mapKeys.filter(
            (k) => k.startsWith("pipeline:") || k === "extensions",
          );
          expect(
            pipelineKeys.length,
            "Must have at least one pipeline or extensions entry in health map",
          ).toBeGreaterThanOrEqual(1);

          // Each pipeline component should have required fields
          for (const key of pipelineKeys) {
            const component = (healthMap as Record<string, unknown>)[key] as Record<
              string,
              unknown
            >;
            expect(component.status, `${key} must have a status field`).toBeDefined();
            expect(typeof component.healthy, `${key}.healthy must be boolean`).toBe("boolean");
            expect(
              component.status_time_unix_nano,
              `${key} should have status_time_unix_nano`,
            ).toBeDefined();
          }
        } else {
          // Older versions may only report top-level healthy (no component tree)
          // Just verify healthy flag was set (already asserted above)
        }

        const result = results.find((r) => r.version === version.tag);
        if (result) result.healthy = true;
      });

      it("reports agent_description with service.name and service.version", async () => {
        const { agents } = await getAgents(configId);
        const agent = agents[0];
        expect(agent, "Agent must exist").toBeDefined();

        let desc = agent?.agent_description;
        if (typeof desc === "string") desc = JSON.parse(desc);

        expect(desc, "agent_description must be present").toBeDefined();
        expect(typeof desc, "agent_description must be an object").toBe("object");

        const identifying = (desc as { identifying_attributes?: Array<{ key: string }> })
          .identifying_attributes;
        expect(identifying, "identifying_attributes must be an array").toBeInstanceOf(Array);
        expect(
          identifying!.length,
          `Must have >= ${version.minIdentifyingAttrs} identifying attributes`,
        ).toBeGreaterThanOrEqual(version.minIdentifyingAttrs);

        // Verify critical attributes are present
        const attrKeys = identifying!.map((a) => a.key);
        expect(attrKeys, "Must include service.name").toContain("service.name");
        expect(attrKeys, "Must include service.version").toContain("service.version");

        // Verify service.name value is "otelcol-contrib"
        const serviceName = identifying!.find((a) => a.key === "service.name");
        const serviceNameValue = (serviceName as { value?: { string_value?: string } })?.value
          ?.string_value;
        expect(serviceNameValue, "service.name must be otelcol-contrib").toBe("otelcol-contrib");

        // Verify service.version starts with the major.minor from our version tag
        // Docker image tags may contain a slightly newer patch version (e.g., 0.120.0 image has 0.120.1 binary)
        const serviceVersion = identifying!.find((a) => a.key === "service.version");
        const serviceVersionValue = (serviceVersion as { value?: { string_value?: string } })?.value
          ?.string_value;
        const expectedMajorMinor = version.tag.split(".").slice(0, 2).join(".");
        expect(
          serviceVersionValue?.startsWith(expectedMajorMinor),
          `service.version must start with ${expectedMajorMinor}, got ${serviceVersionValue}`,
        ).toBe(true);

        // Verify non_identifying_attributes exist (os.type, host.arch, etc.)
        const nonIdentifying = (desc as { non_identifying_attributes?: Array<{ key: string }> })
          .non_identifying_attributes;
        expect(nonIdentifying, "non_identifying_attributes must be present").toBeInstanceOf(Array);
        expect(nonIdentifying!.length, "Must have some non-identifying attributes").toBeGreaterThan(
          0,
        );
        const nonIdKeys = nonIdentifying!.map((a) => a.key);
        expect(nonIdKeys, "Must include os.type").toContain("os.type");

        const result = results.find((r) => r.version === version.tag);
        if (result) {
          result.hasAgentDescription = true;
          result.identifyingAttrsCount = identifying!.length;
        }
      });

      it("reports effective_config with valid YAML content", async () => {
        const { agents } = await getAgents(configId);
        const agent = agents[0];
        expect(agent, "Agent must exist").toBeDefined();

        // API returns effective_config_body (string) and effective_config_hash
        const configBody = agent?.effective_config_body as string | undefined;
        const configHash = agent?.effective_config_hash as string | undefined;

        const hasConfig = !!(configBody && configBody.length > 0);

        const result = results.find((r) => r.version === version.tag);
        if (result) result.hasEffectiveConfig = hasConfig;

        if (version.reportsEffectiveConfig) {
          expect(hasConfig, "effective_config_body must be non-empty").toBe(true);
          expect(configHash, "effective_config_hash must be present").toBeDefined();
          expect(configHash!.length, "effective_config_hash must be a SHA-256 hex string").toBe(64);

          // Verify the config contains our expected pipeline structure
          expect(configBody, "Config must reference otlp receiver").toContain("otlp");
          expect(configBody, "Config must reference debug exporter").toContain("debug");
          expect(configBody, "Config must reference batch processor").toContain("batch");
          expect(configBody, "Config must reference opamp extension").toContain("opamp");

          // Verify it contains pipeline definitions
          expect(configBody, "Config must define service.pipelines").toContain("pipelines");
          expect(configBody, "Config must include traces pipeline").toContain("traces");
          expect(configBody, "Config must include metrics pipeline").toContain("metrics");
        }
      });

      it("maintains persistent WebSocket (no disconnect/reconnect churn)", async () => {
        // Verify agent has valid connection timestamps
        const { agents: agents1 } = await getAgents(configId);
        const agent1 = agents1[0];
        expect(agent1, "Agent must exist").toBeDefined();

        const connectedAt = agent1?.connected_at as number | undefined;
        const lastSeenAt = agent1?.last_seen_at as number | undefined;
        expect(connectedAt, "connected_at must be a timestamp").toBeGreaterThan(0);
        expect(lastSeenAt, "last_seen_at must be a timestamp").toBeGreaterThan(0);
        expect(lastSeenAt! >= connectedAt!, "last_seen_at must be >= connected_at").toBe(true);

        const stats1 = await getConfigStats(configId);
        const gen1 = agent1?.generation as number | undefined;

        await settle(8_000);

        const stats2 = await getConfigStats(configId);
        const { agents: agents2 } = await getAgents(configId);
        const agent2 = agents2[0];

        // No new agents created (would indicate reconnect creating duplicate)
        expect(stats2.total_agents, "Agent count must remain stable").toBe(stats1.total_agents);
        // WebSocket still active
        expect(stats2.active_websockets, "WebSocket must stay active").toBeGreaterThanOrEqual(1);
        // Generation must not increase (no re-enrollment)
        expect(
          agent2?.generation as number,
          "Generation must not increase (no re-enrollment)",
        ).toBe(gen1);
        // last_seen_at must not regress (heartbeat default is 30s so may not advance in 8s)
        const lastSeen2 = agent2?.last_seen_at as number;
        expect(lastSeen2, "last_seen_at must not regress").toBeGreaterThanOrEqual(lastSeenAt!);
        // connected_at must be unchanged (same session, no reconnect)
        expect(
          agent2?.connected_at as number,
          "connected_at must remain unchanged (no reconnect)",
        ).toBe(connectedAt);
      });

      it("reports expected capabilities bitmap", async () => {
        const { agents } = await getAgents(configId);
        const agent = agents[0];
        expect(agent, "Agent must exist").toBeDefined();

        const caps = agent?.capabilities as number;
        expect(typeof caps, "capabilities must be a number").toBe("number");
        expect(caps, "capabilities must be non-zero").toBeGreaterThan(0);

        const result = results.find((r) => r.version === version.tag);
        if (result) result.capabilities = caps;

        // ReportsStatus is always advertised by all opamp-go agents
        expect(
          caps & AgentCapabilities.ReportsStatus,
          `Must have ReportsStatus (0x${AgentCapabilities.ReportsStatus.toString(16)}), got caps=0x${caps.toString(16)}`,
        ).toBe(AgentCapabilities.ReportsStatus);

        // Versions where we configured capabilities should advertise them
        if (version.reportsEffectiveConfig) {
          expect(
            caps & AgentCapabilities.ReportsEffectiveConfig,
            `Must have ReportsEffectiveConfig (0x${AgentCapabilities.ReportsEffectiveConfig.toString(16)}), got caps=0x${caps.toString(16)}`,
          ).toBe(AgentCapabilities.ReportsEffectiveConfig);
        }

        if (version.hasStatusTime) {
          // hasStatusTime correlates with newer opamp-go that supports ReportsHealth config
          expect(
            caps & AgentCapabilities.ReportsHealth,
            `Must have ReportsHealth (0x${AgentCapabilities.ReportsHealth.toString(16)}), got caps=0x${caps.toString(16)}`,
          ).toBe(AgentCapabilities.ReportsHealth);
        }

        // Capabilities must be stable — exact value shouldn't change between runs.
        // If a future collector version changes capabilities, the test documents
        // the change and we update the expected value.
        // Note: ReportsHeartbeat (0x2000) is NOT set by the opamp extension even
        // though heartbeats work — the extension doesn't advertise optional behaviors.
      });

      it("no persistent errors in container logs", () => {
        const logs = getCollectorLogs(version);
        // Filter out known-benign messages
        const errorLines = logs
          .split("\n")
          .filter((l) => l.toLowerCase().includes("error"))
          .filter((l) => !l.includes("Development component"))
          .filter((l) => !l.includes("Cannot connect"))
          .filter((l) => !l.includes("will retry"))
          .filter((l) => !l.includes("context canceled"));

        const result = results.find((r) => r.version === version.tag);
        if (result && errorLines.length > 0) {
          result.errors.push(...errorLines.slice(0, 5));
        }

        // Zero persistent errors expected in a clean start
        expect(
          errorLines.length,
          `Unexpected errors in collector logs:\n${errorLines.join("\n")}`,
        ).toBe(0);
      });
    });
  }
});
