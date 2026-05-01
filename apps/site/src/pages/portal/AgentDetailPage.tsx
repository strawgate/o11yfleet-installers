import { useState, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useConfiguration,
  useAgentDetail,
  useConfigurationStats,
  type AgentDetail,
  type AgentDescription,
} from "../../api/hooks/portal";
import { LoadingSpinner } from "../../components/common/LoadingSpinner";
import { ErrorState } from "../../components/common/ErrorState";
import { relTime } from "../../utils/format";
import { hashLabel } from "../../utils/agents";
import {
  parsePipelineTopology,
  extractAgentIdentity,
  type PipelineTopology,
  type PipelineComponent,
  type ComponentHealthEntry,
} from "../../utils/pipeline";

type Tab = "overview" | "pipeline" | "config";

export default function AgentDetailPage() {
  const { configId, agentUid } = useParams<{ configId: string; agentUid: string }>();
  // The hook is `enabled` only when both ids are present, so it's safe to
  // call unconditionally — but we still surface a clear error to the user
  // if the URL is malformed instead of leaving the page in a perpetual
  // loading state.
  const config = useConfiguration(configId);
  const agentQuery = useAgentDetail(configId, agentUid);
  const stats = useConfigurationStats(configId);
  const [tab, setTab] = useState<Tab>("overview");

  const agent = agentQuery.data ?? null;

  // Parse agent_description (the detail endpoint returns it parsed)
  const agentDesc: AgentDescription | null = useMemo(() => {
    if (!agent) return null;
    return typeof agent.agent_description === "string"
      ? safeJsonParse(agent.agent_description)
      : ((agent.agent_description as AgentDescription | null) ?? null);
  }, [agent]);

  const identity = useMemo(() => extractAgentIdentity(agentDesc), [agentDesc]);

  // Parse pipeline topology
  const topology = useMemo(
    () =>
      parsePipelineTopology(
        (agent?.effective_config_body as string | null) ?? null,
        (agent?.component_health_map as Record<string, ComponentHealthEntry> | null) ?? null,
      ),
    [agent?.effective_config_body, agent?.component_health_map],
  );

  if (!configId || !agentUid) {
    return <ErrorState error={new Error("Missing configuration or agent id in URL")} />;
  }
  if (config.isLoading || agentQuery.isLoading) return <LoadingSpinner />;
  if (config.error) return <ErrorState error={config.error} retry={() => void config.refetch()} />;
  if (agentQuery.error)
    return <ErrorState error={agentQuery.error} retry={() => void agentQuery.refetch()} />;
  if (!agent) return <ErrorState error={new Error("Agent not found")} />;

  const desiredHash =
    agent.desired_config_hash ??
    stats.data?.desired_config_hash ??
    (config.data?.["current_config_hash"] as string | undefined);
  const currentHash = agent.current_config_hash;
  const healthy =
    agent.healthy === true || agent.healthy === 1
      ? true
      : agent.healthy === false || agent.healthy === 0
        ? false
        : null;
  const acceptsRemoteConfig = (Number(agent.capabilities) & 0x02) !== 0;
  const drift = acceptsRemoteConfig
    ? (agent.is_drifted ?? (currentHash && desiredHash ? currentHash !== desiredHash : false))
    : false;
  const isConnected =
    agent.is_connected === true ? true : agent.is_connected === false ? false : null;

  const hostname = identity.hostname ?? agentUid;
  const capabilities = parseCapabilities(agent.capabilities as number | null);

  return (
    <div className="main-wide">
      {/* Header */}
      <div className="page-head mt-6">
        <div>
          <h1>{hostname}</h1>
          <p className="meta">
            {identity.serviceName && (
              <span>
                {identity.serviceName}
                {identity.serviceVersion && ` v${identity.serviceVersion}`}
                {" · "}
              </span>
            )}
            Configuration:{" "}
            <Link to={`/portal/configurations/${configId}`}>{config.data?.name ?? configId}</Link>
          </p>
        </div>
        <div className="flex gap-2">
          <ConnectionBadge connected={isConnected} />
          <StatusBadge status={agent.status as string} />
          <HealthBadge healthy={healthy} />
          <ConfigBadge
            drift={drift}
            currentHash={currentHash}
            acceptsRemoteConfig={acceptsRemoteConfig}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs mt-6">
        <button
          className={`tab ${tab === "overview" ? "tab-active" : ""}`}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          className={`tab ${tab === "pipeline" ? "tab-active" : ""}`}
          onClick={() => setTab("pipeline")}
        >
          Pipeline
        </button>
        <button
          className={`tab ${tab === "config" ? "tab-active" : ""}`}
          onClick={() => setTab("config")}
        >
          Configuration
        </button>
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <OverviewTab
          agent={agent}
          identity={identity}
          agentUid={agentUid!}
          healthy={healthy}
          isConnected={isConnected}
          drift={drift}
          desiredHash={desiredHash}
          currentHash={currentHash}
          capabilities={capabilities}
          topology={topology}
        />
      )}
      {tab === "pipeline" && <PipelineTab topology={topology} />}
      {tab === "config" && (
        <ConfigTab
          effectiveConfig={agent.effective_config_body as string | null}
          effectiveHash={agent.effective_config_hash as string | null}
          desiredHash={desiredHash}
        />
      )}
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────

/** Recursively count leaf components in a component_health_map. */
function countLeaves(map: Record<string, ComponentHealthEntry>): {
  total: number;
  healthy: number;
  degraded: number;
} {
  let total = 0,
    healthy = 0,
    degraded = 0;
  for (const entry of Object.values(map)) {
    if (entry.component_health_map && Object.keys(entry.component_health_map).length > 0) {
      const sub = countLeaves(entry.component_health_map);
      total += sub.total;
      healthy += sub.healthy;
      degraded += sub.degraded;
    } else {
      total++;
      if (entry.healthy === true) healthy++;
      else if (entry.healthy === false) degraded++;
    }
  }
  return { total, healthy, degraded };
}

function OverviewTab({
  agent,
  identity,
  agentUid,
  healthy,
  isConnected,
  drift,
  desiredHash,
  currentHash,
  capabilities,
  topology,
}: {
  agent: AgentDetail;
  identity: ReturnType<typeof extractAgentIdentity>;
  agentUid: string;
  healthy: boolean | null;
  isConnected: boolean | null;
  drift: boolean;
  desiredHash: string | undefined;
  currentHash: string | null | undefined;
  capabilities: string[];
  topology: PipelineTopology | null;
}) {
  // Count components from topology if available, otherwise from component_health_map
  const healthMap = agent.component_health_map as Record<string, ComponentHealthEntry> | null;
  let componentCount = 0;
  let healthyComponents = 0;
  let degradedComponents = 0;
  if (topology) {
    const all = [
      ...topology.receivers,
      ...topology.processors,
      ...topology.exporters,
      ...topology.extensions,
    ];
    componentCount = all.length;
    healthyComponents = all.filter((c) => c.healthy === true).length;
    degradedComponents = all.filter((c) => c.healthy === false).length;
  } else if (healthMap) {
    const counts = countLeaves(healthMap);
    componentCount = counts.total;
    healthyComponents = counts.healthy;
    degradedComponents = counts.degraded;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      {/* Identity card */}
      <div className="card card-pad">
        <h3 className="card-title">Identity</h3>
        <dl className="detail-list">
          <dt>Instance UID</dt>
          <dd className="mono-cell text-sm">{agentUid}</dd>
          <dt>Hostname</dt>
          <dd>{identity.hostname ?? "—"}</dd>
          <dt>Service</dt>
          <dd>
            {identity.serviceName ?? "—"}
            {identity.serviceVersion && (
              <span className="meta ml-1">v{identity.serviceVersion}</span>
            )}
          </dd>
          <dt>OS</dt>
          <dd>
            {identity.osType ?? "—"}
            {identity.hostArch && <span className="meta ml-1">({identity.hostArch})</span>}
            {identity.osDescription && (
              <p className="meta text-xs mt-0.5">{identity.osDescription}</p>
            )}
          </dd>
          <dt>Connection</dt>
          <dd>
            <ConnectionBadge connected={isConnected} />
            {isConnected && agent.uptime_ms !== null && agent.uptime_ms !== undefined && (
              <span className="meta ml-2">uptime {formatDuration(agent.uptime_ms)}</span>
            )}
          </dd>
          <dt>Generation</dt>
          <dd>{agent.generation ?? "—"}</dd>
          <dt>First connected</dt>
          <dd>{relTime(tsToIso(agent.connected_at))}</dd>
          <dt>Last seen</dt>
          <dd>{relTime(tsToIso(agent.last_seen_at))}</dd>
        </dl>
      </div>

      {/* Health card */}
      <div className="card card-pad">
        <h3 className="card-title">Health</h3>
        <dl className="detail-list">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={agent.status as string} />
          </dd>
          <dt>Healthy</dt>
          <dd>
            <HealthBadge healthy={healthy} />
          </dd>
          <dt>Components</dt>
          <dd>
            {componentCount > 0 ? (
              <span>
                {componentCount} total
                {healthyComponents > 0 && (
                  <span className="text-green-600 ml-1">({healthyComponents} ok)</span>
                )}
                {degradedComponents > 0 && (
                  <span className="text-amber-600 ml-1">({degradedComponents} degraded)</span>
                )}
              </span>
            ) : (
              "—"
            )}
          </dd>
          <dt>Last error</dt>
          <dd className={agent.last_error ? "text-red-600" : ""}>
            {(agent.last_error as string) || "—"}
          </dd>
        </dl>
      </div>

      {/* Configuration card */}
      <div className="card card-pad">
        <h3 className="card-title">Configuration</h3>
        <dl className="detail-list">
          <dt>Config sync</dt>
          <dd>
            <ConfigBadge
              drift={drift}
              currentHash={currentHash}
              acceptsRemoteConfig={capabilities.includes("AcceptsRemoteConfig")}
            />
          </dd>
          <dt>Desired hash</dt>
          <dd className="mono-cell text-sm">{hashLabel(desiredHash)}</dd>
          <dt>Current hash</dt>
          <dd className="mono-cell text-sm">{hashLabel(currentHash)}</dd>
          <dt>Effective config hash</dt>
          <dd className="mono-cell text-sm">
            {hashLabel(agent.effective_config_hash as string | undefined)}
          </dd>
        </dl>
      </div>

      {/* Capabilities card */}
      <div className="card card-pad">
        <h3 className="card-title">Capabilities</h3>
        {capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {capabilities.map((cap) => (
              <span key={cap} className="tag">
                {cap}
              </span>
            ))}
          </div>
        ) : (
          <p className="meta mt-2">No capabilities reported</p>
        )}
      </div>
    </div>
  );
}

// ─── Pipeline Tab ──────────────────────────────────────────────────

function PipelineTab({ topology }: { topology: PipelineTopology | null }) {
  if (!topology) {
    return (
      <div className="card card-pad mt-4">
        <p className="meta">No effective configuration reported — pipeline cannot be visualized.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Pipeline flow */}
      <div className="card card-pad">
        <h3 className="card-title mb-3">Pipeline Flow</h3>
        {topology.pipelines.length === 0 ? (
          <p className="meta">No pipelines defined in service configuration.</p>
        ) : (
          <div className="space-y-4">
            {topology.pipelines.map((pipeline) => (
              <div key={pipeline.name} className="pipeline-row">
                <div className="pipeline-label">{pipeline.name}</div>
                <div className="pipeline-flow">
                  <ComponentGroup
                    label="Receivers"
                    names={pipeline.receivers}
                    components={topology.receivers}
                  />
                  <PipelineArrow />
                  <ComponentGroup
                    label="Processors"
                    names={pipeline.processors}
                    components={topology.processors}
                  />
                  <PipelineArrow />
                  <ComponentGroup
                    label="Exporters"
                    names={pipeline.exporters}
                    components={topology.exporters}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Extensions */}
      {topology.extensions.length > 0 && (
        <div className="card card-pad">
          <h3 className="card-title mb-3">Extensions</h3>
          <div className="flex flex-wrap gap-2">
            {topology.extensions.map((ext) => (
              <ComponentChip key={ext.name ?? ext.type} component={ext} />
            ))}
          </div>
        </div>
      )}

      {/* Component detail table */}
      <div className="card card-pad">
        <h3 className="card-title mb-3">All Components</h3>
        <table className="dt">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Health</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...topology.receivers.map((c) => ({ ...c, category: "receiver" })),
              ...topology.processors.map((c) => ({ ...c, category: "processor" })),
              ...topology.exporters.map((c) => ({ ...c, category: "exporter" })),
              ...topology.extensions.map((c) => ({ ...c, category: "extension" })),
            ].map((c) => (
              <tr key={`${c.category}-${c.name}`}>
                <td className="meta">{c.category}</td>
                <td className="mono-cell">{c.name}</td>
                <td>
                  <ComponentHealthDot healthy={c.healthy} />
                </td>
                <td className="text-sm">{c.status ?? c.lastError ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComponentGroup({
  label,
  names,
  components,
}: {
  label: string;
  names: string[];
  components: PipelineComponent[];
}) {
  const matched = names.map(
    (name) => components.find((c) => c.type === name) ?? { name, type: name, healthy: null },
  );

  return (
    <div className="pipeline-group">
      <div className="pipeline-group-label">{label}</div>
      <div className="pipeline-group-items">
        {matched.map((c) => (
          <ComponentChip key={c.name ?? c.type} component={c} />
        ))}
      </div>
    </div>
  );
}

function ComponentChip({ component }: { component: PipelineComponent }) {
  return (
    <div
      className={`component-chip ${
        component.healthy === false
          ? "component-chip-err"
          : component.healthy === true
            ? "component-chip-ok"
            : ""
      }`}
      title={component.lastError ?? component.status ?? component.type}
    >
      <ComponentHealthDot healthy={component.healthy} />
      <span>{component.type}</span>
    </div>
  );
}

function ComponentHealthDot({ healthy }: { healthy: boolean | null }) {
  if (healthy === true) return <span className="health-dot health-dot-ok" />;
  if (healthy === false) return <span className="health-dot health-dot-err" />;
  return <span className="health-dot health-dot-unknown" />;
}

function PipelineArrow() {
  return <div className="pipeline-arrow">→</div>;
}

// ─── Config Tab ────────────────────────────────────────────────────

function ConfigTab({
  effectiveConfig,
  effectiveHash,
  desiredHash,
}: {
  effectiveConfig: string | null;
  effectiveHash: string | null;
  desiredHash: string | undefined;
}) {
  if (!effectiveConfig) {
    return (
      <div className="card card-pad mt-4">
        <p className="meta">No effective configuration has been reported by this agent.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-3">
          <h3 className="card-title">Effective Configuration</h3>
          <div className="flex items-center gap-3">
            <span className="meta text-xs">
              Hash: <code className="mono-cell">{hashLabel(effectiveHash, 12)}</code>
            </span>
            <CopyButton text={effectiveConfig} />
          </div>
        </div>
        {desiredHash && effectiveHash && desiredHash !== effectiveHash && (
          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3 text-sm text-amber-800">
            ⚠ Effective config hash differs from desired config hash — agent may have additional
            local configuration.
          </div>
        )}
        <pre className="config-viewer">{effectiveConfig}</pre>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-sm"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => {
            /* clipboard not available */
          },
        );
      }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

// ─── Badge Components ──────────────────────────────────────────────

function StatusBadge({ status }: { status: string | undefined }) {
  const okStatuses = ["connected", "running", "starting"];
  const warnStatuses = ["degraded", "stopping"];
  const cls = okStatuses.includes(status ?? "")
    ? "tag-ok"
    : warnStatuses.includes(status ?? "")
      ? "tag-warn"
      : "tag-err";
  return <span className={`tag ${cls}`}>{status ?? "unknown"}</span>;
}

function ConnectionBadge({ connected }: { connected: boolean | null }) {
  return (
    <span className={`tag ${connected === true ? "tag-ok" : connected === false ? "tag-err" : ""}`}>
      {connected === true ? "● connected" : connected === false ? "○ disconnected" : "unknown"}
    </span>
  );
}

function HealthBadge({ healthy }: { healthy: boolean | null }) {
  return (
    <span className={`tag ${healthy === true ? "tag-ok" : healthy === false ? "tag-err" : ""}`}>
      {healthy === true ? "healthy" : healthy === false ? "unhealthy" : "unknown"}
    </span>
  );
}

function ConfigBadge({
  drift,
  currentHash,
  acceptsRemoteConfig,
}: {
  drift: boolean;
  currentHash: string | null | undefined;
  acceptsRemoteConfig?: boolean;
}) {
  if (acceptsRemoteConfig === false) return <span className="tag">n/a</span>;
  if (drift) return <span className="tag tag-warn">config drift</span>;
  if (currentHash) return <span className="tag tag-ok">in sync</span>;
  return <span className="tag">not reported</span>;
}

// ─── Helpers ───────────────────────────────────────────────────────

function safeJsonParse(str: string): AgentDescription | null {
  try {
    return JSON.parse(str) as AgentDescription;
  } catch {
    return null;
  }
}

const CAPABILITY_NAMES: Record<number, string> = {
  0x01: "ReportsStatus",
  0x02: "AcceptsRemoteConfig",
  0x04: "ReportsEffectiveConfig",
  0x08: "AcceptsPackages",
  0x10: "ReportsPackageStatuses",
  0x20: "ReportsOwnTraces",
  0x40: "ReportsOwnMetrics",
  0x80: "ReportsOwnLogs",
  0x100: "AcceptsOpAMPConnectionSettings",
  0x200: "AcceptsOtherConnectionSettings",
  0x400: "AcceptsRestartCommand",
  0x800: "ReportsHealth",
  0x1000: "ReportsRemoteConfig",
};

function parseCapabilities(caps: number | null): string[] {
  if (!caps) return [];
  const result: string[] = [];
  for (const [bit, name] of Object.entries(CAPABILITY_NAMES)) {
    if (caps & Number(bit)) result.push(name);
  }
  return result;
}

function tsToIso(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value > 0 ? new Date(value).toISOString() : undefined;
  return value;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
