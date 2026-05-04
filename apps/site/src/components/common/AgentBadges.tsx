import { StatusBadge as AppStatusBadge } from "@/components/app";
import { agentStatusView } from "@/pages/portal/agent-view-model";
import type { ConfigSyncView } from "@/pages/portal/agent-detail-model";

export function StatusBadge({ status }: { status: string | undefined }) {
  const view = agentStatusView(status);
  return <AppStatusBadge tone={view.tone}>{view.label}</AppStatusBadge>;
}

export function ConnectionBadge({ connected }: { connected: boolean | null }) {
  return (
    <AppStatusBadge tone={connected === true ? "ok" : connected === false ? "error" : "neutral"}>
      {connected === true ? "● connected" : connected === false ? "○ disconnected" : "unknown"}
    </AppStatusBadge>
  );
}

export function HealthBadge({ healthy }: { healthy: boolean | null }) {
  return (
    <AppStatusBadge tone={healthy === true ? "ok" : healthy === false ? "error" : "neutral"}>
      {healthy === true ? "healthy" : healthy === false ? "unhealthy" : "unknown"}
    </AppStatusBadge>
  );
}

export function ConfigBadge({ sync }: { sync: ConfigSyncView }) {
  return <AppStatusBadge tone={sync.tone}>{sync.label}</AppStatusBadge>;
}
